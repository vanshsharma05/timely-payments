import { Stat, Card, SectionHeader, AgeingBar, AgeingLegend, Badge, Button, EmptyState } from '../ui/Primitives';
import { BadDebtStrip } from '../ui/BadDebtStrip';
import NotificationBanner from '../NotificationBanner';
import { formatCompact, formatDateShort, relativeDays, startOfToday } from '../ui/format';
import { Outstanding, getFollowUpCategory, isBadDebt } from '../../types';
import type { FollowUpCategoryFilter } from '../ReportsView';
import type { AgeingTotals, WorklistSummary, CashFlowForecast, ChequeSummary } from '../../services/metrics';

export interface PersonalTodayProps {
    /** This person's worklist, ageing, cheques and commitments. */
    userBoxMetrics: WorklistSummary;
    myAgeing: AgeingTotals;
    todayPdcMetrics: ChequeSummary;
    cashFlowForecastMetrics: CashFlowForecast;
    notificationSummary: { urgentCount: number; overdueCount: number };
    /** The accounts under the cards, already narrowed by the card pressed or the search. */
    filteredData: Outstanding[];
    searchTerm: string;
    /** Held to one screen where the window is tall enough. */
    fitsOneScreen: boolean;
    showNotificationBanner: boolean;
    onViewPriority: () => void;
    onDismissBanner: () => void;
    categoryFilter: FollowUpCategoryFilter;
    filtersActive: boolean;
    onCategory: (category: FollowUpCategoryFilter) => void;
    onClearFilters: () => void;
    onOpenFullList: () => void;
    onFollowUp: (customer: Outstanding) => void;
    onWhatsApp: (customer: Outstanding) => void;
    onOpenTodayPdc: () => void;
    onAddPdc: () => void;
    canManagePdc: boolean;
    canEditFollowUp: boolean;
}

/**
 * Today for whoever works a slice of the book: their worklist cards, their
 * book by age, their cheques and commitments, and the accounts themselves —
 * on a desktop all on one screen, the list scrolling inside its own panel.
 */
