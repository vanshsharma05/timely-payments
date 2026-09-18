// @vitest-environment jsdom
/**
 * The cheque register and its dialog: one list of every cheque, six tiles
 * that say where the register stands and each list exactly what they count,
 * one vocabulary for the states, a status on every row with only the actions
 * that fit it (a cleared cheque carries no Clear button), a delete that names
 * what goes, and a dialog that guesses nothing.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));

import PdcChequesView, { normaliseStateFilter, TILE_ORDER, actionsFor, datedNote } from '../components/PdcChequesView';
import PdcModal from '../components/PdcModal';
import { CHEQUE_STATES, sortCheques, stateOf } from '../components/ui/ChequeState';
import { chequeWhen, formatDate } from '../components/ui/format';
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
    cheque('c_cleared_old', { status: PdcStatus.Cleared, chequeDate: day(-30), amount: 1000, clearedDate: day(-28) }),
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
const listed = () => rows().map(r => r.textContent!.match(/#C_(?:CLEARED_OLD|CLEARED_NEW|UPCOMING|DUE|OVERDUE|HOLD|BOUNCED|\d+)/)![0]);
const rowOf = (num: string) => rows().find(r => r.textContent!.includes(`#${num}`))!;
const tile = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });
/** "Due today 1 ₹4,000" — the tile's label, count and amount, as read. */
const tileText = (label: string) => [...tile(label).querySelectorAll('span')].filter(x => x.children.length === 0 && x.textContent!.trim()).map(x => x.textContent!.trim()).join(' ');
const heading = () => (screen.getByText(/^\d+( of \d+)? cheques?/) as HTMLElement).textContent!;
const total = () => (screen.getByText(/^Total ₹/) as HTMLElement).textContent!;
/** The status buttons on a row, without Edit and Delete. */
const actionsOn = (num: string) => within(rowOf(num).querySelector('td:last-child') as HTMLElement).queryAllByRole('button').filter(b => !/^(Edit|Delete) cheque/.test(b.getAttribute('aria-label') || '')).map(b => b.textContent!.trim());

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

    it('the tiles run in the order a cheque moves, and the old filter names find them', () => {
        expect(TILE_ORDER).toEqual(['due', 'overdue', 'upcoming', 'hold', 'bounced', 'cleared']);
        expect(normaliseStateFilter('today')).toBe('due');
        expect(normaliseStateFilter('Pending')).toBe('upcoming');
        expect(normaliseStateFilter('Cleared')).toBe('cleared');
        expect(normaliseStateFilter('all')).toBe('all');
        expect(normaliseStateFilter(null)).toBe('all');
    });

    it('each state offers only what can be done to it', () => {
        const labels = (s: Parameters<typeof actionsFor>[0]) => actionsFor(s).map(a => a.label);
        expect(labels('due')).toEqual(['Clear', 'Hold', 'Bounce']);
        expect(labels('overdue')).toEqual(['Clear', 'Hold', 'Bounce']);
        expect(labels('upcoming')).toEqual(['Clear', 'Hold', 'Bounce']);
        expect(labels('hold')).toEqual(['Clear', 'Release', 'Bounce']);
        expect(labels('bounced')).toEqual(['Clear', 'Back in hand']);
        expect(labels('cleared')).toEqual(['Undo']);
        expect(actionsFor('cleared')[0].status).toBe(PdcStatus.Pending);
        expect(actionsFor('hold')[1].status).toBe(PdcStatus.Pending);
    });

    it('the note under the date says how far off it is, and nothing when the badge already says it', () => {
        expect(datedNote('upcoming', day(5))).toBe('in 5 days');
        expect(datedNote('upcoming', day(1))).toBe('tomorrow');
        expect(datedNote('overdue', day(-3))).toBe('3 days ago');
        expect(datedNote('hold', day(-1))).toBe('yesterday');
        expect(datedNote('due', day(0))).toBe('');
        expect(datedNote('cleared', day(-3))).toBe('');
        expect(datedNote('bounced', day(-3))).toBe('');
    });
});

