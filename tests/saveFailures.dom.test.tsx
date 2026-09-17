// @vitest-environment jsdom
/**
 * A refused save must not look like a success. The hook reports it, keeps
 * the change pending, retries on its own and on demand; the dialogs wait for
 * the verdict and stay open with everything typed when it is "no"; the
 * header line says what is saved and what is not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));
vi.mock('../services/repository', async (importOriginal) => {
    const real = await importOriginal<typeof import('../services/repository')>();
    return { ...real, fetchActivity: vi.fn(async () => []), addActivity: vi.fn(async () => undefined), deleteActivity: vi.fn(async () => undefined) };
});

import { useCollectionSync, SyncStatus, outcomeFor } from '../services/useSupabaseSync';
import { outstandingToRow, customerRowDiff, CustomerRow } from '../services/repository';
import { SaveStatus, combineStatus, ago } from '../components/SaveStatus';
import FollowUpModal from '../components/FollowUpModal';
import { CustomerEditModal } from '../components/CustomerEditModal';
import PdcModal from '../components/PdcModal';
import { Outstanding } from '../types';
import { mixedAccount, adminUser, crmUser, collectorUser } from './fixtures';

if (!window.matchMedia) {
    (window as any).matchMedia = (media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);

/* ------------------------------------------------------------------ hook */

function harness(initial: Outstanding[]) {
    const statuses: SyncStatus[] = [];
    let failWith: Error | null = null;
    const updates: { id: string; changes: Partial<CustomerRow> }[] = [];
    const partial = {
        toRow: outstandingToRow,
        diff: customerRowDiff,
        update: vi.fn(async (id: string, changes: Partial<CustomerRow>) => {
            if (failWith) throw failWith;
            updates.push({ id, changes });
        }),
    };
    const hook = renderHook(
        ({ rows }: { rows: Outstanding[] }) => useCollectionSync<Outstanding, CustomerRow>({
            rows, enabled: true, label: 'customers',
            toSignature: (c) => JSON.stringify(outstandingToRow(c)),
            upsert: async () => {}, partial, delayMs: 100, retryDelaysMs: [1000, 3000],
            onStatus: (s) => statuses.push(s),
        }),
        { initialProps: { rows: initial } },
    );
    return {
        hook, statuses, updates, update: partial.update,
        setFailure: (e: Error | null) => { failWith = e; },
        last: () => statuses[statuses.length - 1],
    };
}

