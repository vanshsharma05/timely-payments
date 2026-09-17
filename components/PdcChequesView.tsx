import React, { useState, useMemo, useEffect } from 'react';
import { useIsPhone } from './ui/usePhone';
import * as XLSX from 'xlsx';
import { Outstanding, PdcCheque, PdcStatus, User, UserRole, can, seesWholeBook, scopeTo, chequeState, ChequeState, CHEQUE_ACTIVE, findOwner, ownerKey } from '../types';
import { ChequeIcon, DownloadIcon, EditIcon, TrashIcon } from './icons/Icons';
import { Button } from './ui/Primitives';
import { formatCompact, formatINR, chequeWhen } from './ui/format';
import { CHEQUE_STATES, CHEQUE_STATE_ORDER, ChequeStateBadge, sortCheques } from './ui/ChequeState';
import { ConfirmDialog } from './ui/ConfirmDialog';
import type { SyncFailure } from '../services/useSupabaseSync';

/**
 * The list's one filter on where a cheque stands. Every key is a state
 * chequeState() works out, so a card, its chip and the list it opens count
 * the same cheques: "Upcoming" used to be the stored status Pending, which
 * also covered the ones due today and the ones whose date had gone.
 */
export type ChequeStateFilter = 'all' | 'active' | ChequeState;

/** The old filter names the dashboard still sends, mapped to states. */
export const normaliseStateFilter = (value?: string | null): ChequeStateFilter => {
    switch (value) {
        case 'today': case 'due': return 'due';
        case 'overdue': return 'overdue';
        case 'active': return 'active';
        case PdcStatus.Pending: case 'upcoming': return 'upcoming';
        case PdcStatus.Hold: case 'hold': return 'hold';
        case PdcStatus.Cleared: case 'cleared': return 'cleared';
        case PdcStatus.Bounced: case 'bounced': return 'bounced';
        default: return 'all';
    }
};

interface PdcChequesViewProps {
    pdcCheques: PdcCheque[];
    customers: Outstanding[];
    users: User[];
    currentUser: User | null;
    onAddPdc: (customerId?: string) => void;
    onEditPdc: (cheque: PdcCheque) => void;
    onDeletePdc: (chequeId: string) => void;
    onUpdatePdcStatus: (chequeId: string, status: PdcStatus) => void;
    /** The same status across a selection, in one pass. */
    onBulkPdcStatus?: (chequeIds: string[], status: PdcStatus) => void;
    onBulkDeletePdc?: (chequeIds: string[]) => void;
    onOpenCustomerFollowUp?: (customer: Outstanding) => void;
    initialStatusFilter?: string | null;
    initialCustomerFilter?: string | null;
    /** The first read of the register has not come back yet. */
    loading?: boolean;
    /** Cheques the server has refused, with the reason — shown on the row, not only in the header. */
    unsaved?: SyncFailure[];
}

export const isSameDay = (d1: Date, d2: Date) => {
    return (
        d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate()
    );
};

type DateRange = 'all' | 'today' | 'this_week' | 'this_month' | 'passed';
const DATE_RANGES: { value: DateRange; label: string }[] = [
    { value: 'all', label: 'Any date' },
    { value: 'today', label: 'Dated today' },
    { value: 'this_week', label: 'This week' },
    { value: 'this_month', label: 'This month' },
    { value: 'passed', label: 'Date passed, not cleared' },
];

const PAGE = 50;

