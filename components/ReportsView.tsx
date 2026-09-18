import { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { loadXlsx } from '../services/excel';
import { Outstanding, User, UserRole, FollowUpStatus, PdcCheque, CompanyProfile, getFollowUpCategory, followUpStatusOf, can, seesWholeBook, scopeTo, chequeState, CHEQUE_ACTIVE, DEFAULT_COMPANY_PROFILE, canExportBook, PaymentRank, PAYMENT_RANK_LABELS, SettlementFilter, SETTLEMENT_LABELS, matchesSettlement, hasOutstanding, matchesSearch, overdueAgeing, isBadDebt } from '../types';
import StatusBadge from './StatusBadge';
const AiReportModal = lazy(() => import('./AiReportModal'));
import { WhatsAppIcon, FireIcon, DownloadIcon, ChequeIcon, SparklesIcon } from './icons/Icons';
import { AgeingBar, AgeingLegend, AGE_BANDS, Stat, Button } from './ui/Primitives';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { formatINR, formatCompact, formatDate as formatDay, localIsoDate, followUpWhen } from './ui/format';
import { useIsPhone } from './ui/usePhone';
import { PhoneAccountRow } from './ui/PhoneAccountRow';

/** `unattended` = overdue or no follow-up planned — the team table's "Unattended" column, drilled into. */
/** `working` = every account with dues except the recovery list — what the team table's "Accounts with dues" counts. */
export type FollowUpCategoryFilter = 'all' | 'today' | 'no_follow_up' | 'overdue' | 'future' | 'completed' | 'over90' | 'over135' | 'urgent' | 'unattended' | 'working' | 'bad_debt';
export type AgeingReportFilter = 'all' | '1-45' | '46-90' | '91-135' | 'over90' | 'over135' | 'dueOver45';

interface ReportsViewProps {
    data: Outstanding[];
    users: User[];
    currentUser: User;
    companyProfile?: CompanyProfile;
    onFollowUp: (customer: Outstanding) => void;
    onWhatsApp: (customer: Outstanding) => void;
    /** Applied to a whole selection at once, the same two the customer book offers. */
    onBulkSetRank?: (customerIds: string[], rank: PaymentRank | '') => void;
    onBulkReassignCrm?: (customerIds: string[], newCrm: string) => void;
    /**
     * Puts one follow-up date on the selection. Admin only: it is how the
     * overdue list is brought back to today when the owners have not done it,
     * and every account it touches gets a line in its activity saying so.
     */
    onBulkSetFollowUp?: (customerIds: string[], isoDate: string) => void;
    initialCrmFilter?: string;
    initialCategoryFilter?: FollowUpCategoryFilter;
    initialAgeingFilter?: AgeingReportFilter;
    pdcCheques?: PdcCheque[];
    onOpenPdcForCustomer?: (customerId: string) => void;
    /** The one customer search, shared with the app bar and the book. */
    globalSearch?: string;
    onGlobalSearch?: (value: string) => void;
}

export const ReportsView = ({
    data,
    users,
    currentUser,
    companyProfile = DEFAULT_COMPANY_PROFILE,
    onFollowUp,
    onWhatsApp,
    onBulkSetRank,
    onBulkReassignCrm,
    onBulkSetFollowUp,
    initialCrmFilter = 'ALL',
    initialCategoryFilter = 'all',
    initialAgeingFilter = 'all',
    pdcCheques = [],
    onOpenPdcForCustomer,
    globalSearch = '',
    onGlobalSearch,
}: ReportsViewProps) => {
    const [selectedCrm, setSelectedCrm] = useState<string>(initialCrmFilter);
    // A drill-down from the team table carries the person with it, the same
    // way a dashboard card carries the category.
    useEffect(() => { setSelectedCrm(initialCrmFilter); }, [initialCrmFilter]);
    const [categoryFilter, setCategoryFilter] = useState<FollowUpCategoryFilter>(initialCategoryFilter);

    // Arriving from a dashboard card carries the category with it. Following the
    // prop rather than only seeding from it means a second card press re-filters
    // even if this view never unmounted in between.
    useEffect(() => {
        setCategoryFilter(initialCategoryFilter);
    }, [initialCategoryFilter]);
    // One search, not two: the box here and the app bar's edit the same term.
    const searchTerm = globalSearch;
    const setSearchTerm = (value: string) => onGlobalSearch?.(value);
    const [ageingFilter, setAgeingFilter] = useState<AgeingReportFilter>(initialAgeingFilter);
    useEffect(() => { setAgeingFilter(initialAgeingFilter); }, [initialAgeingFilter]);
    const [isAiReportOpen, setIsAiReportOpen] = useState<boolean>(false);

    const today = useMemo(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }, []);

    // Strict access control / role-based scoping
    const canViewAll = seesWholeBook(currentUser);

    // Downloading the book and spending money on an AI report are both rights
    // a Viewer or Collector is not given.
    const canExport = can(currentUser, 'canExportData');
    // The spreadsheet leaves the app; the AI report is read on screen. Only
    // the download takes a management role — see canExportBook().
    const canDownloadExcel = canExportBook(currentUser);

    const userAllowedData = useMemo(() => scopeTo(currentUser, data), [data, currentUser]);

    // Get list of distinct CRM owners allowed for this user
    const crmOwners = useMemo(() => {
        const set = new Set<string>();
        if (canViewAll) {
            users.filter(u => u.role === UserRole.CRM).forEach(u => set.add(u.id.toUpperCase()));
            userAllowedData.forEach(d => {
                if (d.crmOwnerId && d.crmOwnerId.trim()) {
                    set.add(d.crmOwnerId.trim().toUpperCase());
                }
            });
        } else {
            const allowedCrms = new Set((currentUser.assignedCrms || []).map(c => c.trim().toUpperCase()));
            if (currentUser.role === UserRole.CRM) {
                allowedCrms.add((currentUser.id || '').trim().toUpperCase());
                allowedCrms.add((currentUser.name || '').trim().toUpperCase());
            }
            allowedCrms.forEach(c => set.add(c));
        }
        return Array.from(set).filter(Boolean).sort();
    }, [userAllowedData, users, canViewAll, currentUser]);

    // Format helpers
    const formatCurrency = (amount?: number) => {
        if (amount === undefined || isNaN(amount)) return '₹0';
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.abs(amount));
    };

    const formatDate = (date?: Date) => {
        if (!date) return 'Not Scheduled';
        return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    const getUserDisplayName = (crmId?: string) => {
        if (!crmId || crmId === 'Unassigned') return 'No CRM Assigned';
        const user = users.find(u => u.id.toUpperCase() === crmId.toUpperCase() || u.name.toUpperCase() === crmId.toUpperCase());
        return user ? user.name : crmId;
    };

    // Classify each record into categories. The four follow-up categories are
    // routine work, and a declared defaulter is in none of them: it is on the
    // recovery list (isBadDebt), which has its own chip and its own count.
    const isTodayFollowUp = (item: Outstanding) => !isBadDebt(item) && getFollowUpCategory(item, today) === 'today';
    const isNoFollowUp = (item: Outstanding) => !isBadDebt(item) && getFollowUpCategory(item, today) === 'no_follow_up';
    const isOverdueFollowUp = (item: Outstanding) => !isBadDebt(item) && getFollowUpCategory(item, today) === 'overdue';
    const isFutureFollowUp = (item: Outstanding) => !isBadDebt(item) && getFollowUpCategory(item, today) === 'future';

    // Filter by CRM first to calculate CRM-scoped box metrics
    const crmScopedData = useMemo(() => {
        if (selectedCrm === 'ALL') return userAllowedData;
        if (selectedCrm === 'UNASSIGNED') {
            return userAllowedData.filter(d => !d.crmOwnerId || d.crmOwnerId.trim() === '' || d.crmOwnerId.toUpperCase() === 'UNASSIGNED');
        }
        return userAllowedData.filter(d => (d.crmOwnerId || '').toUpperCase() === selectedCrm.toUpperCase());
    }, [userAllowedData, selectedCrm]);

    // Comprehensive Metrics Calculation (Scoped to chosen CRM)
    const [settlementFilter, setSettlementFilter] = useState<SettlementFilter>('withDues');

    /**
     * The report is of accounts that owe something, unless asked otherwise.
     *
     * Both the boxes and the table read this, so they cannot disagree. Counting
     * the settled ones is what made "No follow-up set" say 3,835 — three
     * thousand of which had nothing to follow up because they had already paid.
     */
    const settlementCounts = useMemo(() => {
        let withDues = 0;
        crmScopedData.forEach(item => { if (hasOutstanding(item)) withDues++; });
        return { withDues, settled: crmScopedData.length - withDues, all: crmScopedData.length };
    }, [crmScopedData]);

    const workScopedData = useMemo(
        () => crmScopedData.filter(item => matchesSettlement(item, settlementFilter)),
        [crmScopedData, settlementFilter],
    );

    const boxMetrics = useMemo(() => {
        let todayCount = 0;
        let todayAmount = 0;
        let noFollowUpCount = 0;
        let noFollowUpAmount = 0;
        let overdueCount = 0;
        let overdueAmount = 0;
        let futureCount = 0;
        let futureAmount = 0;
        let totalAmount = 0;
        let totalCount = workScopedData.length;
        let dueOver45Total = 0;
        let completedCount = 0;

        // Specific >90d and >135d late payment metrics
        let over90Count = 0;
        let over90Amount = 0;
        let over135Count = 0;
        let over135Amount = 0;
        let ageing91_135Count = 0;
        let ageing91_135Amount = 0;
        let ageing46_90Count = 0;
        let ageing46_90Amount = 0;
        let ageing1_45Count = 0;
        let ageing1_45Amount = 0;
        let badDebtCount = 0;
        let badDebtAmount = 0;
        // What the "needs attention" banner counts: flagged urgent, or overdue.
        let urgentCount = 0;

        workScopedData.forEach(item => {
            totalAmount += item.total || 0;
            // Receivable ageing only: a credit that happens to be old is not
            // overdue, and an account in credit has nothing overdue at all.
            const { a1, a2, a3, a4, over45: itemDue45, over90: itemOver90 } = overdueAgeing(item);
            dueOver45Total += itemDue45;

            if (a1 > 0) { ageing1_45Count++; ageing1_45Amount += a1; }
            if (a2 > 0) { ageing46_90Count++; ageing46_90Amount += a2; }
            if (a3 > 0) { ageing91_135Count++; ageing91_135Amount += a3; }
            if (a4 > 0) { over135Count++; over135Amount += a4; }
            if (itemOver90 > 0) { over90Count++; over90Amount += itemOver90; }

            // The recovery list: counted, and out of every follow-up list below —
            // Completed included, which is how the team table counts them, so a
            // count pressed there opens exactly the accounts it counted.
            if (isBadDebt(item)) {
                badDebtCount++;
                badDebtAmount += item.total || 0;
                return;
            }

            if (item.status === FollowUpStatus.Completed) {
                completedCount++;
                return;
            }

            if (item.isUrgent || isOverdueFollowUp(item)) urgentCount++;

            if (isTodayFollowUp(item)) {
                todayCount++;
                todayAmount += item.total || 0;
            } else if (isOverdueFollowUp(item)) {
                overdueCount++;
                overdueAmount += item.total || 0;
            } else if (isFutureFollowUp(item)) {
                futureCount++;
                futureAmount += item.total || 0;
            } else if (isNoFollowUp(item)) {
                noFollowUpCount++;
                noFollowUpAmount += item.total || 0;
            } else {
                noFollowUpCount++;
                noFollowUpAmount += item.total || 0;
            }
        });

        // Scores are of the routine work: a defaulter neither helps nor hurts.
        const workCount = totalCount - badDebtCount;
        const timelyCount = todayCount + futureCount + completedCount;
        const performanceScore = workCount > 0 ? Math.round((timelyCount / workCount) * 100) : 0;
        const followUpCoverageRate = workCount > 0 ? Math.round(((workCount - noFollowUpCount) / workCount) * 100) : 0;

        return {
            todayCount,
            todayAmount,
            noFollowUpCount,
            noFollowUpAmount,
            overdueCount,
            overdueAmount,
            futureCount,
            futureAmount,
            totalAmount,
            totalCount,
            dueOver45Total,
            completedCount,
            performanceScore,
            followUpCoverageRate,
            over90Count,
            over90Amount,
            over135Count,
            over135Amount,
            ageing91_135Count,
            ageing91_135Amount,
            ageing46_90Count,
            ageing46_90Amount,
            ageing1_45Count,
            ageing1_45Amount,
            badDebtCount,
            badDebtAmount,
            urgentCount,
        };
    }, [workScopedData, today]);

    // Filtered Report Table Data (Applying CRM + Category + Search + Ageing)
    const filteredReportData = useMemo(() => {
        return workScopedData.filter(item => {
            const { a1, a2, a3, a4, over45: itemDue45, over90: itemOver90 } = overdueAgeing(item);

            // Category Filter
            if (categoryFilter === 'today' && !isTodayFollowUp(item)) return false;
            if (categoryFilter === 'no_follow_up' && !isNoFollowUp(item)) return false;
            if (categoryFilter === 'overdue' && !isOverdueFollowUp(item)) return false;
            if (categoryFilter === 'future' && !isFutureFollowUp(item)) return false;
            if (categoryFilter === 'completed' && (isBadDebt(item) || item.status !== FollowUpStatus.Completed)) return false;
            if (categoryFilter === 'bad_debt' && !isBadDebt(item)) return false;
            // Exactly what the "needs attention" banner counts: flagged urgent,
            // or the follow-up date has gone by. The banner used to set a filter
            // that only the personal dashboard rendered, so pressing it on the
            // company dashboard dismissed the banner and did nothing else.
            if (categoryFilter === 'urgent' && (isBadDebt(item) || !(item.isUrgent || isOverdueFollowUp(item)))) return false;
            if (categoryFilter === 'unattended' && !(isOverdueFollowUp(item) || isNoFollowUp(item))) return false;
            if (categoryFilter === 'working' && isBadDebt(item)) return false;
            if (categoryFilter === 'over90' && itemOver90 <= 0) return false;
            if (categoryFilter === 'over135' && a4 <= 0) return false;

            // Ageing Filter
            if (ageingFilter === 'over90' && itemOver90 <= 0) return false;
            if (ageingFilter === 'over135' && a4 <= 0) return false;
            if (ageingFilter === '91-135' && a3 <= 0) return false;
            if (ageingFilter === '46-90' && a2 <= 0) return false;
            if (ageingFilter === '1-45' && a1 <= 0) return false;
            if (ageingFilter === 'dueOver45' && itemDue45 <= 0) return false;

            // Search Term Filter
            if (searchTerm.trim()) {
                const crmDisplayName = getUserDisplayName(item.crmOwnerId).toLowerCase();
                const company = String(item.company || '').toLowerCase();
                const contactPerson = String(item.contactPerson || '').toLowerCase();
                const contactPhone = String(item.contactNumber || '').toLowerCase();
                const email = String(item.email || '').toLowerCase();
                const crmOwnerId = String(item.crmOwnerId || '').toLowerCase();
                const id = String(item.id || '').toLowerCase();
                const total = String(item.total || '');
                const notes = (item.notes || []).join(' ').toLowerCase();

                if (!matchesSearch(
                    [company, contactPerson, contactPhone, email, crmOwnerId, crmDisplayName, id, total, notes],
                    searchTerm,
                )) return false;
            }

            return true;
        });
    }, [workScopedData, categoryFilter, ageingFilter, searchTerm, today, users]);

    // Export current report view to Excel with full ageing breakdown
    /**
     * A phone gets a row list instead of the table, and only the first
     * stretch of it: every row carries an ageing bar, and mounting six
     * hundred of them at once is what made this screen a hundred and sixty
     * thousand pixels tall on a phone.
     */
    const isPhone = useIsPhone();
    const PHONE_PAGE = 50;
    const [phoneVisible, setPhoneVisible] = useState(PHONE_PAGE);
    useEffect(() => { setPhoneVisible(PHONE_PAGE); }, [selectedCrm, categoryFilter, ageingFilter, searchTerm, settlementFilter]);
    /** Six hundred rows at once made the page fifty screens long; fifty at a time, and more on request. */
    const PAGE = 50;
    const [visibleCount, setVisibleCount] = useState(PAGE);
    useEffect(() => { setVisibleCount(PAGE); }, [selectedCrm, categoryFilter, ageingFilter, searchTerm, settlementFilter]);

    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [bulkRank, setBulkRank] = useState<PaymentRank | ''>('');
    const [bulkCrm, setBulkCrm] = useState('');
    // Starts on today, because "bring the overdue ones back to today" is the
    // job this is for; the date is there for anyone who wants a different day.
    const todayIso = localIsoDate();
    const [bulkFollowUp, setBulkFollowUp] = useState(todayIso);
    /** The bulk follow-up date is asked about in the app, with the count and the date named. */
    const [confirmBulkDate, setConfirmBulkDate] = useState(false);

    /** A selection only ever means rows currently on screen; filtering away a
        selected account must not leave it quietly queued for a bulk action. */
    const visibleIds = useMemo(() => new Set(filteredReportData.map(c => c.id)), [filteredReportData]);
    const selected = useMemo(() => selectedIds.filter(id => visibleIds.has(id)), [selectedIds, visibleIds]);
    const allSelected = selected.length > 0 && selected.length === filteredReportData.length;
    const toggleRow = (id: string) =>
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    const toggleAll = (checked: boolean) =>
        setSelectedIds(checked ? filteredReportData.map(c => c.id) : []);

    const canEditCustomer = can(currentUser, 'canEditCustomer');
    const canReassignCrm = can(currentUser, 'canReassignCrm');
    const crmUsers = useMemo(() => users.filter(u => u.role === UserRole.CRM), [users]);
    /** No tickboxes at all unless there is something a tick could lead to. */
    const selectable = (canEditCustomer && !!onBulkSetRank)
        || (canReassignCrm && !!onBulkReassignCrm)
        || !!onBulkSetFollowUp
        || canDownloadExcel;

    /** True when a stored contact number is worth offering as a dial link. */
    const dialable = (raw?: string) => (raw || '').replace(/D/g, '').length >= 7;

    const exportToExcel = async () => {
        const XLSX = await loadXlsx();

        // With rows ticked, the download is those rows — otherwise the whole
        // filtered report, exactly as before.
        const source = selected.length ? filteredReportData.filter(r => selected.includes(r.id)) : filteredReportData;
        const rows = source.map(item => {
            const { a1, a2, a3, a4, over45: due45Total, over90: over90Total } = overdueAgeing(item);
            let categoryName = 'No Follow-up Scheduled';
            if (item.status === FollowUpStatus.Completed) categoryName = 'Completed';
            else if (isTodayFollowUp(item)) categoryName = 'Today Follow-up';
            else if (isOverdueFollowUp(item)) categoryName = 'Overdue Follow-up';
            else if (isFutureFollowUp(item)) categoryName = 'Future Follow-up';

            return {
                'Customer / Company': item.company,
                'Contact Person': item.contactPerson,
                'Phone Number': item.contactNumber,
                'Email': item.email || '',
                'CRM Owner': getUserDisplayName(item.crmOwnerId),
                'Total Outstanding (₹)': item.total,
                'Total Balance Type': item.totalType || 'Dr',
                '1-45 Days (₹)': a1,
                '46-90 Days (₹)': a2,
                '91-135 Days (₹)': a3,
                '>135 Days (₹)': a4,
                'Total >90 Days Overdue (₹)': over90Total,
                'Due >45 Days (₹)': due45Total,
                'Category / Status': categoryName,
                'Follow-up Date': item.followUpDate ? formatDate(item.followUpDate) : 'Not Set',
                'Last Follow-up Notes': item.notes && item.notes.length > 0 ? item.notes[item.notes.length - 1] : ''
            };
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ageing_Report');
        const fileName = `LatePayment_AgeingReport_${selectedCrm}_${categoryFilter}_${ageingFilter}.xlsx`;
        XLSX.writeFile(wb, fileName);
    };

    return (
        <div className="space-y-5">
            {/* Who and which half of the book — the same controls, in the same
                order and words, as the customer book. */}
            <div className="bg-card rounded-[16px] shadow-e1 px-5 py-4 flex flex-col xl:flex-row xl:items-end justify-between gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_auto_minmax(220px,1fr)] gap-2 items-end flex-1">
                    <div>
                        <label htmlFor="crmSelect" className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">CRM owner</label>
                        <select
                            aria-label="Filter by CRM owner"
                            id="crmSelect"
                            value={selectedCrm}
                            onChange={(e) => setSelectedCrm(e.target.value)}
                            className="w-full h-9 px-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[13px] font-semibold text-gray-900 dark:text-white"
                        >
                            <option value="ALL">All CRMs ({data.length.toLocaleString('en-IN')})</option>
                            {crmOwners.map(crm => (
                                <option key={crm} value={crm}>
                                    {getUserDisplayName(crm)} ({data.filter(d => (d.crmOwnerId || '').toUpperCase() === crm).length})
                                </option>
                            ))}
                            <option value="UNASSIGNED">Unassigned ({data.filter(d => !d.crmOwnerId || d.crmOwnerId.toUpperCase() === 'UNASSIGNED').length})</option>
                        </select>
                    </div>
                    <div>
                        <span className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">Accounts</span>
                        <div className="inline-flex rounded-xl bg-card-2 p-1 gap-1" role="group" aria-label="Report on accounts with dues, settled accounts, or all">
                            {(['withDues', 'settled', 'all'] as SettlementFilter[]).map(key => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setSettlementFilter(key)}
                                    aria-pressed={settlementFilter === key}
                                    className={`h-7 px-3 rounded-lg text-[12.5px] font-bold whitespace-nowrap transition-colors ${
                                        settlementFilter === key
                                            ? 'bg-accent text-on-accent shadow-e1'
                                            : 'text-label-2 hover:bg-hover hover:text-label'
                                    }`}
                                >
                                    {SETTLEMENT_LABELS[key]}
                                    <span className="ml-1.5 font-semibold opacity-80 num">
                                        {settlementCounts[key].toLocaleString('en-IN')}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">Search</label>
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search by name, contact, mobile, note…"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full h-9 pl-8 pr-8 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[13px] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/40"
                            />
                            <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            {searchTerm && (
                                <button type="button" onClick={() => setSearchTerm('')} className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600 text-sm font-bold" aria-label="Clear search">✕</button>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-none">
                    {canExport && (
                        <Button size="sm" variant="secondary" onClick={() => setIsAiReportOpen(true)} title="An AI-written credit summary of the accounts in this report">
                            <SparklesIcon className="w-4 h-4" />
                            AI summary
                        </Button>
                    )}
                    {canDownloadExcel && (
                        <Button size="sm" variant="quiet" onClick={exportToExcel} title="Download this report as Excel, with the four ageing buckets">
                            <DownloadIcon />
                            Excel
                        </Button>
                    )}
                </div>
            </div>

            {/* What needs attention, and how old the money is. Every tile is the
                filter it describes: press it and the list below is that list. The
                four red cards and the six tiles this replaces said the same
                numbers twice, in a colour language nothing else in the app uses. */}
            <div className="space-y-3">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Stat label="Overdue" tone="dang" active={categoryFilter === 'overdue'} onClick={() => setCategoryFilter(categoryFilter === 'overdue' ? 'all' : 'overdue')}
                        value={boxMetrics.overdueCount} sub={<><span className="num font-semibold text-label-2">{formatCompact(boxMetrics.overdueAmount)}</span> past the promised date</>} />
                    <Stat label="Due today" tone="brand" active={categoryFilter === 'today'} onClick={() => setCategoryFilter(categoryFilter === 'today' ? 'all' : 'today')}
                        value={boxMetrics.todayCount} sub={<><span className="num font-semibold text-label-2">{formatCompact(boxMetrics.todayAmount)}</span> to chase today</>} />
                    <Stat label="No follow-up" tone="warn" active={categoryFilter === 'no_follow_up'} onClick={() => setCategoryFilter(categoryFilter === 'no_follow_up' ? 'all' : 'no_follow_up')}
                        value={boxMetrics.noFollowUpCount} sub={<><span className="num font-semibold text-label-2">{formatCompact(boxMetrics.noFollowUpAmount)}</span> with nothing planned</>} />
                    <Stat label="Bad debt" tone="dang" active={categoryFilter === 'bad_debt'} onClick={() => setCategoryFilter(categoryFilter === 'bad_debt' ? 'all' : 'bad_debt')}
                        value={boxMetrics.badDebtCount} sub={<><span className="num font-semibold text-label-2">{formatCompact(boxMetrics.badDebtAmount)}</span> on the recovery list</>} />
                </div>
                {/* How old the money is: the bar for shape, the four bands as the
                    filters. One short card rather than five tiles, so the list is
                    still on screen at 1024 px. */}
                <div className="bg-card rounded-[16px] shadow-e1 px-5 pt-3.5 pb-3">
                    <AgeingBar parts={{ a1: boxMetrics.ageing1_45Amount, a2: boxMetrics.ageing46_90Amount, a3: boxMetrics.ageing91_135Amount, a4: boxMetrics.over135Amount }} height={8} />
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-3 gap-y-2 mt-2.5 items-start">
                        <div className="px-2 py-1.5 min-w-0">
                            <span className="block text-[11.5px] font-bold uppercase tracking-wider text-label-3">Outstanding</span>
                            <span className="num block text-[17px] font-semibold text-label leading-tight mt-0.5" title={formatINR(boxMetrics.totalAmount)}>{formatCompact(boxMetrics.totalAmount)}</span>
                            <span className="block text-[12px] text-label-3 mt-0.5 truncate" title="Share of accounts with dues that are completed, due today or upcoming">
                                {boxMetrics.totalCount.toLocaleString('en-IN')} accounts · timely score <span className="num font-semibold text-label-2">{boxMetrics.performanceScore}%</span>
                            </span>
                        </div>
                        {([
                            ['1-45', AGE_BANDS[0], boxMetrics.ageing1_45Amount, boxMetrics.ageing1_45Count],
                            ['46-90', AGE_BANDS[1], boxMetrics.ageing46_90Amount, boxMetrics.ageing46_90Count],
                            ['91-135', AGE_BANDS[2], boxMetrics.ageing91_135Amount, boxMetrics.ageing91_135Count],
                            ['over135', AGE_BANDS[3], boxMetrics.over135Amount, boxMetrics.over135Count],
                        ] as const).map(([key, band, amount, count]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setAgeingFilter(ageingFilter === key ? 'all' : key)}
                                aria-pressed={ageingFilter === key}
                                title={`${band.label} overdue — ${formatINR(amount)} across ${count} accounts. Press to list them.`}
                                className={`text-left rounded-[12px] px-2 py-1.5 min-w-0 transition-colors ${ageingFilter === key ? 'bg-accent-tint ring-2 ring-accent' : 'hover:bg-hover'}`}
                            >
                                <span className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-label-3">
                                    <span className="w-2 h-2 rounded-full flex-none" style={{ background: band.varName }} aria-hidden="true" />
                                    {band.label}
                                </span>
                                <span className="num block text-[17px] font-semibold text-label leading-tight mt-0.5">{formatCompact(amount)}</span>
                                <span className="block text-[12px] text-label-3 mt-0.5 truncate">
                                    {boxMetrics.totalAmount > 0 ? Math.round((amount / boxMetrics.totalAmount) * 100) : 0}% of the book · {count} accounts
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* CUSTOMER REPORT LIST TABLE */}
            <div className="bg-card rounded-[16px] shadow-e1 overflow-hidden">
                {/* The list's own filters — follow-up state and ageing — in the
                    same words the customer book uses. */}
                <div className="px-3.5 py-2.5 bg-card-2 border-b border-separator flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-800 dark:text-gray-200">
                            {filteredReportData.length.toLocaleString('en-IN')} account{filteredReportData.length === 1 ? '' : 's'}
                        </span>
                        <AgeingLegend className="gap-3" />
                        {(categoryFilter !== 'all' || ageingFilter !== 'all' || searchTerm) && (
                            <button type="button" onClick={() => { setCategoryFilter('all'); setAgeingFilter('all'); setSearchTerm(''); }} className="text-[12.5px] text-dang font-bold hover:underline px-1">
                                Reset
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Follow-up state">
                        {([
                            ['all', 'All', boxMetrics.totalCount],
                            ['overdue', 'Overdue', boxMetrics.overdueCount],
                            ['today', 'Due today', boxMetrics.todayCount],
                            ['future', 'Upcoming', boxMetrics.futureCount],
                            ['no_follow_up', 'No follow-up', boxMetrics.noFollowUpCount],
                            ['unattended', 'Unattended', boxMetrics.overdueCount + boxMetrics.noFollowUpCount],
                            ['completed', 'Completed', boxMetrics.completedCount],
                            ['bad_debt', 'Bad debt', boxMetrics.badDebtCount],
                            ['urgent', 'Needs attention', boxMetrics.urgentCount],
                            ['working', 'With dues, not bad debt', boxMetrics.totalCount - boxMetrics.badDebtCount],
                        ] as const).filter(([key]) => (key !== 'urgent' && key !== 'working') || categoryFilter === key).map(([key, label, count]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setCategoryFilter(key)}
                                aria-pressed={categoryFilter === key}
                                className={`h-8 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
                                    categoryFilter === key ? 'bg-accent text-on-accent shadow-e1' : 'bg-card text-label-2 border border-separator-strong hover:bg-hover hover:text-label'
                                }`}
                            >
                                {label} <span className="num opacity-80">({count})</span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="px-3.5 py-2 border-b border-separator flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Ageing">
                    <span className="text-[11.5px] font-bold text-gray-500 dark:text-gray-400 mr-1">Ageing:</span>
                    {([
                        ['all', 'All ageing', boxMetrics.totalCount, 'bg-gray-900 text-white dark:bg-white dark:text-gray-900', 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200', 'Every account in this report'],
                        ['1-45', '1–45d', boxMetrics.ageing1_45Count, 'bg-emerald-600 text-white', 'bg-emerald-50 dark:bg-emerald-950/40 text-pos border border-emerald-200 dark:border-emerald-800', 'Has money 1–45 days overdue'],
                        ['46-90', '46–90d', boxMetrics.ageing46_90Count, 'bg-amber-600 text-white', 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800', 'Has money 46–90 days overdue'],
                        ['91-135', '91–135d', boxMetrics.ageing91_135Count, 'bg-orange-600 text-white', 'bg-orange-50 dark:bg-orange-950/40 text-age-3-ink border border-orange-200 dark:border-orange-800', 'Has money 91–135 days overdue'],
                        ['over135', '>135d', boxMetrics.over135Count, 'bg-red-600 text-white', 'bg-red-50 dark:bg-red-950/40 text-dang border border-red-200 dark:border-red-800', 'Has money more than 135 days overdue'],
                        ['over90', '>90d total', boxMetrics.over90Count, 'bg-orange-600 text-white', 'bg-orange-50 dark:bg-orange-950/40 text-age-3-ink border border-orange-200 dark:border-orange-800', 'Has money more than 90 days overdue (91–135 and >135 together)'],
                    ] as const).map(([key, label, count, on, off, title]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setAgeingFilter(key)}
                            aria-pressed={ageingFilter === key}
                            title={title}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-all ${ageingFilter === key ? on : off}`}
                        >
                            {label} <span className="num opacity-80">({count})</span>
                        </button>
                    ))}
                </div>

                {selectable && selected.length > 0 && (
                    <div className="mb-2.5 p-2.5 bg-accent-tint rounded-xl border border-separator flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-label">
                            <span>{selected.length} account{selected.length === 1 ? '' : 's'} selected</span>
                            <button
                                type="button"
                                onClick={() => setSelectedIds([])}
                                className="px-2 py-1 min-h-[30px] rounded-md text-[12px] font-semibold text-label-2 hover:bg-hover"
                            >
                                Clear
                            </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            {canEditCustomer && onBulkSetRank && (
                                <>
                                    <select
                                        aria-label="Set the payment rank on the selected accounts"
                                        value={bulkRank}
                                        onChange={e => setBulkRank(e.target.value as PaymentRank | '')}
                                        className="px-2 py-1.5 min-h-[32px] text-xs rounded-lg border border-separator bg-card font-bold text-label"
                                    >
                                        <option value="">Set rank to…</option>
                                        <option value="Good">{PAYMENT_RANK_LABELS.Good}</option>
                                        <option value="Late">{PAYMENT_RANK_LABELS.Late}</option>
                                        <option value="Bad">{PAYMENT_RANK_LABELS.Bad}</option>
                                    </select>
                                    <button
                                        onClick={() => {
                                            if (!bulkRank) return;
                                            onBulkSetRank(selected, bulkRank);
                                            setBulkRank('');
                                            setSelectedIds([]);
                                        }}
                                        disabled={!bulkRank}
                                        className="px-2.5 py-1.5 min-h-[32px] rounded-lg text-[12px] font-bold bg-accent text-on-accent disabled:opacity-40"
                                    >
                                        Apply rank
                                    </button>
                                </>
                            )}
                            {canReassignCrm && onBulkReassignCrm && (
                                <>
                                    <select
                                        aria-label="Reassign the selected accounts to a CRM"
                                        value={bulkCrm}
                                        onChange={e => setBulkCrm(e.target.value)}
                                        className="px-2 py-1.5 min-h-[32px] text-xs rounded-lg border border-separator bg-card font-bold text-label"
                                    >
                                        <option value="">Reassign to…</option>
                                        {crmUsers.map(u => (
                                            <option key={u.id} value={u.id}>{u.name}</option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={() => {
                                            if (!bulkCrm) return;
                                            onBulkReassignCrm(selected, bulkCrm);
                                            setBulkCrm('');
                                            setSelectedIds([]);
                                        }}
                                        disabled={!bulkCrm}
                                        className="px-2.5 py-1.5 min-h-[32px] rounded-lg text-[12px] font-bold bg-accent text-on-accent disabled:opacity-40"
                                    >
                                        Reassign
                                    </button>
                                </>
                            )}
                            {onBulkSetFollowUp && (
                                <>
                                    <label className="inline-flex items-center gap-1.5 text-[12px] font-bold text-label-2">
                                        <span>Follow-up on</span>
                                        <input
                                            type="date"
                                            aria-label="Follow-up date to set on the selected accounts"
                                            value={bulkFollowUp}
                                            min={todayIso}
                                            onChange={e => setBulkFollowUp(e.target.value)}
                                            className="px-2 py-1.5 min-h-[32px] text-xs rounded-lg border border-separator bg-card font-bold text-label"
                                        />
                                    </label>
                                    {bulkFollowUp !== todayIso && (
                                        <button
                                            type="button"
                                            onClick={() => setBulkFollowUp(todayIso)}
                                            className="px-2 py-1 min-h-[30px] rounded-md text-[12px] font-semibold text-accent hover:bg-hover"
                                        >
                                            Today
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { if (bulkFollowUp) setConfirmBulkDate(true); }}
                                        disabled={!bulkFollowUp}
                                        className="px-2.5 py-1.5 min-h-[32px] rounded-lg text-[12px] font-bold bg-accent text-on-accent disabled:opacity-40"
                                    >
                                        Set follow-up
                                    </button>
                                </>
                            )}
                            {canDownloadExcel && (
                                <button
                                    onClick={exportToExcel}
                                    className="px-2.5 py-1.5 min-h-[32px] rounded-lg text-[12px] font-bold bg-accent hover:bg-accent-press text-on-accent"
                                >
                                    Export these {selected.length}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Table with Live 1-45d, 46-90d, 91-135d, >135d on Screen */}
                {isPhone ? (
                    <div>
                        {selectable && filteredReportData.length > 0 && (
                            <div className="px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/90 border-b border-gray-200 dark:border-gray-700 flex items-center justify-end">
                                <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 min-h-[32px]">
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={e => toggleAll(e.target.checked)}
                                        aria-label="Select all accounts in this report"
                                        className="w-5 h-5 rounded text-accent focus:ring-accent"
                                    />
                                    Select all
                                </label>
                            </div>
                        )}
                        {filteredReportData.length === 0 ? (
                            <div className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">
                                <p className="text-xs font-bold text-gray-700 dark:text-gray-300">No accounts match this report.</p>
                                <p className="text-[12.5px] text-gray-400 mt-1">Choose another follow-up state or ageing, or press Reset above.</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-200 dark:divide-gray-800">
                                {filteredReportData.slice(0, phoneVisible).map(item => {
                                    const activePdcs = pdcCheques.filter(p => p.customerId === item.id && CHEQUE_ACTIVE.includes(chequeState(p, today)));
                                    const totalPdcAmount = activePdcs.reduce((sum, p) => sum + p.amount, 0);
                                    return (
                                        <PhoneAccountRow
                                            key={item.id}
                                            item={item}
                                            today={today}
                                            ownerName={getUserDisplayName(item.crmOwnerId)}
                                            onOpen={() => onFollowUp(item)}
                                            onWhatsApp={() => onWhatsApp(item)}
                                            selectable={selectable}
                                            selected={selected.includes(item.id)}
                                            onToggleSelect={() => toggleRow(item.id)}
                                            extras={activePdcs.length > 0 ? (
                                                <span
                                                    className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[11.5px] font-bold bg-pos-bg text-pos"
                                                    title={`Active PDC Cheques: ₹${totalPdcAmount.toLocaleString('en-IN')} (${activePdcs.length} cheques)`}
                                                >
                                                    <ChequeIcon className="w-3 h-3" />
                                                    {formatCurrency(totalPdcAmount)}
                                                </span>
                                            ) : undefined}
                                        />
                                    );
                                })}
                            </div>
                        )}
                        {phoneVisible < filteredReportData.length && (
                            <div className="p-3 border-t border-gray-200 dark:border-gray-800">
                                <button
                                    onClick={() => setPhoneVisible(c => c + PHONE_PAGE * 2)}
                                    className="w-full h-11 rounded-xl bg-gray-100 dark:bg-gray-800 active:bg-gray-200 text-[14px] font-semibold text-gray-700 dark:text-gray-300"
                                >
                                    Show more &mdash; {(filteredReportData.length - phoneVisible).toLocaleString('en-IN')} left
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs min-w-[900px]">
                        <thead className="bg-gray-50 dark:bg-gray-800/90 text-[12.5px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                            <tr>
                                {selectable && (
                                    <th className="px-2.5 py-2.5 w-10 text-center">
                                        <label className="inline-flex items-center justify-center p-2 -m-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={allSelected}
                                                onChange={e => toggleAll(e.target.checked)}
                                                aria-label="Select all accounts in this report"
                                                title="Select all accounts in this report"
                                                className="w-4 h-4 rounded text-pos focus:ring-accent cursor-pointer"
                                                style={{ outlineOffset: 6 }}
                                            />
                                        </label>
                                    </th>
                                )}
                                <th className="px-3 py-2.5 text-left min-w-[200px]">Customer</th>
                                <th className="px-2.5 py-2.5 text-right">Balance</th>
                                
                                {/* The four buckets, as one column - same as the customer ledger */}
                                <th className="px-2.5 py-2.5 text-left w-[110px] min-w-[110px] xl:w-[204px] xl:min-w-[204px]">Ageing</th>
                                <th className="px-2.5 py-2.5 text-right text-dang">
                                    Over 90 days
                                </th>

                                <th className="px-2.5 py-2.5 text-center">Follow-up / Status</th>
                                <th className="px-2.5 py-2.5 text-left">CRM Owner</th>
                                <th className="px-2.5 py-2.5 text-left hidden xl:table-cell">Last note</th>
                                <th className="px-2.5 py-2.5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900">
                            {filteredReportData.length === 0 ? (
                                <tr>
                                    <td colSpan={selectable ? 12 : 11} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">
                                        <p className="text-xs font-bold text-gray-700 dark:text-gray-300">No accounts match this report.</p>
                                        <p className="text-[12.5px] text-gray-400 mt-1">Choose another follow-up state or ageing, or press Reset above.</p>
                                    </td>
                                </tr>
                            ) : (
                                filteredReportData.slice(0, visibleCount).map((item) => {
                                    const { a1, a2, a3, a4, over90: over90Total } = overdueAgeing(item);
                                    const hasOver90Dues = over90Total > 0;
                                    
                                    // Row status visual border
                                    let rowBorder = '';
                                    // A 3px status edge is enough. The tinted row backgrounds that came with
                                    // it fought the ageing colours and repeated what the status pill says.
                                    if (item.status === FollowUpStatus.Completed) {
                                        rowBorder = 'border-l-[3px] border-l-green-500';
                                    } else if (isBadDebt(item)) {
                                        rowBorder = 'border-l-[3px] border-l-rose-700';
                                    } else if (isTodayFollowUp(item)) {
                                        rowBorder = 'border-l-[3px] border-l-blue-500';
                                    } else if (isOverdueFollowUp(item)) {
                                        rowBorder = 'border-l-[3px] border-l-red-500';
                                    } else if (isNoFollowUp(item)) {
                                        rowBorder = 'border-l-[3px] border-l-amber-400';
                                    } else if (isFutureFollowUp(item)) {
                                        rowBorder = 'border-l-[3px] border-l-emerald-500';
                                    }

                                    // Customer PDC Summary
                                    const customerPdcs = pdcCheques.filter(p => p.customerId === item.id);
                                    const activePdcs = customerPdcs.filter(p => CHEQUE_ACTIVE.includes(chequeState(p, today)));
                                    const totalPdcAmount = activePdcs.reduce((sum, p) => sum + p.amount, 0);

                                    return (
                                        <tr key={item.id} className={`${rowBorder} ${selected.includes(item.id) ? 'bg-emerald-50/40 dark:bg-emerald-950/10' : hasOver90Dues ? 'hover:bg-red-50/30 dark:hover:bg-red-950/20' : 'hover:bg-gray-50/80 dark:hover:bg-gray-800/50'} transition-colors`}>
                                            {selectable && (
                                                <td className="px-2.5 py-2.5 text-center">
                                                    <label className="inline-flex items-center justify-center p-2 -m-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={selected.includes(item.id)}
                                                            onChange={() => toggleRow(item.id)}
                                                            aria-label={`Select ${item.company}`}
                                                            className="w-4 h-4 rounded text-pos focus:ring-accent cursor-pointer"
                                                            style={{ outlineOffset: 6 }}
                                                        />
                                                    </label>
                                                </td>
                                            )}
                                            <td className="px-3 py-2.5">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <button
                                                        onClick={() => onFollowUp(item)}
                                                        className="font-bold text-label hover:text-accent text-left inline-flex items-center gap-1.5 min-h-[30px] min-w-[30px]"
                                                    >
                                                        <span>{item.company}</span>
                                                        {item.isUrgent && <FireIcon className="text-red-500 w-3.5 h-3.5 flex-shrink-0" />}
                                                    </button>
                                                    {/* A defaulter, on the recovery list — said on the row, since the
                                                        list it is in may be a search or "All". */}
                                                    {isBadDebt(item) && (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11.5px] font-extrabold bg-dang-bg text-dang" title="A declared defaulter — on the recovery list, out of the follow-up lists">
                                                            Bad debt
                                                        </span>
                                                    )}
                                                    {hasOver90Dues && (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11.5px] font-extrabold bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200 border border-red-200 dark:border-red-800" title="Has money more than 90 days overdue">
                                                            &gt;90 days
                                                        </span>
                                                    )}
                                                    {activePdcs.length > 0 && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onOpenPdcForCustomer?.(item.id);
                                                            }}
                                                            className="inline-flex items-center gap-1 px-2 py-1 min-h-[30px] rounded-md text-[11.5px] font-bold bg-pos-bg text-pos hover:opacity-80 transition-opacity flex-shrink-0"
                                                            title={`Active PDC Cheques: ₹${totalPdcAmount.toLocaleString('en-IN')} (${activePdcs.length} cheques)`}
                                                        >
                                                            <ChequeIcon className="w-2.5 h-2.5" />
                                                            <span>{formatCurrency(totalPdcAmount)}</span>
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[12.5px] text-gray-500 dark:text-gray-400">
                                                    {item.contactNumber && (dialable(item.contactNumber) ? (
                                                        <a href={`tel:${item.contactNumber}`} className="inline-flex items-center min-h-[30px] px-1 -mx-1 hover:text-pos font-medium">
                                                            {item.contactNumber}
                                                        </a>
                                                    ) : (
                                                        <span>{item.contactNumber}</span>
                                                    ))}
                                                    {item.contactPerson && (
                                                        <span className="truncate max-w-[110px]">({item.contactPerson})</span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Total Due */}
                                            <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                                                {item.totalType === 'Cr' && item.total > 0 ? (
                                                    <span
                                                        className="inline-flex items-center gap-1 text-xs font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/50 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800/80"
                                                        title={`Excess payment held with us (CR advance) of ${formatINR(item.total)}`}
                                                    >
                                                        {formatINR(item.total)}
                                                        <span className="uppercase font-black text-[10px] px-1 rounded bg-purple-200 text-purple-900 dark:bg-purple-800 dark:text-purple-100">CR</span>
                                                    </span>
                                                ) : (
                                                    <span className="font-extrabold text-gray-900 dark:text-white">{formatINR(item.total)}</span>
                                                )}
                                            </td>

                                            {/* Ageing - bar for shape, then every bucket in full rupees keyed to
                                                its colour. Four number columns cost ~650px here, which is what
                                                pushed Status, Follow-up, CRM and Actions off the screen. */}
                                            <td className="px-2.5 py-2 align-middle" title={AGE_BANDS.map((band, i) => `${band.label}: ${formatINR([a1, a2, a3, a4][i])}`).join(' · ')}>
                                                <AgeingBar parts={{ a1, a2, a3, a4 }} height={6} />
                                                <div className="mt-1.5 flex items-center gap-2 text-[11px] leading-none whitespace-nowrap max-xl:hidden">
                                                    {AGE_BANDS.map((band, i) => {
                                                        const v = [a1, a2, a3, a4][i];
                                                        return (
                                                            <span key={band.key} className="inline-flex items-center gap-1" title={`${band.label}: ${formatINR(v)}`}>
                                                                <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: band.varName, opacity: v > 0 ? 1 : 0.3 }} aria-hidden="true" />
                                                                <span className={`num ${v > 0 ? 'font-semibold text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600'}`}>
                                                                    {v > 0 ? formatCompact(v) : '—'}
                                                                </span>
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </td>

                                            {/* >90d Total Column */}
                                            <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                                                <span className={`text-xs ${over90Total > 0 ? 'text-dang font-extrabold' : 'text-gray-400 dark:text-gray-600'}`}>
                                                    {over90Total > 0 ? formatINR(over90Total) : '—'}
                                                </span>
                                            </td>

                                            {/* Follow-up / Status — the same badge and the same words as the book */}
                                            <td className="px-2.5 py-2 text-center">
                                                <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 max-w-[210px] mx-auto">
                                                    <StatusBadge status={followUpStatusOf(item, today)} />
                                                    <span className={`text-[11.5px] font-bold whitespace-nowrap ${
                                                        isOverdueFollowUp(item) ? 'text-dang' : isTodayFollowUp(item) ? 'text-accent font-extrabold' : isFutureFollowUp(item) ? 'text-pos font-semibold' : 'text-gray-600 dark:text-gray-400'
                                                    }`} title={item.followUpDate ? formatDate(item.followUpDate) : undefined}>
                                                        {followUpWhen(item, today)}
                                                    </span>
                                                    {item.forecastAmount !== undefined && item.forecastAmount > 0 && (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 num whitespace-nowrap" title="Amount the customer promised">
                                                            {formatCurrency(item.forecastAmount)} expected
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* CRM Owner */}
                                            <td className="px-2.5 py-2.5 text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                                <span className="truncate block max-w-[100px]">{getUserDisplayName(item.crmOwnerId)}</span>
                                            </td>

                                            {/* Last Note */}
                                            <td className="px-2.5 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[140px] truncate hidden xl:table-cell" title={item.notes?.[item.notes.length - 1] || ''}>
                                                {item.notes && item.notes.length > 0 ? item.notes[item.notes.length - 1] : '—'}
                                            </td>

                                            {/* Actions */}
                                            <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <button
                                                        onClick={() => onWhatsApp(item)}
                                                        className="w-8 h-8 grid place-items-center text-pos hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-full transition-colors"
                                                        title="Open a WhatsApp reminder"
                                                        aria-label={`WhatsApp ${item.company}`}
                                                    >
                                                        <WhatsAppIcon className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => onFollowUp(item)}
                                                        className="h-8 px-3 bg-accent hover:bg-accent-press text-on-accent rounded-full text-[12.5px] font-semibold transition-colors shadow-2xs"
                                                        title="Open this account: log the call, set the next date"
                                                    >
                                                        Follow up
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                    {visibleCount < filteredReportData.length && (
                        <div className="p-3 border-t border-separator flex justify-center">
                            <button
                                type="button"
                                onClick={() => setVisibleCount(c => c + PAGE * 2)}
                                className="h-9 px-5 rounded-xl bg-card-2 hover:bg-hover text-[13px] font-semibold text-label-2"
                            >
                                Show more &mdash; {(filteredReportData.length - visibleCount).toLocaleString('en-IN')} left
                            </button>
                        </div>
                    )}
                </div>
                )}
            </div>

            {/* AI Report Modal — its markdown renderer arrives when it is first opened */}
            <Suspense fallback={null}>
            <AiReportModal
                isOpen={isAiReportOpen}
                onClose={() => setIsAiReportOpen(false)}
                data={data}
                users={users}
                companyProfile={companyProfile}
                selectedCrm={selectedCrm}
                pdcCheques={pdcCheques}
                onFollowUp={onFollowUp}
            />
            </Suspense>
            <ConfirmDialog
                open={confirmBulkDate}
                title={`Set the follow-up date on ${selected.length} account${selected.length === 1 ? '' : 's'}?`}
                confirmLabel="Set the date"
                tone="primary"
                onCancel={() => setConfirmBulkDate(false)}
                onConfirm={() => { setConfirmBulkDate(false); if (!bulkFollowUp || !onBulkSetFollowUp) return; onBulkSetFollowUp(selected, bulkFollowUp); setSelectedIds([]); }}
            >
                <p>Every selected account gets <strong className="text-label">{bulkFollowUp ? formatDay(bulkFollowUp) : ''}</strong> as its next follow-up date.</p>
                <p className="mt-2">Each account's activity will record the move — and, where it was overdue, that its CRM had not rescheduled it.</p>
            </ConfirmDialog>
        </div>
    );
};

export default ReportsView;
