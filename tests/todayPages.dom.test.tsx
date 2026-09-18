// @vitest-environment jsdom
/**
 * The two Today pages (components/pages), rendered on their own now that
 * they take their figures as props: the company view's cards open Reports
 * on the state they count, the team table shows only for whoever runs the
 * team, the cheque card's button is off when nothing is due; the personal
 * view's cards filter its own list, each row offers WhatsApp and a
 * follow-up (off when the role cannot record one), and the banner can be
 * dismissed.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

import CompanyToday, { CompanyTodayProps } from '../components/pages/CompanyToday';
import PersonalToday, { PersonalTodayProps } from '../components/pages/PersonalToday';
import { ageingTotals, worklistSummary, cashFlowForecast, attentionCounts } from '../services/metrics';
import { Outstanding, FollowUpStatus } from '../types';
import { mixedAccount } from './fixtures';

afterEach(cleanup);

const today = new Date(); today.setHours(0, 0, 0, 0);
const day = (offset: number) => { const d = new Date(today); d.setDate(d.getDate() + offset); return d; };
const account = (id: string, total: number, over: Partial<Outstanding> = {}): Outstanding => ({
    ...mixedAccount(), id, company: id, total, totalType: 'Dr',
    ageing: { '1-45': total, '46-90': 0, '91-135': 0, '>135': 0 },
    ageingTypes: { '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Dr' },
    over90: 0, over90Type: 'Dr', dueOver45: 0, dueOver45Type: 'Dr',
    paymentRank: undefined, settledAt: undefined, forecastAmount: undefined, forecastDate: undefined,
    status: FollowUpStatus.Pending, followUpDate: undefined, notes: [], isUrgent: false, assignedCollectorId: undefined,
    ...over,
});
const rows = [
    account('OVERDUE LTD', 10000, { followUpDate: day(-3), isUrgent: true }),
    account('TODAY LTD', 5000, { followUpDate: day(0) }),
    account('SOON LTD', 7000, { followUpDate: day(4), forecastAmount: 2000, forecastDate: day(0) }),
];

const cheques = { todayCount: 0, todayAmount: 0, overdueCount: 0, overdueAmount: 0, activeCount: 2, activeAmount: 9000 };

const companyProps = (over: Partial<CompanyTodayProps> = {}): CompanyTodayProps => ({
    fourBoxesSummary: worklistSummary(rows, today),
    portfolioAgeing: ageingTotals(rows),
    todayPdcMetrics: cheques,
    cashFlowForecastMetrics: cashFlowForecast(rows, today),
    crmPerformanceStats: [{ crmId: 'VISHNU', crmName: 'Vishnu', totalAssigned: 3, followUpDone: 0, todayFollowUp: 1, overdue: 1, unattended: 1, score: 66, drillable: true }],
    notificationSummary: attentionCounts(rows, today),
    runsTheTeam: true, scrollInside: false, showNotificationBanner: true,
    onViewPriority: vi.fn(), onDismissBanner: vi.fn(),
    categoryFilter: 'all', filtersActive: false, onClearFilters: vi.fn(),
    openReport: vi.fn(), onOpenTodayPdc: vi.fn(), onAddPdc: vi.fn(),
    ...over,
});

describe('CompanyToday', () => {
    it('shows the worklist and opens Reports on the state a card counts', () => {
        const p = companyProps();
        render(<CompanyToday {...p} />);
        expect(screen.getByText('Worklist')).toBeTruthy();
        fireEvent.click(screen.getAllByRole('button', { name: /^Overdue/ })[0]); // the card; the team table has its own Overdue column
        expect(p.openReport).toHaveBeenCalledWith({ category: 'overdue' });
        fireEvent.click(screen.getByRole('button', { name: /Past 45 days/ }));
        expect(p.openReport).toHaveBeenCalledWith({ ageing: 'dueOver45' });
        // the team table, for whoever runs the team
        expect(screen.getAllByText('Vishnu').length).toBeGreaterThan(0); // the table row (desktop and phone renderings)
    });
    it('keeps the team table from whoever only reads the book, and the cheque button off when nothing is due', () => {
        const p = companyProps({ runsTheTeam: false });
        render(<CompanyToday {...p} />);
        expect(screen.queryByText('Vishnu')).toBeNull();
        const nothing = screen.getByRole('button', { name: 'Nothing due today' }) as HTMLButtonElement;
        expect(nothing.disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Record a cheque' }));
        expect(p.onAddPdc).toHaveBeenCalled();
    });
    it('the attention banner names the urgent and the overdue, and can be dismissed', () => {
        const p = companyProps();
        render(<CompanyToday {...p} />);
        fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
        expect(p.onDismissBanner).toHaveBeenCalled();
        cleanup();
        render(<CompanyToday {...companyProps({ showNotificationBanner: false })} />);
        expect(screen.queryByRole('button', { name: /Dismiss/ })).toBeNull();
    });
});

const personalProps = (over: Partial<PersonalTodayProps> = {}): PersonalTodayProps => ({
    userBoxMetrics: worklistSummary(rows, today),
    myAgeing: ageingTotals(rows),
    todayPdcMetrics: cheques,
    cashFlowForecastMetrics: cashFlowForecast(rows, today),
    notificationSummary: attentionCounts(rows, today),
    filteredData: rows, searchTerm: '', fitsOneScreen: false, showNotificationBanner: false,
    onViewPriority: vi.fn(), onDismissBanner: vi.fn(),
    categoryFilter: 'all', filtersActive: false, onCategory: vi.fn(), onClearFilters: vi.fn(), onOpenFullList: vi.fn(),
    onFollowUp: vi.fn(), onWhatsApp: vi.fn(), onOpenTodayPdc: vi.fn(), onAddPdc: vi.fn(),
    canManagePdc: true, canEditFollowUp: true,
    ...over,
});

describe('PersonalToday', () => {
    it('lists my accounts under the cards, each with WhatsApp and a follow-up', () => {
        const p = personalProps();
        render(<PersonalToday {...p} />);
        expect(screen.getByText('My worklist')).toBeTruthy();
        expect(screen.getAllByText('3 accounts').length).toBeGreaterThan(0); // the list's subtitle, and My book's count
        const row = screen.getByText('OVERDUE LTD').closest('div.rounded-\\[14px\\]') as HTMLElement;
        expect(within(row).getByText('Urgent')).toBeTruthy();
        fireEvent.click(within(row).getByRole('button', { name: 'WhatsApp' }));
        expect(p.onWhatsApp).toHaveBeenCalledWith(rows[0]);
        fireEvent.click(within(row).getByRole('button', { name: 'Follow up' }));
        expect(p.onFollowUp).toHaveBeenCalledWith(rows[0]);
        fireEvent.click(screen.getByRole('button', { name: /Due today/ }));
        expect(p.onCategory).toHaveBeenCalledWith('today');
        fireEvent.click(screen.getByRole('button', { name: 'Open full list' }));
        expect(p.onOpenFullList).toHaveBeenCalled();
    });
    it('a role that cannot record follow-ups sees the button off, and no Record a cheque without the right', () => {
        render(<PersonalToday {...personalProps({ canEditFollowUp: false, canManagePdc: false })} />);
        const buttons = screen.getAllByRole('button', { name: 'Follow up' }) as HTMLButtonElement[];
        expect(buttons.every(b => b.disabled)).toBe(true);
        expect(screen.queryByRole('button', { name: 'Record a cheque' })).toBeNull();
    });
    it('says so when the filter leaves nothing, with the way back', () => {
        const p = personalProps({ filteredData: [], categoryFilter: 'bad_debt', filtersActive: true });
        render(<PersonalToday {...p} />);
        expect(screen.getByText('Bad debt — the recovery list')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Show all my accounts' }));
        expect(p.onClearFilters).toHaveBeenCalled();
    });
});
