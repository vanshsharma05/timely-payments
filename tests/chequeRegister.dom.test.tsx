// @vitest-environment jsdom
/**
 * The cheque register and its dialog: one vocabulary for where a cheque
 * stands, three lists (needs attention, coming up, finished) that between
 * them hold the six states, the most urgent first, one obvious action per
 * row with the rest behind a menu, cleared cheques that look finished, a
 * delete that names what goes, and a dialog that guesses nothing.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));

import PdcChequesView, { normaliseStateFilter, TAB_OF, whenLine } from '../components/PdcChequesView';
import PdcModal from '../components/PdcModal';
import { CHEQUE_STATES, sortCheques, stateOf } from '../components/ui/ChequeState';
import { chequeWhen } from '../components/ui/format';
import { Outstanding, PdcCheque, PdcStatus, UserRole, DEFAULT_ROLE_PERMISSIONS } from '../types';
import { mixedAccount, adminUser, crmUser, collectorUser } from './fixtures';

if (!window.matchMedia) {
    (window as any).matchMedia = (media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}
afterEach(cleanup);

const day = (offset: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };
const users = () => [adminUser(), crmUser(), collectorUser()];
const customerA = (): Outstanding => mixedAccount();
const customerB = (): Outstanding => ({ ...mixedAccount(), id: 'cust_b', company: 'BETA TRADERS', contactPerson: 'Beta', contactNumber: '9000000002', total: 50000 });

const cheque = (id: string, over: Partial<PdcCheque>): PdcCheque => ({
    id, customerId: customerA().id, customerName: customerA().company, chequeNumber: id.toUpperCase(), bankName: 'HDFC Bank',
    chequeDate: day(5), amount: 10000, status: PdcStatus.Pending, receivedDate: day(-2), addedBy: 'Rawat', ...over,
});
/** One cheque per state, dated so the order is testable. */
const register = (): PdcCheque[] => [
    cheque('c_cleared_old', { status: PdcStatus.Cleared, chequeDate: day(-30), amount: 1000 }),
    cheque('c_cleared_new', { status: PdcStatus.Cleared, chequeDate: day(-1), amount: 2000 }),
    cheque('c_upcoming', { chequeDate: day(5), amount: 3000 }),
    cheque('c_due', { chequeDate: day(0), amount: 4000 }),
    cheque('c_overdue', { chequeDate: day(-3), amount: 5000, remarks: 'bank on Monday' }),
    cheque('c_hold', { status: PdcStatus.Hold, chequeDate: day(2), amount: 6000 }),
    cheque('c_bounced', { status: PdcStatus.Bounced, chequeDate: day(-6), amount: 7000, customerId: 'cust_b', customerName: 'BETA TRADERS' }),
];

const open = (over: Partial<React.ComponentProps<typeof PdcChequesView>> = {}) => {
    const fns = { onAddPdc: vi.fn(), onEditPdc: vi.fn(), onDeletePdc: vi.fn(), onUpdatePdcStatus: vi.fn(), onBulkPdcStatus: vi.fn(), onBulkDeletePdc: vi.fn(), onOpenCustomerFollowUp: vi.fn() };
    render(<PdcChequesView pdcCheques={register()} customers={[customerA(), customerB()]} users={users()} currentUser={adminUser()} {...fns} {...over} />);
    return fns;
};
const rows = () => screen.getAllByRole('row').slice(1);
const rowOf = (num: string) => rows().find(r => r.textContent!.includes(`#${num}`))!;
const tabOf = (label: RegExp) => screen.getByRole('tab', { name: label });
const summary = () => (screen.getByText(/to deal with|in hand|cleared ·|Nothing needs attention/) as HTMLElement).textContent!;
const menuOf = (num: string) => { fireEvent.click(within(rowOf(num)).getByRole('button', { name: `More for cheque ${num}` })); return screen.getByRole('menu'); };
const menuItems = (num: string) => within(menuOf(num)).getAllByRole('menuitem').map(b => [...b.querySelectorAll('span')].map(x => x.textContent!.trim()).join(' '));

