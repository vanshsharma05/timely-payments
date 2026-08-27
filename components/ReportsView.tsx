import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Outstanding, User, UserRole, FollowUpStatus, PdcCheque, PdcStatus, CompanyProfile, DataVisibility, getFollowUpCategory, can, DEFAULT_COMPANY_PROFILE } from '../types';
import StatusBadge from './StatusBadge';
import AiReportModal from './AiReportModal';
import { 
    ClockIcon, 
    ExclamationTriangleIcon, 
    WhatsAppIcon, 
    FireIcon, 
    UsersIcon, 
    DownloadIcon,
    ChequeIcon,
    SparklesIcon
} from './icons/Icons';
import { AgeingBar, AgeingLegend, AGE_BANDS } from './ui/Primitives';
import { formatINR } from './ui/format';

export type FollowUpCategoryFilter = 'all' | 'today' | 'no_follow_up' | 'overdue' | 'future' | 'completed' | 'over90' | 'over135';
export type AgeingReportFilter = 'all' | '1-45' | '46-90' | '91-135' | 'over90' | 'over135' | 'dueOver45';

interface ReportsViewProps {
    data: Outstanding[];
    users: User[];
    currentUser: User;
    companyProfile?: CompanyProfile;
    onFollowUp: (customer: Outstanding) => void;
    onWhatsApp: (customer: Outstanding) => void;
    initialCrmFilter?: string;
    initialCategoryFilter?: FollowUpCategoryFilter;
    pdcCheques?: PdcCheque[];
    onOpenPdcForCustomer?: (customerId: string) => void;
}

