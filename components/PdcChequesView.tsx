import React, { useState, useMemo, useEffect } from 'react';
import { useIsPhone } from './ui/usePhone';
import { loadXlsx } from '../services/excel';
import { Outstanding, PdcCheque, PdcStatus, User, UserRole, can, seesWholeBook, scopeTo, chequeState, ChequeState, findOwner, ownerKey } from '../types';
import { ChequeIcon, DownloadIcon, EditIcon, TrashIcon } from './icons/Icons';
import { Button, cx } from './ui/Primitives';
import { formatCompact, formatINR, formatDate, relativeDays } from './ui/format';
import { CHEQUE_STATES, ChequeStateBadge, sortCheques } from './ui/ChequeState';
import { ConfirmDialog } from './ui/ConfirmDialog';
import type { SyncFailure } from '../services/useSupabaseSync';

/**
 * The register as it was first built: one list of every cheque, six tiles
 * across the top saying where the register stands, each of them the filter
 * it names, a status on every row and the actions that fit that status
 * beside it. What that first version got wrong is fixed here — a tile's
 * count is exactly the rows it lists, a cleared cheque carries no Clear
 * button, one word per state everywhere — and the engineering that came
 * after it (fifty rows at a time, the named delete question, the refused
 * save said on the row, the phone layout, the account link) stays.
 */
export type ChequeStateFilter = 'all' | ChequeState;

/** The tiles, in the order a cheque moves through them: what is due, what has slipped, what waits, what is held, what came back, what is done. */
export const TILE_ORDER: ChequeState[] = ['due', 'overdue', 'upcoming', 'hold', 'bounced', 'cleared'];
/** The states whose count goes red when it is not zero. */
const ALARM = new Set<ChequeState>(['due', 'overdue', 'bounced']);

/** The names Today and the account dialog send, mapped to the tile they mean. */
export const normaliseStateFilter = (value?: string | null): ChequeStateFilter => {
    switch (value) {
        case 'today': case 'due': return 'due';
        case 'overdue': return 'overdue';
        case PdcStatus.Pending: case 'upcoming': return 'upcoming';
        case PdcStatus.Hold: case 'hold': return 'hold';
        case PdcStatus.Cleared: case 'cleared': return 'cleared';
        case PdcStatus.Bounced: case 'bounced': return 'bounced';
        default: return 'all';
    }
};

type DateRange = 'all' | 'today' | 'this_week' | 'this_month';
const DATE_RANGES: { value: DateRange; label: string }[] = [
    { value: 'all', label: 'Any date' },
    { value: 'today', label: 'Dated today' },
    { value: 'this_week', label: 'This week' },
    { value: 'this_month', label: 'This month' },
];

/** What can be done to a cheque where it stands — and nothing that cannot. */
type RowAction = { label: string; status: PdcStatus; title: string; tone: 'pos' | 'warn' | 'dang' | 'quiet' };
export const actionsFor = (state: ChequeState): RowAction[] => {
    const clear: RowAction = { label: 'Clear', status: PdcStatus.Cleared, title: 'Mark cleared — the bank paid it', tone: 'pos' };
    const hold: RowAction = { label: 'Hold', status: PdcStatus.Hold, title: 'Put on hold — do not present it for now', tone: 'warn' };
    const bounce: RowAction = { label: 'Bounce', status: PdcStatus.Bounced, title: 'Mark bounced — returned unpaid by the bank', tone: 'dang' };
    switch (state) {
        case 'due': case 'overdue': case 'upcoming': return [clear, hold, bounce];
        case 'hold': return [clear, { label: 'Release', status: PdcStatus.Pending, title: 'Release the hold — back in hand, present it when it is due', tone: 'quiet' }, bounce];
        case 'bounced': return [{ ...clear, title: 'Mark cleared — re-presented and paid' }, { label: 'Back in hand', status: PdcStatus.Pending, title: 'Not bounced after all — back in hand, waiting for its date', tone: 'quiet' }];
        case 'cleared': return [{ label: 'Undo', status: PdcStatus.Pending, title: 'Not cleared after all — back in hand, waiting for its date', tone: 'quiet' }];
    }
};

