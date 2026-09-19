import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Outstanding, User, UserRole, FollowUpStatus, PdcCheque, can, getCustomerPaymentRank, seesWholeBook, scopeTo, PaymentRank, PAYMENT_RANK_LABELS, findOwner, ownerKey, canExportBook, SettlementFilter, SETTLEMENT_LABELS, matchesSettlement, hasOutstanding, matchesSearch, overdueAgeing, followUpStatusOf } from '../types';
import BalanceAmount from './BalanceAmount';
import StatusBadge from './StatusBadge';
import { WhatsAppIcon, ChequeIcon, DownloadIcon, TrashIcon, EditIcon } from './icons/Icons';
import { AgeingBar, AgeingLegend, AGE_BANDS } from './ui/Primitives';
import { formatCompact, formatINR, formatDate as formatDay, localIsoDate, followUpWhen, startOfToday } from './ui/format';
import { useIsPhone, PHONE_QUERY } from './ui/usePhone';
import { PhoneAccountRow } from './ui/PhoneAccountRow';
import { ConfirmDialog } from './ui/ConfirmDialog';

interface CustomerDashboardViewProps {
    data: Outstanding[];
    currentUser: User | null;
    users: User[];
    onAddCustomer: () => void;
    onEditCustomer: (customer: Outstanding) => void;
    onDeleteCustomer?: (customerId: string) => void;
    onFollowUp: (customer: Outstanding) => void;
    /** The accounts in view, in order — so the follow-up dialog can step through them. */
    onVisibleRowsChange?: (ids: string[]) => void;
    onWhatsApp: (customer: Outstanding) => void;
    onOpenPdcForCustomer?: (customerId: string) => void;
    onReassignCrm?: (customerId: string, newCrm: string) => void;
    onBulkReassignCrm?: (customerIds: string[], newCrm: string) => void;
    /** Grading 417 bad debts one dialog at a time is not a workflow. */
    onBulkSetRank?: (customerIds: string[], rank: PaymentRank | '') => void;
    /**
     * Puts one follow-up date on the selection. Admin only: it is how the
     * overdue list is brought back to today when the owners have not done it,
     * and every account it touches gets a line in its activity saying so.
     */
    onBulkSetFollowUp?: (customerIds: string[], isoDate: string) => void;
    pdcCheques?: PdcCheque[];
    /**
     * Pulls the outstanding sheet. It is the only sync there is: the sheet
     * carries what is owed, and the customer list is maintained here.
     */
    /** Accepted for compatibility; the app bar owns the sync button and the subtitle the sheet date. */
    onSyncSheet?: () => void;
    isSyncing?: boolean;
    lastUpdatedTill?: string;
    /** Given the rows currently on screen, so a filtered list exports as one. */
    onExportExcel?: (rows: Outstanding[]) => void;
    /** Search text from the app bar. Narrows the book before the view's own filters. */
    /** The one customer search: the app bar's field and the book's field edit the same term (decision 2026-09-17). */
    globalSearch?: string;
    onGlobalSearch?: (value: string) => void;
}

/**
 * The ageing chips. Three of them nest — past 45 includes past 90 includes
 * past 135 — and `current` is the other side of the first line: dues, but
 * nothing older than 45 days. It replaced "1-45d", which meant "has any money
 * in the 1–45 bucket" and so listed 311 accounts, 181 of which also had money
 * past 90 days — beside ">45d" it read as the customers who are up to date,
 * and it was not. The bucket values are kept for the links that use them.
 */
export type AgeingCategoryFilter = 'all' | 'current' | 'dueOver45' | 'over90' | 'over135' | '1-45' | '46-90' | '91-135';

