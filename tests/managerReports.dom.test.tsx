// @vitest-environment jsdom
/**
 * The manager's path from a number to the accounts behind it: the team table
 * opens Reports on a person and a list; Reports speaks the book's words, its
 * tiles are its filters, it follows the filters it is handed, shares the one
 * search, and pages its rows.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));

import ReportsView from '../components/ReportsView';
import CrmPerformanceTable from '../components/CrmPerformanceTable';
import { Outstanding, FollowUpStatus } from '../types';
import { mixedAccount, adminUser, crmUser, collectorUser } from './fixtures';

if (!window.matchMedia) {
    (window as any).matchMedia = (media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}
afterEach(cleanup);

const dayShift = (days: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d; };

/** One account per follow-up state, each on Vishnu's book unless said otherwise. */
const account = (id: string, over: Partial<Outstanding>): Outstanding => ({
    ...mixedAccount(), id, company: id.toUpperCase().replace(/_/g, ' '), notes: [], forecastAmount: undefined, forecastDate: undefined, ...over,
});
const book = (): Outstanding[] => [
    account('overdue_one', { followUpDate: dayShift(-3), status: FollowUpStatus.Pending }),
    account('overdue_two', { followUpDate: dayShift(-1), status: FollowUpStatus.Pending, isUrgent: true }),
    account('due_today', { followUpDate: dayShift(0), status: FollowUpStatus.Pending }),
    account('upcoming', { followUpDate: dayShift(4), status: FollowUpStatus.Pending, forecastAmount: 5000 }),
    account('no_date', { followUpDate: undefined, status: FollowUpStatus.Pending }),
    account('collected', { followUpDate: dayShift(-10), status: FollowUpStatus.Completed }),
    account('defaulter', { followUpDate: undefined, status: FollowUpStatus.Pending, paymentRank: 'Bad' }),
    account('garrys_overdue', { followUpDate: dayShift(-2), status: FollowUpStatus.Pending, crmOwnerId: 'GARRY' }),
];
const users = () => [adminUser(), crmUser(), collectorUser(), { ...crmUser(), id: 'GARRY', name: 'Garry' }];

const openReports = (over: Partial<React.ComponentProps<typeof ReportsView>> = {}) => {
    const onFollowUp = vi.fn(); const onGlobalSearch = vi.fn();
    const utils = render(<ReportsView data={book()} users={users()} currentUser={adminUser()} onFollowUp={onFollowUp} onWhatsApp={vi.fn()} onGlobalSearch={onGlobalSearch} {...over} />);
    return { ...utils, onFollowUp, onGlobalSearch };
};
const rows = () => screen.getAllByRole('row').slice(1);              // minus the header
const listCount = () => screen.getByText(/^\d[\d,]* accounts?$/).textContent!.replace(/ accounts?$/, '');
const chip = (name: RegExp) => screen.getAllByRole('button', { name }).find(b => b.closest('[aria-label="Follow-up state"]'))!;
const pressed = (b: HTMLElement) => b.getAttribute('aria-pressed') === 'true';

describe('Reports speaks the book\'s words', () => {
    it('names the follow-up states as the book does, and the row button is "Follow up"', () => {
        openReports();
        const group = screen.getByRole('group', { name: 'Follow-up state' });
        expect(within(group).getAllByRole('button').map(b => b.textContent!.replace(/\s*\(\d+\)\s*$/, '').trim()))
            .toEqual(['All', 'Overdue', 'Due today', 'Upcoming', 'No follow-up', 'Unattended', 'Completed', 'Bad debt']);
        expect(screen.queryByText(/^Future$/)).toBeNull();
        expect(screen.queryByText(/^No Date$/)).toBeNull();
        expect(screen.queryByRole('button', { name: /^Update$/ })).toBeNull();
        expect(screen.getAllByRole('button', { name: /^Follow up$/ }).length).toBe(8);
    });

    it('says when each follow-up is due the way the book does', () => {
        openReports();
        const text = document.body.textContent!;
        expect(text).toMatch(/3d overdue · /);
        expect(text).toMatch(/Today/);
        expect(text).toMatch(/in 4d · /);
        expect(text).toMatch(/No date/);
        expect(text).toMatch(/5,000 expected/);
    });

    it('counts every state once, and Unattended is overdue plus no follow-up, never a defaulter', () => {
        openReports();
        expect(chip(/^Overdue/).textContent).toMatch(/\(3\)/);
        expect(chip(/^Due today/).textContent).toMatch(/\(1\)/);
        expect(chip(/^Upcoming/).textContent).toMatch(/\(1\)/);
        expect(chip(/^No follow-up/).textContent).toMatch(/\(1\)/);
        expect(chip(/^Unattended/).textContent).toMatch(/\(4\)/);
        expect(chip(/^Completed/).textContent).toMatch(/\(1\)/);
        expect(chip(/^Bad debt/).textContent).toMatch(/\(1\)/);
        fireEvent.click(chip(/^Unattended/));
        expect(listCount()).toBe('4');
        expect(rows().map(r => r.textContent)).not.toContain(expect.stringMatching(/DEFAULTER/));
    });
});