export const ReportsView = ({
    data,
    users,
    currentUser,
    companyProfile = DEFAULT_COMPANY_PROFILE,
    onFollowUp,
    onWhatsApp,
    initialCrmFilter = 'ALL',
    initialCategoryFilter = 'all',
    pdcCheques = [],
    onOpenPdcForCustomer,
}: ReportsViewProps) => {
    const [selectedCrm, setSelectedCrm] = useState<string>(initialCrmFilter);
    const [categoryFilter, setCategoryFilter] = useState<FollowUpCategoryFilter>(initialCategoryFilter);
    const [searchTerm, setSearchTerm] = useState('');
    const [ageingFilter, setAgeingFilter] = useState<AgeingReportFilter>('all');
    const [isAiReportOpen, setIsAiReportOpen] = useState<boolean>(false);

    const today = useMemo(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }, []);

    // Strict access control / role-based scoping
    const canViewAll = 
        currentUser?.role === UserRole.Admin || 
        currentUser?.role === UserRole.Manager || 
        currentUser?.role === UserRole.Viewer || 
        currentUser?.dataVisibility === DataVisibility.All || 
        Boolean(currentUser?.permissions?.canViewAllCrms);

    // Downloading the book and spending money on an AI report are both rights
    // a Viewer or Collector is not given.
    const canExport = can(currentUser, 'canExportData');

    const userAllowedData = useMemo(() => {
        if (canViewAll || !currentUser) return data;
        const userIdUpper = (currentUser.id || '').trim().toUpperCase();
        const userNameUpper = (currentUser.name || '').trim().toUpperCase();
        const allowedCrms = new Set((currentUser.assignedCrms || []).map(c => c.trim().toUpperCase()));
        if (currentUser.role === UserRole.CRM) {
            allowedCrms.add(userIdUpper);
            allowedCrms.add(userNameUpper);
        }
        return data.filter(item => {
            if (currentUser.role === UserRole.Collector) {
                const collectorUpper = (item.assignedCollectorId || '').trim().toUpperCase();
                return collectorUpper === userIdUpper || collectorUpper === userNameUpper;
            }
            const ownerUpper = (item.crmOwnerId || '').trim().toUpperCase();
            return allowedCrms.has(ownerUpper);
        });
    }, [data, currentUser, canViewAll]);

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

    // Classify each record into categories
    const isTodayFollowUp = (item: Outstanding) => getFollowUpCategory(item, today) === 'today';
    const isNoFollowUp = (item: Outstanding) => getFollowUpCategory(item, today) === 'no_follow_up';
    const isOverdueFollowUp = (item: Outstanding) => getFollowUpCategory(item, today) === 'overdue';
    const isFutureFollowUp = (item: Outstanding) => getFollowUpCategory(item, today) === 'future';

    // Filter by CRM first to calculate CRM-scoped box metrics
    const crmScopedData = useMemo(() => {
        if (selectedCrm === 'ALL') return userAllowedData;
        if (selectedCrm === 'UNASSIGNED') {
            return userAllowedData.filter(d => !d.crmOwnerId || d.crmOwnerId.trim() === '' || d.crmOwnerId.toUpperCase() === 'UNASSIGNED');
        }
        return userAllowedData.filter(d => (d.crmOwnerId || '').toUpperCase() === selectedCrm.toUpperCase());
    }, [userAllowedData, selectedCrm]);

    // Comprehensive Metrics Calculation (Scoped to chosen CRM)
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
        let totalCount = crmScopedData.length;
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

        crmScopedData.forEach(item => {
            totalAmount += item.total || 0;
            const a1 = item.ageing?.['1-45'] || 0;
            const a2 = item.ageing?.['46-90'] || 0;
            const a3 = item.ageing?.['91-135'] || 0;
            const a4 = item.ageing?.['>135'] || 0;
            const itemOver90 = item.over90 !== undefined ? item.over90 : (a3 + a4);
            const itemDue45 = item.dueOver45 !== undefined ? item.dueOver45 : (a2 + itemOver90);
            dueOver45Total += itemDue45;

            if (a1 > 0) { ageing1_45Count++; ageing1_45Amount += a1; }
            if (a2 > 0) { ageing46_90Count++; ageing46_90Amount += a2; }
            if (a3 > 0) { ageing91_135Count++; ageing91_135Amount += a3; }
            if (a4 > 0) { over135Count++; over135Amount += a4; }
            if (itemOver90 > 0) { over90Count++; over90Amount += itemOver90; }

            if (item.status === FollowUpStatus.Completed) {
                completedCount++;
                return;
            }

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

        const timelyCount = todayCount + futureCount + completedCount;
        const performanceScore = totalCount > 0 ? Math.round((timelyCount / totalCount) * 100) : 0;
        const followUpCoverageRate = totalCount > 0 ? Math.round(((totalCount - noFollowUpCount) / totalCount) * 100) : 0;

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
            ageing1_45Amount
        };
    }, [crmScopedData, today]);

    // Filtered Report Table Data (Applying CRM + Category + Search + Ageing)
    const filteredReportData = useMemo(() => {
        return crmScopedData.filter(item => {
            const a1 = item.ageing?.['1-45'] || 0;
            const a2 = item.ageing?.['46-90'] || 0;
            const a3 = item.ageing?.['91-135'] || 0;
            const a4 = item.ageing?.['>135'] || 0;
            const itemOver90 = item.over90 !== undefined ? item.over90 : (a3 + a4);
            const itemDue45 = item.dueOver45 !== undefined ? item.dueOver45 : (a2 + itemOver90);

            // Category Filter
            if (categoryFilter === 'today' && !isTodayFollowUp(item)) return false;
            if (categoryFilter === 'no_follow_up' && !isNoFollowUp(item)) return false;
            if (categoryFilter === 'overdue' && !isOverdueFollowUp(item)) return false;
            if (categoryFilter === 'future' && !isFutureFollowUp(item)) return false;
            if (categoryFilter === 'completed' && item.status !== FollowUpStatus.Completed) return false;
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
                const searchTokens = searchTerm.trim().toLowerCase().split(/\s+/).filter(Boolean);
                const crmDisplayName = getUserDisplayName(item.crmOwnerId).toLowerCase();
                const company = String(item.company || '').toLowerCase();
                const contactPerson = String(item.contactPerson || '').toLowerCase();
                const contactPhone = String(item.contactNumber || '').toLowerCase();
                const email = String(item.email || '').toLowerCase();
                const crmOwnerId = String(item.crmOwnerId || '').toLowerCase();
                const id = String(item.id || '').toLowerCase();
                const total = String(item.total || '');
                const notes = (item.notes || []).join(' ').toLowerCase();

                const combinedSearchable = `${company} ${contactPerson} ${contactPhone} ${email} ${crmOwnerId} ${crmDisplayName} ${id} ${total} ${notes}`;
                const allTokensMatch = searchTokens.every(tok => combinedSearchable.includes(tok));
                if (!allTokensMatch) return false;
            }

            return true;
        });
    }, [crmScopedData, categoryFilter, ageingFilter, searchTerm, today, users]);

    // Export current report view to Excel with full ageing breakdown
    const exportToExcel = () => {
        if (!XLSX) {
            alert('Excel utility is loading, please try again in a moment.');
            return;
        }

        const rows = filteredReportData.map(item => {
            const a1 = item.ageing?.['1-45'] || 0;
            const a2 = item.ageing?.['46-90'] || 0;
            const a3 = item.ageing?.['91-135'] || 0;
            const a4 = item.ageing?.['>135'] || 0;
            const over90Total = item.over90 !== undefined ? item.over90 : (a3 + a4);
            const due45Total = item.dueOver45 !== undefined ? item.dueOver45 : (a2 + over90Total);
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
            {/* Top Controls: CRM Filter, Search, AI & Excel Export */}
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-4 sm:p-5">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* CRM Selector */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <label htmlFor="crmSelect" className="text-sm font-bold text-gray-700 dark:text-gray-300 whitespace-nowrap flex items-center gap-1.5">
                            <UsersIcon />
                            <span>Select CRM Owner:</span>
                        </label>
                        <select
                            id="crmSelect"
                            value={selectedCrm}
                            onChange={(e) => {
                                setSelectedCrm(e.target.value);
                            }}
                            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm font-semibold focus:ring-2 focus:ring-green-500 focus:outline-none min-w-[200px]"
                        >
                            <option value="ALL">All CRMs (Company Overview)</option>
                            {crmOwners.map(crm => (
                                <option key={crm} value={crm}>
                                    {getUserDisplayName(crm)} ({data.filter(d => (d.crmOwnerId || '').toUpperCase() === crm).length} accounts)
                                </option>
                            ))}
                            <option value="UNASSIGNED">Unassigned Accounts ({data.filter(d => !d.crmOwnerId || d.crmOwnerId.toUpperCase() === 'UNASSIGNED').length})</option>
                        </select>
                    </div>

                    {/* Customer Search Filter & Action Buttons */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1 lg:max-w-md">
                        <div className="relative flex-1">
                            <input
                                type="text"
                                placeholder="Search by customer, phone, email, CRM..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-8 py-2 border rounded-lg bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                            {searchTerm && (
                                <button
                                    onClick={() => setSearchTerm('')}
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        {canExport && (
                        <button
                            onClick={() => setIsAiReportOpen(true)}
                            className="flex items-center justify-center gap-1.5 px-3.5 py-2 bg-accent hover:bg-accent-press text-on-accent rounded-lg text-xs font-bold shadow-sm transition-all whitespace-nowrap"
                            title="Generate AI Financial & Credit Days Reduction Report"
                        >
                            <SparklesIcon className="w-4 h-4 text-yellow-300 animate-pulse" />
                            <span>AI Credit Report</span>
                        </button>
                        )}

                        {canExport && (
                        <button
                            onClick={exportToExcel}
                            className="flex items-center justify-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors whitespace-nowrap"
                            title="Export Filtered Report to Excel with 1-45d, 46-90d, 91-135d, >135d breakdown"
                        >
                            <DownloadIcon />
                            <span>Excel</span>
                        </button>
                        )}
                    </div>
                </div>
            </div>

            {/* INSTANT HIGH-PRIORITY REPORT CARDS (Including >90 Days and >135 Days Instant Focus) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {/* 1. >90 Days Overdue Instant Report Card */}
                <div
                    onClick={() => {
                        setCategoryFilter(categoryFilter === 'over90' ? 'all' : 'over90');
                        setAgeingFilter('all');
                    }}
                    className={`cursor-pointer rounded-xl p-4.5 border transition-all duration-200 transform hover:scale-[1.02] shadow-sm relative overflow-hidden ${
                        categoryFilter === 'over90'
                            ? 'bg-red-50 dark:bg-red-950/50 border-red-500 ring-2 ring-red-500 shadow-md'
                            : 'bg-white dark:bg-gray-900 border-red-200/70 dark:border-red-900/40 hover:border-red-400'
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold uppercase tracking-wider text-red-600 dark:text-red-400 flex items-center gap-1">
                            <span>&gt;90 Days Overdue</span>
                        </span>
                        <div className="p-2 bg-red-100 dark:bg-red-900/60 rounded-lg text-red-600 dark:text-red-300">
                            <ClockIcon />
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="text-3xl font-black text-red-600 dark:text-red-400">
                            {boxMetrics.over90Count} <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">customers</span>
                        </div>
                        <p className="text-xs font-bold text-gray-700 dark:text-gray-300 mt-1">
                            {formatCurrency(boxMetrics.over90Amount)} <span className="font-normal text-gray-400">(91-135d + &gt;135d)</span>
                        </p>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-xs font-bold text-red-600 dark:text-red-400">
                        <span>{categoryFilter === 'over90' ? '✓ Showing >90d Customers' : 'Instant Report of >90d'}</span>
                        <span>→</span>
                    </div>
                </div>

                {/* 2. >135 Days Critical Dues Instant Report Card */}
                <div
                    onClick={() => {
                        setCategoryFilter(categoryFilter === 'over135' ? 'all' : 'over135');
                        setAgeingFilter('all');
                    }}
                    className={`cursor-pointer rounded-xl p-4.5 border transition-all duration-200 transform hover:scale-[1.02] shadow-sm relative overflow-hidden ${
                        categoryFilter === 'over135'
                            ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-600 ring-2 ring-rose-500 shadow-md'
                            : 'bg-white dark:bg-gray-900 border-rose-200/70 dark:border-rose-900/40 hover:border-rose-400'
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold uppercase tracking-wider text-rose-700 dark:text-rose-400 flex items-center gap-1">
                            <span>&gt;135 Days Critical</span>
                        </span>
                        <div className="p-2 bg-rose-100 dark:bg-rose-900/60 rounded-lg text-rose-700 dark:text-rose-300">
                            <ExclamationTriangleIcon className="w-5 h-5" />
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="text-3xl font-black text-rose-700 dark:text-rose-400">
                            {boxMetrics.over135Count} <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">customers</span>
                        </div>
                        <p className="text-xs font-bold text-gray-700 dark:text-gray-300 mt-1">
                            {formatCurrency(boxMetrics.over135Amount)} <span className="font-normal text-rose-500">Critical late</span>
                        </p>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-xs font-bold text-rose-700 dark:text-rose-400">
                        <span>{categoryFilter === 'over135' ? '✓ Showing >135d Customers' : 'Instant Report of >135d'}</span>
                        <span>→</span>
                    </div>
                </div>

                {/* 3. Today Follow up */}
                <div
                    onClick={() => {
                        setCategoryFilter(categoryFilter === 'today' ? 'all' : 'today');
                        setAgeingFilter('all');
                    }}
                    className={`cursor-pointer rounded-xl p-4.5 border transition-all duration-200 transform hover:scale-[1.02] shadow-sm ${
                        categoryFilter === 'today'
                            ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-500 ring-2 ring-blue-500 shadow-md'
                            : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-blue-300'
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Today Follow up</span>
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg text-blue-600 dark:text-blue-400">
                            <ClockIcon />
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
                            {boxMetrics.todayCount}
                        </div>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">
                            {formatCurrency(boxMetrics.todayAmount)}
                        </p>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-xs font-semibold text-blue-600 dark:text-blue-400">
                        <span>{categoryFilter === 'today' ? '✓ Showing Today' : 'Click to view report'}</span>
                        <span>→</span>
                    </div>
                </div>

                {/* 4. No Follow up Scheduled */}
                <div
                    onClick={() => {
                        setCategoryFilter(categoryFilter === 'no_follow_up' ? 'all' : 'no_follow_up');
                        setAgeingFilter('all');
                    }}
                    className={`cursor-pointer rounded-xl p-4.5 border transition-all duration-200 transform hover:scale-[1.02] shadow-sm ${
                        categoryFilter === 'no_follow_up'
                            ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-500 ring-2 ring-amber-500 shadow-md'
                            : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-amber-300'
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">No Follow-up Set</span>
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/50 rounded-lg text-amber-600 dark:text-amber-400">
                            <ExclamationTriangleIcon className="w-5 h-5" />
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
                            {boxMetrics.noFollowUpCount}
                        </div>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">
                            {formatCurrency(boxMetrics.noFollowUpAmount)}
                        </p>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-xs font-semibold text-amber-600 dark:text-amber-400">
                        <span>{categoryFilter === 'no_follow_up' ? '✓ Showing No Follow-up' : 'Click to view report'}</span>
                        <span>→</span>
                    </div>
                </div>
            </div>

            {/* PERFORMANCE SUMMARY & LIVE AGEING BUCKETS BAR */}
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-4 sm:p-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-3.5">
                    <div>
                        <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <span>Portfolio Overview & Ageing Summary:</span>
                            <span className="text-green-600 dark:text-green-400">{selectedCrm === 'ALL' ? 'Company Total' : getUserDisplayName(selectedCrm)}</span>
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            Live bucket monitoring for 1-45d, 46-90d, 91-135d, and critical &gt;135d.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-right">
                            <span className="text-xs text-gray-500 dark:text-gray-400">Timely Follow-up Score:</span>
                            <div className="text-lg font-extrabold text-gray-900 dark:text-white">
                                {boxMetrics.performanceScore}%
                            </div>
                        </div>
                        <div className="w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                            <div
                                className={`h-3 rounded-full ${boxMetrics.performanceScore >= 75 ? 'bg-emerald-500' : boxMetrics.performanceScore >= 45 ? 'bg-amber-500' : 'bg-red-500'}`}
                                style={{ width: `${boxMetrics.performanceScore}%` }}
                            ></div>
                        </div>
                    </div>
                </div>

                {/* 6 Live Metric Tiles with Ageing Focus */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-3.5 text-center">
                    <div className="p-2.5 bg-gray-50 dark:bg-gray-800/60 rounded-lg">
                        <p className="text-[12.5px] text-gray-500 dark:text-gray-400 font-medium uppercase">Total Accounts</p>
                        <p className="text-base font-extrabold text-gray-900 dark:text-white mt-0.5">{boxMetrics.totalCount}</p>
                        <p className="text-[11.5px] text-gray-400">{formatCurrency(boxMetrics.totalAmount)}</p>
                    </div>
                    <div className="p-2.5 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-lg">
                        <p className="text-[12.5px] text-emerald-800 dark:text-emerald-300 font-medium uppercase">1-45 Days (Current)</p>
                        <p className="text-base font-extrabold text-emerald-700 dark:text-emerald-400 mt-0.5">{formatCurrency(boxMetrics.ageing1_45Amount)}</p>
                        <p className="text-[11.5px] text-emerald-600 dark:text-emerald-400">{boxMetrics.ageing1_45Count} accounts</p>
                    </div>
                    <div className="p-2.5 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 rounded-lg">
                        <p className="text-[12.5px] text-amber-800 dark:text-amber-300 font-medium uppercase">46-90 Days</p>
                        <p className="text-base font-extrabold text-amber-700 dark:text-amber-400 mt-0.5">{formatCurrency(boxMetrics.ageing46_90Amount)}</p>
                        <p className="text-[11.5px] text-amber-600 dark:text-amber-400">{boxMetrics.ageing46_90Count} accounts</p>
                    </div>
                    <div className="p-2.5 bg-orange-50/80 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900/50 rounded-lg">
                        <p className="text-[12.5px] text-orange-900 dark:text-orange-300 font-bold uppercase">91-135 Days</p>
                        <p className="text-base font-extrabold text-orange-700 dark:text-orange-400 mt-0.5">{formatCurrency(boxMetrics.ageing91_135Amount)}</p>
                        <p className="text-[11.5px] text-orange-600 dark:text-orange-400">{boxMetrics.ageing91_135Count} accounts</p>
                    </div>
                    <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-lg">
                        <p className="text-[12.5px] text-rose-900 dark:text-rose-200 font-extrabold uppercase">&gt;135 Days Critical</p>
                        <p className="text-base font-black text-rose-700 dark:text-rose-400 mt-0.5">{formatCurrency(boxMetrics.over135Amount)}</p>
                        <p className="text-[11.5px] text-rose-600 dark:text-rose-300 font-semibold">{boxMetrics.over135Count} accounts</p>
                    </div>
                    <div className="p-2.5 bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 rounded-lg">
                        <p className="text-[12.5px] text-red-900 dark:text-red-200 font-extrabold uppercase">Total &gt;90d Overdue</p>
                        <p className="text-base font-black text-red-700 dark:text-red-400 mt-0.5">{formatCurrency(boxMetrics.over90Amount)}</p>
                        <p className="text-[11.5px] text-red-600 dark:text-red-300 font-semibold">{boxMetrics.over90Count} accounts</p>
                    </div>
                </div>
            </div>

            {/* CUSTOMER REPORT LIST TABLE */}
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
                {/* Table Header Controls & Filter Tabs */}
                <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-800 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <h4 className="text-base font-bold text-gray-900 dark:text-white">
                                Customer Report List
                            </h4>
                            <span className="px-2.5 py-0.5 bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-300 text-xs font-bold rounded-full">
                                {filteredReportData.length} Records
                            </span>
                            <AgeingLegend className="gap-3 ml-1" />
                        </div>

                        {/* Category Filter Tabs */}
                        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                            <button
                                onClick={() => setCategoryFilter('all')}
                                className={`h-8 px-3 rounded-full transition-colors ${
                                    categoryFilter === 'all'
                                        ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-bold'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                                }`}
                            >
                                All ({boxMetrics.totalCount})
                            </button>
                            <button
                                onClick={() => setCategoryFilter('over90')}
                                className={`h-8 px-3 rounded-full transition-colors font-semibold ${
                                    categoryFilter === 'over90'
                                        ? 'bg-red-600 text-white ring-2 ring-red-400'
                                        : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 border border-red-200 dark:border-red-800'
                                }`}
                            >
                                &gt;90d Report ({boxMetrics.over90Count})
                            </button>
                            <button
                                onClick={() => setCategoryFilter('over135')}
                                className={`h-8 px-3 rounded-full transition-colors font-semibold ${
                                    categoryFilter === 'over135'
                                        ? 'bg-rose-700 text-white ring-2 ring-rose-400'
                                        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 border border-rose-200 dark:border-rose-800'
                                }`}
                            >
                                &gt;135d Report ({boxMetrics.over135Count})
                            </button>
                            <button
                                onClick={() => setCategoryFilter('today')}
                                className={`h-8 px-3 rounded-full transition-colors ${
                                    categoryFilter === 'today'
                                        ? 'bg-blue-600 text-white font-bold'
                                        : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100'
                                }`}
                            >
                                Today ({boxMetrics.todayCount})
                            </button>
                            <button
                                onClick={() => setCategoryFilter('no_follow_up')}
                                className={`h-8 px-3 rounded-full transition-colors ${
                                    categoryFilter === 'no_follow_up'
                                        ? 'bg-amber-600 text-white font-bold'
                                        : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100'
                                }`}
                            >
                                No Date ({boxMetrics.noFollowUpCount})
                            </button>
                            <button
                                onClick={() => setCategoryFilter('overdue')}
                                className={`h-8 px-3 rounded-full transition-colors ${
                                    categoryFilter === 'overdue'
                                        ? 'bg-red-600 text-white font-bold'
                                        : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100'
                                }`}
                            >
                                Overdue ({boxMetrics.overdueCount})
                            </button>
                            <button
                                onClick={() => setCategoryFilter('future')}
                                className={`h-8 px-3 rounded-full transition-colors ${
                                    categoryFilter === 'future'
                                        ? 'bg-emerald-600 text-white font-bold'
                                        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
                                }`}
                            >
                                Future ({boxMetrics.futureCount})
                            </button>
                            <button
                                onClick={() => setCategoryFilter('completed')}
                                className={`h-8 px-3 rounded-full transition-colors ${
                                    categoryFilter === 'completed'
                                        ? 'bg-green-700 text-white font-bold'
                                        : 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 hover:bg-green-100'
                                }`}
                            >
                                Completed ({boxMetrics.completedCount})
                            </button>
                        </div>
                    </div>

                    {/* Secondary Ageing Breakdown Quick-Filter Bar */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs bg-slate-50 dark:bg-gray-800/60 p-2 rounded-lg border border-slate-200 dark:border-gray-700">
                        <span className="text-gray-500 dark:text-gray-400 font-bold uppercase text-[11.5px] mr-1">Filter by Ageing Bucket:</span>
                        <button
                            onClick={() => setAgeingFilter('all')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-colors ${ageingFilter === 'all' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >
                            All Ageing
                        </button>
                        <button
                            onClick={() => setAgeingFilter('1-45')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-colors ${ageingFilter === '1-45' ? 'bg-emerald-600 text-white' : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/40'}`}
                        >
                            1-45d ({boxMetrics.ageing1_45Count})
                        </button>
                        <button
                            onClick={() => setAgeingFilter('46-90')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-colors ${ageingFilter === '46-90' ? 'bg-amber-600 text-white' : 'text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/40'}`}
                        >
                            46-90d ({boxMetrics.ageing46_90Count})
                        </button>
                        <button
                            onClick={() => setAgeingFilter('91-135')}
                            className={`px-2 py-0.5 rounded text-[12.5px] font-bold transition-colors ${ageingFilter === '91-135' ? 'bg-orange-600 text-white' : 'text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-950/40'}`}
                        >
                            91-135d ({boxMetrics.ageing91_135Count})
                        </button>
                        <button
                            onClick={() => setAgeingFilter('over135')}
                            className={`px-2 py-0.5 rounded text-[12.5px] font-bold transition-colors ${ageingFilter === 'over135' ? 'bg-rose-700 text-white' : 'text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/40'}`}
                        >
                            &gt;135d ({boxMetrics.over135Count})
                        </button>
                        <button
                            onClick={() => setAgeingFilter('over90')}
                            className={`px-2 py-0.5 rounded text-[12.5px] font-bold transition-colors ${ageingFilter === 'over90' ? 'bg-red-600 text-white' : 'text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/40'}`}
                        >
                            &gt;90d Total ({boxMetrics.over90Count})
                        </button>
                    </div>
                </div>

                {/* Table with Live 1-45d, 46-90d, 91-135d, >135d on Screen */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs min-w-[900px]">
                        <thead className="bg-gray-50 dark:bg-gray-800/90 text-[12.5px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                            <tr>
                                <th className="px-3 py-2.5 text-left min-w-[180px]">Company / Contact</th>
                                <th className="px-2.5 py-2.5 text-right">Total Due</th>
                                
                                {/* The four buckets, as one column - same as the customer ledger */}
                                <th className="px-2.5 py-2.5 text-left w-[204px] min-w-[204px]">Ageing</th>
                                <th className="px-2.5 py-2.5 text-right text-red-600 dark:text-red-400">
                                    &gt;90d Total
                                </th>

                                <th className="px-2.5 py-2.5 text-center">Status</th>
                                <th className="px-2.5 py-2.5 text-left">Follow-up</th>
                                <th className="px-2.5 py-2.5 text-left">CRM Owner</th>
                                <th className="px-2.5 py-2.5 text-left hidden lg:table-cell">Last Note</th>
                                <th className="px-2.5 py-2.5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900">
                            {filteredReportData.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">
                                        <p className="text-xs font-bold text-gray-700 dark:text-gray-300">No customer records match the selected report criteria.</p>
                                        <p className="text-[12.5px] text-gray-400 mt-1">Try switching to"All" or choosing another ageing bucket.</p>
                                    </td>
                                </tr>
                            ) : (
                                filteredReportData.map((item) => {
                                    const a1 = item.ageing?.['1-45'] || 0;
                                    const a2 = item.ageing?.['46-90'] || 0;
                                    const a3 = item.ageing?.['91-135'] || 0;
                                    const a4 = item.ageing?.['>135'] || 0;
                                    const over90Total = item.over90 !== undefined ? item.over90 : (a3 + a4);
                                    const hasOver90Dues = over90Total > 0;
                                    
                                    // Row status visual border
                                    let rowBorder = '';
                                    // A 3px status edge is enough. The tinted row backgrounds that came with
                                    // it fought the ageing colours and repeated what the status pill says.
                                    if (item.status === FollowUpStatus.Completed) {
                                        rowBorder = 'border-l-[3px] border-l-green-500';
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
                                    const activePdcs = customerPdcs.filter(p => p.status !== PdcStatus.Cleared && p.status !== PdcStatus.Bounced);
                                    const totalPdcAmount = activePdcs.reduce((sum, p) => sum + p.amount, 0);

                                    return (
                                        <tr key={item.id} className={`${rowBorder} ${hasOver90Dues ? 'hover:bg-red-50/30 dark:hover:bg-red-950/20' : 'hover:bg-gray-50/80 dark:hover:bg-gray-800/50'} transition-colors`}>
                                            <td className="px-3 py-2.5">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <button
                                                        onClick={() => onFollowUp(item)}
                                                        className="font-bold text-gray-900 dark:text-white hover:text-green-600 dark:hover:text-green-400 text-left inline-flex items-center gap-1.5 min-h-[28px]"
                                                    >
                                                        <span>{item.company}</span>
                                                        {item.isUrgent && <FireIcon className="text-red-500 w-3.5 h-3.5 flex-shrink-0" />}
                                                    </button>
                                                    {hasOver90Dues && (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11.5px] font-extrabold bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200 border border-red-200 dark:border-red-800" title="Overdue > 90 Days late payment focus">
                                                            &gt;90d
                                                        </span>
                                                    )}
                                                    {activePdcs.length > 0 && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onOpenPdcForCustomer?.(item.id);
                                                            }}
                                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11.5px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 hover:bg-emerald-200 transition-colors flex-shrink-0"
                                                            title={`Active PDC Cheques: ₹${totalPdcAmount.toLocaleString('en-IN')} (${activePdcs.length} cheques)`}
                                                        >
                                                            <ChequeIcon className="w-2.5 h-2.5" />
                                                            <span>{formatCurrency(totalPdcAmount)}</span>
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[12.5px] text-gray-500 dark:text-gray-400">
                                                    {item.contactNumber && (
                                                        <a href={`tel:${item.contactNumber}`} className="inline-flex items-center min-h-[28px] hover:text-green-600 dark:text-green-400 font-medium">
                                                            {item.contactNumber}
                                                        </a>
                                                    )}
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
                                            <td className="px-2.5 py-2 align-middle">
                                                <AgeingBar parts={{ a1, a2, a3, a4 }} height={6} />
                                                <div className="mt-1.5 grid grid-cols-2 gap-x-2.5 gap-y-0.5 text-[11px] leading-[1.35]">
                                                    {AGE_BANDS.map((band, i) => {
                                                        const v = [a1, a2, a3, a4][i];
                                                        return (
                                                            <span
                                                                key={band.key}
                                                                className="inline-flex items-center gap-1 whitespace-nowrap"
                                                                title={`${band.label}: ${formatINR(v)}`}
                                                            >
                                                                <span
                                                                    className="w-1.5 h-1.5 rounded-full flex-none"
                                                                    style={{ background: band.varName, opacity: v > 0 ? 1 : 0.3 }}
                                                                    aria-hidden="true"
                                                                />
                                                                <span className={v > 0 ? 'font-semibold text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600'}>
                                                                    {v > 0 ? formatINR(v) : '—'}
                                                                </span>
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </td>

                                            {/* >90d Total Column */}
                                            <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                                                <span className={`text-xs ${over90Total > 0 ? 'text-red-600 dark:text-red-400 font-extrabold' : 'text-gray-400 dark:text-gray-600'}`}>
                                                    {over90Total > 0 ? formatINR(over90Total) : '—'}
                                                </span>
                                            </td>

                                            {/* Status Badge */}
                                            <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                                                {isTodayFollowUp(item) ? (
                                                    <span className="px-2 py-0.5 rounded-full text-[12.5px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                                                        Today
                                                    </span>
                                                ) : isNoFollowUp(item) ? (
                                                    <span className="px-2 py-0.5 rounded-full text-[12.5px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
                                                        No Date
                                                    </span>
                                                ) : isOverdueFollowUp(item) ? (
                                                    <span className="px-2 py-0.5 rounded-full text-[12.5px] font-bold bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300">
                                                        Overdue
                                                    </span>
                                                ) : isFutureFollowUp(item) ? (
                                                    <span className="px-2 py-0.5 rounded-full text-[12.5px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300">
                                                        Future
                                                    </span>
                                                ) : (
                                                    <StatusBadge status={item.status} />
                                                )}
                                            </td>

                                            {/* Follow-up Date & Expected Amount */}
                                            <td className="px-2.5 py-2.5 whitespace-nowrap">
                                                <div className="flex flex-col gap-0.5">
                                                    {item.followUpDate ? (
                                                        <span className={`text-xs font-semibold ${isTodayFollowUp(item) ? 'text-blue-600 font-bold' : isOverdueFollowUp(item) ? 'text-red-600 font-bold' : 'text-gray-700 dark:text-gray-300'}`}>
                                                            {formatDate(item.followUpDate)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-amber-600 dark:text-amber-400 font-medium italic">
                                                            Not Set
                                                        </span>
                                                    )}
                                                    {item.forecastAmount !== undefined && item.forecastAmount > 0 && (
                                                        <span className="inline-flex items-center gap-0.5 text-[11.5px] font-bold text-emerald-700 dark:text-emerald-400">
                                                            {formatCurrency(item.forecastAmount)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* CRM Owner */}
                                            <td className="px-2.5 py-2.5 text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                                <span className="truncate block max-w-[100px]">{getUserDisplayName(item.crmOwnerId)}</span>
                                            </td>

                                            {/* Last Note */}
                                            <td className="px-2.5 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[140px] truncate hidden lg:table-cell" title={item.notes?.[item.notes.length - 1] || ''}>
                                                {item.notes && item.notes.length > 0 ? item.notes[item.notes.length - 1] : '—'}
                                            </td>

                                            {/* Actions */}
                                            <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <button
                                                        onClick={() => onFollowUp(item)}
                                                        className="h-8 px-3.5 bg-green-600 hover:bg-green-700 text-white rounded-full text-xs font-semibold transition-colors"
                                                    >
                                                        Update
                                                    </button>
                                                    <button
                                                        onClick={() => onWhatsApp(item)}
                                                        className="w-8 h-8 grid place-items-center bg-emerald-600 hover:bg-emerald-700 text-white rounded-full transition-colors"
                                                        title="Send WhatsApp reminder"
                                                    >
                                                        <WhatsAppIcon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* AI Report Modal */}
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
        </div>
    );
};

export default ReportsView;
