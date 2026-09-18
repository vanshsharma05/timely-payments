/**
 * The figures on Today (services/metrics.ts), pinned as App.tsx computed
 * them before they were lifted out: the ageing totals skip credits, the
 * worklist boxes count only accounts with dues and keep defaulters on their
 * own card, the personal list agrees with the boxes, commitments fall into
 * today / the week / all open, the team table buckets one person's spellings
 * together and counts a collector's work, and the cheque summary is scoped.
 */
import { describe, it, expect } from 'vitest';
import {
    ageingTotals, worklistSummary, filterWorklist, cashFlowForecast, attentionCounts, crmPerformance, chequeSummary,
} from '../services/metrics';
import { Outstanding, FollowUpStatus, PdcCheque, PdcStatus } from '../types';
import { mixedAccount, creditAccount, adminUser, crmUser, collectorUser } from './fixtures';

const today = new Date('2026-09-18T00:00:00');
const day = (offset: number) => { const d = new Date(today); d.setDate(d.getDate() + offset); return d; };

/** A plain debit account with one bucket, owing `total`, and whatever else is given. */
const account = (id: string, total: number, over: Partial<Outstanding> = {}): Outstanding => ({
    ...mixedAccount(), id, company: id, total, totalType: 'Dr',
    ageing: { '1-45': total, '46-90': 0, '91-135': 0, '>135': 0 },
    ageingTypes: { '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Dr' },
    over90: 0, over90Type: 'Dr', dueOver45: 0, dueOver45Type: 'Dr',
    paymentRank: undefined, settledAt: undefined, forecastAmount: undefined, forecastDate: undefined,
    status: FollowUpStatus.Pending, followUpDate: undefined, notes: [], isUrgent: false, assignedCollectorId: undefined,
    ...over,
});

const book = (): Outstanding[] => [
    account('OVERDUE', 10000, { followUpDate: day(-3) }),
    account('TODAY', 5000, { followUpDate: day(0), isUrgent: true }),
    account('SOON', 7000, { followUpDate: day(4) }),
    account('NOPLAN', 3000),
    account('DEFAULTER', 90000, { paymentRank: 'Bad', followUpDate: day(-40) }),
    account('COLLECTED', 0, { status: FollowUpStatus.Completed, followUpDate: day(0), ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 } }),
    account('SETTLED', 0, { ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 } }),
];

describe('ageingTotals', () => {
    it('sums the four bands, skipping credit buckets and accounts in credit', () => {
        const t = ageingTotals([mixedAccount(), creditAccount()]);
        expect([t.a1, t.a2, t.a3, t.a4]).toEqual([189216, 88744, 200967, 0]); // >135 is a credit; the credit account is skipped whole
        expect(t.total).toBe(189216 + 88744 + 200967);
        expect(t.over45).toBe(88744 + 200967);
        expect(t.over90).toBe(200967);
        expect(t.pct45).toBe(Math.round(((88744 + 200967) / t.total) * 100));
        expect(t.pct90).toBe(Math.round((200967 / t.total) * 100));
    });
    it('is all zeros for an empty book', () => {
        expect(ageingTotals([])).toEqual({ a1: 0, a2: 0, a3: 0, a4: 0, total: 0, over45: 0, over90: 0, pct45: 0, pct90: 0 });
    });
});

describe('worklistSummary', () => {
    it('counts each account with dues once, by the date, with defaulters on their own card', () => {
        const w = worklistSummary(book(), today);
        expect([w.overdueCount, w.overdueAmount]).toEqual([1, 10000]);
        expect([w.todayCount, w.todayAmount]).toEqual([1, 5000]);
        expect([w.futureCount, w.futureAmount]).toEqual([1, 7000]);
        expect([w.noFollowUpCount, w.noFollowUpAmount]).toEqual([1, 3000]);
        expect([w.badDebtCount, w.badDebtAmount]).toEqual([1, 90000]);
        // the total is every account with dues, defaulter included; the settled and the collected are not work
        expect([w.totalCount, w.totalAmount]).toEqual([5, 115000]);
    });
});

describe('filterWorklist', () => {
    const users = [adminUser(), crmUser(), collectorUser()];
    const ids = (rows: Outstanding[]) => rows.map(r => r.id);
    const base = { searchTerm: '', statusFilter: null, categoryFilter: 'all' as const, priorityFilter: false, unattendedFilter: false };

    it('shows the work and nothing else: no settled accounts, no defaulters', () => {
        expect(ids(filterWorklist(book(), base, users, today))).toEqual(['OVERDUE', 'TODAY', 'SOON', 'NOPLAN', 'COLLECTED']);
    });
    it('opens exactly what each box counted', () => {
        expect(ids(filterWorklist(book(), { ...base, categoryFilter: 'today' }, users, today))).toEqual(['TODAY']);
        expect(ids(filterWorklist(book(), { ...base, categoryFilter: 'overdue' }, users, today))).toEqual(['OVERDUE']);
        expect(ids(filterWorklist(book(), { ...base, categoryFilter: 'no_follow_up' }, users, today))).toEqual(['NOPLAN']);
        expect(ids(filterWorklist(book(), { ...base, categoryFilter: 'bad_debt' }, users, today))).toEqual(['DEFAULTER']);
    });
    it('the attention banner opens the urgent and the overdue; unattended is overdue plus no plan', () => {
        expect(ids(filterWorklist(book(), { ...base, priorityFilter: true }, users, today))).toEqual(['OVERDUE', 'TODAY']);
        expect(ids(filterWorklist(book(), { ...base, unattendedFilter: true }, users, today))).toEqual(['OVERDUE', 'NOPLAN']);
    });
    it('a search finds anyone, paid up or defaulter, by name, owner or note', () => {
        expect(ids(filterWorklist(book(), { ...base, searchTerm: 'settled' }, users, today))).toEqual(['SETTLED']);
        expect(ids(filterWorklist(book(), { ...base, searchTerm: 'defaulter' }, users, today))).toEqual(['DEFAULTER']);
        // the owner's display name, not only the code
        expect(ids(filterWorklist(book(), { ...base, searchTerm: 'vishnu' }, users, today)).length).toBe(7);
    });
    it('the collected filter is today\'s collections only', () => {
        const rows = [...book(), account('OLD_COLLECTED', 0, { status: FollowUpStatus.Completed, followUpDate: day(-2), ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 } })];
        expect(ids(filterWorklist(rows, { ...base, statusFilter: FollowUpStatus.Completed }, users, today))).toEqual(['COLLECTED']);
    });
});