describe('one register, six tiles that list exactly what they count', () => {
    it('opens on every cheque, in the register order, with the tiles counting each state', () => {
        open();
        expect(listed()).toEqual(['#C_OVERDUE', '#C_DUE', '#C_UPCOMING', '#C_BOUNCED', '#C_HOLD', '#C_CLEARED_NEW', '#C_CLEARED_OLD']);
        expect(tileText('Due today')).toBe('Due today 1 ₹4,000');
        expect(tileText('Date passed')).toBe('Date passed 1 ₹5,000');
        expect(tileText('Upcoming')).toBe('Upcoming 1 ₹3,000');
        expect(tileText('On hold')).toBe('On hold 1 ₹6,000');
        expect(tileText('Bounced')).toBe('Bounced 1 ₹7,000');
        expect(tileText('Cleared')).toBe('Cleared 2 ₹3,000');
        expect(heading()).toBe('7 cheques');
        expect(total()).toBe('Total ₹28,000');
        expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    });

    it('pressing a tile lists that state and nothing else; pressing it again, or Show all, lists everything', () => {
        open();
        fireEvent.click(tile('Date passed'));
        expect(tile('Date passed').getAttribute('aria-pressed')).toBe('true');
        expect(listed()).toEqual(['#C_OVERDUE']);
        expect(heading()).toBe('1 of 7 cheques · date passed');
        expect(total()).toBe('Total ₹5,000');
        fireEvent.click(tile('Cleared'));
        expect(listed()).toEqual(['#C_CLEARED_NEW', '#C_CLEARED_OLD']);
        expect(tile('Date passed').getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(tile('Cleared'));
        expect(listed().length).toBe(7);
        fireEvent.click(tile('On hold'));
        fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
        expect(listed().length).toBe(7);
    });

    it('the tiles count what the search and the selects leave, so a count is always the rows it opens', () => {
        open();
        fireEvent.change(screen.getByLabelText('Find a cheque'), { target: { value: 'beta' } });
        expect(tileText('Bounced')).toBe('Bounced 1 ₹7,000');
        expect(tileText('Due today')).toBe('Due today 0 —');
        expect(heading()).toBe('1 cheque');
        fireEvent.change(screen.getByLabelText('Find a cheque'), { target: { value: 'monday' } });
        expect(listed()).toEqual(['#C_OVERDUE']);
        fireEvent.change(screen.getByLabelText('Find a cheque'), { target: { value: '7000' } });
        expect(rows()[0].textContent).toContain('BETA TRADERS');
        fireEvent.change(screen.getByLabelText('Find a cheque'), { target: { value: '' } });
        fireEvent.change(screen.getByLabelText('Bank'), { target: { value: 'HDFC Bank' } });
        expect(heading()).toBe('7 cheques');
        fireEvent.change(screen.getByLabelText('Cheque date'), { target: { value: 'today' } });
        expect(listed()).toEqual(['#C_DUE']);
        expect(tileText('Due today')).toBe('Due today 1 ₹4,000');
        expect(tileText('Upcoming')).toBe('Upcoming 0 —');
    });

    it('arriving from Today with "today" opens on Due today; arriving for one customer shows their chip, and × widens the list again', () => {
        open({ initialStatusFilter: 'today' });
        expect(tile('Due today').getAttribute('aria-pressed')).toBe('true');
        expect(listed()).toEqual(['#C_DUE']);
        cleanup();
        open({ initialCustomerFilter: 'cust_b' });
        expect(listed()).toEqual(['#C_BOUNCED']);
        expect(screen.getByText('BETA TRADERS', { selector: 'span' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: "Show every customer's cheques" }));
        expect(listed().length).toBe(7);
    });
});

describe('each row shows its status and offers what fits it', () => {
    it('a status badge on every row, the date with how far off it is, and the cleared date where it is known', () => {
        open();
        expect(within(rowOf('C_OVERDUE')).getByText('Date passed')).toBeTruthy();
        expect(within(rowOf('C_OVERDUE')).getByText('3 days ago')).toBeTruthy();
        expect(within(rowOf('C_DUE')).getByText('Due today')).toBeTruthy();
        expect(within(rowOf('C_DUE')).queryByText('today')).toBeNull();
        expect(within(rowOf('C_UPCOMING')).getByText('Upcoming')).toBeTruthy();
        expect(within(rowOf('C_UPCOMING')).getByText('in 5 days')).toBeTruthy();
        expect(within(rowOf('C_UPCOMING')).getByText(formatDate(day(5)))).toBeTruthy();
        expect(within(rowOf('C_HOLD')).getByText('On hold')).toBeTruthy();
        expect(within(rowOf('C_BOUNCED')).getByText('Bounced')).toBeTruthy();
        expect(within(rowOf('C_CLEARED_OLD')).getByText('Cleared')).toBeTruthy();
        expect(within(rowOf('C_CLEARED_OLD')).getByText(`cleared ${formatDate(day(-28))}`)).toBeTruthy();
        expect(within(rowOf('C_CLEARED_NEW')).queryByText(/ago|cleared /)).toBeNull();
        expect(within(rowOf('C_OVERDUE')).getByText(/O\/S/)).toBeTruthy();
    });

    it('in hand: Clear, Hold, Bounce; on hold: Release; bounced: Back in hand; cleared: only a quiet Undo — and Edit and Delete on every row', () => {
        const { onUpdatePdcStatus, onEditPdc } = open();
        expect(actionsOn('C_DUE')).toEqual(['Clear', 'Hold', 'Bounce']);
        expect(actionsOn('C_OVERDUE')).toEqual(['Clear', 'Hold', 'Bounce']);
        expect(actionsOn('C_UPCOMING')).toEqual(['Clear', 'Hold', 'Bounce']);
        expect(actionsOn('C_HOLD')).toEqual(['Clear', 'Release', 'Bounce']);
        expect(actionsOn('C_BOUNCED')).toEqual(['Clear', 'Back in hand']);
        expect(actionsOn('C_CLEARED_NEW')).toEqual(['Undo']);
        for (const num of ['C_DUE', 'C_CLEARED_NEW']) {
            expect(within(rowOf(num)).getByRole('button', { name: `Edit cheque ${num}` })).toBeTruthy();
            expect(within(rowOf(num)).getByRole('button', { name: `Delete cheque ${num}` })).toBeTruthy();
        }
        fireEvent.click(within(rowOf('C_DUE')).getByRole('button', { name: 'Clear' }));
        expect(onUpdatePdcStatus).toHaveBeenLastCalledWith('c_due', PdcStatus.Cleared);
        fireEvent.click(within(rowOf('C_HOLD')).getByRole('button', { name: 'Release' }));
        expect(onUpdatePdcStatus).toHaveBeenLastCalledWith('c_hold', PdcStatus.Pending);
        fireEvent.click(within(rowOf('C_BOUNCED')).getByRole('button', { name: 'Back in hand' }));
        expect(onUpdatePdcStatus).toHaveBeenLastCalledWith('c_bounced', PdcStatus.Pending);
        fireEvent.click(within(rowOf('C_UPCOMING')).getByRole('button', { name: 'Bounce' }));
        expect(onUpdatePdcStatus).toHaveBeenLastCalledWith('c_upcoming', PdcStatus.Bounced);
        fireEvent.click(within(rowOf('C_CLEARED_NEW')).getByRole('button', { name: 'Undo' }));
        expect(onUpdatePdcStatus).toHaveBeenLastCalledWith('c_cleared_new', PdcStatus.Pending);
        fireEvent.click(within(rowOf('C_UPCOMING')).getByRole('button', { name: 'Edit cheque C_UPCOMING' }));
        expect(onEditPdc).toHaveBeenCalledWith(expect.objectContaining({ id: 'c_upcoming' }));
    });

    it('the customer\'s name opens their account', () => {
        const { onOpenCustomerFollowUp } = open();
        fireEvent.click(within(rowOf('C_BOUNCED')).getByRole('button', { name: 'BETA TRADERS' }));
        expect(onOpenCustomerFollowUp).toHaveBeenCalledTimes(1);
        expect(onOpenCustomerFollowUp.mock.calls[0][0].id).toBe('cust_b');
    });

    it('a viewer without the right sees the status but no actions, no boxes', () => {
        open({ currentUser: { ...adminUser(), id: 'VIEWER', name: 'Viewer', role: UserRole.Viewer, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.Viewer] }, onBulkPdcStatus: undefined, onBulkDeletePdc: undefined });
        expect(screen.queryByRole('button', { name: /Record a cheque/ })).toBeNull();
        expect(screen.queryAllByRole('checkbox')).toEqual([]);
        expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Delete cheque/ })).toBeNull();
        expect(screen.queryByText('Actions')).toBeNull();
        expect(within(rowOf('C_DUE')).getByText('Due today')).toBeTruthy();
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
        fireEvent.click(within(rowOf('C_OVERDUE')).getByRole('button', { name: 'Delete cheque C_OVERDUE' }));
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
        fireEvent.click(within(rowOf('C_OVERDUE')).getByRole('button', { name: 'Delete cheque C_OVERDUE' }));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('alertdialog')).toBeNull();
        fireEvent.click(within(rowOf('C_OVERDUE')).getByRole('button', { name: 'Delete cheque C_OVERDUE' }));
        fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete cheque' }));
        expect(onDeletePdc).toHaveBeenCalledWith('c_overdue');
    });

    it('a selection: one status for all of them in one go, or a delete that names the total', () => {
        const { onBulkPdcStatus, onBulkDeletePdc } = open();
        fireEvent.click(within(rowOf('C_DUE')).getByRole('checkbox'));
        fireEvent.click(within(rowOf('C_OVERDUE')).getByRole('checkbox'));
        expect(screen.getByText('2 selected')).toBeTruthy();
        expect(screen.queryByText(/^Total ₹/)).toBeNull();   // the bar takes the total's place
        const bar = within(screen.getByText('2 selected').parentElement as HTMLElement);
        expect(bar.getAllByRole('button').map(b => b.textContent!.trim())).toEqual(['Mark cleared', 'Put on hold', 'Mark bounced', 'Back in hand', 'Delete…', 'Clear selection']);
        fireEvent.click(bar.getByRole('button', { name: 'Mark cleared' }));
        expect(onBulkPdcStatus).toHaveBeenCalledWith(['c_due', 'c_overdue'], PdcStatus.Cleared);
        fireEvent.click(within(rowOf('C_DUE')).getByRole('checkbox'));
        fireEvent.click(within(rowOf('C_OVERDUE')).getByRole('checkbox'));
        fireEvent.click(within(screen.getByText('2 selected').parentElement as HTMLElement).getByRole('button', { name: 'Delete…' }));
        const dialog = screen.getByRole('alertdialog');
        expect(dialog.textContent).toMatch(/Delete 2 cheques\?/);
        expect(dialog.textContent).toMatch(/9,000 across 2 cheques/);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 cheques' }));
        expect(onBulkDeletePdc).toHaveBeenCalledWith(['c_due', 'c_overdue']);
    });

    it('a selection is trimmed to the rows still listed', () => {
        const { onBulkPdcStatus } = open();
        fireEvent.click(within(rowOf('C_DUE')).getByRole('checkbox'));
        fireEvent.click(within(rowOf('C_CLEARED_NEW')).getByRole('checkbox'));
        fireEvent.click(tile('Cleared'));
        expect(screen.getByText('1 selected')).toBeTruthy();
        fireEvent.click(within(screen.getByText('1 selected').parentElement as HTMLElement).getByRole('button', { name: 'Back in hand' }));
        expect(onBulkPdcStatus).toHaveBeenCalledWith(['c_cleared_new'], PdcStatus.Pending);
    });
});

