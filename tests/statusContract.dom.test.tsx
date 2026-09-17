// @vitest-environment jsdom
/**
 * The status contract, end to end: `customers.status` records one fact — the
 * money was collected (`Completed`) — and every other reading of a follow-up
 * comes from its date. These tests drive the real follow-up dialog and the
 * real edit dialog and look at the exact columns each Save would send, plus
 * the server digest against the same rows.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));
vi.mock('../services/repository', async (importOriginal) => {
    const real = await importOriginal<typeof import('../services/repository')>();
    return { ...real, fetchActivity: vi.fn(async () => []), addActivity: vi.fn(async () => undefined), deleteActivity: vi.fn(async () => undefined) };
});

import FollowUpModal from '../components/FollowUpModal';
import { CustomerEditModal } from '../components/CustomerEditModal';
import { outstandingToRow, customerRowDiff } from '../services/repository';
import { processStatuses } from '../services/googleSheetService';
import { buildDigests, Recipient } from '../api/_lib/digest';
import { Outstanding, FollowUpStatus, followUpStatusOf, getFollowUpCategory } from '../types';
import { mixedAccount, adminUser, crmUser, collectorUser } from './fixtures';

// The dialog asks whether it is on a phone and scrolls its activity thread; jsdom has neither.
if (!window.matchMedia) {
    (window as any).matchMedia = (media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);

const columnsOf = (before: Outstanding, after: Outstanding) => Object.keys(customerRowDiff(outstandingToRow(before), outstandingToRow(after))).sort();
/** A follow-up date the dialog's date field round-trips exactly (it formats with toISOString, so UTC midnight). */
const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const PAST = '2026-09-10';   // before today (2026-09-17) — and before any day these tests will ever run on
const FUTURE = '2099-12-01';

/** An open account whose stored word went stale when its date passed — the state of 172 production rows. */
const staleOpen = (): Outstanding => ({ ...mixedAccount(), followUpDate: utcDay(PAST), status: FollowUpStatus.Upcoming });
const collected = (): Outstanding => ({ ...mixedAccount(), followUpDate: utcDay(PAST), status: FollowUpStatus.Completed });

