import { Stat, Card, SectionHeader, AgeingBar, AgeingLegend, AGE_BANDS, Button } from '../ui/Primitives';
import { BadDebtStrip } from '../ui/BadDebtStrip';
import NotificationBanner from '../NotificationBanner';
import CrmPerformanceTable from '../CrmPerformanceTable';
import { formatCompact, formatINR } from '../ui/format';
import type { FollowUpCategoryFilter, AgeingReportFilter } from '../ReportsView';
import type { AgeingTotals, WorklistSummary, CashFlowForecast, ChequeSummary, CrmStat } from '../../services/metrics';

export interface CompanyTodayProps {
    /** The whole company's worklist, ageing, cheques and commitments. */
    fourBoxesSummary: WorklistSummary;
    portfolioAgeing: AgeingTotals;
    todayPdcMetrics: ChequeSummary;
    cashFlowForecastMetrics: CashFlowForecast;
    crmPerformanceStats: CrmStat[];
    notificationSummary: { urgentCount: number; overdueCount: number };
    /** The team table is a management view: Admin and Manager only. */
    runsTheTeam: boolean;
    /** Whoever reads the whole book without running the team gets the one-screen treatment. */
    scrollInside: boolean;
    showNotificationBanner: boolean;
    onViewPriority: () => void;
    onDismissBanner: () => void;
    /** Which card is lit, and whether any filter is on (so Clear filters shows). */
    categoryFilter: FollowUpCategoryFilter;
    filtersActive: boolean;
    onClearFilters: () => void;
    /** From a number here to the accounts behind it, in Reports. */
    openReport: (opts: { crm?: string; category?: FollowUpCategoryFilter; ageing?: AgeingReportFilter }) => void;
    onOpenTodayPdc: () => void;
    onAddPdc: () => void;
}

/**
 * Today for whoever reads the whole book: the company's worklist, the team
 * table (for those who run the team), portfolio ageing, cheques to present
 * and what customers have promised. Every number opens the accounts behind
 * it in Reports.
 */
