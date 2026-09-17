/**
 * Characterisation tests for the money rules. They pin down what the code
 * does TODAY (docs/product-audit/03-PRODUCT-MODEL.md §4, M1–M8) so that
 * changes elsewhere — first the edit dialog (C1), later the write path (R1)
 * — can be shown not to have moved a rupee. Nothing in here is a proposal;
 * where a rule looks odd it is still pinned as is and noted in the audit.
 */
import { describe, it, expect } from 'vitest';
import {
    overdueAgeing,
    getCustomerPaymentRank,
    isBadDebt,
    hasOutstanding,
    matchesSettlement,
    getFollowUpCategory,
    followUpStatusOf,
    chequeState,
    FollowUpStatus,
    PdcStatus,
} from '../types';
import {
    parseAmountAndType,
    netRollUp,
    financialsFromSheet,
    clearedFinancials,
    stampSettlement,
    settleUnlisted,
    mergeWithExistingFollowUps,
    processStatuses,
    customerIdFor,
} from '../services/googleSheetService';
import { outstandingToRow, rowToOutstanding } from '../services/repository';
import { mixedAccount, creditAccount } from './fixtures';

describe('M1 · parseAmountAndType — Dr/Cr from a sheet cell', () => {
    it('reads plain numbers as debit and negatives as credit', () => {
        expect(parseAmountAndType(1500)).toEqual({ amount: 1500, type: 'Dr' });
        expect(parseAmountAndType(-1500)).toEqual({ amount: 1500, type: 'Cr' });
        expect(parseAmountAndType('1,50,000')).toEqual({ amount: 150000, type: 'Dr' });
    });
    it('reads "Cr", parentheses and a leading minus as credit', () => {
        expect(parseAmountAndType('84,939 Cr')).toEqual({ amount: 84939, type: 'Cr' });
        expect(parseAmountAndType('(84,939)')).toEqual({ amount: 84939, type: 'Cr' });
        expect(parseAmountAndType('-84939')).toEqual({ amount: 84939, type: 'Cr' });
    });
    it('reads blanks and junk as zero debit', () => {
        expect(parseAmountAndType('')).toEqual({ amount: 0, type: 'Dr' });
        expect(parseAmountAndType(undefined)).toEqual({ amount: 0, type: 'Dr' });
        expect(parseAmountAndType('#N/A')).toEqual({ amount: 0, type: 'Dr' });
    });
});

describe('M2 · netRollUp — a roll-up the sheet did not supply is netted, not summed', () => {
    it('nets a credit bucket against debit ones', () => {
        expect(netRollUp([{ amount: 200967, type: 'Dr' }, { amount: 84939, type: 'Cr' }])).toEqual({ amount: 116028, type: 'Dr' });
    });
    it('faces the credit way when credit wins', () => {
        expect(netRollUp([{ amount: 10000, type: 'Dr' }, { amount: 25000, type: 'Cr' }])).toEqual({ amount: 15000, type: 'Cr' });
    });
});

describe('M3 · overdueAgeing — what is actually overdue', () => {
    it('honours the sheet\'s typed roll-ups and signs each bucket', () => {
        const o = overdueAgeing(mixedAccount());
        expect(o).toEqual({ a1: 189216, a2: 88744, a3: 200967, a4: 0, over45: 204772, over90: 116028, over135: 0 });
    });
    it('nets the buckets itself when the roll-ups are missing', () => {
        const item = { ...mixedAccount(), over90: undefined, over90Type: undefined, dueOver45: undefined, dueOver45Type: undefined };
        const o = overdueAgeing(item);
        expect(o.over90).toBe(116028);        // 200967 − 84939
        expect(o.over45).toBe(204772);        // 88744 + 200967 − 84939
        expect(o.over135).toBe(0);            // the credit bucket is never "overdue"
    });
    it('says nothing is overdue for an account in credit overall', () => {
        expect(overdueAgeing(creditAccount())).toEqual({ a1: 0, a2: 0, a3: 0, a4: 0, over45: 0, over90: 0, over135: 0 });
    });
    it('treats a Cr-typed roll-up as nothing overdue and never returns a negative', () => {
        const item = { ...mixedAccount(), over90: 5000, over90Type: 'Cr' as const };
        expect(overdueAgeing(item).over90).toBe(0);
        const allCredit = { ...mixedAccount(), ageingTypes: { '1-45': 'Cr', '46-90': 'Cr', '91-135': 'Cr', '>135': 'Cr' } as const, over90: undefined, dueOver45: undefined };
        const o = overdueAgeing(allCredit);
        expect(Object.values(o).every(v => v >= 0)).toBe(true);
    });
});