export const PersonalToday = ({
    userBoxMetrics, myAgeing, todayPdcMetrics, cashFlowForecastMetrics, notificationSummary, filteredData, searchTerm,
    fitsOneScreen, showNotificationBanner, onViewPriority, onDismissBanner,
    categoryFilter, filtersActive, onCategory, onClearFilters, onOpenFullList, onFollowUp, onWhatsApp,
    onOpenTodayPdc, onAddPdc, canManagePdc, canEditFollowUp,
}: PersonalTodayProps) => (
    /* One screen, no page scroll: the summary above stays put and the
       account list below takes whatever height is left. Only from lg —
       a phone scrolls, because none of this fits a phone. */
    <div className={`flex flex-col gap-7 ${fitsOneScreen ? 'lg:h-full lg:min-h-0 lg:gap-5' : ''}`}>
        {showNotificationBanner && (notificationSummary.urgentCount > 0 || notificationSummary.overdueCount > 0) && (
            <NotificationBanner
                urgentCount={notificationSummary.urgentCount}
                overdueCount={notificationSummary.overdueCount}
                onView={onViewPriority}
                onDismiss={onDismissBanner}
            />
        )}

        {/* ---------- my worklist ---------- */}
        <section>
            <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3.5 lg:mb-2.5">
                <div>
                    <h2 className="text-[19px] font-extrabold text-label tracking-[-0.025em]">My worklist</h2>
                    <p className="text-[13.5px] text-label-3 mt-1">Tap a card to filter the accounts below.</p>
                </div>
                {filtersActive && (
                    <Button size="sm" variant="ghost" onClick={onClearFilters}>Clear filters</Button>
                )}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <Stat
                    label="Due today"
                    tone="brand"
                    active={categoryFilter === 'today'}
                    onClick={() => onCategory('today')}
                    value={userBoxMetrics.todayCount}
                    sub={<><span className="num font-semibold text-label-2">{formatCompact(userBoxMetrics.todayAmount)}</span> to chase</>}
                />
                <Stat
                    label="Overdue"
                    tone="dang"
                    active={categoryFilter === 'overdue'}
                    onClick={() => onCategory('overdue')}
                    value={userBoxMetrics.overdueCount}
                    sub={<><span className="num font-semibold text-label-2">{formatCompact(userBoxMetrics.overdueAmount)}</span> past promised date</>}
                />
                <Stat
                    label="No follow-up"
                    tone="warn"
                    active={categoryFilter === 'no_follow_up'}
                    onClick={() => onCategory('no_follow_up')}
                    value={userBoxMetrics.noFollowUpCount}
                    sub={<><span className="num font-semibold text-label-2">{formatCompact(userBoxMetrics.noFollowUpAmount)}</span> unattended</>}
                />
                <Stat
                    label="Scheduled"
                    tone="pos"
                    active={categoryFilter === 'future'}
                    onClick={() => onCategory('future')}
                    value={userBoxMetrics.futureCount}
                    sub={<><span className="num font-semibold text-label-2">{formatCompact(userBoxMetrics.futureAmount)}</span> committed</>}
                />
            </div>
            <BadDebtStrip
                className="mt-3.5 lg:mt-2.5"
                count={userBoxMetrics.badDebtCount}
                amount={userBoxMetrics.badDebtAmount}
                active={categoryFilter === 'bad_debt'}
                onClick={() => onCategory('bad_debt')}
            />
        </section>

        {/* ---------- my book, and the accounts beside it ----------
            Stacked, this ran to about a screen and a half and the
            account list was the part pushed off the bottom — which is
            the part the day is actually worked from. On a desktop the
            summary takes the left column and the list takes the right,
            full height, so nothing needs scrolling to be seen. */}
        <div className={`flex flex-col gap-7 lg:grid lg:grid-cols-12 lg:gap-4 ${fitsOneScreen ? 'lg:flex-1 lg:min-h-0' : ''}`}>
        {/* Scrolls only if the screen is too short to hold both cards —
            on anything normal there is no scrollbar here at all, and
            nothing is ever cut off on a short one. */}
        <div className={`flex flex-col gap-3.5 lg:col-span-5 lg:gap-4 ${fitsOneScreen ? 'lg:min-h-0 lg:overflow-y-auto lg:pr-1' : ''}`}>
            <Card className="p-6 lg:p-5 flex flex-col">
                <SectionHeader
                    title="My book"
                    subtitle={<span className="lg:hidden">Everything assigned to you, by age.</span>}
                    actions={<AgeingLegend />}
                />
                <div className="flex flex-wrap items-end gap-x-10 gap-y-5 mt-7 lg:mt-4 max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-5 max-md:[&>*:first-child]:col-span-2">
                    <div>
                        <p className="label">Outstanding</p>
                        <p className="num text-[34px] lg:text-[27px] font-semibold text-label leading-none mt-2.5 lg:mt-1.5 tracking-[-0.04em]">
                            {formatCompact(myAgeing.total)}
                        </p>
                        <p className="text-[13px] text-label-3 mt-2.5 lg:mt-1">{userBoxMetrics.totalCount} accounts</p>
                    </div>
                    <div>
                        <p className="label">Past 45 days</p>
                        <p className="num text-[22px] font-semibold leading-none mt-2.5 lg:mt-1.5 tracking-[-0.03em]" style={{ color: 'var(--age-2-ink)' }}>
                            {formatCompact(myAgeing.over45)}
                        </p>
                        <p className="text-[13px] text-label-3 mt-2.5 lg:mt-1">{myAgeing.pct45}% of your book</p>
                    </div>
                    <div>
                        <p className="label">Past 90 days</p>
                        <p className="num text-[22px] font-semibold leading-none mt-2.5 lg:mt-1.5 tracking-[-0.03em]" style={{ color: 'var(--age-3-ink)' }}>
                            {formatCompact(myAgeing.over90)}
                        </p>
                        <p className="text-[13px] text-label-3 mt-2.5 lg:mt-1">{myAgeing.pct90}% of your book</p>
                    </div>
                </div>
                <div className="mt-auto pt-7 lg:pt-4">
                    <AgeingBar parts={myAgeing} height={12} />
                </div>
            </Card>

            <Card className="p-6 lg:p-5 flex flex-col">
                <SectionHeader
                    title="Cheques and commitments"
                    subtitle={<span className="lg:hidden">Cheques to present, and what customers promised you.</span>}
                />
                <div className="flex items-end gap-10 mt-7 lg:mt-4 flex-wrap max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-5 max-md:[&>*:first-child]:col-span-2">
                    <div>
                        <p className="label">Cheques today</p>
                        <p className="num text-[32px] lg:text-[27px] font-semibold text-label leading-none mt-2.5 lg:mt-1.5 tracking-[-0.03em]">
                            {todayPdcMetrics.todayCount}
                        </p>
                        <p className="text-[12.5px] text-label-3 mt-2 lg:mt-1">{formatCompact(todayPdcMetrics.todayAmount)}</p>
                    </div>
                    <div>
                        <p className="label">Held in hand</p>
                        <p className="num text-[22px] font-semibold leading-none mt-2.5 lg:mt-1.5 tracking-[-0.02em]" style={{ color: 'var(--age-1-ink)' }}>
                            {formatCompact(todayPdcMetrics.activeAmount)}
                        </p>
                        <p className="text-[12.5px] text-label-3 mt-2 lg:mt-1">{todayPdcMetrics.activeCount} cheques</p>
                    </div>
                    <div>
                        <p className="label">Promised today</p>
                        <p className="num text-[22px] font-semibold text-label leading-none mt-2.5 lg:mt-1.5 tracking-[-0.02em]">
                            {formatCompact(cashFlowForecastMetrics.todayForecast)}
                        </p>
                        <p className="text-[12.5px] text-label-3 mt-2 lg:mt-1">{cashFlowForecastMetrics.todayCount} commitments</p>
                    </div>
                </div>
                <div className="flex gap-2.5 mt-auto pt-7 lg:pt-4 max-md:[&>button]:flex-1 max-md:[&>button]:h-11">
                    <Button size="sm" variant="primary" onClick={onOpenTodayPdc} disabled={todayPdcMetrics.todayCount === 0}>
                        {todayPdcMetrics.todayCount > 0 ? 'Review cheques' : 'Nothing due today'}
                    </Button>
                    {canManagePdc && (
                        <Button size="sm" variant="secondary" onClick={onAddPdc}>Record a cheque</Button>
                    )}
                </div>
            </Card>
        </div>

        {/* ---------- the accounts themselves ---------- */}
        <Card className={`p-6 lg:col-span-7 ${fitsOneScreen ? 'lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden' : ''}`}>
            <SectionHeader
                title={
                    categoryFilter === 'today' ? 'Due today'
                        : categoryFilter === 'overdue' ? 'Past their promised date'
                        : categoryFilter === 'no_follow_up' ? 'No follow-up planned'
                        : categoryFilter === 'future' ? 'Scheduled'
                        : categoryFilter === 'bad_debt' ? 'Bad debt — the recovery list'
                        : 'My accounts'
                }
                subtitle={`${filteredData.length} account${filteredData.length === 1 ? '' : 's'}${searchTerm ? ' matching your search' : ''}`}
                actions={
                    <Button size="sm" variant="quiet" onClick={onOpenFullList}>
                        Open full list
                    </Button>
                }
            />

            {filteredData.length === 0 ? (
                <EmptyState
                    title="Nothing here"
                    hint="No account matches the current filter."
                    action={<Button size="sm" variant="secondary" onClick={onClearFilters}>Show all my accounts</Button>}
                />
            ) : (
                <div className={`mt-6 flex flex-col gap-2.5 ${fitsOneScreen ? 'lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1.5' : ''}`}>
                    {filteredData.slice(0, 40).map(customer => {
                        const cat = getFollowUpCategory(customer, startOfToday());
                        const due = relativeDays(customer.followUpDate);
                        return (
                            <div
                                key={customer.id}
                                className="rounded-[14px] bg-card-2 px-4 py-3.5 flex flex-col md:flex-row md:items-center gap-3 md:gap-5"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <button
                                            onClick={() => onFollowUp(customer)}
                                            className="text-[15px] font-bold text-label hover:text-accent text-left truncate max-w-[380px]"
                                        >
                                            {customer.company}
                                        </button>
                                        {isBadDebt(customer) && <Badge tone="dang">Bad debt</Badge>}
                                        {customer.isUrgent && <Badge tone="dang">Urgent</Badge>}
                                        {cat === 'overdue' && <Badge tone="dang">{due?.text || 'Overdue'}</Badge>}
                                        {cat === 'today' && <Badge tone="brand">Due today</Badge>}
                                        {cat === 'future' && <Badge tone="pos">{due?.text || 'Scheduled'}</Badge>}
                                        {cat === 'no_follow_up' && <Badge tone="warn">No follow-up</Badge>}
                                    </div>
                                    <p className="text-[13px] text-label-3 mt-1.5 truncate">
                                        {customer.contactPerson || 'No contact'}
                                        {customer.contactNumber ? ` · ${customer.contactNumber}` : ''}
                                        {customer.notes?.length ? ` · ${customer.notes[customer.notes.length - 1]}` : ''}
                                    </p>
                                </div>

                                <div className="flex items-center gap-4 md:gap-5 flex-none max-md:justify-between">
                                    <div className="text-right max-md:text-left">
                                        <p className="num text-[16px] font-semibold text-label">
                                            {formatCompact(customer.total)}
                                        </p>
                                        <p className="text-[12px] text-label-3 mt-0.5">
                                            {customer.followUpDate ? formatDateShort(customer.followUpDate) : 'not scheduled'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button size="sm" variant="quiet" onClick={() => onWhatsApp(customer)}>
                                            WhatsApp
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="primary"
                                            onClick={() => onFollowUp(customer)}
                                            disabled={!canEditFollowUp}
                                            title={canEditFollowUp ? 'Log a follow-up' : 'Your role cannot record follow-ups'}
                                        >
                                            Follow up
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {filteredData.length > 40 && (
                        <button
                            onClick={onOpenFullList}
                            className="text-[13.5px] font-semibold text-accent hover:underline self-start mt-1"
                        >
                            {filteredData.length - 40} more in the full list
                        </button>
                    )}
                </div>
            )}
        </Card>
        </div>
    </div>

);

export default PersonalToday;