const PdcChequesView: React.FC<PdcChequesViewProps> = ({
    pdcCheques,
    customers,
    users,
    currentUser,
    onAddPdc,
    onEditPdc,
    onDeletePdc,
    onUpdatePdcStatus,
    onBulkPdcStatus,
    onBulkDeletePdc,
    onOpenCustomerFollowUp,
    initialStatusFilter,
    initialCustomerFilter,
    loading = false,
    unsaved = [],
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCustomer, setSelectedCustomer] = useState<string>(initialCustomerFilter || 'all');
    const [selectedCrm, setSelectedCrm] = useState<string>('all');
    const [stateFilter, setStateFilter] = useState<ChequeStateFilter>(normaliseStateFilter(initialStatusFilter));
    const [bankFilter, setBankFilter] = useState<string>('all');
    const [dateRangeFilter, setDateRangeFilter] = useState<DateRange>('all');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    /** What is about to be deleted, named, until the person says so. */
    const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);

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

    const customerById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
    const unsavedById = useMemo(() => new Map(unsaved.map(f => [f.id, f.message])), [unsaved]);

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

    // Everything still with us, whether or not its date has come.
    const inHand = useMemo(() => {
        const m = metricsByState;
        return {
            count: m.due.count + m.overdue.count + m.upcoming.count + m.hold.count,
            amount: m.due.amount + m.overdue.amount + m.upcoming.amount + m.hold.amount,
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
        const list = chequesWithComputedStatus.filter(c => {
            // CRM Filter
            if (selectedCrm !== 'all') {
                const customer = customerById.get(c.customerId);
                const crmId = customer ? customer.crmOwnerId : c.crmOwnerId;
                // Compared through the roster: the dropdown holds a CRM code
                // and the stored value may be either spelling. A plain !==
                // matched neither case nor a display name, so picking a CRM
                // here emptied the list instead of narrowing it.
                const canonical = findOwner(users, crmId)?.id || (crmId || '');
                if (ownerKey(canonical) !== ownerKey(selectedCrm)) return false;
            }

            // Customer Filter
            if (selectedCustomer !== 'all' && c.customerId !== selectedCustomer) {
                return false;
            }

            // Bank Filter
            if (bankFilter !== 'all' && c.bankName !== bankFilter) {
                return false;
            }

            // State filter — every key is a computed state, so it lists what its count said.
            if (stateFilter !== 'all') {
                if (stateFilter === 'active') {
                    if (!CHEQUE_ACTIVE.includes(c.state)) return false;
                } else if (c.state !== stateFilter) {
                    return false;
                }
            }

            // Date Range Filter
            if (dateRangeFilter !== 'all') {
                const cDate = c.chequeDate;
                if (dateRangeFilter === 'today') {
                    if (!isSameDay(cDate, today)) return false;
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
                const matchAmount = String(c.amount).includes(term.replace(/[₹,\s]/g, ''));
                if (!matchCustomer && !matchChequeNo && !matchBank && !matchRemarks && !matchAmount) {
                    return false;
                }
            }

            return true;
        });
        return sortCheques(list);
    }, [chequesWithComputedStatus, selectedCrm, selectedCustomer, bankFilter, stateFilter, dateRangeFilter, searchTerm, customerById, users, today]);

    const filteredAmount = useMemo(() => filteredCheques.reduce((sum, c) => sum + c.amount, 0), [filteredCheques]);

    /** Below `md` the table becomes a list of cheque cards; the filter
        selects fold away behind one button. */
    const isPhone = useIsPhone();
    const [phoneFiltersOpen, setPhoneFiltersOpen] = useState(false);
    /** Fifty at a time, on a phone and a laptop alike; the register was 150 rows and eleven screens. */
    const [visibleCount, setVisibleCount] = useState(PAGE);
    useEffect(() => { setVisibleCount(PAGE); }, [selectedCrm, selectedCustomer, bankFilter, stateFilter, dateRangeFilter, searchTerm]);
    /** Selecting rows then filtering them away would act on cheques nobody can
        see, so the selection is trimmed to whatever is currently listed. */
    const visibleIds = useMemo(() => new Set(filteredCheques.map(c => c.id)), [filteredCheques]);
    const selected = useMemo(() => selectedIds.filter(id => visibleIds.has(id)), [selectedIds, visibleIds]);
    const allSelected = selected.length > 0 && selected.length === filteredCheques.length;
    const toggleRow = (id: string) =>
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    const toggleAll = (checked: boolean) =>
        setSelectedIds(checked ? filteredCheques.map(c => c.id) : []);
    const applyBulk = (status: PdcStatus) => {
        if (!onBulkPdcStatus || selected.length === 0) return;
        onBulkPdcStatus(selected, status);
        setSelectedIds([]);
    };

    /** The rows a delete is about, for the question that names them. */
    const chequesToDelete = useMemo(
        () => (confirmDelete ? confirmDelete.ids.map(id => chequesWithComputedStatus.find(c => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c) : []),
        [confirmDelete, chequesWithComputedStatus],
    );
    const runDelete = () => {
        if (!confirmDelete) return;
        const ids = confirmDelete.ids;
        setConfirmDelete(null);
        if (ids.length === 1) onDeletePdc(ids[0]);
        else if (onBulkDeletePdc) onBulkDeletePdc(ids);
        setSelectedIds(prev => prev.filter(id => !ids.includes(id)));
    };

    // Export to Excel / CSV
    const handleExport = () => {
        if (XLSX) {
            const dataToExport = filteredCheques.map(c => {
                const customer = customerById.get(c.customerId);
                const crmUser = users.find(u => u.id === (customer?.crmOwnerId || c.crmOwnerId));
                return {
                    'Customer Name': c.customerName,
                    'Cheque Number': c.chequeNumber,
                    'Bank Name': c.bankName,
                    'Cheque Date': c.chequeDate.toLocaleDateString('en-GB'),
                    'Amount (₹)': c.amount,
                    'Status': c.status,
                    'Where it stands': CHEQUE_STATES[c.state].label,
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
        setStateFilter('all');
        setBankFilter('all');
        setDateRangeFilter('all');
    };

    const hasActiveFilters = searchTerm !== '' || selectedCustomer !== 'all' || selectedCrm !== 'all' || stateFilter !== 'all' || bankFilter !== 'all' || dateRangeFilter !== 'all';
    const filteredCustomer = selectedCustomer !== 'all' ? customerById.get(selectedCustomer) : undefined;
    const ownerName = (id?: string) => (id ? (findOwner(users, id)?.name || id) : '');

    /**
     * The one or two things worth doing to a cheque where it stands. A cheque
     * in hand can be cleared, held or bounced; one on hold can be released;
     * a bounced one can be re-presented; a cleared one can only be un-cleared
     * — a mistake, so it is quiet. Three toggles on every row, with "Clear"
     * lit green on the ninety cleared ones, hid the six that mattered.
     */
    const RowActions = ({ cheque, phone = false }: { cheque: PdcCheque & { state: ChequeState }; phone?: boolean }) => {
        const size = phone ? 'h-10 px-3 text-[13px]' : 'h-8 px-2.5 text-[12.5px]';
        const btn = (label: string, status: PdcStatus, title: string, tone: 'pos' | 'warn' | 'dang' | 'quiet') => (
            <button
                key={label}
                type="button"
                onClick={() => onUpdatePdcStatus(cheque.id, status)}
                title={title}
                className={`${size} rounded-lg font-bold whitespace-nowrap transition-colors ${
                    tone === 'pos' ? 'bg-accent text-on-accent hover:bg-accent-press shadow-2xs'
                    : tone === 'warn' ? 'text-label-2 hover:bg-warn-bg hover:text-warn'
                    : tone === 'dang' ? 'text-label-2 hover:bg-dang-bg hover:text-dang'
                    : 'text-label-2 hover:bg-hover hover:text-label'
                }`}
            >
                {label}
            </button>
        );
        const group = (children: React.ReactNode) => (
            <div className={`inline-flex items-center gap-0.5 bg-card-2 p-0.5 rounded-xl ${phone ? 'flex-1 [&>button]:flex-1' : ''}`}>{children}</div>
        );
        switch (cheque.state) {
            case 'due': case 'overdue': case 'upcoming':
                return group([
                    btn('Clear', PdcStatus.Cleared, 'Mark cleared — the bank paid it', 'pos'),
                    btn('Hold', PdcStatus.Hold, 'Put on hold — do not present it for now', 'warn'),
                    btn('Bounce', PdcStatus.Bounced, 'Mark bounced — returned unpaid', 'dang'),
                ]);
            case 'hold':
                return group([
                    btn('Clear', PdcStatus.Cleared, 'Mark cleared — the bank paid it', 'pos'),
                    btn('Release', PdcStatus.Pending, 'Back to pending — present it when it is due', 'quiet'),
                    btn('Bounce', PdcStatus.Bounced, 'Mark bounced — returned unpaid', 'dang'),
                ]);
            case 'bounced':
                return group([
                    btn('Clear', PdcStatus.Cleared, 'Mark cleared — re-presented and paid', 'pos'),
                    btn('Back to pending', PdcStatus.Pending, 'Not bounced after all — back in hand, waiting for its date', 'quiet'),
                ]);
            case 'cleared':
                return group([
                    btn('Undo', PdcStatus.Pending, 'Not cleared after all — back in hand, waiting for its date', 'quiet'),
                ]);
        }
    };

    const stateStrip = (
        /* Where the register stands, in one row. Every cell is the filter it
           names: press it and the list is that list; press it again for all.
           The six cards this replaces filled the first screen at 1366×768 and
           the sixth of them wrapped to a row of its own. */
        <div className="bg-card rounded-[16px] shadow-e1 px-4 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-2 gap-y-2 items-start max-md:flex max-md:overflow-x-auto max-md:snap-x max-md:[scrollbar-width:none] max-md:[&>button]:min-w-[132px] max-md:[&>button]:snap-start">
                <button
                    type="button"
                    onClick={() => setStateFilter(stateFilter === 'active' ? 'all' : 'active')}
                    aria-pressed={stateFilter === 'active'}
                    title="Every cheque still with us — dated today, date passed, upcoming or on hold"
                    className={`text-left rounded-[12px] px-2.5 py-1.5 min-w-0 transition-colors ${stateFilter === 'active' ? 'bg-accent-tint ring-2 ring-accent' : 'hover:bg-hover'}`}
                >
                    <span className="block text-[11.5px] font-bold uppercase tracking-wider text-label-3">In hand</span>
                    <span className="num block text-[19px] font-semibold text-label leading-tight mt-0.5">{inHand.count}</span>
                    <span className="block text-[12px] text-label-3 mt-0.5 truncate" title={formatINR(inHand.amount)}>{formatCompact(inHand.amount)}</span>
                </button>
                {CHEQUE_STATE_ORDER.map(state => {
                    const m = metricsByState[state];
                    const s = CHEQUE_STATES[state];
                    const attention = (state === 'overdue' || state === 'due' || state === 'bounced') && m.count > 0;
                    return (
                        <button
                            key={state}
                            type="button"
                            onClick={() => setStateFilter(stateFilter === state ? 'all' : state)}
                            aria-pressed={stateFilter === state}
                            title={`${s.hint}. Press to list them.`}
                            className={`text-left rounded-[12px] px-2.5 py-1.5 min-w-0 transition-colors ${stateFilter === state ? 'bg-accent-tint ring-2 ring-accent' : 'hover:bg-hover'}`}
                        >
                            <span className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-label-3 whitespace-nowrap">
                                <span className="w-2 h-2 rounded-full flex-none" style={{ background: s.dot }} aria-hidden="true" />
                                {s.label}
                            </span>
                            <span className={`num block text-[19px] font-semibold leading-tight mt-0.5 ${attention ? 'text-dang' : m.count === 0 ? 'text-label-3' : 'text-label'}`}>{m.count}</span>
                            <span className="block text-[12px] text-label-3 mt-0.5 truncate" title={formatINR(m.amount)}>{m.count > 0 ? formatCompact(m.amount) : '—'}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );

    return (
        <div className="space-y-3">
            {/* The controls, in the order and words of the customer book and Reports. */}
            <div className="bg-card rounded-[16px] shadow-e1 px-5 py-4 flex flex-col xl:flex-row xl:items-end justify-between gap-3 max-md:px-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.4fr)_minmax(150px,1fr)_minmax(150px,1fr)_minmax(150px,1fr)] gap-2 items-end flex-1">
                    <div className="sm:col-span-2 lg:col-span-1">
                        <label htmlFor="pdcSearch" className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">Find a cheque</label>
                        <div className="relative">
                            <input
                                id="pdcSearch"
                                type="text"
                                placeholder="Customer, cheque number, bank, amount, note…"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full h-9 pl-8 pr-8 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[13px] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/40 max-md:h-11"
                            />
                            <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400 max-md:top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            {searchTerm && (
                                <button type="button" onClick={() => setSearchTerm('')} className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600 text-sm font-bold max-md:top-2.5" aria-label="Clear search">✕</button>
                            )}
                        </div>
                    </div>
                    {/* Phone only: the selects below fold behind this. */}
                    <button
                        type="button"
                        onClick={() => setPhoneFiltersOpen(v => !v)}
                        aria-expanded={phoneFiltersOpen}
                        className="md:hidden h-11 rounded-xl border border-separator-strong bg-card text-[13.5px] font-semibold text-label-2 flex items-center justify-center gap-2"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                        {phoneFiltersOpen ? 'Hide filters' : 'Filters'}
                        {(selectedCrm !== 'all' || bankFilter !== 'all' || dateRangeFilter !== 'all') && (
                            <span className="num text-[11px] font-bold px-1.5 py-[2px] rounded-full bg-accent text-on-accent">
                                {[selectedCrm !== 'all', bankFilter !== 'all', dateRangeFilter !== 'all'].filter(Boolean).length}
                            </span>
                        )}
                    </button>
                    <div className={phoneFiltersOpen ? '' : 'max-md:hidden'}>
                        <label htmlFor="pdcCrm" className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">CRM owner</label>
                        <select
                            id="pdcCrm"
                            aria-label="Filter by CRM owner"
                            value={selectedCrm}
                            onChange={(e) => setSelectedCrm(e.target.value)}
                            className="w-full h-9 px-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[13px] font-semibold text-gray-900 dark:text-white max-md:h-11"
                        >
                            <option value="all">{canViewAll ? 'All CRMs' : 'My CRMs'}</option>
                            {availableCrms.map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className={phoneFiltersOpen ? '' : 'max-md:hidden'}>
                        <label htmlFor="pdcBank" className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">Bank</label>
                        <select
                            id="pdcBank"
                            aria-label="Filter by bank"
                            value={bankFilter}
                            onChange={(e) => setBankFilter(e.target.value)}
                            className="w-full h-9 px-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[13px] font-semibold text-gray-900 dark:text-white max-md:h-11"
                        >
                            <option value="all">All banks ({bankList.length})</option>
                            {bankList.map(b => (
                                <option key={b} value={b}>{b}</option>
                            ))}
                        </select>
                    </div>
                    <div className={phoneFiltersOpen ? '' : 'max-md:hidden'}>
                        <label htmlFor="pdcWhen" className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">Cheque date</label>
                        <select
                            id="pdcWhen"
                            aria-label="Filter by cheque date"
                            value={dateRangeFilter}
                            onChange={(e) => setDateRangeFilter(e.target.value as DateRange)}
                            className="w-full h-9 px-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[13px] font-semibold text-gray-900 dark:text-white max-md:h-11"
                        >
                            {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-none max-md:[&>button]:flex-1 max-md:[&>button]:min-h-[44px]">
                    {canExport && (
                        <Button size="sm" variant="quiet" onClick={handleExport} title="Download the cheques listed below as Excel">
                            <DownloadIcon />
                            Excel
                        </Button>
                    )}
                    {canManagePdc && (
                        <Button size="sm" variant="primary" onClick={() => onAddPdc()} title="Record a cheque a customer has given">
                            + Record a cheque
                        </Button>
                    )}
                </div>
            </div>

            {stateStrip}

            {/* The register */}
            <div className="bg-card rounded-[16px] shadow-e1 overflow-hidden">
                <div className="px-3.5 py-2.5 bg-card-2 border-b border-separator flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-800 dark:text-gray-200">
                            {filteredCheques.length.toLocaleString('en-IN')} cheque{filteredCheques.length === 1 ? '' : 's'}
                        </span>
                        <span className="num text-label-3">· {formatINR(filteredAmount)}</span>
                        {stateFilter !== 'all' && (
                            <span className="text-label-3">
                                · {stateFilter === 'active' ? 'in hand' : CHEQUE_STATES[stateFilter].label.toLowerCase()}
                            </span>
                        )}
                        {filteredCustomer && (
                            <span className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-accent-tint text-accent text-[12px] font-semibold">
                                {filteredCustomer.company}
                                <button type="button" onClick={() => setSelectedCustomer('all')} className="w-5 h-5 grid place-items-center rounded-full hover:bg-accent-tint-2" aria-label="Show every customer's cheques">✕</button>
                            </span>
                        )}
                        {hasActiveFilters && (
                            <button type="button" onClick={handleClearFilters} className="text-[12.5px] text-dang font-bold hover:underline px-1">
                                Reset
                            </button>
                        )}
                    </div>
                    <span className="text-[12px] text-label-3 hidden sm:inline">
                        Sorted: in hand by date, then bounced, on hold, cleared
                    </span>
                </div>

                {canManagePdc && selected.length > 0 && (
                    <div className="px-3.5 py-2.5 bg-accent-tint border-b border-separator flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-label">
                            <span>{selected.length} cheque{selected.length === 1 ? '' : 's'} selected</span>
                            <button
                                type="button"
                                onClick={() => setSelectedIds([])}
                                className="px-2 py-1 min-h-[30px] rounded-md text-[12px] font-semibold text-label-2 hover:bg-hover"
                            >
                                Clear selection
                            </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <button onClick={() => applyBulk(PdcStatus.Cleared)} className="px-2.5 py-1.5 min-h-[32px] rounded-lg text-[12px] font-bold bg-accent hover:bg-accent-press text-on-accent" title="The bank paid them">
                                Mark cleared
                            </button>
                            <button onClick={() => applyBulk(PdcStatus.Hold)} className="px-2.5 py-1.5 min-h-[32px] rounded-lg text-[12px] font-bold bg-card hover:bg-hover text-label-2 border border-separator-strong" title="Do not present them for now">
                                Put on hold
                            </button>
                            <button onClick={() => applyBulk(PdcStatus.Bounced)} className="px-2.5 py-1.5 min-h-[32px] rounded-lg text-[12px] font-bold bg-card hover:bg-hover text-label-2 border border-separator-strong" title="Returned unpaid">
                                Mark bounced
                            </button>
                            <button onClick={() => applyBulk(PdcStatus.Pending)} className="px-2.5 py-1.5 min-h-[32px] rounded-lg text-[12px] font-bold bg-card hover:bg-hover text-label-2 border border-separator-strong" title="Back in hand, waiting for their dates">
                                Back to pending
                            </button>
                            {onBulkDeletePdc && (
                                <button
                                    onClick={() => setConfirmDelete({ ids: selected })}
                                    className="px-2.5 py-1.5 min-h-[32px] rounded-lg text-[12px] font-bold text-dang hover:bg-dang-bg border border-separator-strong"
                                >
                                    Delete…
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {loading && pdcCheques.length === 0 ? (
                    <div className="px-4 py-14 text-center text-label-3" role="status" aria-live="polite">
                        <ChequeIcon className="w-8 h-8 mx-auto text-label-4 animate-pulse" />
                        <p className="text-sm font-semibold mt-2">Loading the register…</p>
                    </div>
                ) : filteredCheques.length === 0 ? (
                    <div className="px-4 py-14 text-center text-label-3">
                        <ChequeIcon className="w-8 h-8 mx-auto text-label-4" />
                        {pdcCheques.length === 0 ? (
                            <>
                                <p className="text-sm font-bold text-label mt-2">No cheques recorded yet</p>
                                <p className="text-[12.5px] mt-1">When a customer gives a post-dated cheque, record it here and it will come up on its date.</p>
                            </>
                        ) : (
                            <>
                                <p className="text-sm font-bold text-label mt-2">No cheques match</p>
                                <p className="text-[12.5px] mt-1">Try another state or date, or press Reset.</p>
                            </>
                        )}
                        <div className="flex items-center justify-center gap-2 mt-4">
                            {hasActiveFilters && <Button size="sm" variant="quiet" onClick={handleClearFilters}>Reset filters</Button>}
                            {canManagePdc && <Button size="sm" variant={hasActiveFilters ? 'secondary' : 'primary'} onClick={() => onAddPdc()}>+ Record a cheque</Button>}
                        </div>
                    </div>
                ) : isPhone ? (
                    /* Phone: a card per cheque. The customer, the amount and the
                       state on top; the cheque itself under it; the actions for
                       where it stands, sized for a thumb. */
                    <div className="divide-y divide-separator">
                        {canManagePdc && (
                            <div className="px-3.5 py-2 flex items-center justify-end">
                                <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 min-h-[32px]">
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={e => toggleAll(e.target.checked)}
                                        aria-label="Select all cheques in view"
                                        className="w-5 h-5 rounded text-accent focus:ring-accent"
                                    />
                                    Select all
                                </label>
                            </div>
                        )}
                        {filteredCheques.slice(0, visibleCount).map(cheque => {
                            const customer = customerById.get(cheque.customerId);
                            const isSelected = selected.includes(cheque.id);
                            const notSaved = unsavedById.get(cheque.id);
                            return (
                                <div key={cheque.id} className={`px-3.5 py-3 border-l-[3px] ${CHEQUE_STATES[cheque.state].edge} ${isSelected ? 'bg-accent-tint/60' : ''}`}>
                                    <div className="flex gap-3">
                                        {canManagePdc && (
                                            <label className="flex-none pt-0.5">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleRow(cheque.id)}
                                                    aria-label={`Select cheque ${cheque.chequeNumber || ''} for ${cheque.customerName}`}
                                                    className="w-5 h-5 rounded text-accent focus:ring-accent"
                                                />
                                            </label>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    {customer && onOpenCustomerFollowUp ? (
                                                        <button onClick={() => onOpenCustomerFollowUp(customer)} className="text-[15px] font-bold text-label text-left leading-snug break-words hover:text-accent">
                                                            {cheque.customerName}
                                                        </button>
                                                    ) : (
                                                        <span className="text-[15px] font-bold text-label leading-snug break-words">{cheque.customerName}</span>
                                                    )}
                                                    <p className="text-[12.5px] text-label-3 mt-1">
                                                        <span className="font-mono">#{cheque.chequeNumber}</span> · {cheque.bankName}
                                                    </p>
                                                </div>
                                                <div className="text-right flex-none">
                                                    <p className="num text-[15.5px] font-extrabold text-label">{formatINR(cheque.amount)}</p>
                                                    <ChequeStateBadge state={cheque.state} className="mt-1" />
                                                </div>
                                            </div>
                                            <p className="text-[12.5px] text-label-2 mt-1.5">
                                                Dated <span className={`font-semibold ${cheque.state === 'overdue' ? 'text-dang' : cheque.state === 'due' ? 'text-warn' : ''}`}>{chequeWhen(cheque.chequeDate, today)}</span>
                                                {customer ? ` · O/S ${formatCompact(customer.total)}` : ''}
                                                {ownerName(customer?.crmOwnerId || cheque.crmOwnerId) ? ` · ${ownerName(customer?.crmOwnerId || cheque.crmOwnerId)}` : ''}
                                            </p>
                                            {cheque.remarks && (
                                                <p className="text-[12px] text-label-3 italic mt-1 truncate">“{cheque.remarks}”</p>
                                            )}
                                            {notSaved && (
                                                <p className="text-[12px] font-semibold text-dang mt-1" title={notSaved}>Not saved · will be retried</p>
                                            )}
                                            {canManagePdc && (
                                                <div className="flex items-center gap-2 mt-2.5">
                                                    <RowActions cheque={cheque} phone />
                                                    <button
                                                        onClick={() => onEditPdc(cheque)}
                                                        className="w-11 h-11 grid place-items-center rounded-full text-label-3 active:bg-accent-tint"
                                                        aria-label={`Edit cheque ${cheque.chequeNumber}`}
                                                    >
                                                        <EditIcon />
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmDelete({ ids: [cheque.id] })}
                                                        className="w-11 h-11 grid place-items-center rounded-full text-label-3 active:text-dang active:bg-dang-bg"
                                                        aria-label={`Delete cheque ${cheque.chequeNumber}`}
                                                    >
                                                        <TrashIcon />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {visibleCount < filteredCheques.length && (
                            <div className="p-3">
                                <button
                                    onClick={() => setVisibleCount(c => c + PAGE * 2)}
                                    className="w-full h-11 rounded-xl bg-card-2 active:bg-hover text-[14px] font-semibold text-label-2"
                                >
                                    Show more &mdash; {(filteredCheques.length - visibleCount).toLocaleString('en-IN')} left
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-card-2 text-[11.5px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-separator">
                            <tr>
                                {canManagePdc && (
                                    <th className="px-2.5 py-2.5 w-10 text-center">
                                        <label className="inline-flex items-center justify-center p-2 -m-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={allSelected}
                                                onChange={e => toggleAll(e.target.checked)}
                                                aria-label="Select all cheques in view"
                                                title="Select all cheques in view"
                                                className="w-4 h-4 rounded text-pos focus:ring-accent cursor-pointer"
                                                style={{ outlineOffset: 6 }}
                                            />
                                        </label>
                                    </th>
                                )}
                                <th className="px-3 py-2.5 min-w-[170px]">Customer</th>
                                <th className="px-2.5 py-2.5">Cheque</th>
                                <th className="px-2.5 py-2.5 text-right">Amount</th>
                                <th className="px-2.5 py-2.5" title="Where the cheque stands today, from its date and what has been decided about it">Status · dated</th>
                                <th className="px-2.5 py-2.5 hidden xl:table-cell">CRM owner</th>
                                {canManagePdc && <th className="px-2.5 py-2.5 text-right">Actions</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-separator">
                            {filteredCheques.slice(0, visibleCount).map(cheque => {
                                const customer = customerById.get(cheque.customerId);
                                const notSaved = unsavedById.get(cheque.id);
                                return (
                                    <tr
                                        key={cheque.id}
                                        className={`group border-l-[3px] ${CHEQUE_STATES[cheque.state].edge} transition-colors ${selected.includes(cheque.id) ? 'bg-accent-tint/60' : 'hover:bg-hover'}`}
                                    >
                                        {canManagePdc && (
                                            <td className="px-2.5 py-2 text-center">
                                                <label className="inline-flex items-center justify-center p-2 -m-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={selected.includes(cheque.id)}
                                                        onChange={() => toggleRow(cheque.id)}
                                                        aria-label={`Select cheque ${cheque.chequeNumber || ''} for ${cheque.customerName}`}
                                                        className="w-4 h-4 rounded text-pos focus:ring-accent cursor-pointer"
                                                        style={{ outlineOffset: 6 }}
                                                    />
                                                </label>
                                            </td>
                                        )}
                                        {/* Customer: the name opens the account, the way it does in the book. */}
                                        <td className="px-3 py-2 min-w-[170px] max-w-[240px]">
                                            {customer && onOpenCustomerFollowUp ? (
                                                <button
                                                    onClick={() => onOpenCustomerFollowUp(customer)}
                                                    className="font-bold text-label hover:text-accent text-left truncate max-w-full block min-h-[24px]"
                                                    title="Open this account: log the call, see the other cheques"
                                                >
                                                    {cheque.customerName}
                                                </button>
                                            ) : (
                                                <span className="font-bold text-label truncate max-w-full block">{cheque.customerName}</span>
                                            )}
                                            <span className="block text-[12px] text-label-3 truncate">
                                                {customer ? `O/S ${formatCompact(customer.total)}` : 'Not in the book'}
                                                {notSaved && <span className="ml-1.5 font-semibold text-dang" title={notSaved}>· Not saved, retrying</span>}
                                            </span>
                                        </td>

                                        {/* The cheque itself */}
                                        <td className="px-2.5 py-2">
                                            <span className="block font-mono text-[12.5px] font-bold text-label">#{cheque.chequeNumber}</span>
                                            <span className="block text-[12px] text-label-3 truncate max-w-[150px] xl:max-w-[200px]" title={cheque.remarks ? `${cheque.bankName} — ${cheque.remarks}` : cheque.bankName}>
                                                {cheque.bankName}{cheque.remarks ? ` · ${cheque.remarks}` : ''}
                                            </span>
                                        </td>

                                        {/* Amount */}
                                        <td className="px-2.5 py-2 whitespace-nowrap text-right">
                                            <span className="num text-[13.5px] font-extrabold text-label">{formatINR(cheque.amount)}</span>
                                        </td>

                                        {/* Where it stands, and when */}
                                        <td className="px-2.5 py-2 whitespace-nowrap">
                                            <ChequeStateBadge state={cheque.state} />
                                            <span
                                                className={`block text-[12px] mt-0.5 ${cheque.state === 'overdue' ? 'text-dang font-bold' : cheque.state === 'due' ? 'text-warn font-bold' : 'text-label-3'}`}
                                                title={cheque.chequeDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                                            >
                                                {cheque.state === 'cleared' ? cheque.chequeDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : chequeWhen(cheque.chequeDate, today)}
                                            </span>
                                        </td>

                                        {/* CRM owner */}
                                        <td className="px-2.5 py-2 whitespace-nowrap hidden xl:table-cell">
                                            <span className="block text-[12.5px] font-semibold text-label-2 truncate max-w-[110px]">
                                                {ownerName(customer?.crmOwnerId || cheque.crmOwnerId) || 'Unassigned'}
                                            </span>
                                            {cheque.addedBy && (
                                                <span className="block text-label-3 text-[11.5px] truncate max-w-[110px]">added by {cheque.addedBy}</span>
                                            )}
                                        </td>

                                        {/* Actions: what can be done where it stands; delete only on hover or focus */}
                                        {canManagePdc && (
                                            <td className="px-2.5 py-2 whitespace-nowrap text-right">
                                                <div className="inline-flex items-center justify-end gap-1">
                                                    <RowActions cheque={cheque} />
                                                    <button
                                                        onClick={() => onEditPdc(cheque)}
                                                        className="w-8 h-8 grid place-items-center text-label-3 hover:text-accent hover:bg-accent-tint rounded-full transition-colors"
                                                        title="Edit the cheque's details"
                                                        aria-label={`Edit cheque ${cheque.chequeNumber}`}
                                                    >
                                                        <EditIcon />
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmDelete({ ids: [cheque.id] })}
                                                        className="w-8 h-8 grid place-items-center text-label-3 hover:text-dang hover:bg-dang-bg rounded-full transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 group-focus-within:opacity-100"
                                                        title="Delete this cheque…"
                                                        aria-label={`Delete cheque ${cheque.chequeNumber}`}
                                                    >
                                                        <TrashIcon />
                                                    </button>
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {visibleCount < filteredCheques.length && (
                        <div className="p-3 border-t border-separator flex justify-center">
                            <button
                                type="button"
                                onClick={() => setVisibleCount(c => c + PAGE * 2)}
                                className="h-9 px-5 rounded-xl bg-card-2 hover:bg-hover text-[13px] font-semibold text-label-2"
                            >
                                Show more &mdash; {(filteredCheques.length - visibleCount).toLocaleString('en-IN')} left
                            </button>
                        </div>
                    )}
                </div>
                )}
            </div>

            <ConfirmDialog
                open={!!confirmDelete}
                title={chequesToDelete.length === 1 ? 'Delete this cheque?' : `Delete ${chequesToDelete.length} cheques?`}
                confirmLabel={chequesToDelete.length === 1 ? 'Delete cheque' : `Delete ${chequesToDelete.length} cheques`}
                onConfirm={runDelete}
                onCancel={() => setConfirmDelete(null)}
            >
                {chequesToDelete.length === 1 && chequesToDelete[0] ? (
                    <p>
                        <strong className="text-label">#{chequesToDelete[0].chequeNumber}</strong> · {chequesToDelete[0].bankName} · <span className="num font-semibold text-label">{formatINR(chequesToDelete[0].amount)}</span> · dated {chequesToDelete[0].chequeDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {chequesToDelete[0].customerName}.
                    </p>
                ) : (
                    <p>
                        <span className="num font-semibold text-label">{formatINR(chequesToDelete.reduce((s, c) => s + c.amount, 0))}</span> across {chequesToDelete.length} cheques
                        {chequesToDelete.length > 0 ? ` (${chequesToDelete.slice(0, 3).map(c => `#${c.chequeNumber}`).join(', ')}${chequesToDelete.length > 3 ? ', …' : ''})` : ''}.
                    </p>
                )}
                <p className="mt-2">It leaves the register for everyone and cannot be undone. A cheque that was returned should be marked <strong>bounced</strong>, not deleted, so the record stays.</p>
            </ConfirmDialog>
        </div>
    );
};

export default PdcChequesView;