describe('M4/M5 · payment rank and bad debt', () => {
    it('a hand-set rank wins, whatever the ageing says', () => {
        expect(getCustomerPaymentRank({ ...mixedAccount(), paymentRank: 'Good' })).toBe('Good');
        expect(getCustomerPaymentRank({ ...mixedAccount(), paymentRank: 'Bad' })).toBe('Bad');
    });
    it('is Late when anything is past 45 days, Good when in credit, and Bad only when declared', () => {
        expect(getCustomerPaymentRank({ ...mixedAccount(), paymentRank: undefined })).toBe('Late');
        expect(getCustomerPaymentRank(creditAccount())).toBe('Good');
        expect(isBadDebt({ ...mixedAccount(), paymentRank: undefined })).toBe(false);
        expect(isBadDebt({ ...mixedAccount(), paymentRank: 'Bad' })).toBe(true);
    });
});

describe('M8 · what counts as work', () => {
    it('any non-zero balance, credit included, is "with dues"', () => {
        expect(hasOutstanding(mixedAccount())).toBe(true);
        expect(hasOutstanding(creditAccount())).toBe(true);       // pinned as is — see Q7
        expect(hasOutstanding({ total: 0 })).toBe(false);
        expect(matchesSettlement({ total: 0 }, 'settled')).toBe(true);
        expect(matchesSettlement(mixedAccount(), 'withDues')).toBe(true);
    });
});

describe('M7 · settlement', () => {
    it('financialsFromSheet is exactly the money block and nothing else', () => {
        expect(Object.keys(financialsFromSheet(mixedAccount())).sort()).toEqual(
            ['ageing', 'ageingTypes', 'dueOver45', 'dueOver45Type', 'over90', 'over90Type', 'total', 'totalType'],
        );
    });
    it('stamps settledAt when the balance goes to nil and clears it when money returns', () => {
        const before = { ...mixedAccount(), settledAt: undefined };
        const settled = stampSettlement(before, { ...before, ...clearedFinancials() });
        expect(settled.total).toBe(0);
        expect(settled.isUrgent).toBe(false);
        expect(typeof settled.settledAt).toBe('string');
        const owingAgain = stampSettlement(settled, { ...settled, total: 500, totalType: 'Dr' });
        expect(owingAgain.settledAt).toBeUndefined();
    });
    it('settleUnlisted zeroes money and keeps everything else', () => {
        const [row] = settleUnlisted([mixedAccount()]);
        expect(row.total).toBe(0);
        expect(row.assignedCollectorId).toBe('MUNSHI_RAM');
        expect(row.crmOwnerId).toBe('VISHNU');
        expect(row.notes).toHaveLength(1);
        expect(row.paymentRank).toBe('Late');
    });
});

describe('merge · the sheet changes money and nothing else', () => {
    it('a matched account takes the figures and keeps its owner, collector, notes, rank, id', () => {
        const existing = mixedAccount();
        const fromSheet = {
            ...mixedAccount(),
            id: customerIdFor(existing.company),           // the parser mints cust_* ids
            total: 500000, totalType: 'Dr' as const,
            ageing: { '1-45': 500000, '46-90': 0, '91-135': 0, '>135': 0 },
            ageingTypes: { '1-45': 'Dr' as const, '46-90': 'Dr' as const, '91-135': 'Dr' as const, '>135': 'Dr' as const },
            over90: 0, over90Type: 'Dr' as const, dueOver45: 0, dueOver45Type: 'Dr' as const,
            crmOwnerId: 'SOMEONE_ELSE', assignedCollectorId: undefined, notes: [], paymentRank: undefined,
        };
        const [merged] = mergeWithExistingFollowUps([existing], [fromSheet]);
        expect(merged.id).toBe('out_86_TEST_MIXED');
        expect(merged.total).toBe(500000);
        expect(merged.over90).toBe(0);
        expect(merged.crmOwnerId).toBe('VISHNU');
        expect(merged.assignedCollectorId).toBe('MUNSHI_RAM');
        expect(merged.notes).toHaveLength(1);
        expect(merged.paymentRank).toBe('Late');
    });
    it('an account the sheet no longer lists is settled, not dropped; a new name arrives unassigned', () => {
        const existing = mixedAccount();
        const newcomer = { ...mixedAccount(), id: 'cust_newname', company: 'NEW NAME LTD', crmOwnerId: 'ANKUR' };
        const result = mergeWithExistingFollowUps([existing], [newcomer]);
        const kept = result.find(r => r.id === existing.id)!;
        const added = result.find(r => r.company === 'NEW NAME LTD')!;
        expect(kept.total).toBe(0);
        expect(typeof kept.settledAt).toBe('string');
        expect(added.crmOwnerId).toBe('');
    });
});

