// @vitest-environment jsdom
/**
 * The retry must never make a second record. The case throughout: the
 * server stores the first request, the client sees a network failure, and
 * the same operation is tried again — exactly one logical record must exist.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

/* A fake Supabase client with one table, `customer_activity`, that keeps rows
   under their primary key and can drop the answer to a request after storing it. */
const table = new Map<string, any>();
let dropAnswerOnce = false;
const fakeDb = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-1' } } } }) },
    from: (name: string) => {
        if (name !== 'customer_activity') throw new Error('unexpected table ' + name);
        return {
            insert: (row: any) => ({
                select: () => ({
                    single: async () => {
                        const id = row.id || `srv-${table.size + 1}`;
                        if (table.has(id)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "customer_activity_pkey"' } };
                        const stored = { ...row, id, created_at: new Date().toISOString() };
                        table.set(id, stored);
                        if (dropAnswerOnce) { dropAnswerOnce = false; return { data: null, error: { message: 'TypeError: Failed to fetch' } }; }
                        return { data: stored, error: null };
                    },
                }),
            }),
            select: () => ({ eq: (_col: string, id: string) => ({ single: async () => (table.has(id) ? { data: table.get(id), error: null } : { data: null, error: { message: 'not found' } }) }) }),
        };
    },
};
vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => fakeDb, isSupabaseConfigured: true }));

import * as repo from '../services/repository';
import { useCollectionSync } from '../services/useSupabaseSync';
import { replaceOrAdd } from '../services/refresh';
import { newEntryId } from '../services/ids';
import CustomerActivityPanel from '../components/CustomerActivityPanel';
import { CustomerEditModal } from '../components/CustomerEditModal';
import PdcModal from '../components/PdcModal';
import { Outstanding, PdcCheque, PdcStatus } from '../types';
import { mixedAccount, adminUser, crmUser, collectorUser } from './fixtures';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
beforeEach(() => { table.clear(); dropAnswerOnce = false; });
afterEach(cleanup);

describe('activity entries and promises', () => {
    it('addActivity with a client id: stored once, the lost answer recovered on the retry', async () => {
        const id = newEntryId();
        const entry = { id, customerId: 'cust_a', kind: 'promise' as const, body: 'Will pay Friday', promisedAmount: 50000, promisedOn: '2026-09-19' };
        dropAnswerOnce = true;
        await expect(repo.addActivity(entry, crmUser())).rejects.toThrow(/Failed to fetch/);
        expect(table.size).toBe(1);                         // the server did store it
        const saved = await repo.addActivity(entry, crmUser());   // the retry
        expect(table.size).toBe(1);                         // still exactly one
        expect(saved.id).toBe(id);
        expect(saved.body).toBe('Will pay Friday');
    });

    it('the composer keeps one id for the entry until it is saved, so a second Post is the same entry', async () => {
        const spy = vi.spyOn(repo, 'addActivity');
        dropAnswerOnce = true;
        render(<CustomerActivityPanel customer={mixedAccount()} currentUser={crmUser()} />);
        await waitFor(() => expect(screen.getByLabelText('What happened')).toBeTruthy());
        fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Spoke to Ramesh' } });
        const post = () => fireEvent.click(screen.getByRole('button', { name: /log it|saving/i }));
        post();
        await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(document.body.textContent).toMatch(/Failed to fetch|Could not/));
        expect((screen.getByLabelText('What happened') as HTMLTextAreaElement).value).toBe('Spoke to Ramesh');   // kept
        post();                                                                                       // try again
        await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
        const [first, second] = spy.mock.calls.map(c => (c[0] as any).id);
        expect(first).toBeTruthy();
        expect(second).toBe(first);
        await waitFor(() => expect(table.size).toBe(1));
        await waitFor(() => expect((screen.getByLabelText('What happened') as HTMLTextAreaElement).value).toBe(''));   // saved: composer cleared
        spy.mockRestore();
    });
});

describe('new cheques', () => {
    const customer = mixedAccount();
    const fill = () => {
        fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'TEST MIXED' } });
        fireEvent.click(screen.getByRole('option', { name: /TEST MIXED UDYOG/ }));
        fireEvent.change(screen.getByPlaceholderText('e.g. 004821'), { target: { value: '000777' } });
        fireEvent.change(screen.getByPlaceholderText('e.g. 50000'), { target: { value: '15000' } });
        fireEvent.change(screen.getByLabelText('Bank'), { target: { value: 'SBI' } });
        fireEvent.change(screen.getByLabelText('Dated'), { target: { value: '2026-12-01' } });
    };
    it('the dialog keeps one id for the cheque it is composing; a Save pressed again carries the same id', async () => {
        const onSave = vi.fn(async (_c: Omit<PdcCheque, 'id'> & { id?: string }) => ({ ok: false as const, message: 'no connection to the server' }));
        render(<PdcModal isOpen customers={[customer]} currentUser={crmUser()} onClose={() => {}} onSave={onSave} />);
        fill();
        fireEvent.click(screen.getByRole('button', { name: /record cheque/i }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(document.body.textContent).toMatch(/Not saved/));
        fireEvent.click(screen.getByRole('button', { name: /record cheque/i }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
        const ids = onSave.mock.calls.map(c => c[0].id);
        expect(ids[0]).toMatch(/^pdc_/);
        expect(ids[1]).toBe(ids[0]);
    });
    it('the list keeps one cheque under that id, and the hook upserts it once whatever the answer said', async () => {
        const c = { id: 'pdc_1', customerId: customer.id, customerName: customer.company, chequeNumber: '000777', bankName: 'SBI', chequeDate: new Date('2026-12-01T00:00:00Z'), amount: 15000, status: PdcStatus.Pending, receivedDate: new Date('2026-09-17T00:00:00Z') } as PdcCheque;
        let list = replaceOrAdd([] as PdcCheque[], c);
        list = replaceOrAdd(list, { ...c, amount: 16000 });         // Save again after a refusal
        expect(list).toHaveLength(1);
        expect(list[0].amount).toBe(16000);

        vi.useFakeTimers();
        const server = new Map<string, PdcCheque>();
        let lose = true;
        const upsert = vi.fn(async (rows: PdcCheque[]) => { rows.forEach(r => server.set(r.id, r)); if (lose) { lose = false; throw new Error('Failed to fetch'); } });
        const hook = renderHook(({ rows }: { rows: PdcCheque[] }) => useCollectionSync({ rows, enabled: true, label: 'PDC cheques', toSignature: (r) => JSON.stringify(r), upsert, delayMs: 100, retryDelaysMs: [500] }), { initialProps: { rows: [] as PdcCheque[] } });
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
        hook.rerender({ rows: list });
        await act(async () => { await vi.advanceTimersByTimeAsync(150); });   // stored, answer lost
        expect(upsert).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(600); });   // automatic retry
        expect(upsert).toHaveBeenCalledTimes(2);
        expect(server.size).toBe(1);
        expect(hook.result.current.pendingIds()).toEqual([]);
        vi.useRealTimers();
    });
});