describe('loading, empty, and pages', () => {
    it('says it is loading until the first read, and that nothing is recorded when the register is truly empty', () => {
        const { rerender } = render(<PdcChequesView pdcCheques={[]} customers={[customerA()]} users={users()} currentUser={adminUser()} onAddPdc={vi.fn()} onEditPdc={vi.fn()} onDeletePdc={vi.fn()} onUpdatePdcStatus={vi.fn()} loading />);
        expect(screen.getByRole('status').textContent).toMatch(/Loading the register/);
        rerender(<PdcChequesView pdcCheques={[]} customers={[customerA()]} users={users()} currentUser={adminUser()} onAddPdc={vi.fn()} onEditPdc={vi.fn()} onDeletePdc={vi.fn()} onUpdatePdcStatus={vi.fn()} loading={false} />);
        expect(screen.getByText('No cheques recorded yet')).toBeTruthy();
    });

    it('a search that matches nothing says so; a tile with nothing in it says what is not there; both offer the whole register', () => {
        open();
        fireEvent.change(screen.getByLabelText('Find a cheque'), { target: { value: 'zzz' } });
        expect(screen.getByText('No cheques match')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Show all cheques' }));
        expect(rows().length).toBe(7);
        cleanup();
        open({ pdcCheques: register().filter(c => c.id !== 'c_hold') });
        fireEvent.click(tile('On hold'));
        expect(screen.getByText('Nothing is on hold')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Show all cheques' }));
        expect(rows().length).toBe(6);
        expect(tile('On hold').getAttribute('aria-pressed')).toBe('false');
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