describe('follow-up status — the date wins, Completed is left alone, nothing is rewritten', () => {
    const at = (offsetDays: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays); return d; };
    const rows = () => [
        { ...mixedAccount(), id: 'a', followUpDate: at(-1), status: FollowUpStatus.Upcoming },
        { ...mixedAccount(), id: 'b', followUpDate: at(0), status: FollowUpStatus.Upcoming },
        { ...mixedAccount(), id: 'c', followUpDate: at(3), status: FollowUpStatus.Overdue },
        { ...mixedAccount(), id: 'd', followUpDate: undefined, status: FollowUpStatus.Pending },
        { ...mixedAccount(), id: 'e', followUpDate: at(0), status: FollowUpStatus.Completed },
    ];
    it('followUpStatusOf derives Overdue / Today / Upcoming / Pending from the date, whatever the stored word says', () => {
        expect(rows().map(r => followUpStatusOf(r))).toEqual(['Overdue', 'Today', 'Upcoming', 'Pending', 'Completed']);
    });
    it('processStatuses no longer rewrites the stored word (R1-C): it only normalises dates', () => {
        const out = processStatuses(rows());
        expect(out.map(r => r.status)).toEqual(['Upcoming', 'Upcoming', 'Overdue', 'Pending', 'Completed']);
        const [row] = processStatuses([{ ...mixedAccount(), followUpDate: at(-1) }]);
        const { followUpDate: _f, ...rest } = row;
        const { followUpDate: _f2, ...expected } = mixedAccount();
        expect(rest).toEqual(expected);
        expect(row.followUpDate).toBeInstanceOf(Date);
    });
    it('getFollowUpCategory agrees with it', () => {
        expect(getFollowUpCategory({ ...mixedAccount(), followUpDate: at(-1), status: FollowUpStatus.Upcoming })).toBe('overdue');
        expect(getFollowUpCategory({ ...mixedAccount(), followUpDate: undefined, status: FollowUpStatus.Pending })).toBe('no_follow_up');
    });
});

describe('cheque state comes from the date', () => {
    const at = (offsetDays: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays); return d; };
    it('due today, overdue after, upcoming before; decisions override', () => {
        expect(chequeState({ status: PdcStatus.Pending, chequeDate: at(0) })).toBe('due');
        expect(chequeState({ status: PdcStatus.Pending, chequeDate: at(-2) })).toBe('overdue');
        expect(chequeState({ status: PdcStatus.DueToday, chequeDate: at(5) })).toBe('upcoming');
        expect(chequeState({ status: PdcStatus.Cleared, chequeDate: at(-30) })).toBe('cleared');
    });
});

describe('row mappers — a record survives the trip to the database and back', () => {
    it('outstandingToRow ↔ rowToOutstanding round-trips the mixed account', () => {
        const original = mixedAccount();
        const row = outstandingToRow(original);
        expect(row.assigned_collector_id).toBe('MUNSHI_RAM');
        expect(row.ageing_types).toEqual(original.ageingTypes);
        expect(row.over90).toBe(116028);
        expect(row.settled_at).toBe(original.settledAt);
        expect(row.pan).toBe('AAAAA0000A');
        const back = rowToOutstanding(row);
        expect(back).toEqual(original);
    });
    it('writes undefined as null — which is why a dropped field erases the column', () => {
        const row = outstandingToRow({ ...mixedAccount(), assignedCollectorId: undefined, settledAt: undefined, pan: undefined });
        expect(row.assigned_collector_id).toBeNull();
        expect(row.settled_at).toBeNull();
        expect(row.pan).toBeNull();
    });
});