export const CompanyToday = ({
    fourBoxesSummary, portfolioAgeing, todayPdcMetrics, cashFlowForecastMetrics, crmPerformanceStats, notificationSummary,
    runsTheTeam, scrollInside, showNotificationBanner, onViewPriority, onDismissBanner,
    categoryFilter, filtersActive, onClearFilters, openReport, onOpenTodayPdc, onAddPdc,
}: CompanyTodayProps) => (
    /* Whoever reads the whole book without running the team gets the same
       one-screen treatment as everybody else; the cards scroll inside the
       page rather than the page scrolling under them. */
    <div className={`flex flex-col gap-7 max-md:gap-4 ${scrollInside ? 'lg:h-full lg:min-h-0 lg:gap-5 lg:overflow-y-auto lg:pr-1.5' : ''}`}>
        {showNotificationBanner && (notificationSummary.urgentCount > 0 || notificationSummary.overdueCount > 0) && (
            <NotificationBanner
                urgentCount={notificationSummary.urgentCount}
                overdueCount={notificationSummary.overdueCount}
                onView={onViewPriority}
                onDismiss={onDismissBanner}
            />
        )}

        {/* ---------- worklist ---------- */}
        <section>
            <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3.5 max-md:mb-2">
                <div>
                    <h2 className="text-[19px] font-extrabold text-label tracking-[-0.025em]">Worklist</h2>
                    <p className="text-[13.5px] text-label-3 mt-1 max-md:hidden">The whole company's follow-ups. Press a card to see those accounts in Reports.</p>
                </div>
                {filtersActive && (
                    <Button size="sm" variant="ghost" onClick={onClearFilters}>Clear filters</Button>
                )}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 max-md:gap-2">
                <Stat
                    label="Overdue"
                    tone="dang"
                    active={categoryFilter === 'overdue'}
                    onClick={() => openReport({ category: 'overdue' })}
                    value={fourBoxesSummary.overdueCount}
                    sub={<><span className="num font-semibold text-label-2">{formatCompact(fourBoxesSummary.overdueAmount)}</span> past the promised date</>}
                />
                <Stat
                    label="Due today"
                    tone="brand"
                    active={categoryFilter === 'today'}
                    onClick={() => openReport({ category: 'today' })}
                    value={fourBoxesSummary.todayCount}
                    sub={<><span className="num font-semibold text-label-2">{formatCompact(fourBoxesSummary.todayAmount)}</span> to chase today</>}
                />
                <Stat
                    label="No follow-up"
                    tone="warn"
                    active={categoryFilter === 'no_follow_up'}
                    onClick={() => openReport({ category: 'no_follow_up' })}
                    value={fourBoxesSummary.noFollowUpCount}
                    sub={<><span className="num font-semibold text-label-2">{formatCompact(fourBoxesSummary.noFollowUpAmount)}</span> with nothing planned</>}
                />
                <Stat
                    label="Upcoming"
                    tone="pos"
                    active={categoryFilter === 'future'}
                    onClick={() => openReport({ category: 'future' })}
                    value={fourBoxesSummary.futureCount}
                    sub={<><span className="num font-semibold text-label-2">{formatCompact(fourBoxesSummary.futureAmount)}</span> promised for a later date</>}
                />
            </div>
            <BadDebtStrip
                className="mt-3.5"
                count={fourBoxesSummary.badDebtCount}
                amount={fourBoxesSummary.badDebtAmount}
                active={categoryFilter === 'bad_debt'}
                onClick={() => openReport({ category: 'bad_debt' })}
            />
        </section>

        {/* ---------- team: who is on top of their book, and who is not ---------- */}
        {runsTheTeam && (
            <CrmPerformanceTable
                stats={crmPerformanceStats}
                onSelectCrm={(crmId, category) => openReport({ crm: crmId.toUpperCase(), category: category ?? 'all' })}
            />
        )}

        {/* ---------- portfolio ageing ---------- */}
        <Card className="p-6 max-md:p-4">
            <SectionHeader
                title="Portfolio ageing"
                subtitle="How much of the book is still healthy, and how much has gone cold. Press a band to see its accounts in Reports."
                actions={<AgeingLegend />}
            />

            <div className="flex flex-wrap items-end gap-x-12 gap-y-5 mt-7 max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-5 max-md:[&>*:first-child]:col-span-2">
                <div>
                    <p className="label">Outstanding</p>
                    <p className="num text-[40px] font-semibold text-label leading-none mt-2.5 tracking-[-0.04em]">
                        {formatCompact(portfolioAgeing.total)}
                    </p>
                    <p className="text-[13px] text-label-3 mt-2.5">{formatINR(portfolioAgeing.total)}</p>
                </div>
                <button type="button" className="text-left rounded-[12px] -m-2 p-2 hover:bg-hover transition-colors" onClick={() => openReport({ ageing: 'dueOver45' })} title="Accounts with money more than 45 days overdue — open in Reports">
                    <p className="label">Past 45 days</p>
                    <p className="num text-[26px] font-semibold leading-none mt-2.5 tracking-[-0.03em]" style={{ color: 'var(--age-2-ink)' }}>
                        {formatCompact(portfolioAgeing.over45)}
                    </p>
                    <p className="text-[13px] text-label-3 mt-2.5">{portfolioAgeing.pct45}% of the book</p>
                </button>
                <button type="button" className="text-left rounded-[12px] -m-2 p-2 hover:bg-hover transition-colors" onClick={() => openReport({ ageing: 'over90' })} title="Accounts with money more than 90 days overdue — open in Reports">
                    <p className="label">Past 90 days</p>
                    <p className="num text-[26px] font-semibold leading-none mt-2.5 tracking-[-0.03em]" style={{ color: 'var(--age-3-ink)' }}>
                        {formatCompact(portfolioAgeing.over90)}
                    </p>
                    <p className="text-[13px] text-label-3 mt-2.5">{portfolioAgeing.pct90}% of the book</p>
                </button>
            </div>

            <AgeingBar parts={portfolioAgeing} height={12} className="mt-7" />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
                {AGE_BANDS.map(band => {
                    const amount = portfolioAgeing[band.key];
                    const pct = portfolioAgeing.total > 0 ? Math.round((amount / portfolioAgeing.total) * 100) : 0;
                    const reportBand = ({ a1: '1-45', a2: '46-90', a3: '91-135', a4: 'over135' } as const)[band.key];
                    return (
                        <button key={band.key} type="button" onClick={() => openReport({ ageing: reportBand })} title={`Accounts with money ${band.label} overdue — open in Reports`} className="bg-card-2 rounded-[14px] px-4 py-3.5 text-left hover:bg-hover transition-colors">
                            <span className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: band.varName }} aria-hidden="true" />
                                <span className="text-[13px] font-medium text-label-2">{band.label}</span>
                            </span>
                            <p className="num text-[19px] font-semibold text-label mt-2">{formatCompact(amount)}</p>
                            <p className="text-[12.5px] text-label-3 mt-1">{pct}% of book</p>
                        </button>
                    );
                })}
            </div>
        </Card>

        {/* ---------- cheques + commitments ---------- */}
        <div className="grid lg:grid-cols-2 gap-3.5">
            <Card className="p-6 max-md:p-4 flex flex-col">
                <SectionHeader
                    title="Cheques to present today"
                    subtitle="Post-dated cheques whose date has arrived."
                />
                <div className="flex items-end gap-10 mt-7 max-md:mt-4 max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-5 max-md:[&>*:first-child]:col-span-2">
                    <div>
                        <p className="label">Due today</p>
                        <p className="num text-[32px] font-semibold text-label leading-none mt-2.5 tracking-[-0.03em]">
                            {todayPdcMetrics.todayCount}
                        </p>
                    </div>
                    <div>
                        <p className="label">Value</p>
                        <p className="num text-[22px] font-semibold text-label leading-none mt-2.5 tracking-[-0.02em]">
                            {formatCompact(todayPdcMetrics.todayAmount)}
                        </p>
                    </div>
                    <div>
                        <p className="label">Held in hand</p>
                        <p className="num text-[22px] font-semibold leading-none mt-2.5 tracking-[-0.02em]" style={{ color: 'var(--age-1-ink)' }}>
                            {formatCompact(todayPdcMetrics.activeAmount)}
                        </p>
                        <p className="text-[12.5px] text-label-3 mt-2">{todayPdcMetrics.activeCount} cheques</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2.5 mt-auto pt-7 max-md:pt-4 max-md:[&>button]:flex-1 max-md:[&>button]:min-w-[140px] max-md:[&>button]:h-11">
                    <Button size="sm" variant="primary" onClick={onOpenTodayPdc} disabled={todayPdcMetrics.todayCount === 0}>
                        {todayPdcMetrics.todayCount > 0 ? 'Review cheques' : 'Nothing due today'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={onAddPdc}>Record a cheque</Button>
                </div>
            </Card>

            <Card className="p-6 max-md:p-4 flex flex-col">
                <SectionHeader
                    title="Committed collections"
                    subtitle="What customers have promised, and by when."
                />
                <div className="flex items-end gap-10 mt-7 max-md:mt-4 max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-5 max-md:[&>*:first-child]:col-span-2">
                    <div>
                        <p className="label">Today</p>
                        <p className="num text-[32px] font-semibold leading-none mt-2.5 tracking-[-0.03em]" style={{ color: 'var(--age-1-ink)' }}>
                            {formatCompact(cashFlowForecastMetrics.todayForecast)}
                        </p>
                        <p className="text-[12.5px] text-label-3 mt-2">{cashFlowForecastMetrics.todayCount} commitments</p>
                    </div>
                    <div>
                        <p className="label">Next 7 days</p>
                        <p className="num text-[22px] font-semibold text-label leading-none mt-2.5 tracking-[-0.02em]">
                            {formatCompact(cashFlowForecastMetrics.weekForecast)}
                        </p>
                        <p className="text-[12.5px] text-label-3 mt-2">{cashFlowForecastMetrics.weekCount} commitments</p>
                    </div>
                    <div>
                        <p className="label">All open</p>
                        <p className="num text-[22px] font-semibold text-label leading-none mt-2.5 tracking-[-0.02em]">
                            {formatCompact(cashFlowForecastMetrics.totalForecast)}
                        </p>
                        <p className="text-[12.5px] text-label-3 mt-2">{cashFlowForecastMetrics.totalCount} accounts</p>
                    </div>
                </div>
                {cashFlowForecastMetrics.totalCount === 0 && (
                    <p className="text-[13px] text-label-3 mt-auto pt-7 leading-relaxed">
                        No commitments recorded yet. They appear here once a CRM logs an expected
                        amount and date on a follow-up.
                    </p>
                )}
            </Card>
        </div>

    </div>

);

export default CompanyToday;
