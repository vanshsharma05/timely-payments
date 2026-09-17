/**
 * What the real caller flows now emit, column by column, once their result
 * goes through customerRowDiff() against the last-saved row. Each flow is
 * reproduced the way App.tsx produces it (the same functions on the same
 * shapes), so these are the payloads the app sends — minus the network.
 */
import { describe, it, expect } from 'vitest';
import { outstandingToRow, customerRowDiff } from '../services/repository';
import { mergeWithExistingFollowUps, processStatuses, customerIdFor, financialsFromSheet } from '../services/googleSheetService';
import { Outstanding, FollowUpStatus, followUpStatusOf, getFollowUpCategory } from '../types';
import { mixedAccount } from './fixtures';

const columnsOf = (before: Outstanding, after: Outstanding) => Object.keys(customerRowDiff(outstandingToRow(before), outstandingToRow(after))).sort();
const atDay = (offset: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };

describe('follow-up save (FollowUpModal.handleSave shape: spread the live row, set the outcome)', () => {
    it('next date → follow_up_date, status, last_follow_up_on and the forecast, nothing else', () => {
        const before = mixedAccount();
        const after: Outstanding = { ...before, followUpDate: atDay(3), status: FollowUpStatus.Upcoming, lastFollowUpOn: new Date(), forecastAmount: 50000, forecastDate: atDay(3) };
        expect(columnsOf(before, after)).toEqual(['follow_up_date', 'forecast_amount', 'forecast_date', 'last_follow_up_on']);
    });
    it('collected → status and follow_up_date (and last_follow_up_on)', () => {
        const before = mixedAccount();
        const after: Outstanding = { ...before, status: FollowUpStatus.Completed, followUpDate: new Date(), lastFollowUpOn: new Date() };
        expect(columnsOf(before, after)).toEqual(['follow_up_date', 'last_follow_up_on', 'status']);
    });
});

describe('activity logged (handleActivityLogged: notes mirror line + last_follow_up_on)', () => {
    it('sends notes and last_follow_up_on only', () => {
        const before = mixedAccount();
        const after: Outstanding = { ...before, notes: [...before.notes, '[17 Sept, 10:00 am - Vishnu] No answer: rang twice'], lastFollowUpOn: new Date() };
        expect(columnsOf(before, after)).toEqual(['last_follow_up_on', 'notes']);
    });
});

describe('owner / collector / rank / category', () => {
    it('reassign (handleReassignCrm / bulk) → crm_owner_id only', () => {
        const before = mixedAccount();
        expect(columnsOf(before, { ...before, crmOwnerId: 'ANKUR' })).toEqual(['crm_owner_id']);
    });
    it('collector handed over (follow-up sheet) → assigned_collector_id only', () => {
        const before = mixedAccount();
        expect(columnsOf(before, { ...before, assignedCollectorId: 'RAJU' })).toEqual(['assigned_collector_id']);
    });
    it('bulk rank (handleBulkSetRank) → payment_rank only; clearing it → null', () => {
        const before = mixedAccount();
        expect(customerRowDiff(outstandingToRow(before), outstandingToRow({ ...before, paymentRank: 'Bad' }))).toEqual({ payment_rank: 'Bad' });
        expect(customerRowDiff(outstandingToRow(before), outstandingToRow({ ...before, paymentRank: undefined }))).toEqual({ payment_rank: null });
    });
    it('category → category only', () => {
        const before = mixedAccount();
        expect(columnsOf(before, { ...before, category: 'Dyeing' })).toEqual(['category']);
    });
});

describe('bulk follow-up date (handleBulkSetFollowUp writes the date and the word the date means today)', () => {
    it('sends follow_up_date and status only', () => {
        const before = mixedAccount();
        const nextDate = atDay(0);
        const [after] = processStatuses([{ ...before, followUpDate: nextDate, status: followUpStatusOf({ status: FollowUpStatus.Pending, followUpDate: nextDate }) }]);
        expect(columnsOf(before, after)).toEqual(['follow_up_date', 'status']);
        expect(after.status).toBe(FollowUpStatus.Today);
    });
});

describe('processStatuses on a tab open across midnight (R1-C)', () => {
    it('writes nothing for a date-crossed row — the reading moves, the stored word does not', () => {
        const dueYesterday: Outstanding = { ...mixedAccount(), id: 'a', followUpDate: atDay(-1), status: FollowUpStatus.Today };
        const dueNextWeek: Outstanding = { ...mixedAccount(), id: 'b', followUpDate: atDay(7), status: FollowUpStatus.Upcoming };
        const [a, b] = processStatuses([dueYesterday, dueNextWeek]);
        expect(customerRowDiff(outstandingToRow(dueYesterday), outstandingToRow(a))).toEqual({});
        expect(customerRowDiff(outstandingToRow(dueNextWeek), outstandingToRow(b))).toEqual({});
        expect(followUpStatusOf(a)).toBe(FollowUpStatus.Overdue);
        expect(getFollowUpCategory(a)).toBe('overdue');
    });
});