/** Renders the real follow-up dialog, applies the edits, presses Save, returns what it handed to onUpdate. */
function saveFollowUp(customer: Outstanding, edit?: () => void): Outstanding {
    const onUpdate = vi.fn();
    render(<FollowUpModal customer={customer} currentUser={crmUser()} onClose={() => {}} onUpdate={onUpdate} users={[adminUser(), crmUser(), collectorUser()]} templates={[]} />);
    edit?.();
    fireEvent.click(screen.getByRole('button', { name: /save follow-up/i }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    return processStatuses([onUpdate.mock.calls[0][0] as Outstanding])[0];
}
const outcome = (value: 'follow_up' | 'collected' | 'no_follow_up') => fireEvent.click(document.querySelector(`input[name="outcome"][value="${value}"]`)!);

/** The same for the edit dialog. */
function saveEdit(customer: Outstanding, edit?: () => void): Outstanding {
    const onSave = vi.fn();
    render(<CustomerEditModal customerToEdit={customer} onSave={onSave} onClose={() => {}} currentUser={crmUser()} users={[adminUser(), crmUser(), collectorUser()]} />);
    edit?.();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    return processStatuses([onSave.mock.calls[0][0] as Outstanding])[0];
}
const setDate = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('B · a normal follow-up action stores no word for where the follow-up stands', () => {
    it('a plain Save on a stale open account after its date passed sends last_follow_up_on and nothing else', () => {
        const before = staleOpen();
        expect(followUpStatusOf(before)).toBe(FollowUpStatus.Overdue); // the reading moved; the row need not
        const after = saveFollowUp(before);
        expect(columnsOf(before, after)).toEqual(['last_follow_up_on']);
        expect(after.status).toBe(FollowUpStatus.Upcoming); // the stale word is left alone: nothing reads it
    });
    it('urgency toggled on the same account (the probe scenario) → is_urgent and last_follow_up_on only', () => {
        const before = staleOpen();
        const after = saveFollowUp(before, () => fireEvent.click(document.querySelector('#isUrgent')!));
        expect(columnsOf(before, after)).toEqual(['is_urgent', 'last_follow_up_on']);
    });
    it('a new follow-up date → follow_up_date and last_follow_up_on; the reading comes from the date', () => {
        const before = staleOpen();
        const after = saveFollowUp(before, () => setDate('Next Follow-up Date', FUTURE));
        expect(columnsOf(before, after)).toEqual(['follow_up_date', 'last_follow_up_on']);
        expect(followUpStatusOf(after)).toBe(FollowUpStatus.Upcoming);
    });
    it('"no follow-up" on an open account clears the date and writes no status; it then reads Pending', () => {
        const before = staleOpen();
        const after = saveFollowUp(before, () => outcome('no_follow_up'));
        expect(columnsOf(before, after)).toEqual(['follow_up_date', 'last_follow_up_on']);
        expect(outstandingToRow(after).follow_up_date).toBeNull();
        expect(after.status).toBe(FollowUpStatus.Upcoming);     // stale word untouched…
        expect(followUpStatusOf(after)).toBe(FollowUpStatus.Pending); // …and never consulted
    });
    it('the edit dialog: a new date on an open account → follow_up_date only', () => {
        const before = staleOpen();
        const after = saveEdit(before, () => setDate('Next Follow-up Date', FUTURE));
        expect(columnsOf(before, after)).toEqual(['follow_up_date']);
    });
});

describe('C · collected is the declared outcome and is persisted', () => {
    it('"Payment collected" → status: Completed, follow_up_date: now, last_follow_up_on', () => {
        const before = staleOpen();
        const after = saveFollowUp(before, () => outcome('collected'));
        const diff = customerRowDiff(outstandingToRow(before), outstandingToRow(after));
        expect(Object.keys(diff).sort()).toEqual(['follow_up_date', 'last_follow_up_on', 'status']);
        expect(diff.status).toBe('Completed');
    });
});

describe('D · Completed survives the calendar', () => {
    it('collected long ago, still Completed on every reader, and processStatuses writes nothing', () => {
        const row = collected();
        expect(followUpStatusOf(row, new Date('2030-01-01'))).toBe(FollowUpStatus.Completed);
        expect(getFollowUpCategory(row, new Date('2030-01-01'))).toBe('completed');
        expect(customerRowDiff(outstandingToRow(row), outstandingToRow(processStatuses([row])[0]))).toEqual({});
    });
});

describe('E · reopening a collected account — pinned exactly as it works today', () => {
    it('follow-up dialog, default outcome (a follow-up on the date in the field) → status: Pending, the date kept; this is what a plain Save on a collected account does', () => {
        const before = collected();
        const after = saveFollowUp(before);
        const diff = customerRowDiff(outstandingToRow(before), outstandingToRow(after));
        expect(Object.keys(diff).sort()).toEqual(['last_follow_up_on', 'status']);
        expect(diff.status).toBe('Pending');
        expect(followUpStatusOf(after)).toBe(FollowUpStatus.Overdue); // the collection date, now read as a follow-up date
    });
    it('follow-up dialog, a new date → status: Pending and follow_up_date', () => {
        const before = collected();
        const after = saveFollowUp(before, () => setDate('Next Follow-up Date', FUTURE));
        const diff = customerRowDiff(outstandingToRow(before), outstandingToRow(after));
        expect(Object.keys(diff).sort()).toEqual(['follow_up_date', 'last_follow_up_on', 'status']);
        expect(diff.status).toBe('Pending');
        expect(followUpStatusOf(after)).toBe(FollowUpStatus.Upcoming);
    });
    it('follow-up dialog, "no follow-up" → status: Pending and the date cleared', () => {
        const before = collected();
        const after = saveFollowUp(before, () => outcome('no_follow_up'));
        const diff = customerRowDiff(outstandingToRow(before), outstandingToRow(after));
        expect(diff).toMatchObject({ status: 'Pending', follow_up_date: null });
        expect(followUpStatusOf(after)).toBe(FollowUpStatus.Pending);
    });
    it('edit dialog, a new date on a collected account → status: Pending and follow_up_date', () => {
        const before = collected();
        const after = saveEdit(before, () => setDate('Next Follow-up Date', FUTURE));
        expect(customerRowDiff(outstandingToRow(before), outstandingToRow(after))).toEqual({ follow_up_date: utcDay(FUTURE).toISOString(), status: 'Pending' });
    });
    it('edit dialog, clearing the date on a collected account leaves it collected', () => {
        const before = collected();
        const after = saveEdit(before, () => setDate('Next Follow-up Date', ''));
        expect(customerRowDiff(outstandingToRow(before), outstandingToRow(after))).toEqual({ follow_up_date: null });
        expect(followUpStatusOf(after)).toBe(FollowUpStatus.Completed);
    });
    it('the only values any writer stores are Completed and Pending', () => {
        const seen = new Set<string>();
        const note = (o: Outstanding) => seen.add(o.status);
        note(saveFollowUp(staleOpen(), () => outcome('collected'))); cleanup();
        note(saveFollowUp(collected())); cleanup();
        note(saveFollowUp(collected(), () => outcome('no_follow_up'))); cleanup();
        note(saveEdit(collected(), () => setDate('Next Follow-up Date', FUTURE))); cleanup();
        expect([...seen].sort()).toEqual(['Completed', 'Pending']);
    });
});

describe('F · the readers agree with the date, not the stored word', () => {
    it('Reports categories (getFollowUpCategory) on the stale rows', () => {
        const rows: Outstanding[] = [
            staleOpen(),                                                                          // stored Upcoming, date passed
            { ...mixedAccount(), followUpDate: utcDay(FUTURE), status: FollowUpStatus.Overdue }, // stored Overdue, date ahead
            { ...mixedAccount(), followUpDate: undefined, status: FollowUpStatus.Today },        // stored Today, no date
            collected(),
        ];
        expect(rows.map(r => getFollowUpCategory(r))).toEqual(['overdue', 'future', 'no_follow_up', 'completed']);
    });

    it('the morning digest puts the stale row under overdue and leaves the collected one out', async () => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dueToday = new Date(today); dueToday.setHours(9);
        const customers = [
            { id: 'a', company: 'STALE WORD',   total: 5000, total_type: 'Dr', crm_owner_id: 'VISHNU', payment_rank: null,  follow_up_date: utcDay(PAST).toISOString(), status: 'Upcoming' },
            { id: 'b', company: 'DUE TODAY',    total: 7000, total_type: 'Dr', crm_owner_id: 'VISHNU', payment_rank: null,  follow_up_date: dueToday.toISOString(),     status: 'Pending' },
            { id: 'c', company: 'COLLECTED',    total: 9000, total_type: 'Dr', crm_owner_id: 'VISHNU', payment_rank: null,  follow_up_date: utcDay(PAST).toISOString(), status: 'Completed' },
            { id: 'd', company: 'BAD DEBT',     total: 8000, total_type: 'Dr', crm_owner_id: 'VISHNU', payment_rank: 'Bad', follow_up_date: utcDay(PAST).toISOString(), status: 'Overdue' },
            { id: 'e', company: 'NOTHING SET',  total: 1000, total_type: 'Dr', crm_owner_id: 'VISHNU', payment_rank: null,  follow_up_date: null,                       status: 'Today' },
        ].map(c => ({ contact_person: null, contact_number: null, assigned_collector_id: null, forecast_amount: null, forecast_date: null, last_follow_up_on: null, ...c }));
        const tables: Record<string, unknown[]> = { customers, pdc_cheques: [], customer_activity: [] };
        const db = { from: (t: string) => ({ select: () => ({ order: () => ({ range: async (a: number, b: number) => ({ data: tables[t].slice(a, b + 1), error: null }) }) }) }) } as any;
        const me: Recipient = { authId: 'u', legacyId: 'VISHNU', name: 'Vishnu', email: null, role: 'CRM', dataVisibility: 'Assigned', assignedCrms: [], permissions: null };
        const [d] = await buildDigests(db, [me]);
        expect(d.overdue.map(c => c.id)).toEqual(['a']);
        expect(d.dueToday.map(c => c.id)).toEqual(['b']);
        expect(d.noFollowUpCount).toBe(1);   // 'e' — its stale word says Today, its date says nothing planned
        expect(d.badDebtCount).toBe(1);
        expect([...d.overdue, ...d.dueToday].some(c => c.id === 'c')).toBe(false);
    });
});