/** "today", "in 4 days", "3 days ago" — under the date, only while the cheque is still in hand and the badge does not already say it. */
export const datedNote = (state: ChequeState, date: Date): string => {
    if (state === 'cleared' || state === 'bounced' || state === 'due') return '';
    return relativeDays(date)?.text ?? '';
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

const PAGE = 50;
const SELECT = 'w-full h-9 px-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[13px] font-semibold text-gray-900 dark:text-white max-md:h-11';
const LABEL = 'block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5';

type Row = PdcCheque & { state: ChequeState; chequeDate: Date };

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
    const [stateFilter, setStateFilter] = useState<ChequeStateFilter>(() => normaliseStateFilter(initialStatusFilter));
    const [bankFilter, setBankFilter] = useState<string>('all');
    const [dateRange, setDateRange] = useState<DateRange>('all');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    /** What is about to be deleted, named, until the person says so. */
    const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);
    useEffect(() => { setSelectedCustomer(initialCustomerFilter || 'all'); setStateFilter(normaliseStateFilter(initialStatusFilter)); }, [initialStatusFilter, initialCustomerFilter]);

    const today = useMemo(() => new Date(), []);

    // What this person may do to a cheque. Row Level Security enforces the same
    // rule, so a button we cannot honour is a button we do not show.
    const canManagePdc = can(currentUser, 'canManagePdc');
    const canExport = can(currentUser, 'canExportData');
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

    const normalizeDate = (d: any): Date => (d instanceof Date ? d : new Date(d));

    // Where each cheque stands today, worked out from its date every render.
    // chequeState() in types.ts is the only place that decision is made, so the
    // register, the dashboard badge and the morning email cannot disagree.
    const rows = useMemo<Row[]>(
        () => allowedCheques.map(c => ({ ...c, chequeDate: normalizeDate(c.chequeDate), state: chequeState({ ...c, chequeDate: normalizeDate(c.chequeDate) }, today) })),
        [allowedCheques, today],
    );

    const customerById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
    const unsavedById = useMemo(() => new Map(unsaved.map(f => [f.id, f.message])), [unsaved]);
    const bankList = useMemo(() => Array.from(new Set(pdcCheques.map(c => c.bankName).filter(Boolean))).sort(), [pdcCheques]);

    /**
     * The rows the search and the selects leave, before the tile is applied.
     * The tiles count these, so a tile's number is exactly what pressing it
     * lists — with a CRM chosen, the tiles say how many of that CRM's cheques
     * stand where, not the whole register's.
     */
    const narrowed = useMemo(() => rows.filter(c => {
        if (selectedCrm !== 'all') {
            const customer = customerById.get(c.customerId);
            const crmId = customer ? customer.crmOwnerId : c.crmOwnerId;
            // Compared through the roster: the dropdown holds a CRM code and the stored value may be either spelling.
            const canonical = findOwner(users, crmId)?.id || (crmId || '');
            if (ownerKey(canonical) !== ownerKey(selectedCrm)) return false;
        }
        if (selectedCustomer !== 'all' && c.customerId !== selectedCustomer) return false;
        if (bankFilter !== 'all' && c.bankName !== bankFilter) return false;
        if (dateRange !== 'all') {
            const d = c.chequeDate;
            const t = new Date(today); t.setHours(0, 0, 0, 0);
            if (dateRange === 'today') {
                if (d.getFullYear() !== t.getFullYear() || d.getMonth() !== t.getMonth() || d.getDate() !== t.getDate()) return false;
            } else if (dateRange === 'this_week') {
                const start = new Date(t); start.setDate(t.getDate() - t.getDay());
                const end = new Date(start); end.setDate(start.getDate() + 7);
                if (d < start || d >= end) return false;
            } else if (dateRange === 'this_month') {
                if (d.getMonth() !== t.getMonth() || d.getFullYear() !== t.getFullYear()) return false;
            }
        }
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            const hit = c.customerName.toLowerCase().includes(term)
                || c.chequeNumber.toLowerCase().includes(term)
                || c.bankName.toLowerCase().includes(term)
                || (c.remarks || '').toLowerCase().includes(term)
                || String(c.amount).includes(term.replace(/[₹,\s]/g, ''));
            if (!hit) return false;
        }
        return true;
    }), [rows, selectedCrm, selectedCustomer, bankFilter, dateRange, searchTerm, customerById, users, today]);

    /** Each tile's count and amount, from the narrowed rows. */
    const byState = useMemo(() => {
        const acc = {} as Record<ChequeState, { count: number; amount: number }>;
        for (const s of TILE_ORDER) acc[s] = { count: 0, amount: 0 };
        for (const c of narrowed) { acc[c.state].count++; acc[c.state].amount += c.amount; }
        return acc;
    }, [narrowed]);

    /** The list: the tile's rows, in the register's order — in hand by date, then bounced, on hold, cleared newest first. */
    const filtered = useMemo(() => sortCheques(stateFilter === 'all' ? narrowed : narrowed.filter(c => c.state === stateFilter)), [narrowed, stateFilter]);
    const filteredAmount = useMemo(() => filtered.reduce((s, c) => s + c.amount, 0), [filtered]);

    const isPhone = useIsPhone();
    const [phoneFiltersOpen, setPhoneFiltersOpen] = useState(false);
    /** Fifty at a time, on a phone and a laptop alike; the register was 150 rows and eleven screens. */
    const [visibleCount, setVisibleCount] = useState(PAGE);
    useEffect(() => { setVisibleCount(PAGE); }, [stateFilter, selectedCrm, selectedCustomer, bankFilter, dateRange, searchTerm]);

    /** Selecting rows then filtering them away would act on cheques nobody can see, so the selection is trimmed to what is listed. */
    const visibleIds = useMemo(() => new Set(filtered.map(c => c.id)), [filtered]);
    const selected = useMemo(() => selectedIds.filter(id => visibleIds.has(id)), [selectedIds, visibleIds]);
    const allSelected = selected.length > 0 && selected.length === filtered.length;
    const toggleRow = (id: string) => setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
    const toggleAll = (checked: boolean) => setSelectedIds(checked ? filtered.map(c => c.id) : []);
    const applyBulk = (status: PdcStatus) => {
        if (!onBulkPdcStatus || selected.length === 0) return;
        onBulkPdcStatus(selected, status);
        setSelectedIds([]);
    };

    /** The rows a delete is about, for the question that names them. */
    const chequesToDelete = useMemo(
        () => (confirmDelete ? confirmDelete.ids.map(id => rows.find(c => c.id === id)).filter((c): c is Row => !!c) : []),
        [confirmDelete, rows],
    );
    const runDelete = () => {
        if (!confirmDelete) return;
        const ids = confirmDelete.ids;
        setConfirmDelete(null);
        if (ids.length === 1) onDeletePdc(ids[0]);
        else if (onBulkDeletePdc) onBulkDeletePdc(ids);
        setSelectedIds(prev => prev.filter(id => !ids.includes(id)));
    };

    const handleExport = async () => {
        const XLSX = await loadXlsx();
        const dataToExport = filtered.map(c => {
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
                'Remarks': c.remarks || '',
            };
        });
        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'PDC Cheques');
        XLSX.writeFile(workbook, `PDC_Cheques_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const handleClearFilters = () => { setSearchTerm(''); setSelectedCustomer('all'); setSelectedCrm('all'); setStateFilter('all'); setBankFilter('all'); setDateRange('all'); };
    const selectsOn = [selectedCrm !== 'all', bankFilter !== 'all', dateRange !== 'all'].filter(Boolean).length;
    const hasActiveFilters = searchTerm !== '' || selectedCustomer !== 'all' || stateFilter !== 'all' || selectsOn > 0;
    const filteredCustomer = selectedCustomer !== 'all' ? customerById.get(selectedCustomer) : undefined;
    const ownerName = (id?: string) => (id ? (findOwner(users, id)?.name || id) : '');

    /** The buttons for where a cheque stands: Clear · Hold · Bounce in hand, Release on hold, Back in hand when bounced, a quiet Undo when cleared. */
    const rowActions = (c: Row, phone: boolean) => {
        const actions = actionsFor(c.state);
        const size = phone ? 'h-10 px-3 text-[13px] flex-1' : 'h-7 px-2 xl:px-2.5 text-[12px]';
        const tone = (t: RowAction['tone']) =>
            t === 'pos' ? 'text-pos hover:bg-pos-bg'
            : t === 'warn' ? 'text-label-2 hover:bg-warn-bg hover:text-warn'
            : t === 'dang' ? 'text-label-2 hover:bg-dang-bg hover:text-dang'
            : 'text-label-2 hover:bg-hover hover:text-label';
        if (c.state === 'cleared') {
            const undo = actions[0];
            return (
                <button type="button" onClick={() => onUpdatePdcStatus(c.id, undo.status)} title={undo.title} className={cx('rounded-md font-semibold text-label-3 hover:bg-hover hover:text-label transition-colors whitespace-nowrap', size)}>
                    {undo.label}
                </button>
            );
        }
        return (
            <div className={cx('inline-flex items-center gap-0.5 bg-card-2 rounded-lg p-0.5', phone && 'flex-1')} role="group" aria-label={`Cheque ${c.chequeNumber}`}>
                {actions.map(a => (
                    <button key={a.label} type="button" onClick={() => onUpdatePdcStatus(c.id, a.status)} title={a.title} className={cx('rounded-md font-bold transition-colors whitespace-nowrap', size, tone(a.tone))}>
                        {a.label}
                    </button>
                ))}
            </div>
        );
    };
    const editDelete = (c: Row, phone: boolean) => (
        <>
            <button type="button" onClick={() => onEditPdc(c)} className={cx('grid place-items-center rounded-full text-label-3 hover:text-accent hover:bg-accent-tint transition-colors', phone ? 'w-11 h-11' : 'w-7 h-7 xl:w-8 xl:h-8')} title="Edit the cheque's details" aria-label={`Edit cheque ${c.chequeNumber}`}>
                <EditIcon className="w-[18px] h-[18px]" />
            </button>
            <button type="button" onClick={() => setConfirmDelete({ ids: [c.id] })} className={cx('grid place-items-center rounded-full text-label-3 hover:text-dang hover:bg-dang-bg transition-colors', phone ? 'w-11 h-11' : 'w-7 h-7 xl:w-8 xl:h-8')} title="Delete this cheque…" aria-label={`Delete cheque ${c.chequeNumber}`}>
                <TrashIcon className="w-[18px] h-[18px]" />
            </button>
        </>
    );

    const emptyTitle = pdcCheques.length === 0 ? 'No cheques recorded yet'
        : stateFilter !== 'all' && searchTerm === '' && selectedCustomer === 'all' && selectsOn === 0
            ? { due: 'Nothing is due today', overdue: 'No cheque has passed its date', upcoming: 'Nothing is coming up', hold: 'Nothing is on hold', bounced: 'No bounced cheques', cleared: 'No cleared cheques yet' }[stateFilter]
            : 'No cheques match';

    const listHeading = `${filtered.length.toLocaleString('en-IN')}${filtered.length !== narrowed.length || stateFilter !== 'all' ? ` of ${narrowed.length.toLocaleString('en-IN')}` : ''} cheque${narrowed.length === 1 ? '' : 's'}${stateFilter !== 'all' ? ` · ${CHEQUE_STATES[stateFilter].label.toLowerCase()}` : ''}`;

    return (
        <div className="space-y-3">
            {/* ---------- where the register stands: six tiles, each the filter it names ---------- */}
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-2.5 max-md:gap-2" role="group" aria-label="Where the cheques stand">
                {TILE_ORDER.map(state => {
                    const m = byState[state];
                    const s = CHEQUE_STATES[state];
                    const on = stateFilter === state;
                    const alarm = ALARM.has(state) && m.count > 0;
                    return (
                        <button
                            key={state}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setStateFilter(on ? 'all' : state)}
                            title={`${s.hint}. Press to list them, again for every cheque.`}
                            className={cx('text-left bg-card rounded-[14px] px-3.5 py-2.5 max-md:px-3 max-md:py-2 min-w-0 transition-all duration-150 active:scale-[.99]', on ? 'shadow-e2 ring-2 ring-accent' : 'shadow-e1 ring-1 ring-separator hover:shadow-e2')}
                        >
                            <span className="flex items-center gap-1.5 min-w-0">
                                <span className="w-2 h-2 rounded-full flex-none max-md:hidden" style={{ background: s.dot }} aria-hidden="true" />
                                <span className="label truncate max-md:text-[11px]">{s.label}</span>
                            </span>
                            <span className={cx('num block text-[20px] max-md:text-[18px] font-semibold leading-none mt-1.5 tracking-[-0.02em]', alarm ? 'text-dang' : m.count === 0 ? 'text-label-3' : 'text-label')}>{m.count}</span>
                            <span className="num block text-[12px] text-label-3 mt-0.5 truncate" title={m.count ? formatINR(m.amount) : undefined}>{m.count ? formatCompact(m.amount) : '—'}</span>
                        </button>
                    );
                })}
            </div>

            {/* ---------- find, narrow, export, record ---------- */}
            <div className="bg-card rounded-[16px] shadow-e1 px-4 py-2.5 max-md:px-3.5 max-md:py-3 flex flex-col lg:flex-row lg:items-end justify-between gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1.5fr)_minmax(118px,1fr)_minmax(118px,1fr)_minmax(110px,1fr)] gap-2 items-end flex-1 min-w-0">
                    <div className="sm:col-span-2 lg:col-span-1 flex gap-2">
                        <div className="relative flex-1">
                            <label htmlFor="pdcSearch" className={cx(LABEL, 'max-md:sr-only')}>Find a cheque</label>
                            <input
                                id="pdcSearch"
                                type="search"
                                placeholder="Customer, cheque number, bank, amount, note…"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full h-9 pl-8 pr-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[13px] text-gray-900 dark:text-white focus:ring-2 focus:ring-accent/40 focus:outline-none max-md:h-11"
                            />
                            <svg className="absolute left-2.5 bottom-2.5 w-4 h-4 text-gray-400 max-md:bottom-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        </div>
                        {/* Phone only: the selects fold behind this. */}
                        <button
                            type="button"
                            onClick={() => setPhoneFiltersOpen(v => !v)}
                            aria-expanded={phoneFiltersOpen}
                            className="md:hidden h-11 px-3.5 rounded-xl border border-separator-strong bg-card text-[13.5px] font-semibold text-label-2 flex items-center justify-center gap-2 flex-none"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                            Filters
                            {selectsOn > 0 && <span className="num text-[11px] font-bold px-1.5 py-[2px] rounded-full bg-accent text-on-accent">{selectsOn}</span>}
                        </button>
                    </div>
                    <div className={phoneFiltersOpen ? '' : 'max-md:hidden'}>
                        <label htmlFor="pdcCrm" className={LABEL}>CRM owner</label>
                        <select id="pdcCrm" value={selectedCrm} onChange={e => setSelectedCrm(e.target.value)} className={SELECT}>
                            <option value="all">{canViewAll ? 'All CRMs' : 'My CRMs'}</option>
                            {availableCrms.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                    </div>
                    <div className={phoneFiltersOpen ? '' : 'max-md:hidden'}>
                        <label htmlFor="pdcBankFilter" className={LABEL}>Bank</label>
                        <select id="pdcBankFilter" value={bankFilter} onChange={e => setBankFilter(e.target.value)} className={SELECT}>
                            <option value="all">All banks ({bankList.length})</option>
                            {bankList.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    </div>
                    <div className={phoneFiltersOpen ? '' : 'max-md:hidden'}>
                        <label htmlFor="pdcWhen" className={LABEL}>Cheque date</label>
                        <select id="pdcWhen" value={dateRange} onChange={e => setDateRange(e.target.value as DateRange)} className={SELECT}>
                            {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-none max-md:[&>button]:flex-1 max-md:[&>button]:min-h-[44px]">
                    {canExport && (
                        <Button size="sm" variant="quiet" onClick={handleExport} title="Download the cheques listed below as Excel" className="max-md:hidden">
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

            {/* ---------- the register ---------- */}
            <div className="bg-card rounded-[16px] shadow-e1 overflow-hidden">
                <div className="px-4 py-2 max-md:px-3.5 bg-card-2 border-b border-separator flex flex-wrap items-center justify-between gap-x-3 gap-y-2 min-h-[42px]">
                    <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                        <span className="font-bold text-label">{listHeading}</span>
                        {filteredCustomer && (
                            <span className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-accent-tint text-accent text-[12px] font-semibold">
                                {filteredCustomer.company}
                                <button type="button" onClick={() => setSelectedCustomer('all')} className="w-5 h-5 grid place-items-center rounded-full hover:bg-accent-tint-2" aria-label="Show every customer's cheques">✕</button>
                            </span>
                        )}
                        {hasActiveFilters && (
                            <button type="button" onClick={handleClearFilters} className="text-[12.5px] text-accent font-bold hover:underline px-1">Show all</button>
                        )}
                    </div>
                    {selected.length > 0 && canManagePdc ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[12.5px] font-bold text-label mr-1">{selected.length} selected</span>
                            <Button size="sm" variant="primary" onClick={() => applyBulk(PdcStatus.Cleared)} title="The bank paid them">Mark cleared</Button>
                            <Button size="sm" variant="quiet" onClick={() => applyBulk(PdcStatus.Hold)} title="Do not present them for now">Put on hold</Button>
                            <Button size="sm" variant="quiet" onClick={() => applyBulk(PdcStatus.Bounced)} title="Returned unpaid">Mark bounced</Button>
                            <Button size="sm" variant="quiet" onClick={() => applyBulk(PdcStatus.Pending)} title="Back in hand, waiting for their dates">Back in hand</Button>
                            {onBulkDeletePdc && <Button size="sm" variant="ghost" className="text-dang" onClick={() => setConfirmDelete({ ids: selected })}>Delete…</Button>}
                            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>Clear selection</Button>
                        </div>
                    ) : (
                        <span className="num text-[12.5px] font-semibold text-label-2" title="The amount of the cheques listed">Total {formatINR(filteredAmount)}</span>
                    )}
                </div>

                {loading && pdcCheques.length === 0 ? (
                    <div className="px-4 py-14 text-center text-label-3" role="status" aria-live="polite">
                        <ChequeIcon className="w-8 h-8 mx-auto text-label-4 animate-pulse" />
                        <p className="text-sm font-semibold mt-2">Loading the register…</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="px-4 py-12 text-center text-label-3">
                        <ChequeIcon className="w-8 h-8 mx-auto text-label-4" />
                        <p className="text-sm font-bold text-label mt-2">{emptyTitle}</p>
                        <p className="text-[12.5px] mt-1">
                            {pdcCheques.length === 0 ? 'When a customer gives a post-dated cheque, record it here and it will come up on its date.'
                                : hasActiveFilters ? 'Press Show all for the whole register.' : ''}
                        </p>
                        <div className="flex items-center justify-center gap-2 mt-4">
                            {hasActiveFilters && <Button size="sm" variant="quiet" onClick={handleClearFilters}>Show all cheques</Button>}
                            {canManagePdc && pdcCheques.length === 0 && <Button size="sm" variant="primary" onClick={() => onAddPdc()}>+ Record a cheque</Button>}
                        </div>
                    </div>
                ) : isPhone ? (
                    /* Phone: a card per cheque — the customer, the amount and the status on top, the cheque under it, the actions for where it stands sized for a thumb. */
                    <div className="divide-y divide-separator">
                        {canManagePdc && (
                            <div className="px-3.5 py-2 flex items-center justify-end">
                                <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-label-2 min-h-[32px]">
                                    <input type="checkbox" checked={allSelected} onChange={e => toggleAll(e.target.checked)} aria-label="Select all cheques in view" className="w-5 h-5 rounded text-accent focus:ring-accent" />
                                    Select all
                                </label>
                            </div>
                        )}
                        {filtered.slice(0, visibleCount).map(c => {
                            const customer = customerById.get(c.customerId);
                            const notSaved = unsavedById.get(c.id);
                            const done = c.state === 'cleared';
                            const note = datedNote(c.state, c.chequeDate);
                            return (
                                <div key={c.id} className={cx('px-3.5 py-3', selected.includes(c.id) && 'bg-accent-tint/60')}>
                                    <div className="flex gap-3">
                                        {canManagePdc && (
                                            <label className="flex-none pt-0.5">
                                                <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleRow(c.id)} aria-label={`Select cheque ${c.chequeNumber || ''} for ${c.customerName}`} className="w-5 h-5 rounded text-accent focus:ring-accent" />
                                            </label>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    {customer && onOpenCustomerFollowUp ? (
                                                        <button type="button" onClick={() => onOpenCustomerFollowUp(customer)} className={cx('text-[15px] leading-snug text-left break-words hover:text-accent', done ? 'font-semibold text-label-2' : 'font-bold text-label')}>
                                                            {c.customerName}
                                                        </button>
                                                    ) : (
                                                        <span className={cx('text-[15px] leading-snug break-words', done ? 'font-semibold text-label-2' : 'font-bold text-label')}>{c.customerName}</span>
                                                    )}
                                                    <p className="text-[12.5px] text-label-3 mt-0.5"><span className="font-mono">#{c.chequeNumber}</span> · {c.bankName}</p>
                                                </div>
                                                <div className="text-right flex-none">
                                                    <p className={cx('num text-[15.5px]', done ? 'font-semibold text-label-2' : 'font-extrabold text-label')}>{formatINR(c.amount)}</p>
                                                    <ChequeStateBadge state={c.state} className="mt-1" />
                                                </div>
                                            </div>
                                            <p className="text-[12.5px] text-label-2 mt-1.5">
                                                Dated <span className={cx('font-semibold', c.state === 'overdue' && 'text-dang')}>{formatDate(c.chequeDate)}</span>
                                                {note ? <span className={c.state === 'overdue' ? 'text-dang' : 'text-label-3'}> · {note}</span> : ''}
                                                {customer ? <span className="text-label-3"> · O/S {formatCompact(customer.total)}</span> : ''}
                                            </p>
                                            {c.remarks && <p className="text-[12px] text-label-3 italic mt-1 truncate">“{c.remarks}”</p>}
                                            {notSaved && <p className="text-[12px] font-semibold text-dang mt-1" title={notSaved}>Not saved · will be retried</p>}
                                            {canManagePdc && (
                                                <div className="flex items-center gap-2 mt-2.5">
                                                    {rowActions(c, true)}
                                                    {editDelete(c, true)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {visibleCount < filtered.length && (
                            <div className="p-3">
                                <button type="button" onClick={() => setVisibleCount(n => n + PAGE * 2)} className="w-full h-11 rounded-xl bg-card-2 active:bg-hover text-[14px] font-semibold text-label-2">
                                    Show more — {(filtered.length - visibleCount).toLocaleString('en-IN')} left
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
                                        <th className="px-3 py-2.5 w-10 text-center">
                                            <input type="checkbox" checked={allSelected} onChange={e => toggleAll(e.target.checked)} aria-label="Select all cheques in view" title="Select all cheques in view" className="w-4 h-4 rounded text-pos focus:ring-accent cursor-pointer" />
                                        </th>
                                    )}
                                    <th className="px-3 py-2.5">Customer</th>
                                    <th className="px-2.5 py-2.5">Cheque</th>
                                    <th className="px-2.5 py-2.5">Dated</th>
                                    <th className="px-2.5 py-2.5 text-right">Amount</th>
                                    <th className="px-2.5 py-2.5">Status</th>
                                    <th className="px-2.5 py-2.5 hidden xl:table-cell">CRM owner</th>
                                    {canManagePdc && <th className="px-2 xl:px-3 py-2.5 text-right">Actions</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-separator">
                                {filtered.slice(0, visibleCount).map(c => {
                                    const customer = customerById.get(c.customerId);
                                    const notSaved = unsavedById.get(c.id);
                                    const done = c.state === 'cleared';
                                    const note = datedNote(c.state, c.chequeDate);
                                    return (
                                        <tr key={c.id} className={cx('transition-colors', selected.includes(c.id) ? 'bg-accent-tint/60' : 'hover:bg-hover')}>
                                            {canManagePdc && (
                                                <td className="px-3 py-1.5 text-center">
                                                    <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleRow(c.id)} aria-label={`Select cheque ${c.chequeNumber || ''} for ${c.customerName}`} className="w-4 h-4 rounded text-pos focus:ring-accent cursor-pointer" />
                                                </td>
                                            )}
                                            {/* Customer: the name opens the account, the way it does in the book. */}
                                            <td className="px-3 py-1.5 min-w-[150px] max-w-[200px] xl:max-w-[260px]">
                                                {customer && onOpenCustomerFollowUp ? (
                                                    <button type="button" onClick={() => onOpenCustomerFollowUp(customer)} className={cx('text-[13.5px] text-left truncate max-w-full block hover:text-accent', done ? 'font-semibold text-label-2' : 'font-bold text-label')} title={`${c.customerName} — open this account`}>
                                                        {c.customerName}
                                                    </button>
                                                ) : (
                                                    <span className={cx('text-[13.5px] truncate max-w-full block', done ? 'font-semibold text-label-2' : 'font-bold text-label')} title={c.customerName}>{c.customerName}</span>
                                                )}
                                                <span className="block text-[12px] text-label-3 truncate">
                                                    {customer ? `O/S ${formatCompact(customer.total)}` : 'Not in the book'}
                                                    {notSaved && <span className="ml-1.5 font-semibold text-dang" title={notSaved}>· Not saved, retrying</span>}
                                                </span>
                                            </td>
                                            <td className="px-2.5 py-1.5">
                                                <span className={cx('block font-mono text-[12.5px]', done ? 'font-semibold text-label-2' : 'font-bold text-label')}>#{c.chequeNumber}</span>
                                                <span className="block text-[12px] text-label-3 truncate max-w-[130px] xl:max-w-[220px]" title={c.remarks ? `${c.bankName} — ${c.remarks}` : c.bankName}>
                                                    {c.bankName}{c.remarks ? ` · ${c.remarks}` : ''}
                                                </span>
                                            </td>
                                            <td className="px-2.5 py-1.5 whitespace-nowrap">
                                                <span className={cx('block text-[12.5px] font-semibold', c.state === 'overdue' ? 'text-dang' : done ? 'text-label-2' : 'text-label')}>{formatDate(c.chequeDate)}</span>
                                                {note ? (
                                                    <span className={cx('block text-[11.5px]', c.state === 'overdue' ? 'text-dang font-semibold' : 'text-label-3')}>{note}</span>
                                                ) : done && c.clearedDate ? (
                                                    <span className="block text-[11.5px] text-label-3">cleared {formatDate(c.clearedDate)}</span>
                                                ) : null}
                                            </td>
                                            <td className="px-2.5 py-1.5 whitespace-nowrap text-right">
                                                <span className={cx('num text-[13.5px]', done ? 'font-semibold text-label-2' : 'font-extrabold text-label')}>{formatINR(c.amount)}</span>
                                            </td>
                                            <td className="px-2.5 py-1.5 whitespace-nowrap">
                                                <ChequeStateBadge state={c.state} />
                                            </td>
                                            <td className="px-2.5 py-1.5 whitespace-nowrap hidden xl:table-cell">
                                                <span className="block text-[12.5px] text-label-2 truncate max-w-[120px]">{ownerName(customer?.crmOwnerId || c.crmOwnerId) || '—'}</span>
                                            </td>
                                            {canManagePdc && (
                                                <td className="px-2 xl:px-3 py-1.5 whitespace-nowrap text-right">
                                                    <div className="inline-flex items-center justify-end gap-0.5 xl:gap-1">
                                                        {rowActions(c, false)}
                                                        {editDelete(c, false)}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {visibleCount < filtered.length && (
                            <div className="p-3 border-t border-separator flex justify-center">
                                <button type="button" onClick={() => setVisibleCount(n => n + PAGE * 2)} className="h-9 px-5 rounded-xl bg-card-2 hover:bg-hover text-[13px] font-semibold text-label-2">
                                    Show more — {(filtered.length - visibleCount).toLocaleString('en-IN')} left
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
                        <strong className="text-label">#{chequesToDelete[0].chequeNumber}</strong> · {chequesToDelete[0].bankName} · <span className="num font-semibold text-label">{formatINR(chequesToDelete[0].amount)}</span> · dated {chequesToDelete[0].chequeDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · {chequesToDelete[0].customerName}.
                    </p>
                ) : (
                    <p>
                        <span className="num font-semibold text-label">{formatINR(chequesToDelete.reduce((s, c) => s + c.amount, 0))}</span> across {chequesToDelete.length} cheques
                        {chequesToDelete.length > 0 ? ` (${chequesToDelete.slice(0, 3).map(c => `#${c.chequeNumber}`).join(', ')}${chequesToDelete.length > 3 ? '…' : ''})` : ''}.
                    </p>
                )}
                <p className="mt-2">It leaves the register for everyone and cannot be undone. A cheque that was returned should be marked <strong>bounced</strong>, not deleted.</p>
            </ConfirmDialog>
        </div>
    );
};

export default PdcChequesView;
