import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Outstanding, PdcCheque, PdcStatus, User, UserRole, can, seesWholeBook, scopeTo, chequeState, ChequeState, CHEQUE_ACTIVE } from '../types';
import { ChequeIcon, DownloadIcon, EditIcon, TrashIcon, CheckCircleIcon, ClockIcon, ExclamationTriangleIcon } from './icons/Icons';

interface PdcChequesViewProps {
    pdcCheques: PdcCheque[];
    customers: Outstanding[];
    users: User[];
    currentUser: User | null;
    onAddPdc: (customerId?: string) => void;
    onEditPdc: (cheque: PdcCheque) => void;
    onDeletePdc: (chequeId: string) => void;
    onUpdatePdcStatus: (chequeId: string, status: PdcStatus) => void;
    onOpenCustomerFollowUp?: (customer: Outstanding) => void;
    initialStatusFilter?: string | null;
    initialCustomerFilter?: string | null;
}

export const isSameDay = (d1: Date, d2: Date) => {
    return (
        d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate()
    );
};

const PdcChequesView: React.FC<PdcChequesViewProps> = ({
    pdcCheques,
    customers,
    users,
    currentUser,
    onAddPdc,
    onEditPdc,
    onDeletePdc,
    onUpdatePdcStatus,
    onOpenCustomerFollowUp,
    initialStatusFilter,
    initialCustomerFilter,
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCustomer, setSelectedCustomer] = useState<string>(initialCustomerFilter || 'all');
    const [selectedCrm, setSelectedCrm] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter || 'all');
    const [bankFilter, setBankFilter] = useState<string>('all');
    const [dateRangeFilter, setDateRangeFilter] = useState<'all' | 'today' | 'this_week' | 'this_month' | 'passed'>('all');

    const today = useMemo(() => new Date(), []);

    // What this person may do to a cheque. Row Level Security enforces the same
    // rule, so a button we cannot honour is a button we do not show.
    const canManagePdc = can(currentUser, 'canManagePdc');
    const canExport = can(currentUser, 'canExportData');

    // Permission and Data Scoping
    const canViewAll = seesWholeBook(currentUser);

    const allowedCustomers = useMemo(() => scopeTo(currentUser, customers), [customers, currentUser]);

    const allowedCustomerIds = useMemo(() => new Set(allowedCustomers.map(c => c.id)), [allowedCustomers]);

    const allowedCheques = useMemo(() => {
        if (canViewAll || !currentUser) return pdcCheques;
        const userIdUpper = (currentUser.id || '').trim().toUpperCase();
        const userNameUpper = (currentUser.name || '').trim().toUpperCase();

        return pdcCheques.filter(c => {
            if (allowedCustomerIds.has(c.customerId)) return true;
            const ownerUpper = (c.crmOwnerId || '').trim().toUpperCase();
            return ownerUpper === userIdUpper || ownerUpper === userNameUpper;
        });
    }, [pdcCheques, allowedCustomerIds, currentUser, canViewAll]);

    const availableCrms = useMemo(() => {
        const allCrms = users.filter(u => u.role === UserRole.CRM);
        if (canViewAll) return allCrms;
        return allCrms.filter(u => {
            const uId = u.id.trim().toUpperCase();
            const uName = u.name.trim().toUpperCase();
            const currId = (currentUser?.id || '').trim().toUpperCase();
            const currName = (currentUser?.name || '').trim().toUpperCase();
            const assigned = (currentUser?.assignedCrms || []).map(c => c.trim().toUpperCase());
            return uId === currId || uName === currName || assigned.includes(uId) || assigned.includes(uName);
        });
    }, [users, canViewAll, currentUser]);

    // Helper: Normalize date objects
    const normalizeDate = (d: any): Date => {
        return d instanceof Date ? d : new Date(d);
    };

    // Where each cheque stands today, worked out from its date every render.
    // chequeState() in types.ts is the only place that decision is made, so the
    // register, the dashboard badge and the morning email cannot disagree.
    const chequesWithComputedStatus = useMemo(
        () => allowedCheques.map(c => ({
            ...c,
            chequeDate: normalizeDate(c.chequeDate),
            state: chequeState({ ...c, chequeDate: normalizeDate(c.chequeDate) }, today),
        })),
        [allowedCheques, today],
    );

    const metricsByState = useMemo(() => {
        const blank = () => ({ count: 0, amount: 0 });
        const acc: Record<ChequeState, { count: number; amount: number }> = {
            due: blank(), overdue: blank(), upcoming: blank(),
            hold: blank(), cleared: blank(), bounced: blank(),
        };
        for (const c of chequesWithComputedStatus) {
            acc[c.state].count++;
            acc[c.state].amount += c.amount;
        }
        return acc;
    }, [chequesWithComputedStatus]);

    // Metric Calculations
    const metrics = useMemo(() => {
        const m = metricsByState;
        return {
            todayCount: m.due.count,        todayAmount: m.due.amount,
            overdueCount: m.overdue.count,  overdueAmount: m.overdue.amount,
            pendingCount: m.upcoming.count, pendingAmount: m.upcoming.amount,
            holdCount: m.hold.count,        holdAmount: m.hold.amount,
            clearedCount: m.cleared.count,  clearedAmount: m.cleared.amount,
            bouncedCount: m.bounced.count,  bouncedAmount: m.bounced.amount,
            // Everything still with us, whether or not its date has come.
            activeTotalAmount: m.due.amount + m.overdue.amount + m.upcoming.amount + m.hold.amount,
        };
    }, [metricsByState]);

    // Extract unique banks for filter
    const bankList = useMemo(() => {
        const banks = new Set<string>();
        pdcCheques.forEach(c => {
            if (c.bankName) banks.add(c.bankName);
        });
        return Array.from(banks).sort();
    }, [pdcCheques]);

    // Filter Logic
    const filteredCheques = useMemo(() => {
        return chequesWithComputedStatus.filter(c => {
            // CRM Filter
            if (selectedCrm !== 'all') {
                const customer = customers.find(cust => cust.id === c.customerId);
                const crmId = customer ? customer.crmOwnerId : c.crmOwnerId;
                if (crmId !== selectedCrm) return false;
            }

            // Customer Filter
            if (selectedCustomer !== 'all' && c.customerId !== selectedCustomer) {
                return false;
            }

            // Bank Filter
            if (bankFilter !== 'all' && c.bankName !== bankFilter) {
                return false;
            }

            // Status Filter
            if (statusFilter !== 'all') {
                if (statusFilter === 'today') {
                    if (c.state !== 'due') return false;
                } else if (statusFilter === 'overdue') {
                    if (c.state !== 'overdue') return false;
                } else if (statusFilter === 'active') {
                    if (!CHEQUE_ACTIVE.includes(c.state)) return false;
                } else if (c.status !== statusFilter) {
                    return false;
                }
            }

            // Date Range Filter
            if (dateRangeFilter !== 'all') {
                const cDate = c.chequeDate;
                if (dateRangeFilter === 'today') {
                    if (c.state !== 'due') return false;
                } else if (dateRangeFilter === 'this_week') {
                    const startOfWeek = new Date(today);
                    startOfWeek.setDate(today.getDate() - today.getDay());
                    startOfWeek.setHours(0, 0, 0, 0);
                    const endOfWeek = new Date(startOfWeek);
                    endOfWeek.setDate(startOfWeek.getDate() + 7);
                    if (cDate < startOfWeek || cDate > endOfWeek) return false;
                } else if (dateRangeFilter === 'this_month') {
                    if (cDate.getMonth() !== today.getMonth() || cDate.getFullYear() !== today.getFullYear()) {
                        return false;
                    }
                } else if (dateRangeFilter === 'passed') {
                    const todayZero = new Date(today);
                    todayZero.setHours(0, 0, 0, 0);
                    if (cDate >= todayZero || c.status === PdcStatus.Cleared) return false;
                }
            }

            // Text Search
            if (searchTerm.trim()) {
                const term = searchTerm.toLowerCase();
                const matchCustomer = c.customerName.toLowerCase().includes(term);
                const matchChequeNo = c.chequeNumber.toLowerCase().includes(term);
                const matchBank = c.bankName.toLowerCase().includes(term);
                const matchRemarks = (c.remarks || '').toLowerCase().includes(term);
                if (!matchCustomer && !matchChequeNo && !matchBank && !matchRemarks) {
                    return false;
                }
            }

            return true;
        }).sort((a, b) => a.chequeDate.getTime() - b.chequeDate.getTime());
    }, [chequesWithComputedStatus, selectedCrm, selectedCustomer, bankFilter, statusFilter, dateRangeFilter, searchTerm, customers, today]);

    // Export to Excel / CSV
    const handleExport = () => {
        if (XLSX) {
            const dataToExport = filteredCheques.map(c => {
                const customer = customers.find(cust => cust.id === c.customerId);
                const crmUser = users.find(u => u.id === (customer?.crmOwnerId || c.crmOwnerId));
                return {
                    'Customer Name': c.customerName,
                    'Cheque Number': c.chequeNumber,
                    'Bank Name': c.bankName,
                    'Cheque Date': c.chequeDate.toLocaleDateString('en-GB'),
                    'Amount (₹)': c.amount,
                    'Status': c.status,
                    'Received Date': normalizeDate(c.receivedDate).toLocaleDateString('en-GB'),
                    'CRM Owner': crmUser ? crmUser.name : (customer?.crmOwnerId || 'N/A'),
                    'Remarks': c.remarks || ''
                };
            });

            const worksheet = XLSX.utils.json_to_sheet(dataToExport);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'PDC Cheques');
            XLSX.writeFile(workbook, `PDC_Cheques_${new Date().toISOString().split('T')[0]}.xlsx`);
        } else {
            alert('Export utility is loading, please try again in a moment.');
        }
    };

    const handleClearFilters = () => {
        setSearchTerm('');
        setSelectedCustomer('all');
        setSelectedCrm('all');
        setStatusFilter('all');
        setBankFilter('all');
        setDateRangeFilter('all');
    };

    const hasActiveFilters = searchTerm !== '' || selectedCustomer !== 'all' || selectedCrm !== 'all' || statusFilter !== 'all' || bankFilter !== 'all' || dateRangeFilter !== 'all';

    return (
        <div className="space-y-6">
            {/* Header with Title & Action */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center space-x-3">
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 text-pos rounded-xl">
                        <ChequeIcon className="w-7 h-7" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            PDC Cheques Management
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 font-semibold">
                                {pdcCheques.length} Cheques
                            </span>
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Track post-dated cheques, bank presentation schedules, and clearing status
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                    {canExport && (
                        <button
                            onClick={handleExport}
                            className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
                            title="Export PDC list to Excel"
                        >
                            <DownloadIcon />
                            <span>Export Excel</span>
                        </button>
                    )}
                    {canManagePdc && (
                        <button
                            onClick={() => onAddPdc()}
                            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold shadow-md shadow-emerald-600/20 transition-colors flex items-center gap-2"
                        >
                            <span className="text-lg leading-none">+</span>
                            <span>Add PDC Cheque</span>
                        </button>
                    )}
                </div>
            </div>

            {/* 5 Main Focus Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* 1. Today's Cheques to Present in Bank */}
                <div
                    onClick={() => {
                        setStatusFilter('today');
                        setDateRangeFilter('all');
                    }}
                    className={`cursor-pointer p-5 rounded-2xl border transition-all duration-200 ${
                        statusFilter === 'today'
                            ? 'bg-amber-500 text-white border-amber-600 shadow-lg shadow-amber-500/25 ring-2 ring-amber-400'
                            : 'bg-white dark:bg-gray-800 hover:border-amber-400 border-gray-100 dark:border-gray-700 text-gray-800 dark:text-white'
                    }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-bold uppercase tracking-wider ${statusFilter === 'today' ? 'text-amber-100' : 'text-warn'}`}>
                            Today's Bank Presentation
                        </span>
                        <div className={`p-2 rounded-xl ${statusFilter === 'today' ? 'bg-white/20' : 'bg-amber-100 dark:bg-amber-900/40 text-warn'}`}>
                            <ClockIcon />
                        </div>
                    </div>
                    <div className="text-2xl font-black">
                        {metrics.todayCount}
                        <span className="text-xs font-normal ml-1 opacity-80">cheques</span>
                    </div>
                    <div className={`text-sm font-bold mt-1 ${statusFilter === 'today' ? 'text-white' : 'text-warn'}`}>
                        ₹{metrics.todayAmount.toLocaleString('en-IN')}
                    </div>
                    {metrics.todayCount > 0 && (
                        <div className={`text-xs mt-2 font-medium flex items-center gap-1 ${statusFilter === 'today' ? 'text-amber-100' : 'text-warn'}`}>
                            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                            <span>Ready to present in bank today</span>
                        </div>
                    )}
                </div>

                {/* 2. Cheques whose date has passed and are still in hand. */}
                <div
                    onClick={() => {
                        setStatusFilter('overdue');
                        setDateRangeFilter('all');
                    }}
                    className={`cursor-pointer p-5 rounded-2xl border transition-all duration-200 ${
                        statusFilter === 'overdue'
                            ? 'bg-dang text-card border-dang shadow-lg ring-2 ring-dang'
                            : 'bg-card hover:border-dang border-separator text-label'
                    }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-bold uppercase tracking-wider ${statusFilter === 'overdue' ? 'text-card' : 'text-dang'}`}>
                            Date passed, not banked
                        </span>
                        <div className={`p-2 rounded-xl ${statusFilter === 'overdue' ? 'bg-white/20' : 'bg-dang-bg text-dang'}`}>
                            <ClockIcon />
                        </div>
                    </div>
                    <div className="text-2xl font-black">
                        {metrics.overdueCount}
                        <span className="text-xs font-normal ml-1 opacity-80">cheques</span>
                    </div>
                    <div className={`text-sm font-bold mt-1 ${statusFilter === 'overdue' ? 'text-card' : 'text-dang'}`}>
                        ₹{metrics.overdueAmount.toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs opacity-70 mt-2">
                        {metrics.overdueCount > 0 ? 'Bank these or record why not' : 'Nothing left unbanked'}
                    </div>
                </div>

                {/* 3. Upcoming Pending PDCs */}
                <div
                    onClick={() => {
                        setStatusFilter(PdcStatus.Pending);
                        setDateRangeFilter('all');
                    }}
                    className={`cursor-pointer p-5 rounded-2xl border transition-all duration-200 ${
                        statusFilter === PdcStatus.Pending
                            ? 'bg-blue-600 text-white border-blue-700 shadow-lg shadow-blue-600/25 ring-2 ring-blue-400'
                            : 'bg-white dark:bg-gray-800 hover:border-blue-400 border-gray-100 dark:border-gray-700 text-gray-800 dark:text-white'
                    }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-bold uppercase tracking-wider ${statusFilter === PdcStatus.Pending ? 'text-blue-100' : 'text-accent'}`}>
                            Upcoming PDCs
                        </span>
                        <div className={`p-2 rounded-xl ${statusFilter === PdcStatus.Pending ? 'bg-white/20' : 'bg-blue-100 dark:bg-blue-900/40 text-accent'}`}>
                            <ChequeIcon />
                        </div>
                    </div>
                    <div className="text-2xl font-black">
                        {metrics.pendingCount}
                        <span className="text-xs font-normal ml-1 opacity-80">cheques</span>
                    </div>
                    <div className={`text-sm font-bold mt-1 ${statusFilter === PdcStatus.Pending ? 'text-white' : 'text-accent'}`}>
                        ₹{metrics.pendingAmount.toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs opacity-70 mt-2">Future dated cheques in hand</div>
                </div>

                {/* 3. Cheques on Hold */}
                <div
                    onClick={() => {
                        setStatusFilter(PdcStatus.Hold);
                        setDateRangeFilter('all');
                    }}
                    className={`cursor-pointer p-5 rounded-2xl border transition-all duration-200 ${
                        statusFilter === PdcStatus.Hold
                            ? 'bg-orange-600 text-white border-orange-700 shadow-lg shadow-orange-600/25 ring-2 ring-orange-400'
                            : 'bg-white dark:bg-gray-800 hover:border-orange-400 border-gray-100 dark:border-gray-700 text-gray-800 dark:text-white'
                    }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-bold uppercase tracking-wider ${statusFilter === PdcStatus.Hold ? 'text-orange-100' : 'text-age-3-ink'}`}>
                            Cheques on Hold
                        </span>
                        <div className={`p-2 rounded-xl ${statusFilter === PdcStatus.Hold ? 'bg-white/20' : 'bg-orange-100 dark:bg-orange-900/40 text-age-3-ink'}`}>
                            <ExclamationTriangleIcon />
                        </div>
                    </div>
                    <div className="text-2xl font-black">
                        {metrics.holdCount}
                        <span className="text-xs font-normal ml-1 opacity-80">cheques</span>
                    </div>
                    <div className={`text-sm font-bold mt-1 ${statusFilter === PdcStatus.Hold ? 'text-white' : 'text-age-3-ink'}`}>
                        ₹{metrics.holdAmount.toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs opacity-70 mt-2">Customer requested hold</div>
                </div>

                {/* 4. Cleared Cheques */}
                <div
                    onClick={() => {
                        setStatusFilter(PdcStatus.Cleared);
                        setDateRangeFilter('all');
                    }}
                    className={`cursor-pointer p-5 rounded-2xl border transition-all duration-200 ${
                        statusFilter === PdcStatus.Cleared
                            ? 'bg-emerald-600 text-white border-emerald-700 shadow-lg shadow-emerald-600/25 ring-2 ring-emerald-400'
                            : 'bg-white dark:bg-gray-800 hover:border-emerald-400 border-gray-100 dark:border-gray-700 text-gray-800 dark:text-white'
                    }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-bold uppercase tracking-wider ${statusFilter === PdcStatus.Cleared ? 'text-emerald-100' : 'text-pos'}`}>
                            Cleared in Bank
                        </span>
                        <div className={`p-2 rounded-xl ${statusFilter === PdcStatus.Cleared ? 'bg-white/20' : 'bg-emerald-100 dark:bg-emerald-900/40 text-pos'}`}>
                            <CheckCircleIcon />
                        </div>
                    </div>
                    <div className="text-2xl font-black">
                        {metrics.clearedCount}
                        <span className="text-xs font-normal ml-1 opacity-80">cheques</span>
                    </div>
                    <div className={`text-sm font-bold mt-1 ${statusFilter === PdcStatus.Cleared ? 'text-white' : 'text-pos'}`}>
                        ₹{metrics.clearedAmount.toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs opacity-70 mt-2">Funds successfully realized</div>
                </div>

                {/* 5. Bounced / Returned */}
                <div
                    onClick={() => {
                        setStatusFilter(PdcStatus.Bounced);
                        setDateRangeFilter('all');
                    }}
                    className={`cursor-pointer p-5 rounded-2xl border transition-all duration-200 ${
                        statusFilter === PdcStatus.Bounced
                            ? 'bg-rose-600 text-white border-rose-700 shadow-lg shadow-rose-600/25 ring-2 ring-rose-400'
                            : 'bg-white dark:bg-gray-800 hover:border-rose-400 border-gray-100 dark:border-gray-700 text-gray-800 dark:text-white'
                    }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-bold uppercase tracking-wider ${statusFilter === PdcStatus.Bounced ? 'text-rose-100' : 'text-dang'}`}>
                            Bounced / Returned
                        </span>
                        <div className={`p-2 rounded-xl ${statusFilter === PdcStatus.Bounced ? 'bg-white/20' : 'bg-rose-100 dark:bg-rose-900/40 text-dang'}`}>
                            <ExclamationTriangleIcon />
                        </div>
                    </div>
                    <div className="text-2xl font-black">
                        {metrics.bouncedCount}
                        <span className="text-xs font-normal ml-1 opacity-80">cheques</span>
                    </div>
                    <div className={`text-sm font-bold mt-1 ${statusFilter === PdcStatus.Bounced ? 'text-white' : 'text-dang'}`}>
                        ₹{metrics.bouncedAmount.toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs opacity-70 mt-2">Requires urgent follow-up</div>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    {/* Search Input */}
                    <div className="lg:col-span-2 relative">
                        <input
                            type="text"
                            placeholder="Search by customer, cheque no, bank, remarks..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border rounded-xl bg-gray-50 dark:bg-gray-700/50 dark:border-gray-600 text-sm focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                        />
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>

                    {/* Customer Filter */}
                    <div>
                        <select
                            aria-label="Filter by customer"
                            value={selectedCustomer}
                            onChange={(e) => setSelectedCustomer(e.target.value)}
                            className="w-full px-3 py-2.5 border rounded-xl bg-gray-50 dark:bg-gray-700/50 dark:border-gray-600 text-sm font-medium focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                        >
                            <option value="all">All Customers ({allowedCustomers.length})</option>
                            {allowedCustomers.map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.company}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* CRM Owner Filter */}
                    <div>
                        <select
                            aria-label="Filter by CRM owner"
                            value={selectedCrm}
                            onChange={(e) => setSelectedCrm(e.target.value)}
                            className="w-full px-3 py-2.5 border rounded-xl bg-gray-50 dark:bg-gray-700/50 dark:border-gray-600 text-sm font-medium focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                        >
                            <option value="all">{canViewAll ? 'All CRM Owners' : 'Assigned CRM Owners'}</option>
                            {availableCrms.map(u => (
                                <option key={u.id} value={u.name}>
                                    {u.name} ({u.role})
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Bank Filter */}
                    <div>
                        <select
                            aria-label="Filter by bank"
                            value={bankFilter}
                            onChange={(e) => setBankFilter(e.target.value)}
                            className="w-full px-3 py-2.5 border rounded-xl bg-gray-50 dark:bg-gray-700/50 dark:border-gray-600 text-sm font-medium focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                        >
                            <option value="all">All Banks ({bankList.length})</option>
                            {bankList.map(b => (
                                <option key={b} value={b}>{b}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Status and Time Preset Pills */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mr-1">
                            Status:
                        </span>
                        {[
                            { label: 'All Cheques', val: 'all' },
                            { label:"Today's Due", val: 'today' },
                            { label: 'Pending', val: PdcStatus.Pending },
                            { label: 'On Hold', val: PdcStatus.Hold },
                            { label: 'Cleared', val: PdcStatus.Cleared },
                            { label: 'Bounced', val: PdcStatus.Bounced },
                        ].map(item => (
                            <button
                                key={item.val}
                                onClick={() => setStatusFilter(item.val)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                    statusFilter === item.val
                                        ? 'bg-emerald-600 text-white shadow-sm'
                                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mr-1">
                            Due Date:
                        </span>
                        <select
                            value={dateRangeFilter}
                            onChange={(e) => setDateRangeFilter(e.target.value as any)}
                            aria-label="Filter cheques"
                            className="px-3 py-1.5 border rounded-lg bg-gray-50 dark:bg-gray-700 dark:border-gray-600 text-xs font-medium focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                        >
                            <option value="all">Any Date</option>
                            <option value="today">Due Today</option>
                            <option value="this_week">Due This Week</option>
                            <option value="this_month">Due This Month</option>
                            <option value="passed">Past Dated (Uncleared)</option>
                        </select>

                        {hasActiveFilters && (
                            <button
                                onClick={handleClearFilters}
                                className="px-3 py-1.5 text-xs text-dang hover:underline font-semibold"
                            >
                                Reset Filters
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Cheque Table */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="p-4 bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Showing {filteredCheques.length} of {pdcCheques.length} PDC Cheques
                    </span>
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                        Total Filtered Amount: ₹{filteredCheques.reduce((sum, c) => sum + c.amount, 0).toLocaleString('en-IN')}
                    </span>
                </div>

                <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800/90 text-[12.5px] sm:text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                            <tr>
                                <th className="px-3 py-2.5">Customer</th>
                                <th className="px-2.5 py-2.5">Cheque Details</th>
                                <th className="px-2.5 py-2.5">PDC Date</th>
                                <th className="px-2.5 py-2.5 text-right">Amount (₹)</th>
                                <th className="px-2.5 py-2.5 text-center">Status</th>
                                <th className="px-2.5 py-2.5 hidden md:table-cell">CRM / Added By</th>
                                <th className="px-2.5 py-2.5 text-center">Quick Action</th>
                                <th className="px-2.5 py-2.5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900">
                            {filteredCheques.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">
                                        <div className="flex flex-col items-center justify-center space-y-1.5">
                                            <ChequeIcon className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                                            <p className="text-sm font-semibold">No PDC cheques found</p>
                                            <p className="text-xs text-gray-400">
                                                {hasActiveFilters 
                                                    ? 'Try adjusting your filters or search terms.' 
                                                    : 'Click"+ Add PDC Cheque" to register a new post-dated cheque.'}
                                            </p>
                                            <button
                                                onClick={() => canManagePdc && onAddPdc()}
                                                disabled={!canManagePdc}
                                                className="mt-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors"
                                            >
                                                + Add PDC Cheque
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredCheques.map(cheque => {
                                    const customer = customers.find(c => c.id === cheque.customerId);
                                    const isDueToday = cheque.state === 'due';
                                    const isPastDue = cheque.state === 'overdue';

                                    return (
                                        <tr key={cheque.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/50 transition-colors">
                                            {/* Customer Name */}
                                            <td className="px-3 py-2.5 min-w-[150px] max-w-[220px]">
                                                <div className="flex items-start flex-col">
                                                    <span className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate max-w-full">
                                                        {cheque.customerName}
                                                    </span>
                                                    {customer && (
                                                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                            <span className="text-[12.5px] text-gray-500 dark:text-gray-400">
                                                                O/S: ₹{customer.total.toLocaleString('en-IN')}
                                                            </span>
                                                            {onOpenCustomerFollowUp && (
                                                                <button
                                                                    onClick={() => onOpenCustomerFollowUp(customer)}
                                                                    className="text-[11.5px] text-pos hover:underline font-semibold"
                                                                >
                                                                    Follow-up →
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Cheque Details */}
                                            <td className="px-2.5 py-2.5">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-1 font-mono text-xs font-bold text-gray-800 dark:text-gray-200">
                                                        <span>#{cheque.chequeNumber}</span>
                                                    </div>
                                                    <span className="text-[12.5px] text-gray-500 dark:text-gray-400 truncate max-w-[120px]">
                                                        {cheque.bankName}
                                                    </span>
                                                    {cheque.remarks && (
                                                        <span className="text-[11.5px] text-gray-400 italic truncate max-w-[140px]">"{cheque.remarks}"
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Cheque Date */}
                                            <td className="px-2.5 py-2.5 whitespace-nowrap">
                                                <div className="flex flex-col">
                                                    <span className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white">
                                                        {cheque.chequeDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                    </span>
                                                    {isDueToday && cheque.status !== PdcStatus.Cleared && (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11.5px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 w-fit animate-pulse">
                                                            Today
                                                        </span>
                                                    )}
                                                    {isPastDue && (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11.5px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300 w-fit">
                                                            Overdue
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Amount */}
                                            <td className="px-2.5 py-2.5 whitespace-nowrap text-right">
                                                <span className="text-sm sm:text-base font-extrabold text-pos">
                                                    ₹{cheque.amount.toLocaleString('en-IN')}
                                                </span>
                                            </td>

                                            {/* Status Badge */}
                                            <td className="px-2.5 py-2.5 whitespace-nowrap text-center">
                                                {cheque.status === PdcStatus.Cleared ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12.5px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                                                        Cleared
                                                    </span>
                                                ) : cheque.status === PdcStatus.Hold ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12.5px] font-semibold bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300">
                                                        On Hold
                                                    </span>
                                                ) : cheque.status === PdcStatus.Bounced ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12.5px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300">
                                                        Bounced
                                                    </span>
                                                ) : isDueToday ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12.5px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                                                        Due Today
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12.5px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
                                                        Pending
                                                    </span>
                                                )}
                                            </td>

                                            {/* CRM / Added By */}
                                            <td className="px-2.5 py-2.5 whitespace-nowrap hidden md:table-cell">
                                                <div className="text-xs">
                                                    <span className="font-semibold text-gray-700 dark:text-gray-300 truncate block max-w-[100px]">
                                                        {customer?.crmOwnerId || cheque.crmOwnerId || 'Unassigned'}
                                                    </span>
                                                    {cheque.addedBy && (
                                                        <span className="block text-gray-400 text-[11.5px] truncate max-w-[100px]">
                                                            by {cheque.addedBy}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Quick Status Toggle */}
                                            <td className="px-2.5 py-2.5 whitespace-nowrap text-center">
                                                {!canManagePdc ? (
                                                    <span className="text-[12.5px] text-label-3">{cheque.status}</span>
                                                ) : (
                                                <div className="inline-flex items-center gap-1 bg-card-2 p-1 rounded-lg border border-separator">
                                                    <button
                                                        onClick={() => onUpdatePdcStatus(cheque.id, PdcStatus.Cleared)}
                                                        title="Mark as Cleared in Bank"
                                                        className={`px-2.5 py-1.5 min-h-[30px] rounded-md text-[12.5px] font-bold transition-colors ${
                                                            cheque.status === PdcStatus.Cleared
                                                                ? 'bg-emerald-600 text-white shadow-xs'
                                                                : 'hover:bg-pos-bg text-label-2 hover:text-pos'
                                                        }`}
                                                    >
                                                        ✓ Clear
                                                    </button>
                                                    <button
                                                        onClick={() => onUpdatePdcStatus(cheque.id, cheque.status === PdcStatus.Hold ? PdcStatus.Pending : PdcStatus.Hold)}
                                                        title={cheque.status === PdcStatus.Hold ?"Release from Hold" :"Put on Hold"}
                                                        className={`px-2.5 py-1.5 min-h-[30px] rounded-md text-[12.5px] font-bold transition-colors ${
                                                            cheque.status === PdcStatus.Hold
                                                                ? 'bg-orange-600 text-white shadow-xs'
                                                                : 'hover:bg-warn-bg text-label-2 hover:text-warn'
                                                        }`}
                                                    >
                                                        Hold
                                                    </button>
                                                    <button
                                                        onClick={() => onUpdatePdcStatus(cheque.id, cheque.status === PdcStatus.Bounced ? PdcStatus.Pending : PdcStatus.Bounced)}
                                                        title="Mark as Bounced / Returned"
                                                        className={`px-2.5 py-1.5 min-h-[30px] rounded-md text-[12.5px] font-bold transition-colors ${
                                                            cheque.status === PdcStatus.Bounced
                                                                ? 'bg-rose-600 text-white shadow-xs'
                                                                : 'hover:bg-dang-bg text-label-2 hover:text-dang'
                                                        }`}
                                                    >
                                                        ✕ Bounce
                                                    </button>
                                                </div>
                                                )}
                                            </td>

                                            {/* Action Buttons */}
                                            <td className="px-2.5 py-2.5 whitespace-nowrap text-right space-x-1">
                                                {canManagePdc && (
                                                <button
                                                    onClick={() => onEditPdc(cheque)}
                                                    className="p-1 text-gray-400 hover:text-accent hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                                                    title="Edit Cheque Details"
                                                >
                                                    <EditIcon />
                                                </button>
                                                )}
                                                {canManagePdc && (
                                                <button
                                                    onClick={() => {
                                                        if (window.confirm(`Are you sure you want to delete Cheque #${cheque.chequeNumber} for ${cheque.customerName}?`)) {
                                                            onDeletePdc(cheque.id);
                                                        }
                                                    }}
                                                    className="p-1 text-gray-400 hover:text-dang hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded transition-colors"
                                                    title="Delete Cheque"
                                                >
                                                    <TrashIcon />
                                                </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default PdcChequesView;
