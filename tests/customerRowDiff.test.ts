/**
 * The column diff behind every customer write (R1 Option A): a write carries
 * the columns that changed since this tab last saved the row, a cleared
 * column travels as `null`, and nothing the action did not touch is sent.
 */
import { describe, it, expect } from 'vitest';
import { outstandingToRow, customerRowDiff, CustomerRow } from '../services/repository';
import { FollowUpStatus } from '../types';
import { mixedAccount } from './fixtures';

const row = (over?: Partial<ReturnType<typeof mixedAccount>>) => outstandingToRow({ ...mixedAccount(), ...over });

describe('customerRowDiff', () => {
    it('A · no change → no columns', () => {
        expect(customerRowDiff(row(), row())).toEqual({});
    });

    it('B · one scalar field → exactly its column, nothing invented', () => {
        expect(customerRowDiff(row(), row({ isUrgent: true }))).toEqual({ is_urgent: true });
    });

    it('C · two independent fields → exactly two columns', () => {
        const changes = customerRowDiff(row(), row({ contactNumber: '9811111111', category: 'Dyeing' }));
        expect(changes).toEqual({ contact_number: '9811111111', category: 'Dyeing' });
    });

    it('D · a nullable field cleared → the column is present with null', () => {
        expect(customerRowDiff(row(), row({ assignedCollectorId: undefined }))).toEqual({ assigned_collector_id: null });
        expect(customerRowDiff(row(), row({ settledAt: undefined }))).toEqual({ settled_at: null });
        expect(customerRowDiff(row(), row({ followUpDate: undefined }))).toEqual({ follow_up_date: null });
    });

    it('E · undefined never reaches a row: the mapper writes null, so "not provided" and "clear" are the same thing at the row level and "unchanged" is simply absent from the diff', () => {
        const r = row({ pan: undefined, email: undefined });
        expect(r.pan).toBeNull();
        expect(r.email).toBeNull();
        expect(Object.values(r).some(v => v === undefined)).toBe(false);
        // a row that already had null keeps it out of the diff
        expect(customerRowDiff(r, r)).toEqual({});
    });

    it('never carries the id', () => {
        const changed = { ...row(), id: 'somebody_else' } as CustomerRow;
        expect('id' in customerRowDiff(row(), changed)).toBe(false);
    });

    it('J · one unrelated change on a sensitive row leaves every sensitive column out', () => {
        const changes = customerRowDiff(row(), row({ contactPerson: 'Mahesh' }));
        expect(changes).toEqual({ contact_person: 'Mahesh' });
        for (const sensitive of ['assigned_collector_id', 'crm_owner_id', 'follow_up_date', 'payment_rank', 'settled_at', 'total', 'ageing', 'ageing_types', 'over90', 'due_over45', 'notes', 'forecast_amount', 'forecast_date', 'status']) {
            expect(sensitive in changes).toBe(false);
        }
    });

    it('treats the same ageing types as equal whatever the key order (jsonb vs the parser)', () => {
        const fromDb = row();
        fromDb.ageing_types = { '1-45': 'Dr', '>135': 'Cr', '46-90': 'Dr', '91-135': 'Dr' } as CustomerRow['ageing_types'];
        const fromSheet = row();
        fromSheet.ageing_types = { '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Cr' } as CustomerRow['ageing_types'];
        expect(customerRowDiff(fromDb, fromSheet)).toEqual({});
    });

    it('a money change from the sheet is the money columns only', () => {
        const after = row({ total: 500000, ageing: { '1-45': 500000, '46-90': 0, '91-135': 0, '>135': 0 }, ageingTypes: { '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Dr' }, over90: 0, dueOver45: 0 });
        const changes = customerRowDiff(row(), after);
        expect(Object.keys(changes).sort()).toEqual(['ageing', 'ageing_types', 'due_over45', 'over90', 'total']);
    });

    it('a status flip is one column', () => {
        expect(customerRowDiff(row(), row({ status: FollowUpStatus.Overdue }))).toEqual({ status: 'Overdue' });
    });

    it('notes are compared in order (a new line is a change; the same lines are not)', () => {
        const same = row({ notes: [...mixedAccount().notes] });
        expect(customerRowDiff(row(), same)).toEqual({});
        const appended = row({ notes: [...mixedAccount().notes, 'new line'] });
        expect(customerRowDiff(row(), appended)).toEqual({ notes: [...mixedAccount().notes, 'new line'] });
    });
});