describe('balance sync confirm (mergeWithExistingFollowUps over the book, then diff per row)', () => {
    // Owing accounts carry no settlement stamp (stampSettlement clears one the
    // moment money is owed), so the book here has none on the two that owe.
    const book = () => {
        const changed = { ...mixedAccount(), id: 'out_1_CHANGED', company: 'CHANGED LTD', settledAt: undefined };
        const same = { ...mixedAccount(), id: 'out_2_SAME', company: 'SAME LTD', settledAt: undefined };
        const gone = { ...mixedAccount(), id: 'out_3_GONE', company: 'GONE LTD', isUrgent: true, settledAt: undefined };
        return { changed, same, gone };
    };
    const sheetRows = (b: ReturnType<typeof book>) => {
        const asSheet = (c: Outstanding): Outstanding => ({ ...c, id: customerIdFor(c.company), crmOwnerId: 'SHEET_SAYS', assignedCollectorId: undefined, notes: [], paymentRank: undefined, followUpDate: undefined, forecastAmount: undefined, status: FollowUpStatus.Pending });
        return [
            asSheet({ ...b.changed, total: 250000, ageing: { '1-45': 250000, '46-90': 0, '91-135': 0, '>135': 0 }, ageingTypes: { '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Dr' }, over90: 0, over90Type: 'Dr', dueOver45: 0, dueOver45Type: 'Dr' }),
            asSheet(b.same),
            asSheet({ ...mixedAccount(), company: 'NEW NAME LTD' }),
        ];
    };

    it('only accounts whose figures moved write, and they write the money columns only', () => {
        const b = book();
        const merged = mergeWithExistingFollowUps([b.changed, b.same, b.gone], sheetRows(b));
        const byId = new Map(merged.map(r => [r.id, r]));
        const changed = byId.get('out_1_CHANGED')!;
        const same = byId.get('out_2_SAME')!;
        expect(columnsOf(b.changed, changed)).toEqual(['ageing', 'ageing_types', 'due_over45', 'over90', 'total']);
        expect(columnsOf(b.same, same)).toEqual([]);
        // app-owned fields survive both, and are not in any payload
        for (const r of [changed, same]) {
            expect(r.crmOwnerId).toBe('VISHNU');
            expect(r.assignedCollectorId).toBe('MUNSHI_RAM');
            expect(r.notes).toHaveLength(1);
            expect(r.paymentRank).toBe('Late');
        }
    });

    it('an account the sheet no longer lists is settled: money to nil, settled_at stamped, urgency cleared — nothing else', () => {
        const b = book();
        const merged = mergeWithExistingFollowUps([b.changed, b.same, b.gone], sheetRows(b));
        const gone = merged.find(r => r.id === 'out_3_GONE')!;
        const changes = customerRowDiff(outstandingToRow(b.gone), outstandingToRow(gone));
        // over90_type / due_over45_type were already 'Dr' on this account, so they are not resent.
        expect(Object.keys(changes).sort()).toEqual(['ageing', 'ageing_types', 'due_over45', 'is_urgent', 'over90', 'settled_at', 'total']);
        expect(changes.total).toBe(0);
        expect(changes.is_urgent).toBe(false);
        expect(typeof changes.settled_at).toBe('string');
        expect(gone.crmOwnerId).toBe('VISHNU');
        expect(gone.assignedCollectorId).toBe('MUNSHI_RAM');
    });

    it('a new name is a new row (the upsert path), unassigned', () => {
        const b = book();
        const merged = mergeWithExistingFollowUps([b.changed, b.same, b.gone], sheetRows(b));
        const fresh = merged.find(r => r.company === 'NEW NAME LTD')!;
        expect(fresh.id).toBe(customerIdFor('NEW NAME LTD'));
        expect(fresh.crmOwnerId).toBe('');
    });

    it('the money the sheet owns is exactly financialsFromSheet(), so a sync can never write more than that plus settlement and status', () => {
        expect(Object.keys(financialsFromSheet(mixedAccount())).sort()).toEqual(['ageing', 'ageingTypes', 'dueOver45', 'dueOver45Type', 'over90', 'over90Type', 'total', 'totalType']);
    });
});