describe('new customers', () => {
    it('the edit dialog fixes a new account\'s id on the first Save; a Save pressed again is the same account', async () => {
        const onSave = vi.fn(async (_c: Outstanding) => ({ ok: false as const, message: 'no connection to the server' }));
        render(<CustomerEditModal customerToEdit={null} onSave={onSave} onClose={() => {}} currentUser={adminUser()} users={[adminUser(), crmUser(), collectorUser()]} />);
        fireEvent.change(screen.getByPlaceholderText('e.g. SHREE RAM INDUSTRIES PVT LTD'), { target: { value: 'BRAND NEW FIRM' } });
        const owner = document.querySelector('select') as HTMLSelectElement;
        const option = [...owner.options].find(o => o.value && o.value !== '')!;
        fireEvent.change(owner, { target: { value: option.value } });
        fireEvent.click(screen.getByRole('button', { name: /add customer/i }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(document.body.textContent).toMatch(/Not saved/));
        fireEvent.click(screen.getByRole('button', { name: /add customer/i }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
        const ids = onSave.mock.calls.map(c => c[0].id);
        expect(ids[0]).toMatch(/^cust_/);
        expect(ids[1]).toBe(ids[0]);
    });

    it('the hook upserts a new account once under its id, whatever happened to the first answer', async () => {
        vi.useFakeTimers();
        const server = new Map<string, Outstanding>();
        let lose = true;
        const fresh = { ...mixedAccount(), id: 'cust_1758000000_BRAND_NEW', company: 'BRAND NEW FIRM' };
        const upsert = vi.fn(async (rows: Outstanding[]) => { rows.forEach(r => server.set(r.id, r)); if (lose) { lose = false; throw new Error('Failed to fetch'); } });
        const partial = { toRow: repo.outstandingToRow, diff: repo.customerRowDiff, update: vi.fn(async () => {}) };
        const hook = renderHook(({ rows }: { rows: Outstanding[] }) => useCollectionSync<Outstanding, repo.CustomerRow>({ rows, enabled: true, label: 'customers', toSignature: (c) => JSON.stringify(repo.outstandingToRow(c)), upsert, partial, delayMs: 100, retryDelaysMs: [500] }), { initialProps: { rows: [] as Outstanding[] } });
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
        hook.rerender({ rows: [fresh] });
        await act(async () => { await vi.advanceTimersByTimeAsync(150); });
        await act(async () => { await vi.advanceTimersByTimeAsync(600); });
        expect(upsert).toHaveBeenCalledTimes(2);
        expect(server.size).toBe(1);
        expect(partial.update).not.toHaveBeenCalled();       // never re-sent as an update either
        expect(hook.result.current.pendingIds()).toEqual([]);
        vi.useRealTimers();
    });
});

describe('follow-up actions and other updates', () => {
    it('a column update retried after a lost answer writes the same columns to the same row — one record, same values', async () => {
        vi.useFakeTimers();
        const server = new Map<string, Record<string, unknown>>();
        let lose = true;
        const a = mixedAccount();
        server.set(a.id, repo.outstandingToRow(a) as unknown as Record<string, unknown>);
        const update = vi.fn(async (id: string, changes: Partial<repo.CustomerRow>) => { server.set(id, { ...server.get(id)!, ...changes }); if (lose) { lose = false; throw new Error('Failed to fetch'); } });
        const partial = { toRow: repo.outstandingToRow, diff: repo.customerRowDiff, update };
        const hook = renderHook(({ rows }: { rows: Outstanding[] }) => useCollectionSync<Outstanding, repo.CustomerRow>({ rows, enabled: true, label: 'customers', toSignature: (c) => JSON.stringify(repo.outstandingToRow(c)), upsert: async () => {}, partial, delayMs: 100, retryDelaysMs: [500] }), { initialProps: { rows: [a] } });
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
        hook.rerender({ rows: [{ ...a, followUpDate: new Date('2026-12-01T00:00:00Z'), isUrgent: true }] });
        await act(async () => { await vi.advanceTimersByTimeAsync(150); });
        await act(async () => { await vi.advanceTimersByTimeAsync(600); });
        expect(update).toHaveBeenCalledTimes(2);
        expect(update.mock.calls[0]).toEqual(update.mock.calls[1]);          // identical, repeatable
        expect(server.size).toBe(1);
        expect(server.get(a.id)!.is_urgent).toBe(true);
        vi.useRealTimers();
    });
});
