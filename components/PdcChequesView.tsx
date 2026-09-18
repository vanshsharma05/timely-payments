import React, { useState, useMemo, useEffect } from 'react';
import { useIsPhone } from './ui/usePhone';
import { loadXlsx } from '../services/excel';
import { Outstanding, PdcCheque, PdcStatus, User, UserRole, can, seesWholeBook, scopeTo, chequeState, ChequeState, findOwner, ownerKey } from '../types';
import { ChequeIcon, DownloadIcon } from './icons/Icons';
import { Button, cx } from './ui/Primitives';
import { formatCompact, formatINR } from './ui/format';
import { CHEQUE_STATES, sortCheques } from './ui/ChequeState';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { RowMenu, RowMenuItem } from './ui/RowMenu';
import type { SyncFailure } from '../services/useSupabaseSync';

/**
 * The register in three lists, which is all the six states amount to for
 * the person clearing cheques: what needs doing now, what is waiting for
 * its date, and what is finished.
 *
 *   Needs attention — dated today, date passed and still in hand, bounced
 *   Coming up       — in hand for a later date, and on hold
 *   Finished        — cleared
 */
export type ChequeTab = 'attention' | 'upcoming' | 'finished';
export const TAB_OF: Record<ChequeState, ChequeTab> = { overdue: 'attention', due: 'attention', bounced: 'attention', upcoming: 'upcoming', hold: 'upcoming', cleared: 'finished' };
const TABS: { key: ChequeTab; label: string }[] = [
    { key: 'attention', label: 'Needs attention' },
    { key: 'upcoming', label: 'Coming up' },
    { key: 'finished', label: 'Finished' },
];

