// @vitest-environment jsdom
/**
 * The sync hook's baseline and write behaviour (R1 Option A), driven through
 * the real hook with fake timers and a fake repository. Nothing here touches
 * the network. `isSupabaseConfigured` is mocked true so the hook runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));

import { useCollectionSync } from '../services/useSupabaseSync';
import { outstandingToRow, customerRowDiff, CustomerRow } from '../services/repository';
import { Outstanding, FollowUpStatus } from '../types';
import { mixedAccount } from './fixtures';

type Update = { id: string; changes: Partial<CustomerRow> };

function harness(initial: Outstanding[]) {
    const updates: Update[] = [];
    const upserts: Outstanding[][] = [];
    const removed: string[] = [];
    const errors: string[] = [];
    let failNext: Error | null = null;
    const partial = {
        toRow: outstandingToRow,
        diff: customerRowDiff,
        update: vi.fn(async (id: string, changes: Partial<CustomerRow>) => {
            if (failNext) { const e = failNext; failNext = null; throw e; }
            updates.push({ id, changes });
        }),
    };
    const upsert = vi.fn(async (rows: Outstanding[]) => { upserts.push(rows); });
    const remove = vi.fn(async (id: string) => { removed.push(id); });
    const toSignature = (c: Outstanding) => JSON.stringify(outstandingToRow(c));
    const hook = renderHook(
        ({ rows }: { rows: Outstanding[] }) => useCollectionSync<Outstanding, CustomerRow>({
            rows, enabled: true, label: 'customers', toSignature, upsert, remove, partial,
            onError: (m) => errors.push(m), delayMs: 100,
        }),
        { initialProps: { rows: initial } },
    );
    const setRows = async (rows: Outstanding[]) => {
        hook.rerender({ rows });
        await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    };
    return { updates, upserts, removed, errors, setRows, failNextWith: (e: Error) => { failNext = e; }, update: partial.update };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useCollectionSync with column-level writes', () => {
    it('A · seeding from the load writes nothing, and an unchanged re-render writes nothing', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        await act(async () => { await vi.advanceTimersByTimeAsync(150); });
        await h.setRows([{ ...a }]);
        expect(h.update).not.toHaveBeenCalled();
        expect(h.upserts).toHaveLength(0);
    });

    it('B · one field → one call with exactly that column', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        await h.setRows([{ ...a, isUrgent: true }]);
        expect(h.updates).toEqual([{ id: a.id, changes: { is_urgent: true } }]);
    });

    it('C · two independent fields → one call with exactly two columns', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        await h.setRows([{ ...a, contactNumber: '9811111111', category: 'Dyeing' }]);
        expect(h.updates).toEqual([{ id: a.id, changes: { contact_number: '9811111111', category: 'Dyeing' } }]);
    });

    it('D · a cleared nullable field is sent as null', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        await h.setRows([{ ...a, assignedCollectorId: undefined }]);
        expect(h.updates).toEqual([{ id: a.id, changes: { assigned_collector_id: null } }]);
    });

    it('F · a failed write does not advance the baseline; the next change retries the unsaved difference', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        h.failNextWith(new Error('permission denied'));
        await h.setRows([{ ...a, isUrgent: true }]);
        expect(h.updates).toHaveLength(0);
        expect(h.errors[0]).toMatch(/Could not save customers: permission denied/);
        // a later, unrelated change: the unsaved is_urgent rides along
        await h.setRows([{ ...a, isUrgent: true, city: 'Surat' }]);
        expect(h.updates).toEqual([{ id: a.id, changes: { is_urgent: true, city: 'Surat' } }]);
    });

    it('G · a successful write advances the baseline; the same state again writes nothing', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        await h.setRows([{ ...a, isUrgent: true }]);
        expect(h.updates).toHaveLength(1);
        await h.setRows([{ ...a, isUrgent: true }]);
        expect(h.updates).toHaveLength(1);
    });

    it('H · sequential changes: the second write carries only the second change', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        await h.setRows([{ ...a, isUrgent: true }]);
        await h.setRows([{ ...a, isUrgent: true, city: 'Surat' }]);
        expect(h.updates).toEqual([
            { id: a.id, changes: { is_urgent: true } },
            { id: a.id, changes: { city: 'Surat' } },
        ]);
    });

    it('I · two customers: changing one leaves the other\'s baseline and payload alone', async () => {
        const a = mixedAccount();
        const b = { ...mixedAccount(), id: 'cust_other', company: 'OTHER LTD' };
        const h = harness([a, b]);
        await h.setRows([a, { ...b, isUrgent: true }]);
        expect(h.updates).toEqual([{ id: 'cust_other', changes: { is_urgent: true } }]);
        await h.setRows([{ ...a, city: 'Surat' }, { ...b, isUrgent: true }]);
        expect(h.updates).toEqual([
            { id: 'cust_other', changes: { is_urgent: true } },
            { id: a.id, changes: { city: 'Surat' } },
        ]);
    });

    it('J · one unrelated change on a sensitive row sends none of the sensitive columns', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        await h.setRows([{ ...a, email: 'new@example.com' }]);
        expect(h.updates).toEqual([{ id: a.id, changes: { email: 'new@example.com' } }]);
    });

    it('a new id goes through upsert whole and then joins the baseline', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        const fresh = { ...mixedAccount(), id: 'cust_fresh', company: 'FRESH LTD' };
        await h.setRows([a, fresh]);
        expect(h.upserts).toEqual([[fresh]]);
        expect(h.update).not.toHaveBeenCalled();
        await h.setRows([a, { ...fresh, city: 'Surat' }]);
        expect(h.updates).toEqual([{ id: 'cust_fresh', changes: { city: 'Surat' } }]);
    });

    it('a row that disappears is removed; a partial failure elsewhere does not undo a success', async () => {
        const a = mixedAccount();
        const b = { ...mixedAccount(), id: 'cust_other', company: 'OTHER LTD' };
        const h = harness([a, b]);
        h.failNextWith(new Error('boom'));
        // a's write fails (first in the queue), b's succeeds, and c is gone
        await h.setRows([{ ...a, city: 'Surat' }, { ...b, isUrgent: true }]);
        expect(h.updates).toEqual([{ id: 'cust_other', changes: { is_urgent: true } }]);
        expect(h.errors).toHaveLength(1);
        // next tick: only a is still unsaved
        await h.setRows([{ ...a, city: 'Surat' }, { ...b, isUrgent: true }]);
        expect(h.updates).toEqual([
            { id: 'cust_other', changes: { is_urgent: true } },
            { id: a.id, changes: { city: 'Surat' } },
        ]);
        await h.setRows([{ ...a, city: 'Surat' }]);
        expect(h.removed).toEqual(['cust_other']);
    });

    it('a status flip from processStatuses is one column, not the row', async () => {
        const a = mixedAccount();
        const h = harness([a]);
        await h.setRows([{ ...a, status: FollowUpStatus.Overdue }]);
        expect(h.updates).toEqual([{ id: a.id, changes: { status: 'Overdue' } }]);
    });
});