describe('one vocabulary for where a cheque stands', () => {
    it('names the six states the same everywhere and works them out from the date', () => {
        expect(Object.values(CHEQUE_STATES).map(s => s.label)).toEqual(['Date passed', 'Due today', 'Bounced', 'On hold', 'Upcoming', 'Cleared']);
        expect(stateOf({ status: PdcStatus.Pending, chequeDate: day(-1) })).toBe('overdue');
        expect(stateOf({ status: PdcStatus.Pending, chequeDate: day(0) })).toBe('due');
        expect(stateOf({ status: PdcStatus.Pending, chequeDate: day(1) })).toBe('upcoming');
        expect(stateOf({ status: PdcStatus.DueToday, chequeDate: day(9) })).toBe('upcoming');   // the retired status reads as pending
        expect(stateOf({ status: PdcStatus.Hold, chequeDate: day(-9) })).toBe('hold');
    });

    it('says when a cheque is dated in plain words', () => {
        const t = new Date('2026-09-17T12:00:00');
        expect(chequeWhen(new Date('2026-09-17'), t)).toBe('Today');
        expect(chequeWhen(new Date('2026-09-18'), t)).toBe('Tomorrow · 18 Sept');
        expect(chequeWhen(new Date('2026-09-21'), t)).toBe('in 4d · 21 Sept');
        expect(chequeWhen(new Date('2026-09-14'), t)).toBe('3d ago · 14 Sept');
        expect(chequeWhen(new Date('2026-12-25'), t)).toBe('25 Dec');
        expect(chequeWhen(new Date('2027-01-05'), t)).toBe('5 Jan 2027');
    });

    it('the register lists what is in hand first by date, then bounced, on hold, and cleared newest first', () => {
        const sorted = sortCheques(register().map(c => ({ ...c, state: stateOf(c) })));
        expect(sorted.map(c => c.id)).toEqual(['c_overdue', 'c_due', 'c_upcoming', 'c_bounced', 'c_hold', 'c_cleared_new', 'c_cleared_old']);
    });

    it('every state belongs to exactly one of the three lists, and the old filter names find them', () => {
        expect(TAB_OF).toEqual({ overdue: 'attention', due: 'attention', bounced: 'attention', upcoming: 'upcoming', hold: 'upcoming', cleared: 'finished' });
        expect(normaliseStateFilter('today')).toBe('attention');
        expect(normaliseStateFilter('Pending')).toBe('upcoming');
        expect(normaliseStateFilter('Cleared')).toBe('finished');
        expect(normaliseStateFilter(null)).toBeNull();
    });
});