/** The names Today and the account dialog still send, mapped to the list that holds them. */
export const normaliseStateFilter = (value?: string | null): ChequeTab | null => {
    switch (value) {
        case 'today': case 'due': case 'overdue': case 'active': case 'attention': case 'bounced': case PdcStatus.Bounced: return 'attention';
        case PdcStatus.Pending: case 'upcoming': case 'hold': case PdcStatus.Hold: return 'upcoming';
        case PdcStatus.Cleared: case 'cleared': case 'finished': return 'finished';
        default: return null;
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

const PAGE = 50;
const SHORT = (d: Date, today: Date) => d.toLocaleDateString('en-IN', d.getFullYear() === today.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * When the cheque is for, said the way a person would: "Tomorrow, 19 Sept",
 * "In 6 days, 24 Sept", "Dated 12 Sept, 6 days ago", "Cleared 15 Sept".
 */
export function whenLine(cheque: Pick<PdcCheque, 'chequeDate' | 'clearedDate'> & { state: ChequeState }, today: Date): string {
    const d = new Date(cheque.chequeDate);
    if (isNaN(d.getTime())) return 'No date';
    if (cheque.state === 'cleared') {
        const on = cheque.clearedDate ? new Date(cheque.clearedDate) : d;
        return `Cleared ${SHORT(isNaN(on.getTime()) ? d : on, today)}`;
    }
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const t = new Date(today); t.setHours(0, 0, 0, 0);
    const diff = Math.round((day.getTime() - t.getTime()) / 86_400_000);
    const short = SHORT(d, today);
    if (diff === 0) return 'Due today';
    if (diff === 1) return `Tomorrow, ${short}`;
    if (diff > 1 && diff <= 14) return `In ${diff} days, ${short}`;
    if (diff === -1) return `Dated ${short}, yesterday`;
    if (diff < -1 && diff >= -60) return `Dated ${short}, ${-diff} days ago`;
    return `Dated ${short}`;
}

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
    const [bankFilter, setBankFilter] = useState<string>('all');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    /** What is about to be deleted, named, until the person says so. */
    const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);

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

    /** The rows the person has narrowed to, before the list is chosen. */
    const narrowed = useMemo(() => rows.filter(c => {
        if (selectedCrm !== 'all') {
            const customer = customerById.get(c.customerId);
            const crmId = customer ? customer.crmOwnerId : c.crmOwnerId;
            const canonical = findOwner(users, crmId)?.id || (crmId || '');
            if (ownerKey(canonical) !== ownerKey(selectedCrm)) return false;
        }
        if (selectedCustomer !== 'all' && c.customerId !== selectedCustomer) return false;
        if (bankFilter !== 'all' && c.bankName !== bankFilter) return false;
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
    }), [rows, selectedCrm, selectedCustomer, bankFilter, searchTerm, customerById, users]);

    /** Each list's cheques, in the order a person needs them (sortCheques), with its count and amount. */
    const lists = useMemo(() => {
        const by: Record<ChequeTab, Row[]> = { attention: [], upcoming: [], finished: [] };
        for (const c of narrowed) by[TAB_OF[c.state]].push(c);
        const out = {} as Record<ChequeTab, { rows: Row[]; count: number; amount: number }>;
        (Object.keys(by) as ChequeTab[]).forEach(k => { const sorted = sortCheques(by[k]); out[k] = { rows: sorted, count: sorted.length, amount: sorted.reduce((s, c) => s + c.amount, 0) }; });
        return out;
    }, [narrowed]);

    /** Within a week from today, in hand — the "what next" under Coming up. */
    const dueWithinWeek = useMemo(() => {
        const t = new Date(today); t.setHours(0, 0, 0, 0);
        const limit = t.getTime() + 7 * 86_400_000;
        return lists.upcoming.rows.filter(c => c.state === 'upcoming' && c.chequeDate.getTime() <= limit);
    }, [lists, today]);

    /**
     * Which list opens: the one Today asked for, else what needs attention,
     * else what is coming up, else what is finished — never an empty list
     * when another has cheques.
     */
    const firstTab = (): ChequeTab => {
        const asked = normaliseStateFilter(initialStatusFilter);
        if (asked) return asked;
        if (lists.attention.count) return 'attention';
        if (lists.upcoming.count) return 'upcoming';
        if (lists.finished.count) return 'finished';
        return 'attention';
    };
    // null until the register has arrived: the choice is made once, on the
    // first read, and then stays put — clearing the last cheque that needed
    // attention must not pull the list from under the person.
    const [chosen, setChosen] = useState<ChequeTab | null>(() => normaliseStateFilter(initialStatusFilter));
    useEffect(() => { setSelectedCustomer(initialCustomerFilter || 'all'); setChosen(normaliseStateFilter(initialStatusFilter)); }, [initialStatusFilter, initialCustomerFilter]);
    useEffect(() => { if (chosen === null && pdcCheques.length > 0) setChosen(firstTab()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pdcCheques.length]);
    const tab: ChequeTab = chosen ?? firstTab();
    const chooseTab = (t: ChequeTab) => setChosen(t);

    const list = lists[tab];
    const visible = list.rows;

    const isPhone = useIsPhone();
    const [visibleCount, setVisibleCount] = useState(PAGE);
    useEffect(() => { setVisibleCount(PAGE); setSelectedIds([]); }, [tab, selectedCrm, selectedCustomer, bankFilter, searchTerm]);

    const visibleIds = useMemo(() => new Set(visible.map(c => c.id)), [visible]);
    const selected = useMemo(() => selectedIds.filter(id => visibleIds.has(id)), [selectedIds, visibleIds]);
    const selectable = canManagePdc && tab !== 'finished';
    const allSelected = selected.length > 0 && selected.length === visible.length;
    const toggleRow = (id: string) => setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
    const toggleAll = (checked: boolean) => setSelectedIds(checked ? visible.map(c => c.id) : []);
    const applyBulk = (status: PdcStatus) => {
        if (!onBulkPdcStatus || selected.length === 0) return;
        onBulkPdcStatus(selected, status);
        setSelectedIds([]);
    };

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
        const dataToExport = visible.map(c => {
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

    const handleClearFilters = () => { setSearchTerm(''); setSelectedCustomer('all'); setSelectedCrm('all'); setBankFilter('all'); };
    const filtersOn = selectedCrm !== 'all' || bankFilter !== 'all';
    const hasActiveFilters = searchTerm !== '' || selectedCustomer !== 'all' || filtersOn;
    const filteredCustomer = selectedCustomer !== 'all' ? customerById.get(selectedCustomer) : undefined;
    const ownerName = (id?: string) => (id ? (findOwner(users, id)?.name || id) : '');

    /**
     * The one thing to do next, and the rest behind the menu.
     *
     * A cheque whose date has come is banked, so its button is "Mark
     * cleared"; one on hold is released; a bounced one is re-presented, so
     * it is "Mark cleared" too. A cheque still waiting for its date, and a
     * cleared one, have nothing to press — only the menu. Three buttons on
     * every row, with "Clear" lit on the hundred cleared ones, hid the few
     * that mattered.
     */
    const primaryFor = (c: Row): { label: string; status: PdcStatus; title: string } | null => {
        switch (c.state) {
            case 'due': case 'overdue': return { label: 'Mark cleared', status: PdcStatus.Cleared, title: 'The bank paid it' };
            case 'bounced': return { label: 'Mark cleared', status: PdcStatus.Cleared, title: 'Re-presented and paid' };
            case 'hold': return { label: 'Release hold', status: PdcStatus.Pending, title: 'Back in hand — present it when it is due' };
            default: return null;
        }
    };
    const menuFor = (c: Row): RowMenuItem[] => {
        const items: RowMenuItem[] = [];
        const mark = (label: string, status: PdcStatus, hint?: string, tone: 'default' | 'danger' = 'default') => items.push({ label, hint, tone, onSelect: () => onUpdatePdcStatus(c.id, status) });
        switch (c.state) {
            case 'due': case 'overdue':
                mark('Bounced', PdcStatus.Bounced, 'Returned unpaid by the bank', 'danger');
                mark('Put on hold', PdcStatus.Hold, 'Do not present it for now');
                break;
            case 'upcoming':
                mark('Mark cleared', PdcStatus.Cleared, 'The bank paid it early');
                mark('Put on hold', PdcStatus.Hold, 'Do not present it on its date');
                mark('Bounced', PdcStatus.Bounced, 'Returned unpaid by the bank', 'danger');
                break;
            case 'hold':
                mark('Mark cleared', PdcStatus.Cleared, 'The bank paid it');
                mark('Bounced', PdcStatus.Bounced, 'Returned unpaid by the bank', 'danger');
                break;
            case 'bounced':
                mark('Not bounced after all', PdcStatus.Pending, 'Back in hand, waiting for its date');
                mark('Put on hold', PdcStatus.Hold, 'Do not present it again for now');
                break;
            case 'cleared':
                mark('Not cleared after all', PdcStatus.Pending, 'Back in hand, waiting for its date');
                break;
        }
        items.push({ label: 'Edit details', onSelect: () => onEditPdc(c) });
        items.push({ label: 'Delete…', tone: 'danger', onSelect: () => setConfirmDelete({ ids: [c.id] }) });
        return items;
    };

    /** The state word, only where it tells the person something the list's name does not. */
    const tag = (c: Row) => {
        const t = c.state === 'overdue' ? { text: 'Date passed', cls: 'bg-dang-bg text-dang' }
            : c.state === 'bounced' ? { text: 'Bounced', cls: 'bg-dang-bg text-dang' }
            : c.state === 'hold' ? { text: 'On hold', cls: 'bg-warn-bg text-warn' }
            : null;
        return t ? <span className={cx('inline-flex items-center rounded-full px-2 py-[2px] text-[11.5px] font-bold leading-4 whitespace-nowrap', t.cls)}>{t.text}</span> : null;
    };
    const whenClass = (c: Row) => (c.state === 'overdue' ? 'text-dang font-bold' : c.state === 'due' ? 'text-warn font-bold' : c.state === 'cleared' ? 'text-label-3' : 'text-label-2');

    const summaryLine = tab === 'attention'
        ? (list.count ? `${list.count} to deal with · ${formatINR(list.amount)}` : 'Nothing needs attention')
        : tab === 'upcoming'
            ? `${list.count} in hand · ${formatCompact(list.amount)}${dueWithinWeek.length ? ` · ${dueWithinWeek.length} due within a week` : ''}`
            : `${list.count} cleared · ${formatCompact(list.amount)}`;

    const primaryButton = (c: Row, phone: boolean) => {
        const p = primaryFor(c);
        if (!p) return null;
        return (
            <button
                type="button"
                onClick={() => onUpdatePdcStatus(c.id, p.status)}
                title={p.title}
                className={cx('rounded-lg font-bold whitespace-nowrap transition-colors shadow-2xs', phone ? 'h-11 px-4 text-[14px] flex-1' : 'h-8 px-3 text-[12.5px]',
                    p.status === PdcStatus.Cleared ? 'bg-accent text-on-accent hover:bg-accent-press' : 'bg-accent-tint text-accent hover:bg-accent-tint-2')}
            >
                {p.label}
            </button>
        );
    };

    return (
        <div className="space-y-3">
            {/* ---------- the three lists, the search, the two buttons ---------- */}
            <div className="bg-card rounded-[16px] shadow-e1 px-4 py-3 max-md:px-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="inline-flex rounded-xl bg-card-2 p-1 gap-1 max-md:flex max-md:w-full" role="tablist" aria-label="Which cheques">
                    {TABS.map(t => {
                        const n = lists[t.key].count;
                        const alarm = t.key === 'attention' && n > 0;
                        return (
                            <button
                                key={t.key}
                                type="button"
                                role="tab"
                                aria-selected={tab === t.key}
                                onClick={() => chooseTab(t.key)}
                                className={cx('h-9 px-3.5 rounded-lg text-[13px] font-bold transition-colors whitespace-nowrap max-md:flex-1 max-md:px-1 max-md:h-10 max-md:text-[12.5px]',
                                    tab === t.key ? 'bg-accent text-on-accent shadow-e1' : 'text-label-2 hover:bg-hover hover:text-label')}
                            >
                                {t.label}
                                <span className={cx('num ml-1.5 font-semibold', tab === t.key ? 'opacity-80' : alarm ? 'text-dang' : 'text-label-3')}>{n}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="flex items-center gap-2 flex-wrap max-md:[&>*]:min-h-[44px] max-md:[&>button]:flex-1">
                    <div className="relative flex-1 min-w-[180px] lg:w-[240px] max-md:basis-full">
                        <input
                            id="pdcSearch"
                            type="search"
                            aria-label="Find a cheque"
                            placeholder="Find a cheque…"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full h-9 pl-8 pr-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[13px] text-gray-900 dark:text-white focus:ring-2 focus:ring-accent/40 focus:outline-none max-md:h-11"
                        />
                        <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400 max-md:top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    </div>
                    <Button size="sm" variant={filtersOn ? 'secondary' : 'quiet'} onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen} title="Narrow by CRM owner or bank">
                        Filter{filtersOn ? ` · ${[selectedCrm !== 'all', bankFilter !== 'all'].filter(Boolean).length}` : ''}
                    </Button>
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

            {(filtersOpen || filteredCustomer) && (
                <div className="bg-card rounded-[16px] shadow-e1 px-4 py-3 max-md:px-3.5 flex flex-wrap items-end gap-3">
                    {filtersOpen && (
                        <>
                            <div className="min-w-[160px]">
                                <label htmlFor="pdcCrm" className="block text-[11.5px] font-bold text-label-3 uppercase tracking-wider mb-0.5">CRM owner</label>
                                <select id="pdcCrm" value={selectedCrm} onChange={e => setSelectedCrm(e.target.value)} className="w-full h-9 px-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[13px] font-semibold text-gray-900 dark:text-white max-md:h-11">
                                    <option value="all">{canViewAll ? 'All CRMs' : 'My CRMs'}</option>
                                    {availableCrms.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                            </div>
                            <div className="min-w-[160px]">
                                <label htmlFor="pdcBankFilter" className="block text-[11.5px] font-bold text-label-3 uppercase tracking-wider mb-0.5">Bank</label>
                                <select id="pdcBankFilter" value={bankFilter} onChange={e => setBankFilter(e.target.value)} className="w-full h-9 px-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[13px] font-semibold text-gray-900 dark:text-white max-md:h-11">
                                    <option value="all">All banks ({bankList.length})</option>
                                    {bankList.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                            </div>
                        </>
                    )}
                    {filteredCustomer && (
                        <span className="inline-flex items-center gap-1 h-9 pl-3 pr-1 rounded-full bg-accent-tint text-accent text-[12.5px] font-semibold">
                            {filteredCustomer.company}
                            <button type="button" onClick={() => setSelectedCustomer('all')} className="w-7 h-7 grid place-items-center rounded-full hover:bg-accent-tint-2" aria-label="Show every customer's cheques">×</button>
                        </span>
                    )}
                    {hasActiveFilters && <Button size="sm" variant="ghost" onClick={handleClearFilters}>Reset</Button>}
                </div>
            )}

            {/* ---------- the list ---------- */}
            <div className="bg-card rounded-[16px] shadow-e1 overflow-hidden">
                <div className="px-4 py-2.5 max-md:px-3.5 bg-card-2 border-b border-separator flex flex-wrap items-center justify-between gap-2">
                    <span className={cx('text-[13px] font-semibold', tab === 'attention' && list.count ? 'text-dang' : 'text-label-2')}>{summaryLine}</span>
                    {selectable && selected.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[12.5px] font-bold text-label mr-1">{selected.length} selected</span>
                            <Button size="sm" variant="primary" onClick={() => applyBulk(PdcStatus.Cleared)}>Mark cleared</Button>
                            <Button size="sm" variant="quiet" onClick={() => applyBulk(PdcStatus.Hold)}>Put on hold</Button>
                            {onBulkDeletePdc && <Button size="sm" variant="ghost" className="text-dang" onClick={() => setConfirmDelete({ ids: selected })}>Delete…</Button>}
                            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>Clear selection</Button>
                        </div>
                    )}
                </div>

                {loading && pdcCheques.length === 0 ? (
                    <div className="px-4 py-14 text-center text-label-3" role="status" aria-live="polite">
                        <ChequeIcon className="w-8 h-8 mx-auto text-label-4" />
                        <p className="text-sm font-semibold mt-2">Loading the register…</p>
                    </div>
                ) : visible.length === 0 ? (
                    <div className="px-4 py-12 text-center text-label-3">
                        <ChequeIcon className="w-8 h-8 mx-auto text-label-4" />
                        {pdcCheques.length === 0 ? (
                            <>
                                <p className="text-sm font-bold text-label mt-2">No cheques recorded yet</p>
                                <p className="text-[12.5px] mt-1">When a customer gives a post-dated cheque, record it here and it will come up on its date.</p>
                            </>
                        ) : hasActiveFilters ? (
                            <>
                                <p className="text-sm font-bold text-label mt-2">No cheques match</p>
                                <p className="text-[12.5px] mt-1">Try another search, or press Reset.</p>
                            </>
                        ) : tab === 'attention' ? (
                            <>
                                <p className="text-sm font-bold text-label mt-2">Nothing needs attention</p>
                                <p className="text-[12.5px] mt-1">
                                    {dueWithinWeek.length
                                        ? `${dueWithinWeek.length} cheque${dueWithinWeek.length === 1 ? '' : 's'} due within a week — ${formatCompact(dueWithinWeek.reduce((s, c) => s + c.amount, 0))}.`
                                        : lists.upcoming.count ? `${lists.upcoming.count} in hand for later dates.` : 'Nothing in hand.'}
                                </p>
                            </>
                        ) : tab === 'upcoming' ? (
                            <p className="text-sm font-bold text-label mt-2">No cheques waiting for their date</p>
                        ) : (
                            <p className="text-sm font-bold text-label mt-2">No cleared cheques yet</p>
                        )}
                        <div className="flex items-center justify-center gap-2 mt-4">
                            {hasActiveFilters && <Button size="sm" variant="quiet" onClick={handleClearFilters}>Reset</Button>}
                            {!hasActiveFilters && tab === 'attention' && lists.upcoming.count > 0 && <Button size="sm" variant="secondary" onClick={() => chooseTab('upcoming')}>See what is coming up</Button>}
                            {canManagePdc && pdcCheques.length === 0 && <Button size="sm" variant="primary" onClick={() => onAddPdc()}>+ Record a cheque</Button>}
                        </div>
                    </div>
                ) : isPhone ? (
                    /* Phone: a card per cheque — the customer and the amount, the cheque itself, when it is for, and the one thing to do. */
                    <div className="divide-y divide-separator">
                        {visible.slice(0, visibleCount).map(c => {
                            const customer = customerById.get(c.customerId);
                            const notSaved = unsavedById.get(c.id);
                            const done = c.state === 'cleared';
                            return (
                                <div key={c.id} className={cx('px-3.5 py-3', done && 'opacity-70', selected.includes(c.id) && 'bg-accent-tint/60')}>
                                    <div className="flex gap-3">
                                        {selectable && (
                                            <label className="flex-none pt-0.5">
                                                <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleRow(c.id)} aria-label={`Select cheque ${c.chequeNumber || ''} for ${c.customerName}`} className="w-5 h-5 rounded text-accent focus:ring-accent" />
                                            </label>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-3">
                                                {customer && onOpenCustomerFollowUp ? (
                                                    <button type="button" onClick={() => onOpenCustomerFollowUp(customer)} className={cx('text-[15px] leading-snug text-left break-words min-w-0', done ? 'font-semibold text-label-2' : 'font-bold text-label')}>
                                                        {c.customerName}
                                                    </button>
                                                ) : (
                                                    <span className={cx('text-[15px] leading-snug break-words min-w-0', done ? 'font-semibold text-label-2' : 'font-bold text-label')}>{c.customerName}</span>
                                                )}
                                                <span className="flex items-center gap-1 flex-none">
                                                    <span className={cx('num text-[15.5px]', done ? 'font-semibold text-label-2' : 'font-extrabold text-label')}>{formatINR(c.amount)}</span>
                                                    {canManagePdc && !primaryFor(c) && <RowMenu size="lg" label={`More for cheque ${c.chequeNumber}`} items={menuFor(c)} className="-mr-3 -my-2" />}
                                                </span>
                                            </div>
                                            <p className="text-[12.5px] text-label-3 mt-0.5 truncate"><span className="font-mono">#{c.chequeNumber}</span> · {c.bankName}{c.remarks ? ` · ${c.remarks}` : ''}</p>
                                            <p className={cx('text-[13px] mt-1 flex items-center gap-2 flex-wrap', whenClass(c))}>
                                                <span>{whenLine(c, today)}</span>{tag(c)}
                                                {notSaved && <span className="font-semibold text-dang" title={notSaved}>Not saved · will be retried</span>}
                                            </p>
                                            {canManagePdc && primaryFor(c) && (
                                                <div className="flex items-center gap-2 mt-2.5">
                                                    {primaryButton(c, true)}
                                                    <RowMenu size="lg" label={`More for cheque ${c.chequeNumber}`} items={menuFor(c)} />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {visibleCount < visible.length && (
                            <div className="p-3">
                                <button type="button" onClick={() => setVisibleCount(n => n + PAGE * 2)} className="w-full h-11 rounded-xl bg-card-2 active:bg-hover text-[14px] font-semibold text-label-2">
                                    Show more — {(visible.length - visibleCount).toLocaleString('en-IN')} left
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead className="bg-card-2 text-[11.5px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-separator">
                                <tr>
                                    {selectable && (
                                        <th className="px-3 py-2.5 w-10 text-center">
                                            <input type="checkbox" checked={allSelected} onChange={e => toggleAll(e.target.checked)} aria-label="Select all cheques in view" title="Select all cheques in view" className="w-4 h-4 rounded text-pos focus:ring-accent cursor-pointer" />
                                        </th>
                                    )}
                                    <th className="px-3 py-2.5">Customer</th>
                                    <th className="px-3 py-2.5 text-right">Amount</th>
                                    <th className="px-3 py-2.5">{tab === 'finished' ? 'Cleared' : 'When'}</th>
                                    <th className="px-3 py-2.5 hidden xl:table-cell">CRM owner</th>
                                    {canManagePdc && <th className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-separator">
                                {visible.slice(0, visibleCount).map(c => {
                                    const customer = customerById.get(c.customerId);
                                    const notSaved = unsavedById.get(c.id);
                                    const done = c.state === 'cleared';
                                    return (
                                        <tr key={c.id} className={cx('group transition-colors', selected.includes(c.id) ? 'bg-accent-tint/60' : 'hover:bg-hover', done && 'opacity-70')}>
                                            {selectable && (
                                                <td className="px-3 py-1.5 text-center">
                                                    <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleRow(c.id)} aria-label={`Select cheque ${c.chequeNumber || ''} for ${c.customerName}`} className="w-4 h-4 rounded text-pos focus:ring-accent cursor-pointer" />
                                                </td>
                                            )}
                                            <td className="px-3 py-1.5 min-w-[200px] max-w-[320px]">
                                                {customer && onOpenCustomerFollowUp ? (
                                                    <button type="button" onClick={() => onOpenCustomerFollowUp(customer)} className={cx('text-[13.5px] text-left truncate max-w-full block hover:text-accent', done ? 'font-semibold text-label-2' : 'font-bold text-label')} title="Open this account">
                                                        {c.customerName}
                                                    </button>
                                                ) : (
                                                    <span className={cx('text-[13.5px] truncate max-w-full block', done ? 'font-semibold text-label-2' : 'font-bold text-label')}>{c.customerName}</span>
                                                )}
                                                <span className="block text-[12px] text-label-3 truncate">
                                                    <span className="font-mono">#{c.chequeNumber}</span> · {c.bankName}{c.remarks ? ` · ${c.remarks}` : ''}
                                                    {notSaved && <span className="ml-1.5 font-semibold text-dang" title={notSaved}>· Not saved, retrying</span>}
                                                </span>
                                            </td>
                                            <td className="px-3 py-1.5 whitespace-nowrap text-right">
                                                <span className={cx('num text-[13.5px]', done ? 'font-semibold text-label-2' : 'font-extrabold text-label')}>{formatINR(c.amount)}</span>
                                            </td>
                                            <td className="px-3 py-1.5 whitespace-nowrap">
                                                <span className={cx('inline-flex items-center gap-2 text-[12.5px]', whenClass(c))} title={c.chequeDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}>
                                                    {whenLine(c, today)}{tag(c)}
                                                </span>
                                            </td>
                                            <td className="px-3 py-1.5 whitespace-nowrap hidden xl:table-cell">
                                                <span className="block text-[12.5px] text-label-2 truncate max-w-[120px]">{ownerName(customer?.crmOwnerId || c.crmOwnerId) || '—'}</span>
                                            </td>
                                            {canManagePdc && (
                                                <td className="px-3 py-1.5 whitespace-nowrap text-right">
                                                    <div className="inline-flex items-center justify-end gap-1.5">
                                                        {primaryButton(c, false)}
                                                        <RowMenu label={`More for cheque ${c.chequeNumber}`} items={menuFor(c)} />
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {visibleCount < visible.length && (
                            <div className="p-3 border-t border-separator flex justify-center">
                                <button type="button" onClick={() => setVisibleCount(n => n + PAGE * 2)} className="h-9 px-5 rounded-xl bg-card-2 hover:bg-hover text-[13px] font-semibold text-label-2">
                                    Show more — {(visible.length - visibleCount).toLocaleString('en-IN')} left
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