export const CustomerDashboardView: React.FC<CustomerDashboardViewProps> = ({
    data,
    currentUser,
    users,
    onAddCustomer,
    onEditCustomer,
    onDeleteCustomer,
    onVisibleRowsChange,
    onFollowUp,
    onWhatsApp,
    onOpenPdcForCustomer,
    onReassignCrm,
    onBulkReassignCrm,
    onBulkSetRank,
    onBulkSetFollowUp,
    pdcCheques = [],
    onExportExcel,
    globalSearch = '',
    onGlobalSearch,
}) => {
    // Permissions and Data Scoping
    const isAdmin = currentUser?.role === UserRole.Admin;
    // One reading of the matrix, the same one every other screen uses. Reading
    // `permissions?.x` raw treats a profile carrying a partial matrix as though
    // every key it omits were denied; can() fills those from the role.
    const canAddCustomer = can(currentUser, 'canAddCustomer');
    const canEditCustomer = can(currentUser, 'canEditCustomer');
    const canDeleteCustomer = can(currentUser, 'canDeleteCustomer');
    const canEditFollowUp = can(currentUser, 'canEditFollowUp');
    const canManagePdc = can(currentUser, 'canManagePdc');
    const canReassignCrm = can(currentUser, 'canReassignCrm');
    // Taking the book out as a file is Admin/Manager, not merely whoever has
    // the export permission — see canExportBook().
    const canExport = canExportBook(currentUser);
    const canViewAllCrms = seesWholeBook(currentUser);

    // Filter raw data strictly based on user roles and assigned access rights
    // One scoping rule for the whole app — see scopeTo() in types.ts.
    const userAllowedData = useMemo(() => scopeTo(currentUser, data), [data, currentUser]);

    // Filters State
    // One search, not two: the book's box and the app bar's box are the same term.
    const searchTerm = globalSearch;
    const setSearchTerm = (value: string) => onGlobalSearch?.(value);
    const [selectedCrm, setSelectedCrm] = useState<string>('ALL');
    const [showMoreFilters, setShowMoreFilters] = useState(false);
    const [rankFilter, setRankFilter] = useState<'ALL' | PaymentRank>('ALL');

    /** Rank pill colours, shared by the table row and the mobile card. */
    const RANK_TONE: Record<PaymentRank, string> = {
        Good: 'bg-pos-bg text-pos border border-separator',
        Late: 'bg-warn-bg text-warn border border-separator',
        Bad: 'bg-dang-bg text-dang border border-separator',
    };
    // Starts on the accounts that owe something: four customers in five owe
    // nothing, and listing them all buries the few hundred worth working.
    const [settlementFilter, setSettlementFilter] = useState<SettlementFilter>('withDues');
    const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
    const [ageingFilter, setAgeingFilter] = useState<AgeingCategoryFilter>('all');
    const [statusFilter, setStatusFilter] = useState<string>('ALL');
    const [balanceTypeFilter, setBalanceTypeFilter] = useState<'ALL' | 'Dr' | 'Cr'>('ALL');
    const [originFilter, setOriginFilter] = useState<'ALL' | 'NEW' | 'SHEET'>('ALL');
    const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
    /**
     * The seven money tiles are a manager's glance, not a CRM's morning: for
     * someone working their own book they push the list a screen down. Open
     * by default for the roles that manage, folded for the roles that call;
     * either way the choice is remembered on this device.
     */
    const [overviewOpen, setOverviewOpen] = useState<boolean>(() => {
        // A phone has room for the accounts or for seven money tiles, not both:
        // it opens on the accounts and the tiles are one tap away.
        const onPhone = typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches;
        try {
            const saved = localStorage.getItem('tp.bookOverviewOpen');
            if (saved === '1' || saved === '0') return saved === '1' && !onPhone;
        } catch { /* private window */ }
        return seesWholeBook(currentUser) && !onPhone;
    });
    const toggleOverview = () => setOverviewOpen(o => { try { localStorage.setItem('tp.bookOverviewOpen', o ? '0' : '1'); } catch { /* ignore */ } return !o; });
    /**
     * A phone gets neither the table nor the card grid: it gets a row list
     * (PhoneAccountRow), and the filter selects fold away behind one button
     * so the list starts within a thumb's reach of the search box.
     */
    const isPhone = useIsPhone();
    const [phoneFiltersOpen, setPhoneFiltersOpen] = useState(false);
    /**
     * Picking several accounts at once is a desk job. On a phone the tick
     * boxes sat on every row all day for the once-a-month bulk reassignment,
     * so they wait behind "Select" instead.
     */
    const [phoneSelecting, setPhoneSelecting] = useState(false);
    const today = useMemo(() => startOfToday(), []);

    /** How many rows are mounted. Grows as the reader reaches the bottom. */
    const PAGE = 60;
    const [visibleCount, setVisibleCount] = useState(PAGE);
    const sentinelRef = useRef<HTMLTableRowElement | null>(null);

    /**
     * Typing re-filtered and re-rendered the entire book on every keystroke,
     * which cost about five seconds a character. The input stays instant and
     * the list catches up a beat later.
     */
    const [searchDraft, setSearchDraft] = useState(globalSearch);
    // Typed in the app bar: the box here follows. Typed here: the term follows a beat later.
    useEffect(() => { setSearchDraft(globalSearch); }, [globalSearch]);
    useEffect(() => {
        if (searchDraft === globalSearch) return;
        const t = window.setTimeout(() => setSearchTerm(searchDraft), 220);
        return () => window.clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchDraft]);


    // Hiding filters must never hide the fact that they are ON.
    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver(
            entries => { if (entries.some(e => e.isIntersecting)) setVisibleCount(c => c + PAGE * 2); },
            { rootMargin: '400px' },
        );
        io.observe(node);
        return () => io.disconnect();
    }, [visibleCount, viewMode]);

    // A new filter means a new list; keep the window from carrying over.
    useEffect(() => {
        setVisibleCount(PAGE);
    }, [searchTerm, globalSearch, rankFilter, selectedCrm, settlementFilter, categoryFilter, ageingFilter, statusFilter, balanceTypeFilter, originFilter, viewMode]);

    // Hiding filters must never hide the fact that they are ON. Every filter
    // counts — it used to leave out the CRM and the status, so "1 filter on"
    // could sit above a list narrowed by three.
    const activeFilterCount = [
        rankFilter !== 'ALL',
        categoryFilter !== 'ALL',
        selectedCrm !== 'ALL',
        ageingFilter !== 'all',
        statusFilter !== 'ALL',
        balanceTypeFilter !== 'ALL',
        originFilter !== 'ALL',
    ].filter(Boolean).length;

    /**
     * The categories this book actually contains, commonest first, each with
     * its count. Built from the data rather than from CUSTOMER_CATEGORIES so
     * the dropdown never offers a category that would return nothing, and never
     * hides one the sheet introduced that the list has not caught up with.
     */
    /** How many of this person's accounts sit on each side of the line. */
    const settlementCounts = useMemo(() => {
        let withDues = 0;
        userAllowedData.forEach(item => { if (hasOutstanding(item)) withDues++; });
        return { withDues, settled: userAllowedData.length - withDues, all: userAllowedData.length };
    }, [userAllowedData]);

    const categoriesInData = useMemo(() => {
        const counts = new Map<string, number>();
        let uncategorised = 0;
        userAllowedData.forEach(item => {
            const c = (item.category || '').trim();
            if (!c) { uncategorised++; return; }
            counts.set(c, (counts.get(c) || 0) + 1);
        });
        return {
            list: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
            uncategorised,
        };
    }, [userAllowedData]);

    // Bulk selection
    const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
    /** The bulk follow-up date is asked about in the app, with the count and the date named. */
    const [confirmBulkDate, setConfirmBulkDate] = useState(false);
    const [bulkRank, setBulkRank] = useState<PaymentRank | ''>('');
    const [bulkCrm, setBulkCrm] = useState('');
    // Starts on today, because "bring the overdue ones back to today" is the
    // job this is for; the date is there for anyone who wants a different day.
    const todayIso = localIsoDate();
    const [bulkFollowUp, setBulkFollowUp] = useState(todayIso);

    // List of CRM options (Scoped to user rights)
    const crmUsers = useMemo(() => {
        const allCrms = users.filter(u => u.role === UserRole.CRM);
        if (canViewAllCrms) return allCrms;
        return allCrms.filter(u => {
            const uId = u.id.trim().toUpperCase();
            const uName = u.name.trim().toUpperCase();
            const currId = (currentUser?.id || '').trim().toUpperCase();
            const currName = (currentUser?.name || '').trim().toUpperCase();
            const assigned = (currentUser?.assignedCrms || []).map(c => c.trim().toUpperCase());
            return uId === currId || uName === currName || assigned.includes(uId) || assigned.includes(uName);
        });
    }, [users, canViewAllCrms, currentUser]);

    /**
     * Accounts with nobody against them.
     *
     * A name that turns up in the outstanding sheet before it is in the customer
     * list is added automatically so its money is counted, but the sheet does
     * not get to say who chases it. That leaves a queue, and a queue nobody can
     * see is a queue nobody works — so it is counted here and shown as a chip.
     */
    const unassigned = useMemo(
        () => userAllowedData.filter(item => !(item.crmOwnerId || '').trim()),
        [userAllowedData],
    );
    const unassignedOwing = useMemo(() => unassigned.filter(i => Math.abs(Number(i.total) || 0) > 0), [unassigned]);

    /**
     * One entry per owner, under the code their profile actually uses.
     *
     * Some accounts were saved under a display name while three of the owner
     * dropdowns wrote `u.name` instead of `u.id`, which listed the same person
     * twice — "VISHNU" and "Vishnu" — and split their book across two filters.
     */
    const allCrmsInDataset = useMemo(() => {
        const byKey = new Map<string, string>();
        userAllowedData.forEach(item => {
            const raw = (item.crmOwnerId || '').trim();
            if (!raw) return;
            const canonical = findOwner(users, raw)?.id || raw;
            byKey.set(ownerKey(canonical), canonical);
        });
        return Array.from(byKey.values()).sort();
    }, [userAllowedData, users]);

    // Formatters
    const formatCurrency = (amount?: number) => {
        if (amount === undefined || isNaN(amount)) return '₹0';
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.abs(amount));
    };

    /** True when a stored contact number is worth offering as a dial link. */
    const dialable = (raw?: string) => (raw || '').replace(/\D/g, '').length >= 7;

    const formatDate = (date?: Date | string) => {
        if (!date) return '';
        return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
    };

    /** Matches a record against a free-text query across every field a
        person might search by. */
    const matchesQuery = (item: Outstanding, raw: string) => matchesSearch([
        item.company, item.contactPerson, item.contactPost, item.contactNumber,
        item.email, item.city, item.state, item.gstin, item.address, item.crmOwnerId, item.category,
        ...(item.additionalContacts || []).flatMap(c => [c.name, c.mobile, c.post || '']),
        ...(item.notes || []),
    ], raw);

    // Filter logic based on userAllowedData
    /**
     * The list, plus how many rows the settlement tab is holding back.
     *
     * Searching for a settled customer from the "With dues" tab returned
     * nothing at all, which reads as a broken search rather than a filter doing
     * its job. Every other filter is applied here; settlement is applied last
     * and separately, so the screen can say "one settled customer matches" and
     * offer to show it.
     */
    /**
     * The list, and what every filter control says beside each of its options.
     *
     * One rule for all of them: an option's count is how many rows it would
     * show, given every *other* filter and the tab in view. Counting after a
     * control's own filter meant choosing "Late pay" left Good and Bad reading
     * (0), which looks like the app losing the customers rather than a filter
     * working; counting the whole book meant "All CRMs (4,027)" sat above a
     * ledger of 520. So each row is tested against every filter once, and it
     * counts towards a control's options when it fails no filter but that
     * control's own.
     */
    const { filteredData, hiddenBySettlement, counts } = useMemo(() => {
        type Dim = 'rank' | 'category' | 'crm' | 'ageing' | 'status' | 'balance' | 'origin';
        const kept: Outstanding[] = [];
        let hidden = 0;
        const counts = {
            rank: { ALL: 0, Good: 0, Late: 0, Bad: 0 } as Record<'ALL' | PaymentRank, number>,
            ageing: { all: 0, current: 0, dueOver45: 0, over90: 0, over135: 0 },
            category: new Map<string, number>(), categoryAll: 0, uncategorised: 0,
            crm: new Map<string, number>(), crmAll: 0, unassigned: 0,
            status: new Map<string, number>(), statusAll: 0,
            balance: { ALL: 0, Dr: 0, Cr: 0 } as Record<'ALL' | 'Dr' | 'Cr', number>,
            origin: { ALL: 0, NEW: 0, SHEET: 0 } as Record<'ALL' | 'NEW' | 'SHEET', number>,
        };
        const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);

        const matchesText = (item: Outstanding): boolean => matchesQuery(item, globalSearch);

        userAllowedData.forEach(item => {
            if (!matchesText(item)) return;

            // What the row is, on each axis.
            const rank = getCustomerPaymentRank(item);
            const itemCategory = (item.category || '').trim();
            // CRM resolved through the roster, so an account saved under a
            // display name still lands in its owner's portfolio.
            const ownerRaw = (item.crmOwnerId || '').trim();
            const ownerK = ownerRaw ? ownerKey(findOwner(users, ownerRaw)?.id || ownerRaw) : '';
            // Ageing — on what is actually overdue, never on a credit that
            // happens to be old. See overdueAgeing().
            const { a1, a2, a3, over45, over90, over135 } = overdueAgeing(item);
            const isCurrent = a1 > 0 && over45 <= 0;
            const balance = item.totalType || 'Dr';
            const origin = item.isNewCustomer ? 'NEW' : 'SHEET';
            // Read from the date, not the stored word: a row due yesterday is
            // overdue this morning whether or not anything has saved it since.
            const followUp = followUpStatusOf(item, today);

            // Which filters the row fails.
            const fails = new Set<Dim>();
            if (rankFilter !== 'ALL' && rank !== rankFilter) fails.add('rank');
            if (categoryFilter !== 'ALL' && (categoryFilter === 'UNCATEGORISED' ? itemCategory !== '' : itemCategory !== categoryFilter)) fails.add('category');
            if (selectedCrm !== 'ALL' && (selectedCrm === 'UNASSIGNED' ? ownerRaw !== '' : ownerK !== ownerKey(selectedCrm))) fails.add('crm');
            if (ageingFilter !== 'all') {
                if (ageingFilter === 'current' && !isCurrent) fails.add('ageing');
                if (ageingFilter === 'over90' && over90 <= 0) fails.add('ageing');
                if (ageingFilter === 'over135' && over135 <= 0) fails.add('ageing');
                if (ageingFilter === 'dueOver45' && over45 <= 0) fails.add('ageing');
                if (ageingFilter === '91-135' && a3 <= 0) fails.add('ageing');
                if (ageingFilter === '46-90' && a2 <= 0) fails.add('ageing');
                if (ageingFilter === '1-45' && a1 <= 0) fails.add('ageing');
            }
            if (statusFilter !== 'ALL' && followUp !== statusFilter) fails.add('status');
            if (balanceTypeFilter !== 'ALL' && balance !== balanceTypeFilter) fails.add('balance');
            if (originFilter === 'NEW' && !item.isNewCustomer) fails.add('origin');
            if (originFilter === 'SHEET' && item.isNewCustomer) fails.add('origin');

            const inThisTab = matchesSettlement(item, settlementFilter);
            if (fails.size === 0) {
                if (inThisTab) kept.push(item);
                else hidden++;
            }
            if (!inThisTab) return;

            // The row counts towards a control when it fails nothing but that
            // control's own filter.
            const countsFor = (d: Dim) => fails.size === 0 || (fails.size === 1 && fails.has(d));
            if (countsFor('rank')) { counts.rank.ALL++; counts.rank[rank]++; }
            if (countsFor('ageing')) {
                counts.ageing.all++;
                if (isCurrent) counts.ageing.current++;
                if (over45 > 0) counts.ageing.dueOver45++;
                if (over90 > 0) counts.ageing.over90++;
                if (over135 > 0) counts.ageing.over135++;
            }
            if (countsFor('category')) { counts.categoryAll++; if (itemCategory) bump(counts.category, itemCategory); else counts.uncategorised++; }
            if (countsFor('crm')) { counts.crmAll++; if (ownerK) bump(counts.crm, ownerK); else counts.unassigned++; }
            if (countsFor('status')) { counts.statusAll++; bump(counts.status, followUp); }
            if (countsFor('balance')) { counts.balance.ALL++; counts.balance[balance === 'Cr' ? 'Cr' : 'Dr']++; }
            if (countsFor('origin')) { counts.origin.ALL++; counts.origin[origin]++; }
        });
        return { filteredData: kept, hiddenBySettlement: hidden, counts };
    }, [userAllowedData, users, globalSearch, searchTerm, rankFilter, selectedCrm, settlementFilter, categoryFilter, ageingFilter, statusFilter, balanceTypeFilter, originFilter]);
    const rankCounts = counts.rank;

    /**
     * The overdue column follows the ageing chip. With ">90d" pressed the
     * question is how much of each account is past 90 days, so that is the
     * figure shown and the order of the list — largest first — rather than
     * "Due >45 days" in alphabetical order under every chip, which is what
     * made the three chips look like they were not doing anything.
     */
    const focusColumn = useMemo(() => {
        switch (ageingFilter) {
            case 'current': return { label: 'Within 45 days', pick: (o: ReturnType<typeof overdueAgeing>) => o.a1 };
            case 'over90': return { label: 'Due >90 days', pick: (o: ReturnType<typeof overdueAgeing>) => o.over90 };
            case 'over135': return { label: 'Due >135 days', pick: (o: ReturnType<typeof overdueAgeing>) => o.over135 };
            case '1-45': return { label: '1–45 days', pick: (o: ReturnType<typeof overdueAgeing>) => o.a1 };
            case '46-90': return { label: '46–90 days', pick: (o: ReturnType<typeof overdueAgeing>) => o.a2 };
            case '91-135': return { label: '91–135 days', pick: (o: ReturnType<typeof overdueAgeing>) => o.a3 };
            default: return { label: 'Due >45 days', pick: (o: ReturnType<typeof overdueAgeing>) => o.over45 };
        }
    }, [ageingFilter]);

    /** True while somebody is looking for a particular customer. */
    const isSearching = Boolean(globalSearch.trim() || searchTerm.trim());

    /**
     * On the settled tab, newest first.
     *
     * The list is three thousand rows and alphabetical by default, which buries
     * the account that cleared this morning — the one somebody was mid-
     * conversation with, and the whole reason for looking. Accounts settled
     * before the app started recording the date keep their alphabetical place
     * at the bottom.
     */
    const orderedData = useMemo(() => {
        if (settlementFilter !== 'settled' && ageingFilter !== 'all') {
            return [...filteredData].sort((a, b) => focusColumn.pick(overdueAgeing(b)) - focusColumn.pick(overdueAgeing(a)) || a.company.localeCompare(b.company));
        }
        if (settlementFilter !== 'settled') return filteredData;
        return [...filteredData].sort((a, b) => {
            const at = a.settledAt || '';
            const bt = b.settledAt || '';
            if (at && bt) return bt.localeCompare(at);
            if (at) return -1;
            if (bt) return 1;
            return a.company.localeCompare(b.company);
        });
    }, [filteredData, settlementFilter, ageingFilter, focusColumn]);
    useEffect(() => { onVisibleRowsChange?.(orderedData.map(r => r.id)); }, [orderedData, onVisibleRowsChange]);

    // Metrics summary for filtered dataset
    const metrics = useMemo(() => {
        let totalSum = 0;
        let debitSum = 0;
        let creditSum = 0;
        let due45Sum = 0;
        let over90Sum = 0;
        let over135Sum = 0;
        let forecastSum = 0;
        let newCount = 0;
        let goodCount = 0;
        let lateCount = 0;
        let badCount = 0;
        let lateDebitSum = 0;
        let badDebitSum = 0;
        let goodDebitSum = 0;

        filteredData.forEach(item => {
            const isCr = item.totalType === 'Cr';
            const itemTotal = item.total || 0;
            if (isCr) {
                creditSum += itemTotal;
            } else {
                debitSum += itemTotal;
            }
            totalSum += isCr ? -itemTotal : itemTotal;

            const overdue = overdueAgeing(item);
            due45Sum += overdue.over45;
            over90Sum += overdue.over90;
            over135Sum += overdue.over135;
            forecastSum += (item.forecastAmount || 0);
            if (item.isNewCustomer) newCount++;

            const rank = getCustomerPaymentRank(item);
            if (rank === 'Good') {
                goodCount++;
                if (!isCr) goodDebitSum += itemTotal;
            } else if (rank === 'Late') {
                lateCount++;
                if (!isCr) lateDebitSum += itemTotal;
            } else {
                badCount++;
                if (!isCr) badDebitSum += itemTotal;
            }
        });

        return {
            count: filteredData.length,
            totalSum,
            debitSum,
            creditSum,
            due45Sum,
            over90Sum,
            over135Sum,
            forecastSum,
            newCount,
            goodCount,
            lateCount,
            badCount,
            lateDebitSum,
            goodDebitSum,
            badDebitSum
        };
    }, [filteredData]);

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedCustomerIds(filteredData.map(d => d.id));
        } else {
            setSelectedCustomerIds([]);
        }
    };

    const handleToggleRow = (id: string) => {
        setSelectedCustomerIds(prev => 
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const handleApplyBulkCrm = () => {
        if (!bulkCrm) {
            alert('Please select a CRM.');
            return;
        }
        if (selectedCustomerIds.length === 0) {
            alert('Please select customers.');
            return;
        }
        if (onBulkReassignCrm) {
            onBulkReassignCrm(selectedCustomerIds, bulkCrm);
            setSelectedCustomerIds([]);
            setBulkCrm('');
        }
    };

    /* The ledger fits the viewport now, so the slider, the First/Left/Right/Last
       buttons and the scroll-percentage readout that used to compensate for a
       1845px table are gone. The container keeps overflow-x for very narrow
       windows; the browser scrolls it. */

    return (
        <div className="w-full space-y-3.5 pb-2">
            {/* Top Header Banner */}
            <div className="bg-card rounded-[16px] shadow-e1 px-5 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 max-md:hidden">
                <div>
                    {/* The count and the sheet date are in the page subtitle already; here
                        the one useful thing is the overview toggle. */}
                    <button
                        type="button"
                        onClick={toggleOverview}
                        aria-expanded={overviewOpen}
                        className="inline-flex items-center gap-2 h-8 px-2.5 -ml-2.5 rounded-lg text-[13px] font-semibold text-label-2 hover:bg-hover hover:text-label"
                    >
                        <span className={`transition-transform ${overviewOpen ? 'rotate-90' : ''}`} aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 2.5 7.5 6 4 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </span>
                        Book overview
                        {!overviewOpen && <span className="text-label-3 font-medium">· {formatCurrency(metrics.debitSum)} receivable · {metrics.count} accounts</span>}
                    </button>
                    <div className="hidden">
                        <span>Signed in as <strong className="text-label font-semibold">{currentUser?.name}</strong> ({currentUser?.role})</span>
                        <span className="text-label-3">•</span>
                        <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-pos"></span>
                            Rights: {[canAddCustomer && 'Add', canEditCustomer && 'Edit', canEditFollowUp && 'Follow-up', canManagePdc && 'PDC', isAdmin && 'Admin'].filter(Boolean).join(' · ')}
                        </span>
                    </div>
                </div>

                {/* Primary Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto max-md:[&>button]:min-h-[40px]">
                    {/* Add Customer Button */}
                    <button
                        onClick={onAddCustomer}
                        disabled={!canAddCustomer}
                        title={canAddCustomer ? 'Create a new customer master account' : 'You do not have permission to add new customers'}
                        className={`px-3.5 py-1.5 text-xs font-extrabold rounded-lg transition-all shadow-sm flex items-center gap-1.5 ${
                            canAddCustomer
                                ? 'bg-accent hover:bg-accent-press text-on-accent cursor-pointer'
                                : 'bg-card-3 text-label-2 cursor-not-allowed'
                        }`}
                    >
                        <span>Add customer</span>
                        
                    </button>

                    {/* Export Excel */}
                    {onExportExcel && canExport && (
                        <button
                            onClick={() => onExportExcel(filteredData)}
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-card hover:bg-card-3 text-label-2 hover:text-label border border-separator-strong transition-colors flex items-center gap-1"
                            title="Export filtered customer list to Excel / CSV"
                        >
                            <DownloadIcon className="w-3.5 h-3.5" />
                            <span>Export</span>
                        </button>
                    )}

                    {/* Table / Cards toggle */}
                    <div className="flex bg-card-3 p-0.5 rounded-lg border border-separator max-md:hidden">
                        <button
                            onClick={() => setViewMode('table')}
                            className={`h-8 px-3 text-xs font-semibold rounded-lg transition-all ${viewMode === 'table' ? 'bg-card text-label ' : 'text-label-3 hover:text-label'}`}
                            title="Detailed Compact Table View"
                        >
                            Table
                        </button>
                        <button
                            onClick={() => setViewMode('cards')}
                            className={`h-8 px-3 text-xs font-semibold rounded-lg transition-all ${viewMode === 'cards' ? 'bg-card text-label ' : 'text-label-3 hover:text-label'}`}
                            title="Customer Cards View"
                        >
                            Cards
                        </button>
                    </div>
                </div>
            </div>

            {overviewOpen && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 max-md:flex max-md:overflow-x-auto max-md:snap-x max-md:snap-mandatory max-md:-mx-4 max-md:px-4 max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&>div]:min-w-[172px] max-md:[&>div]:snap-start">
                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Receivables</p>
                    <p className="num text-[19px] font-medium text-label mt-1.5 tracking-[-0.02em]">{formatCurrency(metrics.debitSum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">{metrics.count} accounts</p>
                </div>

                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Good payers</p>
                    <p className="num text-[19px] font-medium text-label mt-1.5 tracking-[-0.02em]">{formatCurrency(metrics.goodDebitSum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">{metrics.goodCount} accounts</p>
                </div>

                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Late payers</p>
                    <p className="num text-[19px] font-medium text-label mt-1.5 tracking-[-0.02em]">{formatCurrency(metrics.lateDebitSum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">{metrics.lateCount} accounts</p>
                </div>

                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Bad debt &mdash; defaulters</p>
                    <p className="num text-[19px] font-medium mt-1.5 tracking-[-0.02em]" style={{ color: 'var(--age-4-ink)' }}>{formatCurrency(metrics.badDebitSum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">{metrics.badCount} named defaulters · agency list</p>
                </div>

                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Past 45 days</p>
                    <p className="num text-[19px] font-medium mt-1.5 tracking-[-0.02em]" style={{ color: 'var(--age-2-ink)' }}>{formatCurrency(metrics.due45Sum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">Working capital held up</p>
                </div>

                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Past 90 days</p>
                    <p className="num text-[19px] font-medium mt-1.5 tracking-[-0.02em]" style={{ color: 'var(--age-3-ink)' }}>{formatCurrency(metrics.over90Sum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">Recovery risk</p>
                </div>

                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Advance held</p>
                    <p className="num text-[19px] font-medium mt-1.5 tracking-[-0.02em]" style={{ color: 'var(--age-1-ink)' }}>{formatCurrency(metrics.creditSum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">Credit with us</p>
                </div>
            </div>
            )}

            {/* Accounts nobody owns yet — one click to work through them */}
            {canReassignCrm && unassigned.length > 0 && selectedCrm !== 'UNASSIGNED' && (
                <button
                    type="button"
                    onClick={() => setSelectedCrm('UNASSIGNED')}
                    className="w-full text-left rounded-[16px] border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-5 py-3.5 hover:brightness-[0.98] transition-all"
                >
                    <p className="text-[13px] font-bold text-amber-900 dark:text-amber-200">
                        {unassigned.length} customer{unassigned.length === 1 ? '' : 's'} have no CRM against them
                        {unassignedOwing.length > 0 && (
                            <span className="font-semibold">
                                {' '}— {unassignedOwing.length} of them owing {formatCurrency(
                                    unassignedOwing.reduce((sum, i) => sum + (Number(i.total) || 0), 0)
                                )}
                            </span>
                        )}
                    </p>
                    <p className="text-[12px] text-amber-800 dark:text-amber-300 mt-0.5">
                        These came in from the outstanding sheet before they were in the customer list.
                        Click to open them and set an owner — nobody is chasing them until you do.
                    </p>
                </button>
            )}

            {/* Compact Filter Controls Card */}
            <div className="bg-card rounded-[16px] shadow-e1 p-5 space-y-3.5 max-md:p-3 max-md:space-y-2.5">
                {/* Which half of the book. First control on the card, because it
                    decides what every filter under it is narrowing. Settled
                    customers keep every note, cheque and word of their history —
                    they are one click away, not hidden. */}
                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-xl bg-card-2 p-1 gap-1 max-md:flex max-md:w-full" role="group" aria-label="Show accounts with dues, settled accounts, or all">
                        {(['withDues', 'settled', 'all'] as SettlementFilter[]).map(key => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setSettlementFilter(key)}
                                aria-pressed={settlementFilter === key}
                                className={`h-8 px-3.5 rounded-lg text-[13px] font-bold transition-colors max-md:flex-1 max-md:px-1 max-md:h-11 max-md:text-[12.5px] max-md:whitespace-nowrap ${
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
                    <p className="text-[12.5px] text-label-3 max-md:hidden">
                        {settlementFilter === 'withDues'
                            ? 'Accounts that owe something, or are in credit. Settled customers are on the next tab, with their full history.'
                            : settlementFilter === 'settled'
                                ? 'Paid up and nothing outstanding. Every note, cheque and follow-up they ever had is still on the account.'
                                : 'Everyone on the books, settled or not.'}
                    </p>
                </div>

                {/* Search, Rank, CRM, Status Filters Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2">
                    {/* Live Search */}
                    <div className="lg:col-span-4 relative">
                        <label className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5 max-md:hidden">
                            Search Customer / Phone / City
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                value={searchDraft}
                                onChange={e => setSearchDraft(e.target.value)}
                                placeholder="Search by name, contact, mobile, GST, city..."
                                className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-accent font-medium max-md:h-11 max-md:text-[15px] max-md:pl-10 max-md:rounded-xl"
                            />
                            <svg className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400 max-md:top-3.5 max-md:left-3.5 max-md:w-4 max-md:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.5-4.5" strokeLinecap="round" /></svg>
                            {searchTerm && (
                                <button
                                    type="button"
                                    onClick={() => { setSearchDraft(''); setSearchTerm(''); }}
                                    aria-label="Clear the search"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 max-md:w-10 max-md:h-10 grid place-items-center rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs font-bold"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Phone only: one row of controls — the four selects fold
                        behind Filters, and the buttons the desktop banner carries
                        (add an account, the money tiles, the export) live here so
                        the list starts within a thumb's reach of the search. */}
                    <div className="md:hidden flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setPhoneFiltersOpen(v => !v)}
                            aria-expanded={phoneFiltersOpen}
                            className="flex-1 h-11 rounded-xl border border-separator-strong bg-card text-[13.5px] font-semibold text-label-2 flex items-center justify-center gap-2"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                            {phoneFiltersOpen ? 'Hide filters' : 'Filters'}
                            {activeFilterCount > 0 && (
                                <span className="num text-[11px] font-bold px-1.5 py-[2px] rounded-full bg-accent text-on-accent">
                                    {activeFilterCount}
                                </span>
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={toggleOverview}
                            aria-expanded={overviewOpen}
                            className="h-11 px-3.5 rounded-xl border border-separator-strong bg-card text-[13.5px] font-semibold text-label-2"
                        >
                            {overviewOpen ? 'Hide totals' : 'Totals'}
                        </button>
                        {canAddCustomer && (
                            <button
                                type="button"
                                onClick={onAddCustomer}
                                aria-label="Add customer"
                                className="h-11 w-11 flex-none grid place-items-center rounded-xl bg-accent text-on-accent text-[22px] font-bold leading-none shadow-e1 active:brightness-95"
                            >
                                +
                            </button>
                        )}
                    </div>

                    {/* Payment Rank Filter Dropdown */}
                    <div className={`lg:col-span-2 ${phoneFiltersOpen ? '' : 'max-md:hidden'}`}>
                        <label className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">
                            Payment Rank
                        </label>
                        <select aria-label="Payment Rank"
                            value={rankFilter}
                            onChange={e => setRankFilter(e.target.value as any)}
                            className="w-full py-1.5 px-2.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-bold focus:ring-2 focus:ring-accent max-md:h-11 max-md:text-[14px]"
                        >
                            <option value="ALL">All ranks ({rankCounts.ALL})</option>
                            <option value="Good">Good — pays to terms ({rankCounts.Good})</option>
                            <option value="Late">Late pay — slow but paying ({rankCounts.Late})</option>
                            <option value="Bad">Bad debt — named defaulters ({rankCounts.Bad})</option>
                        </select>
                    </div>

                    {/* Category Filter Dropdown — Builder / Dealer / Retailer / trade */}
                    <div className={`lg:col-span-2 ${phoneFiltersOpen ? '' : 'max-md:hidden'}`}>
                        <label className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">
                            Category
                        </label>
                        <select aria-label="Filter by customer category"
                            value={categoryFilter}
                            onChange={e => setCategoryFilter(e.target.value)}
                            className="w-full py-1.5 px-2.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-bold focus:ring-2 focus:ring-accent max-md:h-11 max-md:text-[14px]"
                        >
                            <option value="ALL">All categories ({counts.categoryAll})</option>
                            {categoriesInData.list.map(([name]) => (
                                <option key={name} value={name}>{name} ({counts.category.get(name) || 0})</option>
                            ))}
                            {categoriesInData.uncategorised > 0 && (
                                <option value="UNCATEGORISED">Not set ({counts.uncategorised})</option>
                            )}
                        </select>
                    </div>

                    {/* CRM Filter Dropdown */}
                    <div className={`lg:col-span-2 ${phoneFiltersOpen ? '' : 'max-md:hidden'}`}>
                        <label className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">
                            CRM Owner
                        </label>
                        <select aria-label="Filter by CRM owner"
                            value={selectedCrm}
                            onChange={e => setSelectedCrm(e.target.value)}
                            disabled={!canViewAllCrms && currentUser?.role === UserRole.CRM}
                            className="w-full py-1.5 px-2.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-bold focus:ring-2 focus:ring-accent disabled:opacity-60 max-md:h-11 max-md:text-[14px]"
                        >
                            <option value="ALL">All CRMs ({counts.crmAll})</option>
                            {allCrmsInDataset.map(crm => (
                                <option key={crm} value={crm}>{crm} ({counts.crm.get(ownerKey(crm)) || 0})</option>
                            ))}
                            <option value="UNASSIGNED">Unassigned ({counts.unassigned})</option>
                        </select>
                    </div>

                    {/* Status Filter */}
                    <div className={`lg:col-span-2 ${phoneFiltersOpen ? '' : 'max-md:hidden'}`}>
                        <label className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">
                            Status
                        </label>
                        <select aria-label="Status"
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            className="w-full py-1.5 px-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-medium focus:ring-2 focus:ring-accent max-md:h-11 max-md:text-[14px]"
                        >
                            <option value="ALL">All statuses ({counts.statusAll})</option>
                            <option value={FollowUpStatus.Today}>Due today ({counts.status.get(FollowUpStatus.Today) || 0})</option>
                            <option value={FollowUpStatus.Overdue}>Overdue ({counts.status.get(FollowUpStatus.Overdue) || 0})</option>
                            <option value={FollowUpStatus.Upcoming}>Upcoming ({counts.status.get(FollowUpStatus.Upcoming) || 0})</option>
                            <option value={FollowUpStatus.Pending}>Pending ({counts.status.get(FollowUpStatus.Pending) || 0})</option>
                            <option value={FollowUpStatus.Completed}>Completed ({counts.status.get(FollowUpStatus.Completed) || 0})</option>
                        </select>
                    </div>
                </div>

                {/* Secondary filters stay available, just out of the way until asked for. */}
                <div className={`flex items-center justify-between gap-2 pt-2 border-t border-separator ${phoneFiltersOpen ? '' : 'max-md:hidden'}`}>
                    <button
                        type="button"
                        onClick={() => setShowMoreFilters(v => !v)}
                        aria-expanded={showMoreFilters}
                        className="inline-flex items-center gap-1.5 h-8 px-1 -mx-1 text-[13.5px] font-semibold text-label-2 hover:text-label transition-colors"
                    >
                        <svg className={`w-4 h-4 transition-transform ${showMoreFilters ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9.5 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        {showMoreFilters ? 'Fewer filters' : 'More filters'}
                    </button>
                    {activeFilterCount > 0 && (
                        <span className="text-[13px] text-label-3">{activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} on</span>
                    )}
                </div>
                {showMoreFilters && (
                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-gray-100 dark:border-gray-700/60">
                    <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[11.5px] font-bold text-gray-500 dark:text-gray-400 mr-1">Rank:</span>
                        <button
                            onClick={() => setRankFilter('ALL')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                rankFilter === 'ALL'
                                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
                            }`}
                        >
                            All ({rankCounts.ALL})
                        </button>
                        <button
                            onClick={() => setRankFilter(rankFilter === 'Good' ? 'ALL' : 'Good')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                rankFilter === 'Good'
                                    ? 'bg-pos text-card ring-1 ring-pos'
                                    : 'bg-pos-bg text-pos border border-separator'
                            }`}
                        >
                            Good ({rankCounts.Good})
                        </button>
                        <button
                            onClick={() => setRankFilter(rankFilter === 'Late' ? 'ALL' : 'Late')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                rankFilter === 'Late'
                                    ? 'bg-warn text-card ring-1 ring-warn'
                                    : 'bg-warn-bg text-warn border border-separator'
                            }`}
                        >
                            Late pay ({rankCounts.Late})
                        </button>
                        <button
                            onClick={() => setRankFilter(rankFilter === 'Bad' ? 'ALL' : 'Bad')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                rankFilter === 'Bad'
                                    ? 'bg-dang text-card ring-1 ring-dang'
                                    : 'bg-dang-bg text-dang border border-separator'
                            }`}
                        >
                            Bad debt ({rankCounts.Bad})
                        </button>

                        <span className="text-[11.5px] font-bold text-gray-400 dark:text-gray-500 mx-1">|</span>
                        <span className="text-[11.5px] font-bold text-gray-500 dark:text-gray-400 mr-1">Ageing:</span>
                        <button
                            onClick={() => setAgeingFilter('all')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                ageingFilter === 'all'
                                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
                            }`}
                        >
                            All ageing ({counts.ageing.all})
                        </button>
                        <button
                            onClick={() => setAgeingFilter(ageingFilter === 'current' ? 'all' : 'current')}
                            title="Owes something, and none of it is older than 45 days"
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                ageingFilter === 'current'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-pos border border-emerald-200 dark:border-emerald-800'
                            }`}
                        >
                            Current &le;45d ({counts.ageing.current})
                        </button>
                        <button
                            onClick={() => setAgeingFilter(ageingFilter === 'dueOver45' ? 'all' : 'dueOver45')}
                            title="Something owed is more than 45 days old"
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                ageingFilter === 'dueOver45'
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                            }`}
                        >
                            &gt;45d ({counts.ageing.dueOver45})
                        </button>
                        <button
                            onClick={() => setAgeingFilter(ageingFilter === 'over90' ? 'all' : 'over90')}
                            title="Something owed is more than 90 days old"
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                ageingFilter === 'over90'
                                    ? 'bg-orange-600 text-white'
                                    : 'bg-orange-50 dark:bg-orange-950/40 text-age-3-ink border border-orange-200 dark:border-orange-800'
                            }`}
                        >
                            &gt;90d ({counts.ageing.over90})
                        </button>
                        <button
                            onClick={() => setAgeingFilter(ageingFilter === 'over135' ? 'all' : 'over135')}
                            title="Something owed is more than 135 days old"
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                ageingFilter === 'over135'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-red-50 dark:bg-red-950/40 text-dang border border-red-200 dark:border-red-800'
                            }`}
                        >
                            &gt;135d ({counts.ageing.over135})
                        </button>
                    </div>

                    {/* Balance Type & Origin Toggles */}
                    <div className="flex items-center gap-1.5">
                        <select
                            aria-label="Filter by balance type"
                            value={balanceTypeFilter}
                            onChange={e => setBalanceTypeFilter(e.target.value as any)}
                            className="text-[12.5px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 font-semibold text-gray-800 dark:text-gray-200"
                        >
                            <option value="ALL">All balances ({counts.balance.ALL})</option>
                            <option value="Dr">Dr — owes us ({counts.balance.Dr})</option>
                            <option value="Cr">Cr — in credit ({counts.balance.Cr})</option>
                        </select>

                        <select
                            aria-label="Filter by where the customer came from"
                            value={originFilter}
                            onChange={e => setOriginFilter(e.target.value as any)}
                            className="text-[12.5px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 font-semibold text-gray-800 dark:text-gray-200"
                        >
                            <option value="ALL">All sources ({counts.origin.ALL})</option>
                            <option value="NEW">Created here ({counts.origin.NEW})</option>
                            <option value="SHEET">From the sheet ({counts.origin.SHEET})</option>
                        </select>

                        {(searchTerm || activeFilterCount > 0) && (
                            <button
                                onClick={() => {
                                    setSearchDraft('');
                                    setSearchTerm('');
                                    setRankFilter('ALL');
                                    setCategoryFilter('ALL');
                                    setSelectedCrm('ALL');
                                    setAgeingFilter('all');
                                    setStatusFilter('ALL');
                                    setBalanceTypeFilter('ALL');
                                    setOriginFilter('ALL');
                                }}
                                className="text-[12.5px] text-dang font-bold hover:underline px-1"
                            >
                                Reset
                            </button>
                        )}
                    </div>
                </div>
                )}
            </div>

            {/* Bulk Reassign CRM Bar (If selected) */}
            {(canReassignCrm || canEditCustomer) && selectedCustomerIds.length > 0 && (
                /* On a phone the bar follows the list down, so what has been
                   picked and what can be done to it stay above the tab bar. */
                <div className="p-2.5 bg-accent-tint rounded-xl border border-separator flex flex-wrap items-center justify-between gap-2 animate-in fade-in max-md:sticky max-md:bottom-[calc(72px+env(safe-area-inset-bottom))] max-md:z-30 max-md:shadow-e2 max-md:[&_select]:min-h-[40px] max-md:[&_button]:min-h-[40px]">
                    <div className="flex items-center gap-2 text-xs font-bold text-label">
                        <span>{selectedCustomerIds.length} selected</span>
                        <button
                            type="button"
                            onClick={() => setSelectedCustomerIds([])}
                            className="px-2 py-1 min-h-[30px] rounded-md text-[12px] font-semibold text-label-2 hover:bg-hover"
                        >
                            Clear
                        </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {canEditCustomer && onBulkSetRank && (
                            <>
                                <select
                                    aria-label="Set payment rank on the selected customers"
                                    value={bulkRank}
                                    onChange={e => setBulkRank(e.target.value as PaymentRank | '')}
                                    className="px-2 py-1.5 min-h-[32px] text-xs rounded-lg border border-separator bg-card font-bold text-label"
                                >
                                    <option value="">Set rank…</option>
                                    <option value="Good">Good</option>
                                    <option value="Late">Late pay</option>
                                    <option value="Bad">Bad debt</option>
                                </select>
                                <button
                                    onClick={() => {
                                        if (!bulkRank) return;
                                        onBulkSetRank(selectedCustomerIds, bulkRank);
                                        setBulkRank('');
                                        setSelectedCustomerIds([]);
                                    }}
                                    disabled={!bulkRank}
                                    className="px-3 py-1.5 min-h-[32px] bg-accent text-card text-xs font-bold rounded-lg disabled:opacity-40"
                                >
                                    Apply rank
                                </button>
                            </>
                        )}
                        {canReassignCrm && (
                            <>
                                <select
                                    aria-label="Reassign the selected customers to a CRM"
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
                                    onClick={handleApplyBulkCrm}
                                    className="px-3 py-1.5 min-h-[32px] bg-accent text-card text-xs font-bold rounded-lg"
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
                                        aria-label="Follow-up date to set on the selected customers"
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
                                    className="px-3 py-1.5 min-h-[32px] bg-accent text-card text-xs font-bold rounded-lg disabled:opacity-40"
                                >
                                    Set follow-up
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Main Content: Dense & Realigned Table View vs Card View */}
            {filteredData.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs">
                    <svg className="w-8 h-8 mx-auto mb-2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.5-4.5" strokeLinecap="round" /></svg>
                    <h3 className="text-sm font-bold text-gray-800 dark:text-white">
                        {hiddenBySettlement > 0
                            ? `Nothing here, but ${hiddenBySettlement} ${settlementFilter === 'withDues' ? 'settled' : 'unsettled'} customer${hiddenBySettlement === 1 ? '' : 's'} match${hiddenBySettlement === 1 ? 'es' : ''}`
                            : 'No Customers Match Current Filters'}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-md mx-auto">
                        {hiddenBySettlement > 0
                            ? (isSearching
                                ? `You are looking at "${SETTLEMENT_LABELS[settlementFilter]}". Whoever you are searching for is on another tab.`
                                : `The "${SETTLEMENT_LABELS[settlementFilter]}" tab is holding these back.`)
                            : 'Nothing matches this search and these filters.'}
                    </p>
                    {hiddenBySettlement === 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                setSearchTerm('');
                                setRankFilter('ALL');
                                setCategoryFilter('ALL');
                                setSelectedCrm('ALL');
                                setAgeingFilter('all');
                                setStatusFilter('ALL');
                                setBalanceTypeFilter('ALL');
                                setOriginFilter('ALL');
                            }}
                            className="mt-3 px-3.5 py-1.5 bg-accent text-on-accent text-xs font-bold rounded-lg shadow-sm"
                        >
                            Clear search and filters
                        </button>
                    )}
                    {hiddenBySettlement > 0 && (
                        <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
                            <button
                                onClick={() => setSettlementFilter(settlementFilter === 'withDues' ? 'settled' : 'withDues')}
                                className="px-3.5 py-1.5 bg-accent text-on-accent text-xs font-bold rounded-lg shadow-sm"
                            >
                                Show {settlementFilter === 'withDues' ? 'settled' : 'with dues'} ({hiddenBySettlement})
                            </button>
                            <button
                                onClick={() => setSettlementFilter('all')}
                                className="px-3.5 py-1.5 bg-card hover:bg-card-3 text-label-2 border border-separator-strong text-xs font-bold rounded-lg"
                            >
                                Search all customers
                            </button>
                        </div>
                    )}
                    {canAddCustomer && (
                        <button
                            onClick={onAddCustomer}
                            className="mt-3 h-9 px-4 bg-accent hover:bg-accent-press text-on-accent text-[13px] font-semibold rounded-full shadow-e1 transition-all inline-flex items-center gap-1"
                        >
                            <span>Add customer</span>
                        </button>
                    )}
                </div>
            ) : isPhone ? (
                /* Phone: one row per account, the whole row opens it. */
                <div className="bg-card rounded-[16px] shadow-e1 overflow-hidden">
                    <div className="px-3.5 py-2 bg-card-2 border-b border-separator flex items-center justify-between gap-3 text-[12.5px]">
                        <span className="font-bold text-label">
                            {filteredData.length.toLocaleString('en-IN')} account{filteredData.length === 1 ? '' : 's'}
                        </span>
                        {(canReassignCrm || canEditCustomer) && (
                            phoneSelecting ? (
                                <span className="flex items-center gap-3">
                                    <label className="inline-flex items-center gap-2 font-semibold text-label-2 min-h-[40px]">
                                        <input
                                            type="checkbox"
                                            checked={selectedCustomerIds.length === filteredData.length && filteredData.length > 0}
                                            onChange={e => handleSelectAll(e.target.checked)}
                                            aria-label="Select all customers in view"
                                            className="w-5 h-5 rounded text-accent focus:ring-accent"
                                        />
                                        All
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => { setPhoneSelecting(false); handleSelectAll(false); }}
                                        className="min-h-[40px] px-2 font-bold text-accent"
                                    >
                                        Done
                                    </button>
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setPhoneSelecting(true)}
                                    className="min-h-[40px] px-2 font-semibold text-label-2"
                                >
                                    Select
                                </button>
                            )
                        )}
                    </div>
                    <div className="divide-y divide-separator">
                        {orderedData.slice(0, visibleCount).map(item => (
                            <PhoneAccountRow
                                key={item.id}
                                item={item}
                                today={today}
                                ownerName={findOwner(users, item.crmOwnerId)?.name}
                                onOpen={() => onFollowUp(item)}
                                onWhatsApp={() => onWhatsApp(item)}
                                selectable={phoneSelecting && (canReassignCrm || canEditCustomer)}
                                selected={selectedCustomerIds.includes(item.id)}
                                onToggleSelect={() => handleToggleRow(item.id)}
                                canFollowUp={canEditFollowUp}
                            />
                        ))}
                    </div>
                    {visibleCount < filteredData.length && (
                        <div className="p-3 border-t border-separator">
                            <button
                                onClick={() => setVisibleCount(c => c + PAGE * 2)}
                                className="w-full h-11 rounded-xl bg-card-2 active:bg-press text-[14px] font-semibold text-label-2"
                            >
                                Show more &mdash; {(filteredData.length - visibleCount).toLocaleString('en-IN')} left
                            </button>
                        </div>
                    )}
                </div>
            ) : viewMode === 'table' ? (
                /* Customer Data Table with Dedicated Smooth Horizontal Scroll Container */
                <div className="w-full max-w-full bg-card rounded-[16px] shadow-e1 overflow-hidden flex flex-col">
                    {/* Top Table Control Bar with Quick Horizontal Scroll Slider & Navigation */}
                    <div className="px-3.5 py-2.5 bg-card-2 border-b border-separator flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                                                                <span>{filteredData.length.toLocaleString('en-IN')} account{filteredData.length === 1 ? '' : 's'}</span>
                            </span>
                            {/* What the bar colours mean, said once instead of per row. */}
                            <AgeingLegend className="gap-3" />
                            {ageingFilter !== 'all' && settlementFilter !== 'settled' && (
                                <span className="text-[12px] text-label-3 font-medium">· {focusColumn.label.toLowerCase()}, largest first</span>
                            )}
                        </div>

                    </div>

                    {/* Horizontal Scroll Container (Strict containment without triggering body scroll) */}
                    <div 
                        id="customer-table-scroll-container"
                        className="w-full max-w-full overflow-x-auto overflow-y-visible scrollbar-thin scrollbar-thumb-gray-400 hover:scrollbar-thumb-gray-500 dark:scrollbar-thumb-gray-600 dark:hover:scrollbar-thumb-gray-500 scrollbar-track-slate-100 dark:scrollbar-track-gray-800 focus:outline-none"
                        tabIndex={0}
                    >
                        <table className="min-w-[940px] xl:min-w-[1140px] w-full text-xs text-left border-collapse table-auto">
                            <thead className="bg-slate-100/95 dark:bg-gray-800/95 text-gray-700 dark:text-gray-300 font-bold uppercase tracking-wider border-b border-gray-200 dark:border-gray-700 text-[11.5px] sticky top-0 z-10 backdrop-blur-xs">
                                <tr>
                                    {(canReassignCrm || canEditCustomer) && (
                                        <th className="px-2.5 py-2.5 w-12 text-center">
                                            <label className="inline-flex items-center justify-center p-2 -m-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedCustomerIds.length === filteredData.length && filteredData.length > 0}
                                                    onChange={e => handleSelectAll(e.target.checked)}
                                                    className="w-4 h-4 rounded text-pos focus:ring-accent cursor-pointer" style={{ outlineOffset: 6 }}
                                                    title="Select all customers on view"
                                                    aria-label="Select all customers in view"
                                                />
                                            </label>
                                        </th>
                                    )}
                                    <th className="px-3.5 py-2.5 min-w-[210px] max-xl:min-w-[200px]">Customer & Contact Details</th>
                                    <th className="px-3 py-2.5 text-right w-24">Balance</th>
                                    <th className="px-2.5 py-2.5 text-left w-[204px] min-w-[204px] max-xl:w-[130px] max-xl:min-w-[130px]">Ageing</th>
                                    <th className="px-2.5 py-2.5 text-right w-30 bg-rose-50/40 dark:bg-rose-950/20 font-extrabold text-rose-800 dark:text-rose-300 max-xl:hidden">{focusColumn.label}</th>
                                    <th className="px-2.5 py-2.5 text-center w-36 max-xl:w-[120px]">Follow-up / Status</th>
                                    <th className="px-2.5 py-2.5 text-left w-32 max-xl:w-24">CRM Owner</th>
                                    <th className="px-3 max-xl:px-2 py-2.5 text-right w-44 max-xl:w-40 z-20 bg-slate-100 dark:bg-gray-800 sticky right-0 shadow-[inset_1px_0_0_0_var(--separator),-12px_0_16px_-12px_rgb(2_6_23_/_0.28)]">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {orderedData.slice(0, visibleCount).map(item => {
                                    const activePdcs = pdcCheques.filter(p => p.customerId === item.id && (p.status === 'Pending' || p.status === 'DueToday'));
                                    const totalPdc = activePdcs.reduce((sum, p) => sum + p.amount, 0);

                                    // Receivable ageing: a credit account's bar is empty, and its
                                    // balance carries the CR badge that says why.
                                    const overdue = overdueAgeing(item);
                                    const { a1, a2, a3, a4 } = overdue;
                                    const focus = focusColumn.pick(overdue);

                                    const isChecked = selectedCustomerIds.includes(item.id);
                                    const rank = getCustomerPaymentRank(item);

                                    return (
                                        <tr 
                                            key={item.id} 
                                            className={`group hover:bg-slate-50/90 dark:hover:bg-gray-800/60 transition-colors ${isChecked ? 'bg-emerald-50/30 dark:bg-emerald-950/10' : ''}`}
                                        >
                                            {(canReassignCrm || canEditCustomer) && (
                                                <td className="px-2.5 max-xl:px-1.5 py-2.5 text-center">
                                                    <label className="inline-flex items-center justify-center p-2 -m-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={() => handleToggleRow(item.id)}
                                                            aria-label={`Select ${item.company}`}
                                                            className="w-4 h-4 rounded text-pos focus:ring-accent cursor-pointer" style={{ outlineOffset: 6 }}
                                                        />
                                                    </label>
                                                </td>
                                            )}

                                            {/* Company & Contact Column */}
                                            <td className="px-3.5 py-2 min-w-[280px] max-w-[340px] max-xl:min-w-[220px] max-xl:max-w-[250px]">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    {canEditFollowUp ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => onFollowUp(item)}
                                                            className="font-extrabold text-gray-900 dark:text-white text-[13px] whitespace-normal break-words text-left hover:text-accent hover:underline underline-offset-2 rounded"
                                                            title="Open this account"
                                                        >
                                                            {item.company}
                                                        </button>
                                                    ) : (
                                                        <span className="font-extrabold text-gray-900 dark:text-white text-[13px] whitespace-normal break-words">
                                                            {item.company}
                                                        </span>
                                                    )}
                                                    {item.isNewCustomer && (
                                                        <span className="px-1.5 py-0.5 rounded text-[11px] font-extrabold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
                                                            NEW
                                                        </span>
                                                    )}
                                                    {item.isUrgent && (
                                                        <span className="px-1.5 py-0.5 rounded text-[11px] font-extrabold bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200">
                                                            URGENT
                                                        </span>
                                                    )}
                                                    {activePdcs.length > 0 && (
                                                        <button
                                                            onClick={() => onOpenPdcForCustomer?.(item.id)}
                                                            className="inline-flex items-center gap-1 px-2 py-1 min-h-[30px] rounded-md text-[11px] font-bold bg-pos-bg text-pos hover:opacity-80 transition-opacity"
                                                            title={`Active PDCs: ₹${totalPdc.toLocaleString('en-IN')}`}
                                                        >
                                                            <ChequeIcon className="w-2.5 h-2.5" />
                                                            <span>PDC {formatCurrency(totalPdc)}</span>
                                                        </button>
                                                    )}
                                                </div>

                                                {/* Two fixed lines under the name — what kind of account, then who to
                                                    ring — instead of one wrapping run that broke differently on every row. */}
                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[12.5px] text-gray-500 dark:text-gray-400">
                                                    {/* Payment rank used to be its own 178px column; it is one pill,
                                                        so it lives with the customer it describes. */}
                                                    <span
                                                        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-extrabold ${RANK_TONE[rank]}`}
                                                        title={item.paymentRank
                                                            ? `Set by hand: ${PAYMENT_RANK_LABELS[rank]}`
                                                            : `Worked out from credit terms and ageing: ${PAYMENT_RANK_LABELS[rank]}`}
                                                    >
                                                        {PAYMENT_RANK_LABELS[rank]}
                                                    </span>
                                                    {item.category && (
                                                        <span
                                                            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-separator whitespace-nowrap"
                                                            title={`Category: ${item.category}`}
                                                        >
                                                            {item.category}
                                                        </span>
                                                    )}
                                                    {!hasOutstanding(item) && (
                                                        <span
                                                            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-pos-bg text-pos border border-separator whitespace-nowrap"
                                                            title={item.settledAt
                                                                ? `Nothing outstanding. Cleared ${new Date(item.settledAt).toLocaleString('en-IN')}. Every note, cheque and follow-up is still on the account.`
                                                                : 'Nothing outstanding. Every note, cheque and follow-up is still on the account.'}
                                                        >
                                                            Settled{item.settledAt ? ` ${formatDate(item.settledAt)}` : ''}
                                                        </span>
                                                    )}
                                                    <span className="text-[11.5px] font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                        {item.paymentTermsDays ? `${item.paymentTermsDays}d terms` : 'Std credit'}
                                                        {item.creditLimit ? ` • ₹${(item.creditLimit / 100000).toFixed(1)}L` : ''}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-x-2 mt-0.5 text-[12.5px] text-gray-500 dark:text-gray-400 whitespace-nowrap overflow-hidden" title={[item.city, item.contactPerson, item.contactNumber].filter(Boolean).join(' · ')}>
                                                    {item.city && (
                                                        <span className="font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                                            {item.city}
                                                        </span>
                                                    )}
                                                    {item.contactPerson && (
                                                        <span className="text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap truncate" title={item.contactPost ? `${item.contactPerson} (${item.contactPost})` : item.contactPerson}>
                                                            {item.contactPerson}
                                                        </span>
                                                    )}
                                                    {item.contactNumber && (dialable(item.contactNumber) ? (
                                                        <a href={`tel:${item.contactNumber}`} className="inline-flex items-center min-h-[24px] px-1 -mx-1 font-bold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap">
                                                            {item.contactNumber}
                                                        </a>
                                                    ) : (
                                                        <span className="text-label-3 whitespace-nowrap">{item.contactNumber}</span>
                                                    ))}
                                                    {item.additionalContacts && item.additionalContacts.length > 0 && (
                                                        <span 
                                                            className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 text-[11px] font-bold cursor-help whitespace-nowrap"
                                                            title={`Additional contacts:\n${item.additionalContacts.map(c => `• ${c.name} (${c.post || 'Staff'}): ${c.mobile}`).join('\n')}`}
                                                        >
                                                            +{item.additionalContacts.length} contact{item.additionalContacts.length === 1 ? '' : 's'}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Total Balance — compact by default, exact figure on hover.
                                                A credit balance still gets the full CR (Excess) treatment. */}
                                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                                {item.totalType === 'Cr' && item.total > 0 ? (
                                                    /* One credit row anywhere in the book used to widen this column to
                                                       171px for every row, because the full "CR (Excess)" chip never
                                                       wraps. Same meaning, compact. */
                                                    <span
                                                        className="inline-flex items-center gap-1 num text-xs font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/50 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800/80"
                                                        title={`Excess payment held with us (CR advance) of ${formatINR(item.total)}`}
                                                    >
                                                        {formatINR(item.total)}
                                                        <span className="uppercase font-black text-[10px] px-1 rounded bg-purple-200 text-purple-900 dark:bg-purple-800 dark:text-purple-100">
                                                            CR
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span
                                                        className="num text-xs font-extrabold text-gray-900 dark:text-gray-100"
                                                        title={formatCompact(item.total)}
                                                    >
                                                        {formatINR(item.total)}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Ageing — the bar for shape, then every bucket in full rupees,
                                                colour-keyed to the bar above it. Four separate number columns
                                                cost ~420px; this says the same in ~195px without a tooltip. */}
                                            <td className="px-2.5 py-2 align-middle" title={AGE_BANDS.map((band, i) => `${band.label}: ${formatINR([a1, a2, a3, a4][i])}`).join(' · ')}>
                                                <AgeingBar parts={{ a1, a2, a3, a4 }} height={6} />
                                                {/* One line, compact figures; the exact rupees are on hover. Two
                                                    lines of full figures made every row a third taller than the
                                                    name beside it, which is what set the height of the whole list. */}
                                                <div className="mt-1.5 flex items-center gap-2 text-[11px] leading-none whitespace-nowrap max-xl:hidden">
                                                    {AGE_BANDS.map((band, i) => {
                                                        const v = [a1, a2, a3, a4][i];
                                                        return (
                                                            <span
                                                                key={band.key}
                                                                className="inline-flex items-center gap-1"
                                                                title={`${band.label}: ${formatINR(v)}`}
                                                            >
                                                                <span
                                                                    className="w-1.5 h-1.5 rounded-full flex-none"
                                                                    style={{ background: band.varName, opacity: v > 0 ? 1 : 0.3 }}
                                                                    aria-hidden="true"
                                                                />
                                                                <span className={`num ${v > 0 ? 'font-semibold text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600'}`}>
                                                                    {v > 0 ? formatCompact(v) : '—'}
                                                                </span>
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </td>

                                            {/* The chip's column: Due >45 days unless a chip says otherwise */}
                                            <td className="px-2.5 py-2.5 text-right whitespace-nowrap bg-rose-50/30 dark:bg-rose-950/10 max-xl:hidden">
                                                <span
                                                    className={`num text-[12.5px] ${focus > 0 ? (ageingFilter === 'current' || ageingFilter === '1-45' ? 'text-label font-extrabold' : 'text-dang font-extrabold') : 'text-label-3'}`}
                                                    title={formatCompact(focus)}
                                                >
                                                    {formatINR(focus)}
                                                </span>
                                            </td>

                                            {/* Follow-up Date & Status */}
                                            <td className="px-2.5 py-2 text-center whitespace-nowrap">
                                                <div className="flex flex-col items-center justify-center gap-0.5">
                                                    <StatusBadge status={followUpStatusOf(item, today)} />
                                                    <span className={`text-[11.5px] font-bold ${
                                                        followUpStatusOf(item, today) === FollowUpStatus.Overdue ? 'text-dang' :
                                                        followUpStatusOf(item, today) === FollowUpStatus.Today ? 'text-accent font-extrabold' :
                                                        followUpStatusOf(item, today) === FollowUpStatus.Upcoming ? 'text-pos font-semibold' :
                                                        'text-gray-600 dark:text-gray-400'
                                                    }`} title={item.followUpDate ? formatDate(item.followUpDate) : undefined}>
                                                        {followUpWhen(item, today)}
                                                    </span>
                                                    {item.forecastAmount !== undefined && item.forecastAmount > 0 && (
                                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" title={`Committed Cash Forecast: ₹${item.forecastAmount.toLocaleString('en-IN')}`}>
                                                            {formatCurrency(item.forecastAmount)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* CRM Owner */}
                                            <td className="px-2.5 py-2.5 text-left whitespace-nowrap">
                                                {canReassignCrm && onReassignCrm ? (
                                                    <select
                                                        value={findOwner(crmUsers, item.crmOwnerId)?.id || item.crmOwnerId || ''}
                                                        onChange={e => onReassignCrm(item.id, e.target.value)}
                                                        aria-label={`CRM owner for ${item.company}`}
                                                        className="text-[12.5px] h-8 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 font-semibold text-gray-800 dark:text-gray-200 cursor-pointer max-xl:w-[88px]"
                                                    >
                                                        <option value="">Unassigned</option>
                                                        {crmUsers.map(u => (
                                                            <option key={u.id} value={u.id}>{u.name}</option>
                                                        ))}
                                                        {item.crmOwnerId && !findOwner(crmUsers, item.crmOwnerId) && (
                                                            <option value={item.crmOwnerId}>{item.crmOwnerId}</option>
                                                        )}
                                                    </select>
                                                ) : (
                                                    <span className="font-bold text-gray-800 dark:text-gray-200 text-[12.5px]">
                                                        {item.crmOwnerId || 'Unassigned'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Actions — pinned to the right edge. The ledger is ~1850px wide, so on a
                                                laptop this column used to sit past the fold and Edit / Follow Up could
                                                only be reached by scrolling sideways. */}
                                            <td className="px-3 max-xl:px-2 py-2.5 text-right whitespace-nowrap z-10 bg-card group-hover:bg-slate-50 dark:group-hover:bg-gray-800 sticky right-0 shadow-[inset_1px_0_0_0_var(--separator),-12px_0_16px_-12px_rgb(2_6_23_/_0.28)]">
                                                <div className="flex items-center justify-end space-x-1">
                                                    {/* WhatsApp Reminder */}
                                                    <button
                                                        onClick={() => onWhatsApp(item)}
                                                        className="w-8 h-8 grid place-items-center text-pos hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-full transition-colors"
                                                        title="Send WhatsApp follow-up"
                                                        aria-label={`Send WhatsApp follow-up to ${item.company}`}
                                                    >
                                                        <WhatsAppIcon className="w-4 h-4" />
                                                    </button>

                                                    {/* Edit — icon only. Follow Up is the primary action and keeps its
                                                        label; this one buys back the width the ageing figures need. */}
                                                    <button
                                                        onClick={() => onEditCustomer(item)}
                                                        disabled={!canEditCustomer}
                                                        className={`w-8 h-8 grid place-items-center rounded-full transition-colors ${
                                                            canEditCustomer
                                                                ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                                                                : 'text-gray-400 opacity-50 cursor-not-allowed'
                                                        }`}
                                                        title={canEditCustomer ? 'Edit customer master details & rank' : 'No rights to edit customer'}
                                                        aria-label={`Edit ${item.company}`}
                                                    >
                                                        <EditIcon className="w-4 h-4" />
                                                    </button>

                                                    {/* Follow-up Button */}
                                                    <button
                                                        onClick={() => onFollowUp(item)}
                                                        disabled={!canEditFollowUp}
                                                        className={`h-8 px-3 text-[12.5px] font-semibold rounded-full transition-all ${
                                                            canEditFollowUp
                                                                ? 'bg-accent hover:bg-accent-press text-on-accent shadow-2xs'
                                                                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 opacity-50 cursor-not-allowed'
                                                        }`}
                                                        title="Open this account: log the call, set the next date"
                                                    >
                                                        Follow up
                                                    </button>

                                                    {/* Delete Customer Button */}
                                                    {canDeleteCustomer && onDeleteCustomer && (
                                                        <button
                                                            onClick={() => onDeleteCustomer(item.id)}
                                                            className="w-8 h-8 grid place-items-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-dang hover:text-red-800 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-full transition-colors"
                                                            title="Delete customer"
                                                            aria-label={`Delete ${item.company}`}
                                                        >
                                                            <TrashIcon className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filteredData.length > visibleCount && (
                                    <tr ref={sentinelRef}>
                                        <td colSpan={canReassignCrm ? 8 : 7} className="px-4 py-5 text-center">
                                            <button
                                                onClick={() => setVisibleCount(c => c + PAGE * 2)}
                                                className="h-9 px-4 rounded-full bg-card-2 hover:bg-hover text-[13px] font-semibold text-label-2"
                                            >
                                                Show more &mdash; {(filteredData.length - visibleCount).toLocaleString('en-IN')} left
                                            </button>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                </div>
            ) : (
                /* Grid / Cards View */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {orderedData.slice(0, visibleCount).map(item => {

                        const { over90 } = overdueAgeing(item);
                        const rank = getCustomerPaymentRank(item);

                        return (
                            <div 
                                key={item.id}
                                className="bg-white dark:bg-gray-800 rounded-xl p-3.5 border border-gray-200 dark:border-gray-700 shadow-2xs flex flex-col justify-between hover:shadow-md transition-shadow"
                            >
                                <div>
                                    {/* Card Header */}
                                    <div className="flex justify-between items-start gap-2">
                                        <div>
                                            <h3 className="font-extrabold text-sm text-gray-900 dark:text-white whitespace-normal break-words">
                                                {item.company}
                                            </h3>
                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-extrabold ${RANK_TONE[rank]}`}>
                                                    {PAYMENT_RANK_LABELS[rank]}
                                                </span>
                                                <span className="px-2 py-0.5 rounded-md text-[11.5px] font-bold bg-slate-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                                                    CRM: {item.crmOwnerId || 'Unassigned'}
                                                </span>
                                                <StatusBadge status={followUpStatusOf(item, today)} />
                                            </div>
                                        </div>

                                        <div className="text-right">
                                            <BalanceAmount
                                                amount={item.total}
                                                type={item.totalType || 'Dr'}
                                                defaultClass="font-extrabold text-sm text-gray-900 dark:text-white"
                                            />
                                            {over90 > 0 && (
                                                <div className="text-[11.5px] font-bold text-dang mt-0.5">
                                                    &gt;90d: {formatCurrency(over90)}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Contact Details */}
                                    <div className="mt-2.5 p-2 bg-slate-50 dark:bg-gray-900/60 rounded-lg space-y-1 text-xs">
                                        <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                                            <span className="font-semibold">{item.contactPerson || 'Accounts Dept'}</span>
                                            {item.city && <span className="text-[11.5px] text-gray-500 font-medium">{item.city}</span>}
                                        </div>
                                        {item.category && (
                                            <div>
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-separator">
                                                    {item.category}
                                                </span>
                                            </div>
                                        )}
                                        {item.contactNumber && (
                                            <div className="flex items-center justify-between text-[12.5px]">
                                                <a href={dialable(item.contactNumber) ? `tel:${item.contactNumber}` : undefined} className="inline-flex items-center min-h-[30px] px-1 -mx-1 font-bold text-emerald-700 dark:text-emerald-400 hover:underline">
                                                    {item.contactNumber}
                                                </a>
                                                <button
                                                    onClick={() => onWhatsApp(item)}
                                                    className="text-pos hover:text-emerald-700 text-xs font-semibold flex items-center gap-1"
                                                >
                                                    <WhatsAppIcon className="w-3.5 h-3.5" />
                                                    <span>WhatsApp</span>
                                                </button>
                                            </div>
                                        )}
                                        {(item.paymentTermsDays || item.creditLimit) && (
                                            <div className="text-[11.5px] text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-200 dark:border-gray-800">
                                                Credit Terms: <span className="font-semibold text-gray-700 dark:text-gray-200">{item.paymentTermsDays ? `${item.paymentTermsDays} Days` : 'Standard'}</span>
                                                {item.creditLimit ? ` • Limit: ₹${(item.creditLimit / 100000).toFixed(1)}L` : ''}
                                            </div>
                                        )}
                                    </div>

                                    {/* Ageing Breakdown Summary */}
                                    <div className="grid grid-cols-4 gap-1 text-center mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/60 text-[11.5px]">
                                        <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-1 rounded">
                                            <div className="text-gray-500">1-45d</div>
                                            <div className="font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(item.ageing?.['1-45'] || 0)}</div>
                                        </div>
                                        <div className="bg-amber-50/50 dark:bg-amber-950/20 p-1 rounded">
                                            <div className="text-gray-500">46-90d</div>
                                            <div className="font-bold text-amber-700 dark:text-amber-300">{formatCurrency(item.ageing?.['46-90'] || 0)}</div>
                                        </div>
                                        <div className="bg-orange-50/50 dark:bg-orange-950/20 p-1 rounded">
                                            <div className="text-gray-500">91-135d</div>
                                            <div className="font-bold text-orange-700 dark:text-orange-300">{formatCurrency(item.ageing?.['91-135'] || 0)}</div>
                                        </div>
                                        <div className="bg-red-50/50 dark:bg-red-950/20 p-1 rounded">
                                            <div className="text-gray-500">&gt;135d</div>
                                            <div className="font-extrabold text-red-700 dark:text-red-400">{formatCurrency(item.ageing?.['>135'] || 0)}</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Card Footer Actions */}
                                <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-between gap-2">
                                    <div className="text-[12.5px] text-gray-500 dark:text-gray-400">
                                        {item.followUpDate ? `Next: ${formatDate(item.followUpDate)}` : 'No date set'}
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => onEditCustomer(item)}
                                            disabled={!canEditCustomer}
                                            className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                                                canEditCustomer
                                                    ? 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'
                                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 opacity-50 cursor-not-allowed'
                                            }`}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => onFollowUp(item)}
                                            disabled={!canEditFollowUp}
                                            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                                                canEditFollowUp
                                                    ? 'bg-accent hover:bg-accent-press text-on-accent shadow-2xs'
                                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 opacity-50 cursor-not-allowed'
                                            }`}
                                        >
                                            Follow Up
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            <ConfirmDialog
                open={confirmBulkDate}
                title={`Set the follow-up date on ${selectedCustomerIds.length} account${selectedCustomerIds.length === 1 ? '' : 's'}?`}
                confirmLabel="Set the date"
                tone="primary"
                onCancel={() => setConfirmBulkDate(false)}
                onConfirm={() => { setConfirmBulkDate(false); if (!bulkFollowUp) return; onBulkSetFollowUp?.(selectedCustomerIds, bulkFollowUp); setSelectedCustomerIds([]); }}
            >
                <p>Every selected account gets <strong className="text-label">{bulkFollowUp ? formatDay(bulkFollowUp) : ''}</strong> as its next follow-up date.</p>
                <p className="mt-2">Each account's activity will record the move — and, where it was overdue, that its CRM had not rescheduled it.</p>
            </ConfirmDialog>
        </div>
    );
};

export default CustomerDashboardView;
