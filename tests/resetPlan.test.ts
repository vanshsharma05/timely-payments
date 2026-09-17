/**
 * The fresh-start plan (services/reset.ts): what the browser asks the
 * database to do, computed from a synthetic book and a synthetic sheet.
 * Nothing here talks to a network.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));

import { buildResetPlan, backupFileContents } from '../services/reset';
import { customerIdFor } from '../services/googleSheetService';
import { Outstanding, FollowUpStatus, PdcCheque, PdcStatus } from '../types';
import { mixedAccount } from './fixtures';

/** A row as parseGoogleSheetCsv() hands it over: money, a name, a CRM code, nothing else the app owns. */
const sheetRow = (company: string, total: number, crm = 'SHEET_CRM'): Outstanding => ({
    id: customerIdFor(company),
    company,
    contactPerson: '',
    contactNumber: '',
    total,
    totalType: 'Dr',
    ageing: { '1-45': total, '46-90': 0, '91-135': 0, '>135': 0 },
    ageingTypes: { '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Dr' },
    over90: 0,
    over90Type: 'Dr',
    dueOver45: 0,
    dueOver45Type: 'Dr',
    crmOwnerId: crm,
    assignedCollectorId: undefined,
    followUpDate: undefined,
    status: FollowUpStatus.Pending,
    notes: [],
    isUrgent: total > 1000000,
    creationDate: new Date(),
    lastFollowUpOn: undefined,
});

/** Legacy id, owner, collector, note, forecast — the account the old reset deleted and re-created. */
const legacy = (): Outstanding => ({ ...mixedAccount(), id: 'out_63_3_BROTHERS', company: '3 BROTHERS ( THUKRAL HOSIERY )', settledAt: undefined });
const listed = (): Outstanding => ({ ...mixedAccount(), id: customerIdFor('BHAVYA PRINT-O-FLEX'), company: 'BHAVYA PRINT-O-FLEX', settledAt: undefined, total: 50000, ageing: { '1-45': 50000, '46-90': 0, '91-135': 0, '>135': 0 } });
const unlistedOwing = (): Outstanding => ({ ...mixedAccount(), id: customerIdFor('GONE TRADERS'), company: 'GONE TRADERS', settledAt: undefined, total: 12000 });
const alreadySettled = (): Outstanding => ({ ...mixedAccount(), id: customerIdFor('OLD SETTLED CO'), company: 'OLD SETTLED CO', total: 0, ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 }, over90: 0, dueOver45: 0, settledAt: '2026-03-01T00:00:00.000Z', followUpDate: undefined, notes: [], forecastAmount: undefined, forecastDate: undefined, lastFollowUpOn: undefined, isUrgent: false });

const book = () => [legacy(), listed(), unlistedOwing(), alreadySettled()];
const sheet = () => [sheetRow('3 BROTHERS ( THUKRAL HOSIERY )', 777000), sheetRow('BHAVYA PRINT-O-FLEX', 0), sheetRow('BRAND NEW FIRM', 5000)];
const cheque = (): PdcCheque => ({ id: 'pdc_1', customerId: 'out_63_3_BROTHERS', customerName: '3 BROTHERS ( THUKRAL HOSIERY )', chequeNumber: '000123', bankName: 'SBI', chequeDate: new Date('2026-10-01T00:00:00.000Z'), amount: 25000, status: PdcStatus.Pending, receivedDate: new Date('2026-09-01T00:00:00.000Z') });

describe('buildResetPlan — ids are kept, only money moves, the rest is the database\'s clearing step', () => {
    const plan = buildResetPlan(book(), sheet(), [cheque()], '16-09-2026');

    it('has exactly one update per account on file, under the id it already has (legacy out_* ids included)', () => {
        expect(plan.updates.map(u => u.id).sort()).toEqual(book().map(c => c.id).sort());
        expect(plan.updates.find(u => u.id === 'out_63_3_BROTHERS')).toBeTruthy();
    });

    it('a listed account takes the sheet\'s figures, matched by name whatever its id', () => {
        const u = plan.updates.find(u => u.id === 'out_63_3_BROTHERS')!;
        expect(u.total).toBe(777000);
        expect(u.ageing).toEqual({ '1-45': 777000, '46-90': 0, '91-135': 0, '>135': 0 });
        expect(u.settled_at).toBeNull();
    });

    it('an account the sheet no longer lists, still owing, is settled to nil and stamped', () => {
        const u = plan.updates.find(u => u.id === customerIdFor('GONE TRADERS'))!;
        expect(u.total).toBe(0);
        expect(typeof u.settled_at).toBe('string');
    });

    it('an account already settled keeps its old stamp and stays at nil', () => {
        const u = plan.updates.find(u => u.id === customerIdFor('OLD SETTLED CO'))!;
        expect(u.total).toBe(0);
        expect(u.settled_at).toBe('2026-03-01T00:00:00.000Z');
    });

    it('a listed account whose sheet balance is now zero is settled by the sheet, not deleted', () => {
        const u = plan.updates.find(u => u.id === customerIdFor('BHAVYA PRINT-O-FLEX'))!;
        expect(u.total).toBe(0);
        expect(typeof u.settled_at).toBe('string');
    });

    it('an update carries money and settlement only — never owner, collector, contacts, notes or dates', () => {
        for (const u of plan.updates) {
            expect(Object.keys(u).sort()).toEqual(['ageing', 'ageing_types', 'due_over45', 'due_over45_type', 'id', 'over90', 'over90_type', 'settled_at', 'total', 'total_type']);
        }
    });

    it('a name the book has never seen is added under a cust_ id, unassigned, with no follow-up work', () => {
        expect(plan.inserts).toHaveLength(1);
        const n = plan.inserts[0];
        expect(n.id).toBe(customerIdFor('BRAND NEW FIRM'));
        expect(n.company).toBe('BRAND NEW FIRM');
        expect(n.crm_owner_id).toBe('');          // the sheet does not decide ownership
        expect(n.total).toBe(5000);
        expect(n.notes).toEqual([]);
        expect(n.follow_up_date).toBeNull();
        expect(n.status).toBe('Pending');
    });

    it('counts what the dialog shows', () => {
        expect(plan.counts).toEqual({ onFile: 4, listed: 2, settled: 2, untouched: 1, added: 1, cheques: 1, withFollowUpWork: 3 });
        expect(plan.updatedTillDate).toBe('16-09-2026');
    });

    it('refuses an empty sheet: there is nothing to reset to', () => {
        expect(() => buildResetPlan(book(), [], [cheque()])).toThrow(/no rows/);
    });
});

describe('the backup file', () => {
    it('carries every customer row, every cheque, the templates and the profile', () => {
        const json = JSON.parse(backupFileContents(book(), [cheque()], [{ id: 't', name: 'T', content: 'x' }], { companyName: 'Co' } as any));
        expect(json.customers).toHaveLength(4);
        expect(json.customers[0].id).toBe('out_63_3_BROTHERS');
        expect(json.customers[0].assigned_collector_id).toBe('MUNSHI_RAM');
        expect(json.pdc_cheques).toHaveLength(1);
        expect(json.pdc_cheques[0].cheque_number).toBe('000123');
        expect(json.templates[0].id).toBe('t');
        expect(json.company_profile.companyName).toBe('Co');
        expect(typeof json.exportedAt).toBe('string');
    });
});
