// @vitest-environment jsdom
/**
 * R1-C: the follow-up status is read from the date, never rewritten. These
 * tests cover the two halves of that — the reading (followUpStatusOf /
 * getFollowUpCategory) and the absence of the write (processStatuses, and the
 * sync hook when time passes) — plus the states that must not move: a
 * declared Completed, a declared Bad, a settled account.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));

import { useCollectionSync } from '../services/useSupabaseSync';
import { outstandingToRow, customerRowDiff, CustomerRow } from '../services/repository';
import { processStatuses, settleUnlisted } from '../services/googleSheetService';
import { Outstanding, FollowUpStatus, followUpStatusOf, getFollowUpCategory, isBadDebt, hasOutstanding } from '../types';
import { mixedAccount } from './fixtures';

const at = (offsetDays: number, from = new Date()) => { const d = new Date(from); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays); return d; };

describe('A · crossing the follow-up date changes the reading, not the row', () => {
    it('a row saved as Today reads Overdue the next morning with no field changed', () => {
        const today = at(0);
        const tomorrow = at(1);
        const row: Outstanding = { ...mixedAccount(), followUpDate: today, status: FollowUpStatus.Today };
        expect(followUpStatusOf(row, today)).toBe(FollowUpStatus.Today);
        expect(followUpStatusOf(row, tomorrow)).toBe(FollowUpStatus.Overdue);
        expect(getFollowUpCategory(row, tomorrow)).toBe('overdue');
        expect(row.status).toBe(FollowUpStatus.Today); // untouched
    });

    it('a row saved as Upcoming reads Today on its day', () => {
        const row: Outstanding = { ...mixedAccount(), followUpDate: at(1), status: FollowUpStatus.Upcoming };
        expect(followUpStatusOf(row, at(1))).toBe(FollowUpStatus.Today);
    });
});

describe('B · processStatuses causes no customer PATCH merely because time passed', () => {
    it('date-crossed rows diff to nothing', () => {
        const rows: Outstanding[] = [
            { ...mixedAccount(), id: 'a', followUpDate: at(-1), status: FollowUpStatus.Today },
            { ...mixedAccount(), id: 'b', followUpDate: at(0), status: FollowUpStatus.Upcoming },
            { ...mixedAccount(), id: 'c', followUpDate: at(-30), status: FollowUpStatus.Upcoming },
        ];
        const out = processStatuses(rows);
        rows.forEach((before, i) => expect(customerRowDiff(outstandingToRow(before), outstandingToRow(out[i]))).toEqual({}));
    });
});

describe('C · an unrelated edit after midnight sends only its own column', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('172 stale rows in the tab, one urgency toggle → one update with [is_urgent]', async () => {
        vi.setSystemTime(new Date('2026-09-16T10:00:00'));
        const yesterday = at(0); // "today" while the tab loads
        const loaded: Outstanding[] = Array.from({ length: 172 }, (_, i) => ({ ...mixedAccount(), id: `cust_${i}`, company: `ACCOUNT ${i}`, followUpDate: yesterday, status: FollowUpStatus.Today }));
        const updates: { id: string; changes: Partial<CustomerRow> }[] = [];
        const partial = { toRow: outstandingToRow, diff: customerRowDiff, update: async (id: string, changes: Partial<CustomerRow>) => { updates.push({ id, changes }); } };
        const hook = renderHook(
            ({ rows }: { rows: Outstanding[] }) => useCollectionSync<Outstanding, CustomerRow>({
                rows, enabled: true, label: 'customers', toSignature: (c) => JSON.stringify(outstandingToRow(c)),
                upsert: async () => {}, partial, delayMs: 100,
            }),
            { initialProps: { rows: processStatuses(loaded) } },
        );
        // the night passes; the tab stays open
        vi.setSystemTime(new Date('2026-09-17T09:05:00'));
        // the first thing the user does: mark one account urgent (App.tsx runs processStatuses over the whole book)
        const edited = processStatuses(loaded.map((r, i) => (i === 7 ? { ...r, isUrgent: true } : r)));
        hook.rerender({ rows: edited });
        await act(async () => { await vi.advanceTimersByTimeAsync(150); });
        expect(updates).toEqual([{ id: 'cust_7', changes: { is_urgent: true } }]);
        // and yet every one of them now reads Overdue
        expect(edited.every(r => followUpStatusOf(r) === FollowUpStatus.Overdue)).toBe(true);
    });
});

describe('D · declared and settled states do not move with the calendar', () => {
    it('Completed stays Completed however old its date', () => {
        const row: Outstanding = { ...mixedAccount(), followUpDate: at(-400), status: FollowUpStatus.Completed };
        expect(followUpStatusOf(row)).toBe(FollowUpStatus.Completed);
        expect(getFollowUpCategory(row)).toBe('completed');
        expect(processStatuses([row])[0].status).toBe(FollowUpStatus.Completed);
    });
    it('Bad is a rank, not a follow-up state: it is untouched by the date and still keeps the account off the routine lists', () => {
        const row: Outstanding = { ...mixedAccount(), paymentRank: 'Bad', followUpDate: at(-5), status: FollowUpStatus.Today };
        expect(isBadDebt(row)).toBe(true);
        expect(isBadDebt(processStatuses([row])[0])).toBe(true);
        expect(followUpStatusOf(row)).toBe(FollowUpStatus.Overdue); // the reading still works on a defaulter; the worklists exclude it by rank
    });
    it('a settled account keeps its follow-up reading and its stamp; settling writes no status', () => {
        const before: Outstanding = { ...mixedAccount(), settledAt: undefined, followUpDate: at(3), status: FollowUpStatus.Upcoming };
        const [settled] = settleUnlisted([before]);
        expect(hasOutstanding(settled)).toBe(false);
        expect(typeof settled.settledAt).toBe('string');
        expect(followUpStatusOf(settled)).toBe(FollowUpStatus.Upcoming);
        expect('status' in customerRowDiff(outstandingToRow(before), outstandingToRow(settled))).toBe(false);
    });
});

describe('E · boundary cases of the reading', () => {
    const cases: [string, Partial<Outstanding>, Date, FollowUpStatus][] = [
        ['yesterday', { followUpDate: at(-1), status: FollowUpStatus.Upcoming }, at(0), FollowUpStatus.Overdue],
        ['today, saved as Upcoming', { followUpDate: at(0), status: FollowUpStatus.Upcoming }, at(0), FollowUpStatus.Today],
        ['today, saved as Overdue (wrong word)', { followUpDate: at(0), status: FollowUpStatus.Overdue }, at(0), FollowUpStatus.Today],
        ['tomorrow', { followUpDate: at(1), status: FollowUpStatus.Pending }, at(0), FollowUpStatus.Upcoming],
        ['no date, saved Pending', { followUpDate: undefined, status: FollowUpStatus.Pending }, at(0), FollowUpStatus.Pending],
        ['no date, stale word Overdue (the word is never consulted; 0 such rows in production)', { followUpDate: undefined, status: FollowUpStatus.Overdue }, at(0), FollowUpStatus.Pending],
        ['invalid date, stale word Upcoming (same)', { followUpDate: new Date('not a date'), status: FollowUpStatus.Upcoming }, at(0), FollowUpStatus.Pending],
        ['late evening still counts as today', { followUpDate: at(0), status: FollowUpStatus.Pending }, new Date(at(0).getTime() + 23 * 3600 * 1000), FollowUpStatus.Today],
    ];
    for (const [name, over, today, expected] of cases) {
        it(name, () => expect(followUpStatusOf({ ...mixedAccount(), ...over }, today)).toBe(expected));
    }
});

describe('F · counts that used to read the stored word', () => {
    it('the book\'s Status filter counts agree with the old stored counts when the words were fresh, and correct them when stale', () => {
        const fresh: Outstanding[] = [
            { ...mixedAccount(), id: '1', followUpDate: at(0), status: FollowUpStatus.Today },
            { ...mixedAccount(), id: '2', followUpDate: at(2), status: FollowUpStatus.Upcoming },
            { ...mixedAccount(), id: '3', followUpDate: at(-2), status: FollowUpStatus.Overdue },
            { ...mixedAccount(), id: '4', followUpDate: undefined, status: FollowUpStatus.Pending },
            { ...mixedAccount(), id: '5', followUpDate: at(-9), status: FollowUpStatus.Completed },
        ];
        const count = (rows: Outstanding[]) => rows.reduce((m, r) => { const k = followUpStatusOf(r); m[k] = (m[k] || 0) + 1; return m; }, {} as Record<string, number>);
        expect(count(fresh)).toEqual({ Today: 1, Upcoming: 1, Overdue: 1, Pending: 1, Completed: 1 });
        // the same rows a day later: the stored words are stale, the counts are not
        const stale = fresh.map(r => ({ ...r }));
        const tomorrow = at(1);
        const later = stale.reduce((m, r) => { const k = followUpStatusOf(r, tomorrow); m[k] = (m[k] || 0) + 1; return m; }, {} as Record<string, number>);
        expect(later).toEqual({ Overdue: 2, Upcoming: 1, Pending: 1, Completed: 1 });
        expect(stale.map(r => r.status)).toEqual(fresh.map(r => r.status)); // nothing rewritten
    });
});
