import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Outstanding, PdcCheque, PdcStatus, User, UserRole, can, seesWholeBook, scopeTo, chequeState, ChequeState, CHEQUE_ACTIVE } from '../types';
import { ChequeIcon, DownloadIcon, EditIcon, TrashIcon } from './icons/Icons';
import { Badge, Button } from './ui/Primitives';
import { formatCompact } from './ui/format';

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

/** One word per state, and one colour, wherever a cheque is shown. */
const ROW_TONE: Record<ChequeState, 'pos' | 'warn' | 'dang' | 'neutral' | 'brand'> = {
    due: 'warn', overdue: 'dang', upcoming: 'brand', hold: 'neutral', cleared: 'pos', bounced: 'dang',
};
const ROW_LABEL: Record<ChequeState, string> = {
    due: 'Due today', overdue: 'Not banked', upcoming: 'Upcoming',
    hold: 'On hold', cleared: 'Cleared', bounced: 'Bounced',
};

const PDC_SELECT =
    'h-9 px-3 rounded-[10px] bg-card-2 border border-separator text-[13px] text-label ' +
    'outline-none focus:border-accent transition-colors max-w-[190px]';

/**
 * The register's own language, in the order a cheque moves through it.
 *
 * These used to be six large tiles above a separate row of filter chips — two
 * controls for one job, and the tiles wrapped onto a second row leaving a hole
 * where the sixth sat alone. One row now carries the count, the money, and the
 * filtering.
 */