describe('the sync hook when the server refuses a write', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('flush() reports the refusal for that row, keeps it pending, and says so through onStatus', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });   // seed
        h.setFailure(new Error('permission denied for table customers'));
        h.hook.rerender({ rows: [{ ...a, isUrgent: true }] });
        let result: any;
        // flush() lets React commit first (a 0 ms tick), which fake timers must be nudged through.
        await act(async () => { const p = h.hook.result.current.flush(); await vi.advanceTimersByTimeAsync(10); result = await p; });
        expect(result.failed).toEqual([{ id: a.id, message: 'permission denied for table customers' }]);
        expect(outcomeFor(a.id, result)).toEqual({ ok: false, message: 'permission denied for table customers' });
        expect(h.hook.result.current.pendingIds()).toEqual([a.id]);
        expect(h.last()).toMatchObject({ saving: false, pending: 1, failed: [{ id: a.id, message: 'permission denied for table customers' }] });
        expect(h.last().retryAt).toBeGreaterThan(Date.now());
    });

    it('retries on its own with backoff, and clears the failure once the server accepts', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
        h.setFailure(new Error('network down'));
        h.hook.rerender({ rows: [{ ...a, isUrgent: true }] });
        await act(async () => { await vi.advanceTimersByTimeAsync(150); });      // debounced pass: refused
        expect(h.update).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });     // first retry (1 s): still refused
        expect(h.update).toHaveBeenCalledTimes(2);
        h.setFailure(null);
        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });     // second retry (3 s): accepted
        expect(h.update).toHaveBeenCalledTimes(3);
        expect(h.updates).toEqual([{ id: a.id, changes: { is_urgent: true } }]);
        expect(h.last()).toMatchObject({ pending: 0, failed: [], retryAt: null });
        expect(h.last().lastSavedAt).toBeTruthy();
        expect(h.hook.result.current.pendingIds()).toEqual([]);
    });

    it('retries when the tab comes back (focus) and when the network returns (online)', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
        h.setFailure(new Error('offline'));
        h.hook.rerender({ rows: [{ ...a, isUrgent: true }] });
        await act(async () => { await vi.advanceTimersByTimeAsync(150); });
        expect(h.update).toHaveBeenCalledTimes(1);
        h.setFailure(null);
        await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(10); });
        expect(h.update).toHaveBeenCalledTimes(2);
        expect(h.last().failed).toEqual([]);
        // nothing left to retry: another focus does not write again
        await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10); });
        expect(h.update).toHaveBeenCalledTimes(2);
    });

    it('retry() runs at once (the "Retry now" button) and a second edit meanwhile is carried with the first', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
        h.setFailure(new Error('nope'));
        h.hook.rerender({ rows: [{ ...a, isUrgent: true }] });
        await act(async () => { await vi.advanceTimersByTimeAsync(150); });
        h.hook.rerender({ rows: [{ ...a, isUrgent: true, contactNumber: '9811111111' }] });
        h.setFailure(null);
        let result: any;
        await act(async () => { result = await h.hook.result.current.retry(); });
        expect(result.failed).toEqual([]);
        expect(h.updates.pop()).toEqual({ id: a.id, changes: { is_urgent: true, contact_number: '9811111111' } });
    });

    it('accept() moves the baseline to server rows without writing them; forget() drops a row without deleting it', async () => {
        const a = mixedAccount();
        const remove = vi.fn(async () => {});
        const statuses: SyncStatus[] = [];
        const partial = { toRow: outstandingToRow, diff: customerRowDiff, update: vi.fn(async () => {}) };
        const hook = renderHook(
            ({ rows }: { rows: Outstanding[] }) => useCollectionSync<Outstanding, CustomerRow>({
                rows, enabled: true, label: 'customers', toSignature: (c) => JSON.stringify(outstandingToRow(c)),
                upsert: async () => {}, remove, partial, delayMs: 100, onStatus: (s) => statuses.push(s),
            }),
            { initialProps: { rows: [a] } },
        );
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
        const fromServer: Outstanding = { ...a, notes: [...a.notes, 'a colleague wrote this'] };
        const gone = { ...mixedAccount(), id: 'cust_gone' };
        act(() => { hook.result.current.accept([fromServer]); hook.result.current.forget([gone.id]); });
        hook.rerender({ rows: [fromServer] });
        await act(async () => { await vi.advanceTimersByTimeAsync(150); });
        expect(partial.update).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
        expect(hook.result.current.pendingIds()).toEqual([]);
    });
});

/* ------------------------------------------------------------- dialogs */

const refusal = { ok: false as const, message: 'permission denied for table customers' };