describe('the tiles are the filters', () => {
    it('pressing the Overdue tile lists the overdue accounts and presses the Overdue chip; again clears it', () => {
        openReports();
        const tile = screen.getAllByRole('button', { name: /^Overdue/ }).find(b => !b.closest('[role="group"]'))!;
        fireEvent.click(tile);
        expect(pressed(tile)).toBe(true);
        expect(pressed(chip(/^Overdue/))).toBe(true);
        expect(listCount()).toBe('3');
        fireEvent.click(tile);
        expect(pressed(chip(/^All/))).toBe(true);
        expect(listCount()).toBe('8');
    });

    it('an ageing band lists the accounts with money in that band, and the ageing chip agrees', () => {
        openReports();
        fireEvent.click(screen.getByTitle(/^91–135 days overdue — /));
        expect(pressed(screen.getByRole('button', { name: /^91–135d/ }))).toBe(true);
        expect(listCount()).toBe('8');                                   // every fixture carries a 91–135 figure
        fireEvent.click(screen.getByRole('button', { name: /^>135d/ }));
        expect(listCount()).toBe('0');                                   // the fixture's >135 bucket is in credit
        fireEvent.click(screen.getByRole('button', { name: /^All ageing/ }));
        expect(pressed(screen.getByRole('button', { name: /^All ageing/ }))).toBe(true);
    });

    it('Reset clears the state, the ageing and the search together', () => {
        const { onGlobalSearch } = openReports({ initialCategoryFilter: 'overdue', initialAgeingFilter: '1-45' });
        expect(pressed(chip(/^Overdue/))).toBe(true);
        expect(pressed(screen.getByRole('button', { name: /^1–45d/ }))).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(pressed(chip(/^All/))).toBe(true);
        expect(pressed(screen.getByRole('button', { name: /^All ageing/ }))).toBe(true);
        expect(onGlobalSearch).toHaveBeenCalledWith('');
    });
});

describe('Reports follows the filters it is handed', () => {
    it('opens on the person, the state and the band it was given, and re-filters when they change', () => {
        const { rerender } = openReports({ initialCrmFilter: 'GARRY', initialCategoryFilter: 'overdue' });
        expect((screen.getByLabelText('Filter by CRM owner') as HTMLSelectElement).value).toBe('GARRY');
        expect(listCount()).toBe('1');
        expect(rows()[0].textContent).toMatch(/GARRYS OVERDUE/);
        rerender(<ReportsView data={book()} users={users()} currentUser={adminUser()} onFollowUp={vi.fn()} onWhatsApp={vi.fn()} initialCrmFilter="VISHNU" initialCategoryFilter="unattended" />);
        expect((screen.getByLabelText('Filter by CRM owner') as HTMLSelectElement).value).toBe('VISHNU');
        expect(pressed(chip(/^Unattended/))).toBe(true);
        expect(listCount()).toBe('3');
    });

    it('a CRM opens on their own book and stays there', () => {
        openReports({ currentUser: crmUser(), initialCrmFilter: 'VISHNU' });
        expect((screen.getByLabelText('Filter by CRM owner') as HTMLSelectElement).value).toBe('VISHNU');
        expect(listCount()).toBe('7');
        expect(screen.queryByRole('button', { name: 'Excel' })).toBeNull();   // no download for a CRM
    });

    it('shows the "Needs attention" chip only while that list — the banner\'s — is open', () => {
        openReports({ initialCategoryFilter: 'urgent' });
        expect(chip(/^Needs attention/).textContent).toMatch(/\(3\)/);   // two overdue + one flagged urgent, counted once
        expect(listCount()).toBe('3');
        fireEvent.click(chip(/^All/));
        expect(screen.queryByRole('button', { name: /^Needs attention/ })).toBeNull();
    });
});