describe('cashFlowForecast', () => {
    it('sorts commitments by amount and buckets them into today, the week and all open', () => {
        const rows = [
            account('A', 1, { forecastAmount: 500, forecastDate: day(0) }),
            account('B', 1, { forecastAmount: 900, forecastDate: day(3) }),
            account('C', 1, { forecastAmount: 300, forecastDate: day(7) }),
            account('D', 1, { forecastAmount: 100, forecastDate: day(8) }),
            account('E', 1, { forecastAmount: 100, followUpDate: day(2) }),          // no forecast date: the follow-up date stands in
            account('F', 1, { forecastAmount: 999, forecastDate: day(1), status: FollowUpStatus.Completed }), // collected: not open
        ];
        const f = cashFlowForecast(rows, today);
        expect([f.todayForecast, f.todayCount]).toEqual([500, 1]);
        expect([f.weekForecast, f.weekCount]).toEqual([900 + 300 + 100, 3]);
        expect([f.totalForecast, f.totalCount]).toEqual([1900, 5]);
        expect(f.committedCustomers.map(c => c.customer.id)).toEqual(['B', 'A', 'C', 'D', 'E']);
        expect(f.committedCustomers[0].dateText).toBe(day(3).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
    });
});

describe('attentionCounts', () => {
    it('counts urgent and overdue among accounts with dues, never a defaulter', () => {
        expect(attentionCounts(book(), today)).toEqual({ urgentCount: 1, overdueCount: 1 });
    });
});

describe('crmPerformance', () => {
    it('buckets one person\'s spellings together, seeds every CRM, and counts a collector\'s work too', () => {
        const users = [adminUser(), crmUser(), collectorUser()];
        const rows = [
            account('A', 100, { crmOwnerId: 'VISHNU', followUpDate: day(0) }),
            account('B', 100, { crmOwnerId: 'vishnu ', followUpDate: day(-2), assignedCollectorId: 'Munshi Ram' }),
            account('C', 100, { crmOwnerId: 'Vishnu', paymentRank: 'Bad' }),
            account('D', 0, { crmOwnerId: 'VISHNU', ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 } }),
            account('E', 100, { crmOwnerId: '' }),
            account('F', 100, { crmOwnerId: 'GHOST', followUpDate: day(5) }),
        ];
        const stats = crmPerformance(rows, users, today);
        const by = Object.fromEntries(stats.map(s => [s.crmId, s]));
        expect(Object.keys(by).sort()).toEqual(['GHOST', 'MUNSHI_RAM', 'UNASSIGNED', 'VISHNU']);
        expect(by.VISHNU).toMatchObject({ totalAssigned: 2, todayFollowUp: 1, overdue: 1, unattended: 1, badDebt: 1, noDues: 1, timelyCount: 1, score: 50, drillable: true });
        expect(by.MUNSHI_RAM).toMatchObject({ totalAssigned: 1, overdue: 1, unattended: 1, score: 0, drillable: false });
        expect(by.UNASSIGNED).toMatchObject({ crmName: 'No CRM Assigned', totalAssigned: 1, unattended: 1, drillable: true });
        expect(by.GHOST).toMatchObject({ crmName: 'GHOST', totalAssigned: 1, timelyCount: 1, score: 100, drillable: true });
    });
});

describe('chequeSummary', () => {
    const cheque = (id: string, customerId: string, amount: number, date: Date, status = PdcStatus.Pending, over: Partial<PdcCheque> = {}): PdcCheque => ({
        id, customerId, customerName: customerId, chequeNumber: id, bankName: 'HDFC', chequeDate: date, amount, status, receivedDate: day(-10), crmOwnerId: 'VISHNU', ...over,
    });
    const now = new Date('2026-09-18T11:00:00');
    const rows = [account('MINE', 100, { crmOwnerId: 'VISHNU' }), account('THEIRS', 100, { crmOwnerId: 'OTHER' })];
    const cheques = [
        cheque('c1', 'MINE', 1000, day(0)),
        cheque('c2', 'MINE', 2000, day(-1)),
        cheque('c3', 'MINE', 3000, day(3)),
        cheque('c4', 'MINE', 4000, day(-5), PdcStatus.Cleared),
        cheque('c5', 'THEIRS', 5000, day(0), PdcStatus.Pending, { crmOwnerId: 'OTHER' }),
    ];
    it('the whole book for whoever reads it', () => {
        expect(chequeSummary(cheques, adminUser(), rows, now)).toEqual({ todayCount: 2, todayAmount: 6000, overdueCount: 1, overdueAmount: 2000, activeCount: 4, activeAmount: 11000 });
    });
    it('only their own for a CRM', () => {
        expect(chequeSummary(cheques, crmUser(), rows, now)).toEqual({ todayCount: 1, todayAmount: 1000, overdueCount: 1, overdueAmount: 2000, activeCount: 3, activeAmount: 6000 });
    });
});