describe('three lists, and the one with work in it opens first', () => {
    it('counts on the tabs: what needs attention (date passed, due today, bounced), coming up (upcoming, on hold), finished (cleared)', () => {
        open();
        expect(tabOf(/^Needs attention/).textContent).toMatch(/Needs attention3/);
        expect(tabOf(/^Coming up/).textContent).toMatch(/Coming up2/);
        expect(tabOf(/^Finished/).textContent).toMatch(/Finished2/);
        expect(tabOf(/^Needs attention/).getAttribute('aria-selected')).toBe('true');
        expect(summary()).toBe('3 to deal with · ₹16,000');
        // the most urgent first: the one whose date passed, then today's, then the bounced one
        expect(rows().map(r => r.textContent!.match(/#C_[A-Z_]+/)![0])).toEqual(['#C_OVERDUE', '#C_DUE', '#C_BOUNCED']);
    });

    it('Coming up lists what is in hand for later and what is on hold, by date; Finished lists the cleared newest first, dimmed', () => {
        open();
        fireEvent.click(tabOf(/^Coming up/));
        expect(rows().map(r => r.textContent!.match(/#C_[A-Z_]+/)![0])).toEqual(['#C_UPCOMING', '#C_HOLD']);
        expect(summary()).toMatch(/^2 in hand · ₹9,000 · 1 due within a week$/);
        fireEvent.click(tabOf(/^Finished/));
        expect(rows().map(r => r.textContent!.match(/#C_[A-Z_]+/)![0])).toEqual(['#C_CLEARED_NEW', '#C_CLEARED_OLD']);
        expect(summary()).toBe('2 cleared · ₹3,000');
        expect(rows()[0].className).toMatch(/opacity-70/);
    });

    it('with nothing needing attention the register opens on Coming up and says so', () => {
        open({ pdcCheques: register().filter(c => !['c_due', 'c_overdue', 'c_bounced'].includes(c.id)) });
        expect(tabOf(/^Coming up/).getAttribute('aria-selected')).toBe('true');
        fireEvent.click(tabOf(/^Needs attention/));
        expect(screen.getAllByText('Nothing needs attention').length).toBe(2);   // the summary line, and the empty state
        expect(screen.getByText(/1 cheque due within a week — ₹3,000/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'See what is coming up' }));
        expect(tabOf(/^Coming up/).getAttribute('aria-selected')).toBe('true');
    });

    it('arriving from Today with "today" opens on Needs attention; "cleared" on Finished', () => {
        open({ initialStatusFilter: 'today' });
        expect(tabOf(/^Needs attention/).getAttribute('aria-selected')).toBe('true');
        cleanup();
        open({ initialStatusFilter: 'cleared' });
        expect(tabOf(/^Finished/).getAttribute('aria-selected')).toBe('true');
    });

    it('arriving for one customer shows their chip, and × widens the list again', () => {
        open({ initialCustomerFilter: 'cust_b' });
        expect(tabOf(/^Needs attention/).textContent).toMatch(/Needs attention1/);
        expect(screen.getByText('BETA TRADERS', { selector: 'span' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: "Show every customer's cheques" }));
        expect(tabOf(/^Needs attention/).textContent).toMatch(/Needs attention3/);
    });

    it('the search finds a cheque by customer, number, bank, note or amount, across the current list', () => {
        open();
        const box = screen.getByLabelText('Find a cheque');
        fireEvent.change(box, { target: { value: 'monday' } });
        expect(rows().length).toBe(1);
        fireEvent.change(box, { target: { value: '7000' } });
        expect(rows()[0].textContent).toContain('BETA TRADERS');
        fireEvent.change(box, { target: { value: 'C_HOLD' } });
        expect(tabOf(/^Coming up/).textContent).toMatch(/Coming up1/);
        expect(screen.getByText('No cheques match')).toBeTruthy();
    });

    it('the filters fold behind one button', () => {
        open();
        expect(screen.queryByLabelText('CRM owner')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
        fireEvent.change(screen.getByLabelText('Bank'), { target: { value: 'HDFC Bank' } });
        expect(screen.getByRole('button', { name: /^Filter · 1/ })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(screen.getByRole('button', { name: /^Filter$/ })).toBeTruthy();
    });
});

describe('each row shows its state and offers what fits it', () => {
    it('says when each cheque is for in plain words, with the state word only where it adds something', () => {
        open();
        expect(within(rowOf('C_OVERDUE')).getByText('Date passed')).toBeTruthy();
        expect(within(rowOf('C_OVERDUE')).getByText(/^Dated .*, 3 days ago$/)).toBeTruthy();
        expect(within(rowOf('C_DUE')).getByText('Due today')).toBeTruthy();        // the line itself; no tag repeating it
        expect(within(rowOf('C_BOUNCED')).getByText('Bounced')).toBeTruthy();
        fireEvent.click(tabOf(/^Coming up/));
        expect(within(rowOf('C_UPCOMING')).getByText(/^In 5 days, /)).toBeTruthy();
        expect(within(rowOf('C_UPCOMING')).queryByText('Upcoming')).toBeNull();
        expect(within(rowOf('C_HOLD')).getByText('On hold')).toBeTruthy();
        fireEvent.click(tabOf(/^Finished/));
        expect(within(rowOf('C_CLEARED_NEW')).getByText(/^Cleared /)).toBeTruthy();
        expect(within(rowOf('C_CLEARED_NEW')).queryByText('Cleared', { exact: true })).toBeNull();
        const t = new Date();
        expect(whenLine({ chequeDate: day(1), state: 'upcoming' }, t)).toMatch(/^Tomorrow, /);
        expect(whenLine({ chequeDate: day(-1), state: 'overdue' }, t)).toMatch(/, yesterday$/);
        expect(whenLine({ chequeDate: day(-10), clearedDate: day(-2), state: 'cleared' }, t)).toBe(`Cleared ${day(-2).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`);
    });

    it('one obvious action per row, the rest behind the menu; a cleared cheque has nothing to press', () => {
        const { onUpdatePdcStatus, onEditPdc } = open();
        const primary = (num: string) => within(rowOf(num).querySelector('td:last-child') as HTMLElement).queryAllByRole('button').filter(b => !/^More for/.test(b.getAttribute('aria-label') || '')).map(b => b.textContent!.trim());
        expect(primary('C_DUE')).toEqual(['Mark cleared']);
        expect(primary('C_OVERDUE')).toEqual(['Mark cleared']);
        expect(primary('C_BOUNCED')).toEqual(['Mark cleared']);
        expect(menuItems('C_DUE')).toEqual(['Bounced Returned unpaid by the bank', 'Put on hold Do not present it for now', 'Edit details', 'Delete…']);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(menuItems('C_BOUNCED')).toEqual(['Not bounced after all Back in hand, waiting for its date', 'Put on hold Do not present it again for now', 'Edit details', 'Delete…']);
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(within(rowOf('C_DUE')).getByRole('button', { name: 'Mark cleared' }));
        expect(onUpdatePdcStatus).toHaveBeenLastCalledWith('c_due', PdcStatus.Cleared);

        fireEvent.click(tabOf(/^Coming up/));
        expect(primary('C_UPCOMING')).toEqual([]);
        expect(primary('C_HOLD')).toEqual(['Release hold']);
        expect(menuItems('C_UPCOMING')).toEqual(['Mark cleared The bank paid it early', 'Put on hold Do not present it on its date', 'Bounced Returned unpaid by the bank', 'Edit details', 'Delete…']);
        fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Edit details/ }));
        expect(onEditPdc).toHaveBeenCalledWith(expect.objectContaining({ id: 'c_upcoming' }));
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(within(rowOf('C_HOLD')).getByRole('button', { name: 'Release hold' }));
        expect(onUpdatePdcStatus).toHaveBeenLastCalledWith('c_hold', PdcStatus.Pending);

        fireEvent.click(tabOf(/^Finished/));
        expect(primary('C_CLEARED_NEW')).toEqual([]);
        expect(menuItems('C_CLEARED_NEW')).toEqual(['Not cleared after all Back in hand, waiting for its date', 'Edit details', 'Delete…']);
        fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Not cleared after all/ }));
        expect(onUpdatePdcStatus).toHaveBeenLastCalledWith('c_cleared_new', PdcStatus.Pending);
    });

    it('the customer\'s name opens their account', () => {
        const { onOpenCustomerFollowUp } = open();
        fireEvent.click(within(rowOf('C_BOUNCED')).getByRole('button', { name: 'BETA TRADERS' }));
        expect(onOpenCustomerFollowUp).toHaveBeenCalledTimes(1);
        expect(onOpenCustomerFollowUp.mock.calls[0][0].id).toBe('cust_b');
    });

    it('a viewer without the right sees the state but no actions, no boxes', () => {
        open({ currentUser: { ...adminUser(), id: 'VIEWER', name: 'Viewer', role: UserRole.Viewer, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.Viewer] }, onBulkPdcStatus: undefined, onBulkDeletePdc: undefined });
        expect(screen.queryByRole('button', { name: /Record a cheque/ })).toBeNull();
        expect(screen.queryAllByRole('checkbox')).toEqual([]);
        expect(screen.queryByRole('button', { name: 'Mark cleared' })).toBeNull();
        expect(screen.queryByRole('button', { name: /^More for cheque/ })).toBeNull();
    });

    it('a refused save is said on the row', () => {
        open({ unsaved: [{ id: 'c_due', message: 'permission denied for table pdc_cheques' }] });
        expect(within(rowOf('C_DUE')).getByText(/Not saved, retrying/)).toBeTruthy();
        expect(within(rowOf('C_OVERDUE')).queryByText(/Not saved/)).toBeNull();
    });
});

describe('deleting names what goes, and waits to be told', () => {
    it('one cheque: the question carries its number, bank, amount, date and customer; Cancel does nothing', () => {
        const { onDeletePdc } = open();
        fireEvent.click(within(menuOf('C_OVERDUE')).getByRole('menuitem', { name: 'Delete…' }));
        const dialog = screen.getByRole('alertdialog');
        expect(dialog.textContent).toMatch(/#C_OVERDUE/);
        expect(dialog.textContent).toMatch(/HDFC Bank/);
        expect(dialog.textContent).toMatch(/5,000/);
        expect(dialog.textContent).toMatch(/TEST MIXED UDYOG/);
        expect(dialog.textContent).toMatch(/cannot be undone/);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(onDeletePdc).not.toHaveBeenCalled();
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('the button that deletes says "Delete cheque"; Esc is no', () => {
        const { onDeletePdc } = open();
        fireEvent.click(within(menuOf('C_OVERDUE')).getByRole('menuitem', { name: 'Delete…' }));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('alertdialog')).toBeNull();
        fireEvent.click(within(menuOf('C_OVERDUE')).getByRole('menuitem', { name: 'Delete…' }));
        fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete cheque' }));
        expect(onDeletePdc).toHaveBeenCalledWith('c_overdue');
    });

    it('a selection: mark cleared or put on hold in one go, or a delete that names the total; nothing to select among the finished', () => {
        const { onBulkPdcStatus, onBulkDeletePdc } = open();
        fireEvent.click(within(rowOf('C_DUE')).getByRole('checkbox'));
        fireEvent.click(within(rowOf('C_OVERDUE')).getByRole('checkbox'));
        expect(screen.getByText('2 selected')).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'Mark cleared' }).length).toBe(4);   // the bar's, and one per row
        fireEvent.click(screen.getAllByRole('button', { name: 'Mark cleared' })[0]);
        expect(onBulkPdcStatus).toHaveBeenCalledWith(['c_due', 'c_overdue'], PdcStatus.Cleared);
        fireEvent.click(within(rowOf('C_DUE')).getByRole('checkbox'));
        fireEvent.click(within(rowOf('C_OVERDUE')).getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
        const dialog = screen.getByRole('alertdialog');
        expect(dialog.textContent).toMatch(/Delete 2 cheques\?/);
        expect(dialog.textContent).toMatch(/9,000 across 2 cheques/);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 cheques' }));
        expect(onBulkDeletePdc).toHaveBeenCalledWith(['c_due', 'c_overdue']);
        fireEvent.click(tabOf(/^Finished/));
        expect(screen.queryAllByRole('checkbox')).toEqual([]);
    });
});

describe('loading, empty, and pages', () => {
    it('says it is loading until the first read, and that nothing is recorded when the register is truly empty', () => {
        const { rerender } = render(<PdcChequesView pdcCheques={[]} customers={[customerA()]} users={users()} currentUser={adminUser()} onAddPdc={vi.fn()} onEditPdc={vi.fn()} onDeletePdc={vi.fn()} onUpdatePdcStatus={vi.fn()} loading />);
        expect(screen.getByRole('status').textContent).toMatch(/Loading the register/);
        rerender(<PdcChequesView pdcCheques={[]} customers={[customerA()]} users={users()} currentUser={adminUser()} onAddPdc={vi.fn()} onEditPdc={vi.fn()} onDeletePdc={vi.fn()} onUpdatePdcStatus={vi.fn()} loading={false} />);
        expect(screen.getByText('No cheques recorded yet')).toBeTruthy();
    });

    it('a filter that matches nothing says so and offers Reset', () => {
        open();
        fireEvent.change(screen.getByLabelText('Find a cheque'), { target: { value: 'zzz' } });
        expect(screen.getByText('No cheques match')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(rows().length).toBe(3);
    });

    it('fifty rows at a time', () => {
        const many = Array.from({ length: 120 }, (_, i) => cheque(`c_${i}`, { chequeDate: day(-(i + 1)) }));
        open({ pdcCheques: many });
        expect(rows().length).toBe(50);
        fireEvent.click(screen.getByRole('button', { name: /Show more — 70 left/ }));
        expect(rows().length).toBe(120);
    });
});

describe('the dialog guesses nothing', () => {
    const openDialog = (over: Partial<React.ComponentProps<typeof PdcModal>> = {}) => {
        const onSave = vi.fn(async () => ({ ok: true as const })); const onClose = vi.fn();
        render(<PdcModal isOpen customers={[customerA(), customerB()]} currentUser={crmUser()} users={users()} existingCheques={register()} onClose={onClose} onSave={onSave} {...over} />);
        return { onSave, onClose };
    };

    it('opens with no customer, no bank and no date chosen, and will not save without them', async () => {
        const { onSave } = openDialog();
        expect((screen.getByLabelText('Customer') as HTMLInputElement).value).toBe('');
        expect((screen.getByLabelText('Bank') as HTMLInputElement).value).toBe('');
        expect((screen.getByLabelText('Dated') as HTMLInputElement).value).toBe('');
        // everything else filled: the browser's own "required" check passes and ours speaks
        fireEvent.change(screen.getByPlaceholderText('e.g. 004821'), { target: { value: '000777' } });
        fireEvent.change(screen.getByPlaceholderText('e.g. 50000'), { target: { value: '15000' } });
        fireEvent.change(screen.getByLabelText('Bank'), { target: { value: 'SBI' } });
        fireEvent.change(screen.getByLabelText('Dated'), { target: { value: '2026-12-01' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record cheque' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Choose the customer/));
        expect(onSave).not.toHaveBeenCalled();
    });

    it('the customer is found by typing and chosen from the matches; the line shows their balance and owner', () => {
        openDialog();
        fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'beta' } });
        const list = screen.getByRole('listbox', { name: 'Matching customers' });
        expect(within(list).getAllByRole('option').length).toBe(1);
        fireEvent.click(within(list).getByRole('option', { name: /BETA TRADERS/ }));
        expect(screen.getByText('BETA TRADERS')).toBeTruthy();
        expect(document.body.textContent).toMatch(/O\/S ₹50,000/);
        expect(screen.queryByRole('listbox')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Change' }));
        expect(screen.getByLabelText('Customer')).toBeTruthy();
    });

    it('opened from an account, the customer is fixed', () => {
        openDialog({ preselectedCustomerId: 'cust_b' });
        expect(screen.getByText('BETA TRADERS')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
        expect(screen.queryByLabelText('Customer', { selector: 'input' })).toBeNull();
    });

    it('a number already recorded for that customer from that bank is pointed out, not blocked', () => {
        openDialog({ preselectedCustomerId: customerA().id });
        fireEvent.change(screen.getByPlaceholderText('e.g. 004821'), { target: { value: 'C_DUE' } });
        fireEvent.change(screen.getByLabelText('Bank'), { target: { value: 'hdfc bank' } });
        expect(screen.getByRole('status').textContent).toMatch(/Already recorded: #C_DUE from HDFC Bank, ₹4,000/);
    });

    it('the date says when that is, and warns when it has already passed', () => {
        openDialog({ preselectedCustomerId: customerA().id });
        const past = day(-3); const iso = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
        fireEvent.change(screen.getByLabelText('Dated'), { target: { value: iso } });
        expect(document.body.textContent).toMatch(/3d ago .* it will need attention until it is cleared/);
    });

    it('records with the same payload shape as before, the status as chosen, and one id for retries', async () => {
        const onSave = vi.fn(async (_c: Omit<PdcCheque, 'id'> & { id?: string }) => ({ ok: false as const, message: 'no connection to the server' }));
        openDialog({ onSave, preselectedCustomerId: 'cust_b' });
        fireEvent.change(screen.getByPlaceholderText('e.g. 004821'), { target: { value: '000777' } });
        fireEvent.change(screen.getByPlaceholderText('e.g. 50000'), { target: { value: '15000' } });
        fireEvent.change(screen.getByLabelText('Bank'), { target: { value: 'SBI' } });
        fireEvent.change(screen.getByLabelText('Dated'), { target: { value: '2026-12-01' } });
        expect(screen.queryByRole('radio', { name: 'On hold' })).toBeNull();          // folded away for a new cheque
        fireEvent.click(screen.getByRole('button', { name: /^More/ }));
        fireEvent.click(screen.getByRole('radio', { name: 'On hold' }));
        fireEvent.click(screen.getByRole('button', { name: 'Record cheque' }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        const sent = onSave.mock.calls[0][0] as any;
        expect(sent).toMatchObject({ customerId: 'cust_b', customerName: 'BETA TRADERS', chequeNumber: '000777', bankName: 'SBI', amount: 15000, status: PdcStatus.Hold, remarks: '', crmOwnerId: 'VISHNU', addedBy: 'Vishnu' });
        expect(sent.chequeDate.toISOString()).toBe('2026-12-01T00:00:00.000Z');
        expect(sent.id).toMatch(/^pdc_/);
        await waitFor(() => expect(document.body.textContent).toMatch(/Not saved: no connection/));
        fireEvent.click(screen.getByRole('button', { name: 'Record cheque' }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
        expect((onSave.mock.calls[1][0] as any).id).toBe(sent.id);
    });

    it('editing prefills every field, keeps who added it, and the button says Save changes', async () => {
        const onSave = vi.fn(async (_c: Omit<PdcCheque, 'id'> & { id?: string }) => ({ ok: true as const }));
        openDialog({ onSave, chequeToEdit: cheque('c_edit', { chequeNumber: '4242', bankName: 'Canara Bank', amount: 9000, status: PdcStatus.Hold, remarks: 'from the director', chequeDate: new Date('2026-10-10T00:00:00Z') }) });
        expect(screen.getByText('Edit cheque #4242')).toBeTruthy();
        expect((screen.getByPlaceholderText('e.g. 004821') as HTMLInputElement).value).toBe('4242');
        expect((screen.getByLabelText('Bank') as HTMLInputElement).value).toBe('Canara Bank');
        expect((screen.getByLabelText('Dated') as HTMLInputElement).value).toBe('2026-10-10');
        expect(screen.getByRole('radio', { name: 'On hold' }).getAttribute('aria-checked')).toBe('true');   // open, since it is not simply in hand
        expect(screen.getByText(/On hold · dated 10 Oct 2026/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect((onSave.mock.calls[0][0] as any)).toMatchObject({ id: 'c_edit', addedBy: 'Rawat', remarks: 'from the director' });
    });
});