const STATE_CHIPS: { state: ChequeState; filter: string; label: string; hint: string }[] = [
    { state: 'due',      filter: 'today',    label: 'Due today',  hint: 'Dated today. Present these in the bank.' },
    { state: 'overdue',  filter: 'overdue',  label: 'Not banked', hint: 'The date has gone and it is still in hand.' },
    { state: 'upcoming', filter: 'Pending',  label: 'Upcoming',   hint: 'In hand, waiting for its date.' },
    { state: 'hold',     filter: 'Hold',     label: 'On hold',    hint: 'Deliberately not being presented.' },
    { state: 'cleared',  filter: 'Cleared',  label: 'Cleared',    hint: 'The bank paid it.' },
    { state: 'bounced',  filter: 'Bounced',  label: 'Bounced',    hint: 'Returned unpaid.' },
];

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
            {/* One row of state, which is also the filter. */}
            <div className="bg-card rounded-[16px] shadow-e1 px-4 py-3 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                    {STATE_CHIPS.map(chip => {
                        const m = metricsByState[chip.state];
                        const on = statusFilter === chip.filter;
                        return (
                            <button
                                key={chip.filter}
                                type="button"
                                aria-pressed={on}
                                onClick={() => { setStatusFilter(on ? 'all' : chip.filter); setDateRangeFilter('all'); }}
                                title={chip.hint}
                                className={`flex items-center gap-2 h-9 px-3.5 rounded-full text-[13px] whitespace-nowrap transition-colors ${
                                    on ? 'bg-accent text-on-accent font-bold' : 'bg-card-2 text-label-2 font-medium hover:bg-hover hover:text-label'
                                }`}
                            >
                                <span>{chip.label}</span>
                                <span className={`num text-[11.5px] font-bold leading-none px-1.5 py-[3px] rounded-full ${
                                    on ? 'bg-brand-yellow text-brand-yellow-ink' : 'bg-card-3 text-label-2'
                                }`}>
                                    {m.count}
                                </span>
                                {m.amount > 0 && (
                                    <span className={`num text-[12px] ${on ? 'opacity-90' : 'text-label-3'}`}>
                                        {formatCompact(m.amount)}
                                    </span>
                                )}
                            </button>
                        );
                    })}

                    <div className="flex-1" />

                    {canManagePdc && (
                        <Button size="sm" variant="primary" onClick={() => onAddPdc()}>Record a cheque</Button>
                    )}
                    {canExport && (
                        <Button size="sm" variant="quiet" onClick={handleExport} icon={<DownloadIcon className="w-3.5 h-3.5" />}>
                            Export
                        </Button>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[220px]">
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            placeholder="Customer, cheque number, bank or remark"
                            aria-label="Search cheques"
                            className="w-full h-9 pl-3 pr-8 rounded-[10px] bg-card-2 border border-transparent text-[13.5px] text-label placeholder:text-label-3 outline-none focus:border-accent focus:bg-card transition-colors"
                        />
                        {searchTerm && (
                            <button onClick={() => setSearchTerm('')} aria-label="Clear the search"
                                className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full text-label-3 hover:text-label hover:bg-hover text-[15px] leading-none">
                                &times;
                            </button>
                        )}
                    </div>

                    <select aria-label="Filter by customer" value={selectedCustomer}
                        onChange={e => setSelectedCustomer(e.target.value)} className={PDC_SELECT}>
                        <option value="all">Every customer</option>
                        {allowedCustomers
                            .filter(c => pdcCheques.some(q => q.customerId === c.id))
                            .map(c => <option key={c.id} value={c.id}>{c.company}</option>)}
                    </select>

                    <select aria-label="Filter by CRM owner" value={selectedCrm}
                        onChange={e => setSelectedCrm(e.target.value)} className={PDC_SELECT}>
                        <option value="all">Every CRM</option>
                        {availableCrms.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>

                    <select aria-label="Filter by bank" value={bankFilter}
                        onChange={e => setBankFilter(e.target.value)} className={PDC_SELECT}>
                        <option value="all">Every bank</option>
                        {bankList.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>

                    {hasActiveFilters && (
                        <Button size="sm" variant="ghost" onClick={handleClearFilters}>Clear</Button>
                    )}

                    <span className="text-[12.5px] text-label-3 ml-auto">
                        {filteredCheques.length} of {allowedCheques.length} shown
                        <span className="num font-semibold text-label-2">
                            {' · '}{formatCompact(filteredCheques.reduce((sum, c) => sum + c.amount, 0))}
                        </span>
                    </span>
                </div>
            </div>

            {/* Cheque Table */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
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
                                                className="mt-1 px-3 py-1.5 bg-accent hover:bg-accent-press text-on-accent rounded-lg text-xs font-semibold transition-colors"
                                            >
                                                + Add PDC Cheque
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredCheques.map(cheque => {
                                    const customer = customers.find(c => c.id === cheque.customerId);

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
                                                <span className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white">
                                                    {cheque.chequeDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                </span>
                                            </td>

                                            {/* Amount — ink, not green. A cheque in hand is a
                                                figure, not good news; green is reserved for
                                                money that actually arrived. */}
                                            <td className="px-2.5 py-2.5 whitespace-nowrap text-right">
                                                <span className="num text-sm sm:text-base font-bold text-label"
                                                      title={`₹${cheque.amount.toLocaleString('en-IN')}`}>
                                                    {formatCompact(cheque.amount)}
                                                </span>
                                            </td>

                                            {/* One status, derived from the date every render. */}
                                            <td className="px-2.5 py-2.5 whitespace-nowrap text-center">
                                                <Badge tone={ROW_TONE[cheque.state]}>{ROW_LABEL[cheque.state]}</Badge>
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
                                                                ? 'bg-accent text-on-accent shadow-xs'
                                                                : 'hover:bg-pos-bg text-label-2 hover:text-pos'
                                                        }`}
                                                    >
                                                        ✓ Clear
                                                    </button>
                                                    <button
                                                        onClick={() => onUpdatePdcStatus(cheque.id, cheque.status === PdcStatus.Hold ? PdcStatus.Pending : PdcStatus.Hold)}
                                                        title={cheque.status === PdcStatus.Hold ? 'Release this cheque back to Pending' : 'Hold this cheque back from the bank'}
                                                        className={`px-2.5 py-1.5 min-h-[30px] rounded-md text-[12.5px] font-bold transition-colors ${
                                                            cheque.status === PdcStatus.Hold
                                                                ? 'bg-card-3 text-label ring-1 ring-separator-strong'
                                                                : 'hover:bg-hover text-label-2 hover:text-label'
                                                        }`}
                                                    >
                                                        {cheque.status === PdcStatus.Hold ? 'Release' : 'Hold'}
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