describe('the follow-up dialog on a refused save', () => {
    it('stays open, says why, keeps what was typed, and never called onClose', async () => {
        const onUpdate = vi.fn(async () => refusal);
        const onClose = vi.fn();
        render(<FollowUpModal customer={mixedAccount()} currentUser={crmUser()} onClose={onClose} onUpdate={onUpdate} users={[adminUser(), crmUser(), collectorUser()]} templates={[]} />);
        fireEvent.click(document.querySelector('#isUrgent')!);
        fireEvent.click(screen.getByRole('button', { name: /save follow-up/i }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Not saved: permission denied/));
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect((onUpdate.mock.calls[0] as any)[0].isUrgent).toBe(true);
        expect(onClose).not.toHaveBeenCalled();
        expect((document.querySelector('#isUrgent') as HTMLInputElement).checked).toBe(true);   // still as typed
        expect((screen.getByRole('button', { name: /save follow-up/i }) as HTMLButtonElement).disabled).toBe(false); // can try again
    });

    it('closes when the server accepts, and when the caller answers nothing (older callers)', async () => {
        const onClose = vi.fn();
        render(<FollowUpModal customer={mixedAccount()} currentUser={crmUser()} onClose={onClose} onUpdate={vi.fn(async () => ({ ok: true as const }))} users={[adminUser()]} templates={[]} />);
        fireEvent.click(screen.getByRole('button', { name: /save follow-up/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        cleanup();
        const onClose2 = vi.fn();
        render(<FollowUpModal customer={mixedAccount()} currentUser={crmUser()} onClose={onClose2} onUpdate={vi.fn()} users={[adminUser()]} templates={[]} />);
        fireEvent.click(screen.getByRole('button', { name: /save follow-up/i }));
        await waitFor(() => expect(onClose2).toHaveBeenCalledTimes(1));
    });
});

describe('the customer edit dialog on a refused save', () => {
    it('stays open with the error and the typed phone number; the caller decides when it closes', async () => {
        const onSave = vi.fn(async () => refusal);
        const onClose = vi.fn();
        render(<CustomerEditModal customerToEdit={mixedAccount()} onSave={onSave} onClose={onClose} currentUser={crmUser()} users={[adminUser(), crmUser(), collectorUser()]} />);
        const phone = screen.getByDisplayValue('9800000001') as HTMLInputElement;
        fireEvent.change(phone, { target: { value: '9822222222' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Not saved: permission denied/));
        expect(onSave).toHaveBeenCalledTimes(1);
        expect((onSave.mock.calls[0] as any)[0].contactNumber).toBe('9822222222');
        expect(onClose).not.toHaveBeenCalled();
        expect((screen.getByDisplayValue('9822222222') as HTMLInputElement).value).toBe('9822222222');
        expect((screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement).disabled).toBe(false);
    });
});

describe('the cheque dialog on a refused save', () => {
    const customer = mixedAccount();
    const fill = () => {
        fireEvent.change(screen.getByLabelText('Customer Account'), { target: { value: customer.id } });
        fireEvent.change(screen.getByPlaceholderText('e.g. 004821'), { target: { value: '000777' } });
        fireEvent.change(screen.getByPlaceholderText('e.g. 50000'), { target: { value: '15000' } });
        fireEvent.change(screen.getByLabelText('Cheque Date (PDC Date)'), { target: { value: '2026-12-01' } });
    };
    it('stays open and shows the refusal; the cheque is not lost', async () => {
        const onSave = vi.fn(async () => refusal);
        const onClose = vi.fn();
        render(<PdcModal isOpen customers={[customer]} currentUser={crmUser()} onClose={onClose} onSave={onSave} />);
        fill();
        fireEvent.click(screen.getByRole('button', { name: /add pdc cheque/i }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(document.body.textContent).toMatch(/Not saved: permission denied/));
        expect(onClose).not.toHaveBeenCalled();
        expect((onSave.mock.calls[0] as any)[0].chequeNumber).toBe('000777');
        expect((screen.getByRole('button', { name: /add pdc cheque/i }) as HTMLButtonElement).disabled).toBe(false);
    });
    it('closes when accepted', async () => {
        const onClose = vi.fn();
        render(<PdcModal isOpen customers={[customer]} currentUser={crmUser()} onClose={onClose} onSave={vi.fn(async () => ({ ok: true as const }))} />);
        fill();
        fireEvent.click(screen.getByRole('button', { name: /add pdc cheque/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });
});

/* ------------------------------------------------------- the header line */

describe('SaveStatus — the line that is always true', () => {
    const base: SyncStatus = { saving: false, pending: 0, failed: [], lastSavedAt: null, retryAt: null };
    it('says all saved, then saving, then not saved with a retry', () => {
        const onRetry = vi.fn(); const onRefresh = vi.fn();
        const { rerender } = render(<SaveStatus status={base} refreshedAt={null} onRetry={onRetry} onRefresh={onRefresh} />);
        expect(screen.getByRole('status').textContent).toBe('All changes saved');
        rerender(<SaveStatus status={{ ...base, pending: 2 }} refreshedAt={null} onRetry={onRetry} onRefresh={onRefresh} />);
        expect(screen.getByRole('status').textContent).toBe('Saving…');
        rerender(<SaveStatus status={{ ...base, failed: [{ id: 'a', message: 'x' }, { id: 'b', message: 'y' }] }} refreshedAt={null} onRetry={onRetry} onRefresh={onRefresh} />);
        expect(screen.getByRole('alert').textContent).toMatch(/2 changes not saved/);
        fireEvent.click(screen.getByRole('button', { name: /retry now/i }));
        expect(onRetry).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });
    it('shows how fresh the book is', () => {
        const now = Date.now();
        render(<SaveStatus status={base} refreshedAt={now - 3 * 60_000} onRetry={() => {}} onRefresh={() => {}} now={now} />);
        expect(document.body.textContent).toContain('Book refreshed 3 min ago');
        expect(ago(now - 5000, now)).toBe('just now');
        expect(ago(now - 2 * 3600_000, now)).toBe('2 h ago');
    });
    it('combineStatus folds several collections into one line', () => {
        const c = combineStatus([
            { ...base, saving: true, pending: 1 },
            { ...base, failed: [{ id: 'q', message: 'cheque refused' }], retryAt: 200, lastSavedAt: 50 },
            { ...base, lastSavedAt: 90 },
        ]);
        expect(c).toEqual({ saving: true, pending: 1, failed: [{ id: 'q', message: 'cheque refused' }], lastSavedAt: 90, retryAt: 200 });
    });
});