describe('one search, and pages of fifty', () => {
    it('the app bar\'s term narrows Reports, and typing in Reports edits the same term', () => {
        const { onGlobalSearch } = openReports({ globalSearch: 'garry' });
        expect(listCount()).toBe('1');
        expect((screen.getByPlaceholderText(/Search by name/) as HTMLInputElement).value).toBe('garry');
        fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: 'upcoming' } });
        expect(onGlobalSearch).toHaveBeenCalledWith('upcoming');
    });

    it('renders fifty rows, then more on request', () => {
        const many = Array.from({ length: 120 }, (_, i) => account(`acct_${i}`, { followUpDate: dayShift(-1), status: FollowUpStatus.Pending }));
        render(<ReportsView data={many} users={users()} currentUser={adminUser()} onFollowUp={vi.fn()} onWhatsApp={vi.fn()} />);
        expect(rows().length).toBe(50);
        fireEvent.click(screen.getByRole('button', { name: /Show more — 70 left/ }));
        expect(rows().length).toBe(120);
        expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
    });

    it('the account name and the row button both open the account', () => {
        const { onFollowUp } = openReports({ initialCategoryFilter: 'today' });
        fireEvent.click(screen.getByRole('button', { name: 'DUE TODAY' }));
        expect(onFollowUp).toHaveBeenCalledTimes(1);
        expect(onFollowUp.mock.calls[0][0].id).toBe('due_today');
        fireEvent.click(screen.getByRole('button', { name: /^Follow up$/ }));
        expect(onFollowUp).toHaveBeenCalledTimes(2);
    });
});

describe('the team table opens Reports on a person and a list', () => {
    const stats = () => [
        { crmId: 'VISHNU', crmName: 'Vishnu', totalAssigned: 20, followUpDone: 2, todayFollowUp: 3, overdue: 4, unattended: 6, score: 70, drillable: true },
        { crmId: 'MUNSHI_RAM', crmName: 'Munshi Ram', totalAssigned: 5, followUpDone: 0, todayFollowUp: 1, overdue: 1, unattended: 1, score: 80, drillable: false },
        { crmId: 'GARRY', crmName: 'Garry', totalAssigned: 30, followUpDone: 0, todayFollowUp: 0, overdue: 12, unattended: 14, score: 18, drillable: true },
        { crmId: 'UNASSIGNED', crmName: 'No CRM Assigned', totalAssigned: 0, followUpDone: 0, todayFollowUp: 0, overdue: 0, unattended: 0, score: 0, drillable: true },
    ];

    it('a name opens the person; each count opens the person on that list', () => {
        const onSelectCrm = vi.fn();
        render(<CrmPerformanceTable stats={stats()} onSelectCrm={onSelectCrm} />);
        const vishnu = screen.getAllByRole('row').find(r => /Vishnu/.test(r.textContent!))!;
        fireEvent.click(within(vishnu).getByRole('button', { name: 'Vishnu' }));
        expect(onSelectCrm).toHaveBeenLastCalledWith('VISHNU', undefined);
        fireEvent.click(within(vishnu).getByRole('button', { name: '6' }));
        expect(onSelectCrm).toHaveBeenLastCalledWith('VISHNU', 'unattended');
        fireEvent.click(within(vishnu).getByRole('button', { name: '4' }));
        expect(onSelectCrm).toHaveBeenLastCalledWith('VISHNU', 'overdue');
        fireEvent.click(within(vishnu).getByRole('button', { name: '3' }));
        expect(onSelectCrm).toHaveBeenLastCalledWith('VISHNU', 'today');
        fireEvent.click(within(vishnu).getByRole('button', { name: '2' }));
        expect(onSelectCrm).toHaveBeenLastCalledWith('VISHNU', 'completed');
        fireEvent.click(within(vishnu).getByRole('button', { name: '20' }));
        expect(onSelectCrm).toHaveBeenLastCalledWith('VISHNU', 'all');
    });

    it('a collector\'s row stays plain numbers: Reports has no filter for accounts handed to them', () => {
        render(<CrmPerformanceTable stats={stats()} onSelectCrm={vi.fn()} />);
        const munshi = screen.getAllByRole('row').find(r => /Munshi Ram/.test(r.textContent!))!;
        expect(within(munshi).queryAllByRole('button')).toEqual([]);
        expect(munshi.textContent).toMatch(/Munshi Ram/);
    });

    it('lists the most unattended person first, and the words match Reports', () => {
        render(<CrmPerformanceTable stats={stats()} onSelectCrm={vi.fn()} />);
        const names = screen.getAllByRole('row').slice(1).map(r => r.textContent!.trim().slice(0, 12));
        expect(names[0]).toMatch(/^Garry/);
        expect(names[1]).toMatch(/^Vishnu/);
        expect(screen.getAllByRole('columnheader').map(h => h.textContent!.trim()))
            .toEqual(['CRM / Collector', 'Accounts with dues', 'Completed', 'Due today', 'Overdue', 'Unattended', 'Timely score']);
    });

    it('without a handler nothing is a button', () => {
        render(<CrmPerformanceTable stats={stats()} />);
        expect(screen.queryAllByRole('button')).toEqual([]);
    });
});
