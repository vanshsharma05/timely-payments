import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { User, can, matchesSearch } from '../types';
import {
    StockItem,
    StockStatus,
    StockMovement,
    Availability,
    STOCK_STATUS_LABELS,
    MOVEMENT_LABELS,
    STOCK_AGE_LABELS,
    STOCK_COLOUR_LABELS,
    AVAILABILITY_LABELS,
    availabilityOf,
    isCritical,
    stockAgeBucket,
    hasLevels,
    drivePhotoUrl,
    LIVE_STOCK_SHEET_URL,
    LIVE_STOCK_REFRESH_MS,
} from '../services/liveStock';
import { Badge, Button, Card, EmptyState, SectionHeader, cx } from './ui/Primitives';
import { formatCompact, formatDate, formatINR, groupIndian } from './ui/format';
import { useIsPhone } from './ui/usePhone';
import { DownloadIcon, SyncIcon } from './icons/Icons';
import { ChevronDown } from './shell/NavIcons';

/* ============================================================================
   Live stock — a window onto the stores sheet.

   Read-only by design: the stores team keeps the sheet, and this page shows
   what they keep, a minute behind at most. It answers the question a call is
   about — is it there, how much, is it running low — which is the search and
   the list, with a row that opens into the whole record. The overview — five
   tiles on availability, the stock by brand, a strip of the figures worth
   knowing — is not an everyday need, so it sits folded above the list and
   opens with one click, for everyone, closed again on the next visit.

   Several products at once: "Compare" in the list's header puts a tick box
   on every row — the everyday list carries none — and the ticks survive a
   change of search or filter (that is the point: find one, tick it, find
   the next). A bar at the foot of the screen keeps the picks in view
   wherever the list has scrolled to, and "Compare" lays them side by side,
   one column each, the same facts in the same rows.
   ============================================================================ */

interface LiveStockViewProps {
    items: StockItem[];
    fetchedAt?: string;
    loading: boolean;
    error?: string;
    fromCache: boolean;
    onRefresh: () => void;
    currentUser: User | null;
    /**
     * Whether rate and value are shown. Admin and Manager only — the boss's
     * call — and the server has already emptied both columns for anyone
     * else (see api/_lib/liveStock.ts), so this decides only what the page
     * offers, never what it hides.
     */
    showPrices: boolean;
    /** Search text from the app bar. */
    globalSearch?: string;
}

type AvailabilityFilter = 'ALL' | Availability;
type StatusFilter = 'ALL' | StockStatus;
type MovementFilter = 'ALL' | StockMovement;
type SortKey = 'value' | 'quantity' | 'rate' | 'ageing' | 'name' | 'category';

const STATUS_TONE: Record<StockStatus, 'pos' | 'brand' | 'dang' | 'neutral'> = {
    FM: 'pos',
    OD: 'brand',
    D: 'dang',
    '': 'neutral',
};

const MOVEMENT_TONE: Record<StockMovement, 'pos' | 'warn' | 'neutral' | 'age3'> = {
    'FAST MOVING': 'pos',
    REVIEW: 'warn',
    'SLOW MOVING': 'age3',
    '': 'neutral',
};

const AVAILABILITY_TONE: Record<Availability, 'pos' | 'warn' | 'dang'> = {
    in: 'pos',
    low: 'warn',
    out: 'dang',
};

const AVAILABILITY_VAR: Record<Availability, string> = {
    in: 'var(--pos)',
    low: 'var(--age-3)',
    out: 'var(--dang)',
};

const COLOUR_SWATCH: Record<string, string> = {
    R: '#D93636',
    M: '#C2338F',
    Y: '#E5B400',
    G: '#1F9D55',
};

/** "36.5 KGS" — two decimals at most, none when whole, Indian grouping. */
const formatQty = (n: number, unit?: string) => {
    const whole = Math.abs(n - Math.round(n)) < 0.005;
    const s = whole ? groupIndian(n) : (Math.round(n * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return unit ? `${s} ${unit}` : s;
};

/** Side by side stops being side by side past this many columns. */
const COMPARE_MAX = 8;
/** The ticks outlive a tab change — the search for the next item often goes through the book. */
const COMPARE_KEY = 'timely_stock_compare';
const readCompare = (): { on: boolean; ids: string[] } => {
    try {
        const v = JSON.parse(sessionStorage.getItem(COMPARE_KEY) || '{}');
        const ids = Array.isArray(v?.ids) ? v.ids.filter((x: unknown): x is string => typeof x === 'string').slice(0, COMPARE_MAX) : [];
        return { on: Boolean(v?.on) || ids.length > 0, ids };
    } catch { return { on: false, ids: [] }; }
};
const writeCompare = (on: boolean, ids: string[]) => { try { sessionStorage.setItem(COMPARE_KEY, JSON.stringify({ on, ids })); } catch { /* private window */ } };

/** "1 day ago" / "127 days ago" — for the receipt ageing. */
const daysAgo = (n: number) => `${n} day${n === 1 ? '' : 's'} ago`;

const pct = (n: number, of: number) => (of > 0 ? (100 * n) / of : 0);
const pctText = (n: number, of: number) => `${pct(n, of).toFixed(1)}%`;

/** "2 min ago" / "just now" — for the read timestamp. */
const agoText = (iso?: string): string => {
    if (!iso) return '';
    const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 10) return 'just now';
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
};

/**
 * The share of the range that is on the shelf and not under its minimum —
 * one figure for how the stores are doing, in three words.
 */
const healthWord = (score: number) => (score >= 85 ? 'Healthy' : score >= 70 ? 'Fair' : 'Needs attention');
const healthVar = (score: number) => (score >= 85 ? 'var(--pos)' : score >= 70 ? 'var(--age-2)' : 'var(--dang)');

/**
 * A figure with a bar under it. The bar is the figure as a share of the
 * range, so the five tiles read as one picture: how the shelf is divided.
 */
const Tile = ({
    label,
    value,
    sub,
    share,
    tone,
    active,
    onClick,
}: {
    label: string;
    value: React.ReactNode;
    sub: React.ReactNode;
    /** 0–100 */
    share: number;
    tone: string;
    active?: boolean;
    onClick?: () => void;
}) => {
    const Wrapper: any = onClick ? 'button' : 'div';
    return (
        <Wrapper
            type={onClick ? 'button' : undefined}
            onClick={onClick}
            aria-pressed={onClick ? active : undefined}
            className={cx(
                'relative text-left bg-card rounded-[16px] px-5 py-4 transition-all duration-150',
                onClick && 'cursor-pointer hover:shadow-e2 active:scale-[.99]',
                active ? 'shadow-e2 ring-2 ring-accent' : 'shadow-e1',
            )}
        >
            <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: tone }} aria-hidden="true" />
                <span className="label">{label}</span>
            </span>
            <span className="block num text-[30px] font-semibold text-label mt-2.5 leading-none tracking-[-0.03em]">{value}</span>
            <span className="block h-1.5 rounded-full bg-card-3 mt-3 overflow-hidden" aria-hidden="true">
                <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, share))}%`, background: tone }} />
            </span>
            <span className="block text-[13px] text-label-3 mt-2 leading-snug">{sub}</span>
        </Wrapper>
    );
};

/**
 * Where the quantity sits against the item's min and max — the one figure a
 * stores person reads first. Red below the minimum, amber between, green at
 * or above the maximum; the tick marks the minimum.
 */
const LevelBar = ({ item, className }: { item: StockItem; className?: string }) => {
    if (!hasLevels(item)) return null;
    const scale = Math.max(item.maxLevel, item.minLevel, item.quantity, 1);
    const fill = Math.max(0, Math.min(100, (item.quantity / scale) * 100));
    const tick = Math.max(0, Math.min(100, (item.minLevel / scale) * 100));
    const tone = item.quantity < item.minLevel ? 'var(--dang)' : item.maxLevel > 0 && item.quantity >= item.maxLevel ? 'var(--pos)' : 'var(--warn)';
    return (
        <div
            className={cx('relative h-1.5 rounded-full bg-card-3 overflow-visible', className)}
            role="img"
            aria-label={`${formatQty(item.quantity)} in stock, minimum ${formatQty(item.minLevel)}, maximum ${formatQty(item.maxLevel)}`}
            title={`Min ${formatQty(item.minLevel)} · Max ${formatQty(item.maxLevel)}`}
        >
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fill}%`, background: tone }} />
            {item.minLevel > 0 && (
                <span className="absolute -top-[3px] w-[2px] h-[12px] rounded-full bg-label-3" style={{ left: `calc(${tick}% - 1px)` }} aria-hidden="true" />
            )}
        </div>
    );
};

const ColourDot = ({ code }: { code?: string }) => {
    if (!code || !COLOUR_SWATCH[code]) return null;
    return (
        <span
            className="inline-block w-2.5 h-2.5 rounded-full ring-1 ring-black/10 flex-none"
            style={{ background: COLOUR_SWATCH[code] }}
            title={`Colour: ${STOCK_COLOUR_LABELS[code]}`}
            aria-label={`Colour ${STOCK_COLOUR_LABELS[code]}`}
        />
    );
};

/** One horizontal bar in a breakdown list, sized against the largest. */
const BarRow = ({
    label,
    value,
    max,
    sub,
    money = true,
    active,
    onClick,
}: {
    label: string;
    value: number;
    max: number;
    sub?: string;
    /** Rupees, or a plain count. */
    money?: boolean;
    active?: boolean;
    onClick?: () => void;
}) => (
    <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cx(
            'w-full text-left rounded-[10px] px-2 py-1.5 -mx-2 transition-colors',
            onClick && 'hover:bg-hover',
            active && 'bg-accent-tint',
        )}
    >
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className={cx('truncate font-semibold', active ? 'text-accent' : 'text-label')}>{label}</span>
            <span className="num text-label-2 flex-none">
                {money ? formatCompact(value) : `${value.toLocaleString('en-IN')} items`}
                {sub && <span className="text-label-3 font-normal"> · {sub}</span>}
            </span>
        </div>
        <div className="h-1.5 rounded-full bg-card-3 mt-1.5 overflow-hidden">
            <div className="h-full rounded-full bg-accent" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
        </div>
    </button>
);

/** The tick box on a row: toggles the item in the comparison, never opens the row. */
const CompareTick = ({ item, checked, disabled, onToggle, className }: { item: StockItem; checked: boolean; disabled: boolean; onToggle: () => void; className?: string }) => (
    <label
        className={cx('flex items-center justify-center flex-none', disabled ? 'cursor-not-allowed' : 'cursor-pointer', className)}
        onClick={e => e.stopPropagation()}
        title={disabled ? `Up to ${COMPARE_MAX} items side by side` : checked ? 'Take out of the comparison' : 'Tick to compare'}
    >
        <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={onToggle}
            aria-label={`${checked ? 'Take out of the comparison:' : 'Compare'} ${item.code}`}
            className="w-[18px] h-[18px] rounded focus:ring-accent disabled:opacity-40 max-md:w-5 max-md:h-5"
            style={{ accentColor: 'var(--accent)' }}
        />
    </label>
);

/** One figure in the Quick insights strip. */
const Insight = ({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) => (
    <div className="bg-card-2 rounded-[14px] px-4 py-5 text-center flex flex-col justify-center">
        <p className="label">{label}</p>
        <p className="num text-[24px] font-semibold mt-2 leading-none tracking-[-0.02em]" style={{ color: tone || 'var(--label)' }}>{value}</p>
        {sub && <p className="text-[11.5px] text-label-3 mt-2 leading-snug">{sub}</p>}
    </div>
);

export const LiveStockView = ({
    items,
    fetchedAt,
    loading,
    error,
    fromCache,
    onRefresh,
    currentUser,
    showPrices,
    globalSearch = '',
}: LiveStockViewProps) => {
    const isPhone = useIsPhone();
    const canExport = can(currentUser, 'canExportData');

    /* ------------------------------- filters ------------------------------ */
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('ALL');
    const [subCategory, setSubCategory] = useState('ALL');
    const [availability, setAvailability] = useState<AvailabilityFilter>('ALL');
    const [criticalOnly, setCriticalOnly] = useState(false);
    const [status, setStatus] = useState<StatusFilter>('ALL');
    const [movement, setMovement] = useState<MovementFilter>('ALL');
    // Without prices there is no value to sort by; the brand is the next
    // most natural order for a shelf.
    const [sortKey, setSortKey] = useState<SortKey>(showPrices ? 'value' : 'category');
    const [sortDesc, setSortDesc] = useState(showPrices);
    const [sortTouched, setSortTouched] = useState(false);
    // The prices arrive a moment after the page does; the default sort follows
    // them, unless somebody has already chosen a sort of their own.
    useEffect(() => {
        if (sortTouched) return;
        setSortKey(showPrices ? 'value' : 'category');
        setSortDesc(showPrices);
    }, [showPrices, sortTouched]);
    const [phoneFiltersOpen, setPhoneFiltersOpen] = useState(false);
    // The overview starts folded on every visit: there when wanted, not in
    // the way when it is not.
    const [overviewOpen, setOverviewOpen] = useState(false);
    const [selected, setSelected] = useState<StockItem | null>(null);

    /* ------------------------------ compare ------------------------------ */
    // Ticked item ids, in the order they were ticked. Kept as ids so that a
    // re-read of the sheet replaces each with its current row.
    const [compareMode, setCompareMode] = useState<boolean>(() => readCompare().on);
    const [compareIds, setCompareIds] = useState<string[]>(() => readCompare().ids);
    const [compareOpen, setCompareOpen] = useState(false);
    useEffect(() => { writeCompare(compareMode, compareIds); }, [compareMode, compareIds]);
    const compared = useMemo(
        () => compareIds.map(id => items.find(i => i.id === id)).filter((i): i is StockItem => Boolean(i)),
        [compareIds, items],
    );
    const compareFull = compareIds.length >= COMPARE_MAX;
    const isCompared = (id: string) => compareIds.includes(id);
    const toggleCompare = (id: string) => setCompareIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : ids.length >= COMPARE_MAX ? ids : [...ids, id]));
    const clearCompare = () => { setCompareIds([]); setCompareOpen(false); };
    // "Done" puts the list back the way it was: no boxes, no picks.
    const leaveCompare = () => { setCompareIds([]); setCompareOpen(false); setCompareMode(false); };
    // Nothing to lay side by side once the ticks are gone.
    useEffect(() => { if (compared.length === 0) setCompareOpen(false); }, [compared.length]);
    useEffect(() => {
        if (!compareOpen) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setCompareOpen(false);
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [compareOpen]);

    // A sub-category belongs to a category; changing the category clears it.
    useEffect(() => { setSubCategory('ALL'); }, [category]);

    const PAGE = 60;
    const [visible, setVisible] = useState(PAGE);
    useEffect(() => { setVisible(PAGE); }, [search, globalSearch, category, subCategory, availability, criticalOnly, status, movement, sortKey, sortDesc]);

    // The item open in the drawer follows the sheet: a re-read replaces it
    // with its current row, and drops it if the row is gone.
    useEffect(() => {
        if (!selected) return;
        const fresh = items.find(i => i.id === selected.id);
        if (fresh !== selected) setSelected(fresh || null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items]);

    useEffect(() => {
        if (!selected) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [selected]);

    // "now" ticks so the "2 min ago" stays honest without a re-read.
    const [, setTick] = useState(0);
    useEffect(() => {
        const t = window.setInterval(() => setTick(x => x + 1), 15_000);
        return () => window.clearInterval(t);
    }, []);

    /* ------------------------------- derived ------------------------------ */
    const categories = useMemo(() => {
        const counts = new Map<string, number>();
        items.forEach(i => counts.set(i.category || '(none)', (counts.get(i.category || '(none)') || 0) + 1));
        return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [items]);

    const subCategories = useMemo(() => {
        const counts = new Map<string, number>();
        items
            .filter(i => category === 'ALL' || (i.category || '(none)') === category)
            .forEach(i => counts.set(i.subCategory || '(none)', (counts.get(i.subCategory || '(none)') || 0) + 1));
        return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [items, category]);

    const filtered = useMemo(() => {
        const rows = items.filter(i => {
            if (!matchesSearch([i.code, i.description, i.category, i.subCategory, i.unit], globalSearch)) return false;
            if (!matchesSearch([i.code, i.description, i.category, i.subCategory, i.unit], search)) return false;
            if (category !== 'ALL' && (i.category || '(none)') !== category) return false;
            if (subCategory !== 'ALL' && (i.subCategory || '(none)') !== subCategory) return false;
            if (availability !== 'ALL' && availabilityOf(i) !== availability) return false;
            if (criticalOnly && !isCritical(i)) return false;
            if (status !== 'ALL' && i.status !== status) return false;
            if (movement !== 'ALL' && i.movement !== movement) return false;
            return true;
        });
        const dir = sortDesc ? -1 : 1;
        const by: Record<SortKey, (a: StockItem, b: StockItem) => number> = {
            value: (a, b) => a.value - b.value,
            quantity: (a, b) => a.quantity - b.quantity,
            rate: (a, b) => a.rate - b.rate,
            ageing: (a, b) => (a.ageingDays ?? -1) - (b.ageingDays ?? -1),
            name: (a, b) => a.code.localeCompare(b.code),
            category: (a, b) => (a.category + a.subCategory + a.code).localeCompare(b.category + b.subCategory + b.code),
        };
        return rows.sort((a, b) => by[sortKey](a, b) * dir || a.code.localeCompare(b.code));
    }, [items, globalSearch, search, category, subCategory, availability, criticalOnly, status, movement, sortKey, sortDesc]);

    /** The figures on the tiles are of the whole sheet, never of the filter. */
    const summary = useMemo(() => {
        const s = {
            items: items.length,
            value: 0,
            quantity: 0,
            inStock: 0,
            low: 0,
            out: 0,
            critical: 0,
            toMinimum: 0,
            brands: new Set<string>(),
            subCategories: new Set<string>(),
            byCategory: new Map<string, { items: number; value: number }>(),
        };
        items.forEach(i => {
            s.value += i.value;
            s.quantity += i.quantity;
            const a = availabilityOf(i);
            if (a === 'in') s.inStock++;
            else if (a === 'low') s.low++;
            else s.out++;
            if (isCritical(i)) s.critical++;
            if (hasLevels(i) && i.quantity < i.minLevel) s.toMinimum += (i.minLevel - i.quantity) * i.rate;
            if (i.category) s.brands.add(i.category);
            if (i.subCategory) s.subCategories.add(i.subCategory);
            const c = s.byCategory.get(i.category || '(none)') || { items: 0, value: 0 };
            c.items++; c.value += i.value; s.byCategory.set(i.category || '(none)', c);
        });
        return s;
    }, [items]);

    const health = pct(summary.inStock, summary.items);

    const topCategories = useMemo(
        () => [...summary.byCategory.entries()]
            .sort((a, b) => (showPrices ? b[1].value - a[1].value : b[1].items - a[1].items))
            .slice(0, 8),
        [summary, showPrices],
    );

    const viewValue = useMemo(() => filtered.reduce((a, i) => a + i.value, 0), [filtered]);

    const filtersOn = [category !== 'ALL', subCategory !== 'ALL', availability !== 'ALL', criticalOnly, status !== 'ALL', movement !== 'ALL'].filter(Boolean).length;
    const clearFilters = () => {
        setSearch(''); setCategory('ALL'); setSubCategory('ALL'); setAvailability('ALL'); setCriticalOnly(false); setStatus('ALL'); setMovement('ALL');
    };

    /** A tile is a filter: pressing it again clears it. */
    const onlyAvailability = (a: Availability) => availability === a && filtersOn === 1;
    const pickAvailability = (a: Availability) => {
        const already = onlyAvailability(a);
        clearFilters();
        if (!already) setAvailability(a);
    };

    const sortBy = (k: SortKey) => {
        setSortTouched(true);
        if (sortKey === k) setSortDesc(d => !d);
        else { setSortKey(k); setSortDesc(k !== 'name' && k !== 'category'); }
    };

    const exportExcel = (source: StockItem[] = filtered) => {
        const rows = source.map(i => ({
            'Item Code': i.code,
            'Description': i.description,
            'Brand / Category': i.category,
            'Sub-category': i.subCategory,
            'Unit': i.unit,
            'Availability': AVAILABILITY_LABELS[availabilityOf(i)],
            'Quantity': i.quantity,
            'Quantity + PO': i.quantityWithPo,
            ...(showPrices ? { 'Rate (₹)': i.rate, 'Value (₹)': i.value } : {}),
            'Min Level': i.minLevel,
            'Max Level': i.maxLevel,
            'Short of Minimum': i.isShort ? 'Yes' : '',
            'Short Since': i.shortSince ? formatDate(i.shortSince) : '',
            'Status': STOCK_STATUS_LABELS[i.status],
            'Movement': MOVEMENT_LABELS[i.movement],
            'Avg Sales Qty': i.avgSales ?? '',
            'Transactions': i.transactions,
            'Last Received': i.lastReceived ? formatDate(i.lastReceived) : '',
            'Days Since Receipt': i.ageingDays ?? '',
            'Tax %': i.taxPct ?? '',
            'Colour': i.colour ? STOCK_COLOUR_LABELS[i.colour] : '',
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Live stock');
        XLSX.writeFile(wb, `Live_Stock_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const SortHead = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
        <th className={cx('px-3 py-2.5', className)}>
            <button
                type="button"
                onClick={() => sortBy(k)}
                className={cx('inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-label', sortKey === k ? 'text-label' : '')}
                aria-sort={sortKey === k ? (sortDesc ? 'descending' : 'ascending') : 'none'}
            >
                {children}
                {sortKey === k && <span aria-hidden="true" className="text-[10px]">{sortDesc ? '▼' : '▲'}</span>}
            </button>
        </th>
    );

    const selectBase = 'h-10 px-3 text-[13px] rounded-xl border border-separator-strong bg-card-2 text-label font-semibold focus:ring-2 focus:ring-accent max-md:h-11';
    const selectClass = `w-full ${selectBase}`;
    const chipSelectClass = `${selectBase} h-9 pr-8 max-md:w-full`;
    const nothingYet = items.length === 0;

    return (
        // Room at the foot for the compare bar, so the last row is never under it.
        <div className={cx('space-y-5 max-md:space-y-4', compareMode && 'pb-20')}>
            {/* ---------- freshness: one line ---------- */}
            <div className={cx(
                'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] px-4 py-2 text-[13px]',
                error ? 'bg-warn-bg text-warn' : 'bg-card shadow-e1 text-label-2',
            )}>
                <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                    {!error && !loading && <span className="absolute inline-flex h-full w-full rounded-full bg-pos opacity-60 animate-ping" />}
                    <span className={cx('relative inline-flex rounded-full h-2.5 w-2.5', error ? 'bg-warn' : 'bg-pos')} />
                </span>
                <span className="font-semibold">
                    {error
                        ? 'Could not read the sheet'
                        : loading && !fetchedAt
                            ? 'Reading the stock sheet…'
                            : fromCache
                                ? `Last read ${agoText(fetchedAt)} — reading again`
                                : `Live from the stock sheet · read ${agoText(fetchedAt)}`}
                </span>
                {error && <span className="opacity-90">— {error}{fetchedAt ? ` Showing the read from ${agoText(fetchedAt)}.` : ''}</span>}
                {!error && !fromCache && (
                    <span className="text-label-3 max-md:hidden">Re-reads every {Math.round(LIVE_STOCK_REFRESH_MS / 1000)}s while this page is open.</span>
                )}
                <span className="ml-auto flex items-center gap-2">
                    {/* The sheet carries the prices, so the link to it goes only
                        to the people who may see them. */}
                    {showPrices && (
                        <a
                            href={LIVE_STOCK_SHEET_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-8 px-3 inline-flex items-center rounded-full text-[12.5px] font-semibold text-accent hover:bg-accent-tint"
                        >
                            Open the sheet ↗
                        </a>
                    )}
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={loading}
                        className="h-8 px-3 inline-flex items-center gap-1.5 rounded-full text-[12.5px] font-semibold bg-card border border-separator-strong text-label-2 hover:bg-hover disabled:opacity-50"
                    >
                        <SyncIcon className={cx('w-3.5 h-3.5', loading && 'animate-spin')} />
                        {loading ? 'Reading…' : 'Read now'}
                    </button>
                </span>
            </div>

            {nothingYet ? (
                <Card className="p-6">
                    <EmptyState
                        title={error ? 'The stock sheet could not be read' : 'Reading the stock sheet'}
                        hint={error || 'The first read takes a moment; figures appear as soon as it lands.'}
                        action={error ? <Button variant="primary" size="sm" onClick={onRefresh}>Try again</Button> : undefined}
                    />
                </Card>
            ) : (
                <>
                    {/* ---------- overview: folded until asked for, one click either way ---------- */}
                    <button
                        type="button"
                        onClick={() => setOverviewOpen(v => !v)}
                        aria-expanded={overviewOpen}
                        aria-controls={overviewOpen ? 'stock-overview' : undefined}
                        className={cx(
                            'w-full flex items-center gap-3 rounded-[14px] bg-card shadow-e1 px-4 py-2.5 text-left transition-all',
                            'hover:shadow-e2 active:scale-[.995]',
                            overviewOpen && 'ring-1 ring-accent-tint-2',
                        )}
                    >
                        <span className={cx(
                            'w-8 h-8 rounded-full grid place-items-center flex-none transition-colors',
                            overviewOpen ? 'bg-accent text-on-accent' : 'bg-accent-tint text-accent',
                        )}>
                            <ChevronDown className={cx('w-4 h-4 transition-transform duration-200', overviewOpen && 'rotate-180')} />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-[14px] font-bold text-label leading-tight">Overview</span>
                            <span className="block text-[12.5px] text-label-3 truncate mt-0.5">
                                {overviewOpen
                                    ? <>
                                        <span className="max-md:hidden">Availability, stock by brand and quick insights. Each tile is a filter.</span>
                                        <span className="md:hidden">Each tile is a filter. Tap here to close.</span>
                                    </>
                                    : <>
                                        <span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: AVAILABILITY_VAR.in }} aria-hidden="true" />
                                        <span className="num font-semibold text-label-2">{summary.inStock.toLocaleString('en-IN')}</span> in stock
                                        <span className="mx-1.5">·</span>
                                        <span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: AVAILABILITY_VAR.low }} aria-hidden="true" />
                                        <span className="num font-semibold text-label-2">{summary.low.toLocaleString('en-IN')}</span> low
                                        <span className="mx-1.5">·</span>
                                        <span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: AVAILABILITY_VAR.out }} aria-hidden="true" />
                                        <span className="num font-semibold text-label-2">{summary.out.toLocaleString('en-IN')}</span> out
                                        <span className="mx-1.5 max-md:hidden">·</span>
                                        <span className="max-md:hidden">health <span className="num font-semibold" style={{ color: healthVar(health) }}>{Math.round(health)}%</span></span>
                                    </>}
                            </span>
                        </span>
                        {/* On a phone the chevron is the cue; the word would cost the counts their room. */}
                        <span className={cx(
                            'h-8 px-3 inline-flex items-center rounded-full text-[12.5px] font-semibold flex-none max-md:hidden',
                            overviewOpen ? 'bg-card-2 text-label-2' : 'bg-accent-tint text-accent',
                        )}>
                            {overviewOpen ? 'Hide' : 'Show'}
                        </span>
                    </button>

                    {overviewOpen && (
                    <div id="stock-overview" className="space-y-5 max-md:space-y-4 animate-reveal">
                    {/* ---------- tiles: how the shelf is divided, each one a filter ---------- */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 max-md:flex max-md:overflow-x-auto max-md:snap-x max-md:snap-mandatory max-md:-mx-4 max-md:px-4 max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&>*]:min-w-[180px] max-md:[&>*]:snap-start">
                        <Tile
                            label="Total items"
                            tone="var(--accent)"
                            share={100}
                            active={filtersOn === 0 && !search}
                            onClick={clearFilters}
                            value={summary.items.toLocaleString('en-IN')}
                            sub={filtered.length !== summary.items || search
                                ? <><span className="num font-semibold text-label-2">{filtered.length.toLocaleString('en-IN')}</span> in view</>
                                : showPrices
                                    ? <><span className="num font-semibold text-label-2">{formatCompact(summary.value)}</span> stock value</>
                                    : <><span className="num font-semibold text-label-2">{summary.brands.size}</span> brands</>}
                        />
                        <Tile
                            label="In stock"
                            tone={AVAILABILITY_VAR.in}
                            share={pct(summary.inStock, summary.items)}
                            active={onlyAvailability('in')}
                            onClick={() => pickAvailability('in')}
                            value={summary.inStock.toLocaleString('en-IN')}
                            sub={<><span className="num font-semibold text-label-2">{pctText(summary.inStock, summary.items)}</span> of items</>}
                        />
                        <Tile
                            label="Low stock"
                            tone={AVAILABILITY_VAR.low}
                            share={pct(summary.low, summary.items)}
                            active={onlyAvailability('low')}
                            onClick={() => pickAvailability('low')}
                            value={summary.low.toLocaleString('en-IN')}
                            sub={<><span className="num font-semibold text-label-2">{pctText(summary.low, summary.items)}</span> · below minimum</>}
                        />
                        <Tile
                            label="Out of stock"
                            tone={AVAILABILITY_VAR.out}
                            share={pct(summary.out, summary.items)}
                            active={onlyAvailability('out')}
                            onClick={() => pickAvailability('out')}
                            value={summary.out.toLocaleString('en-IN')}
                            sub={<><span className="num font-semibold text-label-2">{pctText(summary.out, summary.items)}</span> of items</>}
                        />
                        <Tile
                            label="Health score"
                            tone={healthVar(health)}
                            share={health}
                            value={`${Math.round(health)}%`}
                            sub={<><span className="font-semibold" style={{ color: healthVar(health) }}>{healthWord(health)}</span> · in stock, not below minimum</>}
                        />
                    </div>

                    {/* ---------- brand value + quick insights ---------- */}
                    <div className="grid lg:grid-cols-2 gap-3.5">
                        <Card className="p-6 max-md:p-5">
                            <SectionHeader
                                title="Stock by brand"
                                subtitle={showPrices ? 'Where the value sits. Tap a brand to see its items.' : 'The brands with the most items. Tap one to see its items.'}
                            />
                            <div className="mt-5 space-y-1">
                                {topCategories.map(([name, c]) => (
                                    <BarRow
                                        key={name}
                                        label={name}
                                        value={showPrices ? c.value : c.items}
                                        max={showPrices ? (topCategories[0]?.[1].value || 1) : (topCategories[0]?.[1].items || 1)}
                                        sub={showPrices ? `${c.items} items` : undefined}
                                        money={showPrices}
                                        active={category === name}
                                        onClick={() => setCategory(category === name ? 'ALL' : name)}
                                    />
                                ))}
                                {summary.byCategory.size > 8 && (
                                    <p className="text-[12.5px] text-label-3 pt-2">
                                        {summary.byCategory.size - 8} more brands in the filter below.
                                    </p>
                                )}
                            </div>
                        </Card>

                        <Card className="p-6 max-md:p-5 flex flex-col">
                            <SectionHeader
                                title="Quick insights"
                                subtitle="The range at a glance, from the whole sheet."
                            />
                            <div className="mt-5 grid grid-cols-3 max-md:grid-cols-2 gap-2.5 flex-1 auto-rows-fr">
                                <Insight label="Brands" value={summary.brands.size.toLocaleString('en-IN')} sub="product lines" />
                                <Insight label="Sub-categories" value={summary.subCategories.size.toLocaleString('en-IN')} sub="across those brands" />
                                <Insight label="Total quantity" value={groupIndian(Math.round(summary.quantity))} sub="all units together" />
                                <Insight
                                    label="Critical items"
                                    value={summary.critical.toLocaleString('en-IN')}
                                    sub="out of stock, and stocked or fast-moving"
                                    tone={summary.critical > 0 ? 'var(--dang)' : undefined}
                                />
                                <Insight label="Avg per item" value={formatQty(Math.round(summary.quantity / Math.max(1, summary.items) * 10) / 10)} sub="units per item" />
                                <Insight
                                    label="Low or out"
                                    value={pctText(summary.low + summary.out, summary.items)}
                                    sub={`${(summary.low + summary.out).toLocaleString('en-IN')} items${showPrices ? ` · ${formatCompact(summary.toMinimum)} to reach minimums` : ''}`}
                                    tone={summary.low + summary.out > 0 ? 'var(--age-3-ink)' : undefined}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => { const already = criticalOnly && filtersOn === 1; clearFilters(); if (!already) setCriticalOnly(true); }}
                                aria-pressed={criticalOnly}
                                className={cx(
                                    'mt-4 w-full h-10 rounded-xl text-[13px] font-semibold transition-colors',
                                    criticalOnly ? 'bg-dang text-card' : 'bg-dang-bg text-dang hover:brightness-95',
                                )}
                            >
                                {criticalOnly ? 'Showing the critical items — press to clear' : `Show the ${summary.critical} critical items`}
                            </button>
                        </Card>
                    </div>
                    </div>
                    )}

                    {/* ---------- filters ---------- */}
                    <Card className="p-5 max-md:p-4 space-y-3.5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2">
                            <div className="lg:col-span-4 relative">
                                <input
                                    type="text"
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    placeholder="Search item, brand, sub-category…"
                                    aria-label="Search stock"
                                    className="w-full h-10 pl-9 pr-8 text-[13.5px] rounded-xl border border-separator-strong bg-card-2 text-label focus:ring-2 focus:ring-accent focus:outline-none font-medium max-md:h-11"
                                />
                                <svg className="absolute left-3 top-3 w-4 h-4 text-label-3 max-md:top-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.5-4.5" strokeLinecap="round" /></svg>
                                {search && (
                                    <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-2 w-6 h-6 grid place-items-center rounded-full text-label-3 hover:bg-hover">×</button>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => setPhoneFiltersOpen(v => !v)}
                                aria-expanded={phoneFiltersOpen}
                                className="md:hidden h-11 rounded-xl border border-separator-strong bg-card text-[13.5px] font-semibold text-label-2 flex items-center justify-center gap-2"
                            >
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                                {phoneFiltersOpen ? 'Hide filters' : 'Filters'}
                                {filtersOn > 0 && <span className="num text-[11px] font-bold px-1.5 py-[2px] rounded-full bg-accent text-on-accent">{filtersOn}</span>}
                            </button>

                            <div className={cx('lg:col-span-3', !phoneFiltersOpen && 'max-md:hidden')}>
                                <select aria-label="Brand / category" value={category} onChange={e => setCategory(e.target.value)} className={selectClass}>
                                    <option value="ALL">All brands ({items.length})</option>
                                    {categories.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
                                </select>
                            </div>
                            <div className={cx('lg:col-span-3', !phoneFiltersOpen && 'max-md:hidden')}>
                                <select aria-label="Sub-category" value={subCategory} onChange={e => setSubCategory(e.target.value)} className={selectClass}>
                                    <option value="ALL">All sub-categories</option>
                                    {subCategories.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
                                </select>
                            </div>
                            <div className={cx('lg:col-span-2', !phoneFiltersOpen && 'max-md:hidden')}>
                                <select
                                    aria-label="Sort by"
                                    value={`${sortKey}:${sortDesc ? 'desc' : 'asc'}`}
                                    onChange={e => { const [k, d] = e.target.value.split(':'); setSortTouched(true); setSortKey(k as SortKey); setSortDesc(d === 'desc'); }}
                                    className={selectClass}
                                >
                                    {showPrices && <option value="value:desc">Highest value first</option>}
                                    {showPrices && <option value="value:asc">Lowest value first</option>}
                                    <option value="category:asc">Brand A–Z</option>
                                    <option value="name:asc">Item code A–Z</option>
                                    <option value="quantity:desc">Most quantity first</option>
                                    <option value="quantity:asc">Least quantity first</option>
                                    <option value="ageing:desc">Longest since receipt</option>
                                    <option value="ageing:asc">Most recently received</option>
                                    {showPrices && <option value="rate:desc">Highest rate first</option>}
                                </select>
                            </div>
                        </div>

                        <div className={cx('flex flex-wrap items-center gap-2 pt-3 border-t border-separator', !phoneFiltersOpen && 'max-md:hidden')}>
                            <div className="inline-flex rounded-xl bg-card-2 p-1 gap-1 max-md:flex max-md:w-full" role="group" aria-label="Availability">
                                {(['ALL', 'in', 'low', 'out'] as AvailabilityFilter[]).map(k => (
                                    <button
                                        key={k}
                                        type="button"
                                        onClick={() => setAvailability(k)}
                                        aria-pressed={availability === k}
                                        className={cx(
                                            'h-8 px-3 rounded-lg text-[12.5px] font-bold transition-colors whitespace-nowrap max-md:flex-1 max-md:px-1',
                                            availability === k ? 'bg-accent text-on-accent shadow-e1' : 'text-label-2 hover:bg-hover hover:text-label',
                                        )}
                                    >
                                        {k === 'ALL' ? 'All' : AVAILABILITY_LABELS[k]}
                                    </button>
                                ))}
                            </div>
                            <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value as StatusFilter)} className={chipSelectClass}>
                                <option value="ALL">Any status</option>
                                {(['FM', 'OD', 'D'] as const).map(k => <option key={k} value={k}>{STOCK_STATUS_LABELS[k]} ({k})</option>)}
                            </select>
                            <select aria-label="Movement" value={movement} onChange={e => setMovement(e.target.value as MovementFilter)} className={chipSelectClass}>
                                <option value="ALL">Any movement</option>
                                {(['FAST MOVING', 'REVIEW', 'SLOW MOVING'] as const).map(k => <option key={k} value={k}>{MOVEMENT_LABELS[k]}</option>)}
                            </select>
                            {/* The overview offers this too, but the overview is folded most of the time. */}
                            <button
                                type="button"
                                onClick={() => setCriticalOnly(v => !v)}
                                aria-pressed={criticalOnly}
                                className={cx(
                                    'h-9 px-3 rounded-xl text-[12.5px] font-bold whitespace-nowrap transition-colors max-md:w-full max-md:h-11',
                                    criticalOnly ? 'bg-dang text-card' : 'bg-dang-bg text-dang hover:brightness-95',
                                )}
                            >
                                Critical ({summary.critical})
                            </button>
                            {(filtersOn > 0 || search) && (
                                <button type="button" onClick={clearFilters} className="h-8 px-2 text-[12.5px] font-bold text-dang hover:underline ml-auto">
                                    Reset
                                </button>
                            )}
                        </div>
                    </Card>

                    {/* ---------- the list ---------- */}
                    <Card className="overflow-hidden">
                        <div className="px-4 py-3 bg-card-2 border-b border-separator flex flex-wrap items-center justify-between gap-2 text-[13px]">
                            <span className="font-bold text-label">
                                {filtered.length.toLocaleString('en-IN')} item{filtered.length === 1 ? '' : 's'}
                                {showPrices && (
                                    <>
                                        <span className="font-semibold text-label-3"> · </span>
                                        <span className="num font-semibold text-label-2">{formatCompact(viewValue)}</span>
                                    </>
                                )}
                                <span className="text-label-3 font-medium"> in view</span>
                            </span>
                            <span className="flex items-center gap-2">
                                {/* Several at once: this puts a tick box on every row. */}
                                <button
                                    type="button"
                                    onClick={() => (compareMode ? leaveCompare() : setCompareMode(true))}
                                    aria-pressed={compareMode}
                                    className={cx(
                                        'h-8 px-3 inline-flex items-center gap-1.5 rounded-full text-[12.5px] font-semibold border transition-colors',
                                        compareMode
                                            ? 'bg-accent text-on-accent border-accent'
                                            : 'bg-card border-separator-strong text-label-2 hover:bg-hover',
                                    )}
                                >
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></svg>
                                    {compareMode ? 'Done' : 'Compare'}
                                </button>
                                {canExport && filtered.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => exportExcel()}
                                        className="h-8 px-3 inline-flex items-center gap-1.5 rounded-full text-[12.5px] font-semibold bg-card border border-separator-strong text-label-2 hover:bg-hover"
                                    >
                                        <DownloadIcon className="w-3.5 h-3.5" />
                                        Export {filtered.length === items.length ? 'all' : 'these'}
                                    </button>
                                )}
                            </span>
                        </div>

                        {filtered.length === 0 ? (
                            <EmptyState
                                title="No items match"
                                hint="Try another search, or clear the filters."
                                action={<Button size="sm" variant="secondary" onClick={clearFilters}>Clear filters</Button>}
                            />
                        ) : isPhone ? (
                            <div className="divide-y divide-separator">
                                {filtered.slice(0, visible).map(item => {
                                    const a = availabilityOf(item);
                                    const ticked = isCompared(item.id);
                                    return (
                                        <div key={item.id} className={cx('flex items-stretch', ticked && 'bg-accent-tint')}>
                                        {compareMode && <CompareTick item={item} checked={ticked} disabled={!ticked && compareFull} onToggle={() => toggleCompare(item.id)} className="pl-3 pr-1" />}
                                        <button
                                            type="button"
                                            onClick={() => (compareMode ? toggleCompare(item.id) : setSelected(item))}
                                            className={cx('flex-1 min-w-0 text-left pr-4 py-3 active:bg-press', compareMode ? 'pl-2' : 'pl-4')}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-[14.5px] font-bold text-label leading-snug break-words flex items-center gap-1.5">
                                                        <ColourDot code={item.colour} />
                                                        <span>{item.code}</span>
                                                    </p>
                                                    <p className="text-[12.5px] text-label-3 mt-0.5 truncate">
                                                        {[item.category, item.subCategory].filter(Boolean).join(' · ')}
                                                    </p>
                                                </div>
                                                <div className="text-right flex-none">
                                                    <p className={cx('num text-[15px] font-bold leading-tight', a === 'out' ? 'text-dang' : 'text-label')}>
                                                        {formatQty(item.quantity, item.unit)}
                                                    </p>
                                                    {showPrices && <p className="num text-[12px] text-label-3 mt-0.5">{formatCompact(item.value)}</p>}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 flex-wrap mt-2">
                                                {a !== 'in' && <Badge tone={AVAILABILITY_TONE[a]}>{AVAILABILITY_LABELS[a]}</Badge>}
                                                {isCritical(item) && <Badge tone="dang">Critical</Badge>}
                                                {item.movement && <Badge tone={MOVEMENT_TONE[item.movement]}>{MOVEMENT_LABELS[item.movement]}</Badge>}
                                                <span className="text-[11.5px] text-label-3 ml-auto num">
                                                    {item.lastReceived ? `Recd ${formatDate(item.lastReceived)}` : 'No receipt'}
                                                </span>
                                            </div>
                                            <LevelBar item={item} className="mt-2.5" />
                                        </button>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-[13px] min-w-[960px]">
                                    <thead className="bg-card-2 text-[11.5px] text-label-3 border-b border-separator">
                                        <tr>
                                            {compareMode && (
                                                <th className="pl-3 pr-1 py-2.5 w-[34px]">
                                                    <span className="sr-only">Compare</span>
                                                </th>
                                            )}
                                            <SortHead k="name" className="min-w-[280px]">Item</SortHead>
                                            <SortHead k="quantity" className="text-right">Stock</SortHead>
                                            <th className="px-3 py-2.5 uppercase tracking-wider font-bold w-[150px]">Level</th>
                                            {showPrices && <SortHead k="rate" className="text-right">Rate</SortHead>}
                                            {showPrices && <SortHead k="value" className="text-right">Value</SortHead>}
                                            <th className="px-3 py-2.5 uppercase tracking-wider font-bold">Movement</th>
                                            <SortHead k="ageing">Last received</SortHead>
                                            <th className="px-3 py-2.5 uppercase tracking-wider font-bold">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-separator">
                                        {filtered.slice(0, visible).map(item => {
                                            const a = availabilityOf(item);
                                            const ticked = isCompared(item.id);
                                            return (
                                                <tr
                                                    key={item.id}
                                                    // While comparing, the whole row is the tick box.
                                                    onClick={() => (compareMode ? (ticked || !compareFull) && toggleCompare(item.id) : setSelected(item))}
                                                    className={cx('cursor-pointer transition-colors hover:bg-hover', (selected?.id === item.id || ticked) && 'bg-accent-tint')}
                                                >
                                                    {compareMode && (
                                                        <td className="pl-3 pr-1 py-2.5 align-middle">
                                                            <CompareTick item={item} checked={ticked} disabled={!ticked && compareFull} onToggle={() => toggleCompare(item.id)} />
                                                        </td>
                                                    )}
                                                    <td className="px-3 py-2.5">
                                                        <div className="flex items-center gap-2">
                                                            <ColourDot code={item.colour} />
                                                            <span className="font-bold text-label">{item.code}</span>
                                                            {a !== 'in' && <Badge tone={AVAILABILITY_TONE[a]}>{AVAILABILITY_LABELS[a]}</Badge>}
                                                            {isCritical(item) && <Badge tone="dang">Critical</Badge>}
                                                        </div>
                                                        <p className="text-[12px] text-label-3 mt-0.5">
                                                            {[item.category, item.subCategory].filter(Boolean).join(' · ')}
                                                            {item.taxPct !== undefined ? ` · GST ${item.taxPct}%` : ''}
                                                        </p>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                                        <span className={cx('num font-semibold', a === 'out' ? 'text-dang' : 'text-label')}>{formatQty(item.quantity)}</span>
                                                        <span className="text-[11.5px] text-label-3"> {item.unit}</span>
                                                        {item.quantityWithPo !== item.quantity && (
                                                            <span className="block text-[11.5px] text-label-3 num" title="Including purchase orders">+PO {formatQty(item.quantityWithPo)}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2.5 align-middle">
                                                        {hasLevels(item) ? (
                                                            <>
                                                                <LevelBar item={item} />
                                                                <p className="text-[11px] text-label-3 mt-1.5 num">min {formatQty(item.minLevel)} · max {formatQty(item.maxLevel)}</p>
                                                            </>
                                                        ) : (
                                                            <span className="text-[11.5px] text-label-4">no levels</span>
                                                        )}
                                                    </td>
                                                    {showPrices && <td className="px-3 py-2.5 text-right whitespace-nowrap num text-label-2">{item.rate ? formatINR(item.rate) : '—'}</td>}
                                                    {showPrices && <td className="px-3 py-2.5 text-right whitespace-nowrap num font-semibold text-label" title={formatINR(item.value)}>{formatCompact(item.value)}</td>}
                                                    <td className="px-3 py-2.5 whitespace-nowrap">
                                                        {item.movement ? <Badge tone={MOVEMENT_TONE[item.movement]}>{MOVEMENT_LABELS[item.movement]}</Badge> : <span className="text-label-4">—</span>}
                                                    </td>
                                                    <td className="px-3 py-2.5 whitespace-nowrap">
                                                        {item.lastReceived ? (
                                                            <>
                                                                <span className="text-label-2 num">{formatDate(item.lastReceived)}</span>
                                                                {item.ageingDays !== undefined && (
                                                                    <span className={cx('block text-[11.5px] num', item.ageingDays > 90 ? 'text-warn font-semibold' : 'text-label-3')}>
                                                                        {daysAgo(item.ageingDays)}
                                                                    </span>
                                                                )}
                                                            </>
                                                        ) : <span className="text-label-4">—</span>}
                                                    </td>
                                                    <td className="px-3 py-2.5 whitespace-nowrap">
                                                        {item.status ? <Badge tone={STATUS_TONE[item.status]}>{STOCK_STATUS_LABELS[item.status]}</Badge> : <span className="text-label-4">—</span>}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {visible < filtered.length && (
                            <div className="p-3 border-t border-separator">
                                <button
                                    onClick={() => setVisible(v => v + PAGE * 2)}
                                    className="w-full h-10 rounded-xl bg-card-2 hover:bg-hover text-[13.5px] font-semibold text-label-2"
                                >
                                    Show more — {(filtered.length - visible).toLocaleString('en-IN')} left
                                </button>
                            </div>
                        )}
                    </Card>
                </>
            )}

            {/* ---------- compare bar: the picks, wherever the list has scrolled to ---------- */}
            {compareMode && !compareOpen && (
                <div
                    role="region"
                    aria-label="Items to compare"
                    className="fixed z-40 left-1/2 -translate-x-1/2 bottom-5 max-md:bottom-[calc(92px+env(safe-area-inset-bottom))] w-[min(960px,calc(100vw-32px))] rounded-[16px] bg-card/95 backdrop-blur-xl border border-separator shadow-e3 px-3 py-2 flex items-center gap-2.5 animate-reveal"
                >
                    {compared.length === 0 ? (
                        <p className="flex-1 min-w-0 text-[13px] text-label-2 px-1.5 leading-snug">
                            <span className="font-semibold text-label">Tick the items you want side by side</span>
                            <span className="max-md:hidden"> — up to {COMPARE_MAX}. Search for the next one; the ticks stay.</span>
                        </p>
                    ) : (
                        <>
                            <span className="num text-[13px] font-bold text-label flex-none pl-1.5">{compared.length} of {COMPARE_MAX}</span>
                            <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
                                {compared.map(i => (
                                    <span key={i.id} className="inline-flex items-center gap-0.5 h-7 pl-2.5 pr-1 rounded-full bg-accent-tint text-accent text-[12px] font-semibold whitespace-nowrap">
                                        {i.code}
                                        <button
                                            type="button"
                                            onClick={() => toggleCompare(i.id)}
                                            aria-label={`Take ${i.code} out of the comparison`}
                                            className="w-5 h-5 grid place-items-center rounded-full hover:bg-accent-tint-2 text-[15px] leading-none"
                                        >
                                            &times;
                                        </button>
                                    </span>
                                ))}
                            </div>
                        </>
                    )}
                    {compared.length > 0 && (
                        <Button size="sm" variant="ghost" onClick={clearCompare} className="flex-none max-md:hidden">Clear</Button>
                    )}
                    <Button size="sm" variant="primary" onClick={() => setCompareOpen(true)} disabled={compared.length === 0} className="flex-none">
                        Compare{compared.length > 1 ? ` ${compared.length}` : ''}
                    </Button>
                    <button
                        type="button"
                        onClick={leaveCompare}
                        aria-label="Done comparing"
                        title="Done — back to the plain list"
                        className="w-8 h-8 grid place-items-center rounded-full text-label-3 hover:bg-hover text-xl leading-none flex-none"
                    >
                        &times;
                    </button>
                </div>
            )}

            {/* ---------- compare panel: one column per item, the same facts in the same rows ---------- */}
            {compareOpen && compared.length > 0 && (
                <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Comparing ${compared.length} items`}>
                    <button type="button" aria-label="Close" onClick={() => setCompareOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-xs" />
                    <div className="absolute inset-x-0 bottom-0 top-0 md:inset-6 md:max-w-[1180px] md:mx-auto bg-card md:rounded-[20px] shadow-e3 flex flex-col animate-reveal">
                        <div className="px-5 py-4 border-b border-separator flex items-start justify-between gap-3 flex-none">
                            <div className="min-w-0">
                                <p className="text-[12px] font-semibold uppercase tracking-wider text-label-3">Side by side</p>
                                <h2 className="text-[18px] font-extrabold text-label leading-snug mt-0.5">
                                    {compared.length} item{compared.length === 1 ? '' : 's'}
                                </h2>
                                <p className="text-[13px] text-label-2 mt-1">
                                    Live from the stock sheet{fetchedAt ? ` · read ${agoText(fetchedAt)}` : ''}
                                </p>
                            </div>
                            <div className="flex items-center gap-2 flex-none">
                                {canExport && (
                                    <Button size="sm" variant="quiet" icon={<DownloadIcon className="w-3.5 h-3.5" />} onClick={() => exportExcel(compared)} className="max-md:hidden">
                                        Export these
                                    </Button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setCompareOpen(false)}
                                    aria-label="Close"
                                    className="w-10 h-10 grid place-items-center rounded-full text-label-3 hover:bg-hover text-2xl leading-none flex-none"
                                >
                                    &times;
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto">
                            <table className="border-collapse text-[13px] min-w-full">
                                <thead>
                                    <tr className="align-top">
                                        <th className="sticky left-0 top-0 z-20 bg-card w-[136px] min-w-[112px] max-md:min-w-[96px] px-4 py-3 text-left border-b border-separator" />
                                        {compared.map(i => (
                                            <th key={i.id} className="sticky top-0 z-10 bg-card min-w-[220px] max-md:min-w-[184px] px-4 py-3 text-left font-normal border-b border-l border-separator">
                                                <div className="flex items-start gap-2">
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-[12px] font-semibold uppercase tracking-wider text-label-3 truncate">
                                                            {[i.category, i.subCategory].filter(Boolean).join(' · ') || 'Item'}
                                                        </p>
                                                        <button type="button" onClick={() => { setCompareOpen(false); setSelected(i); }} className="text-[14.5px] font-extrabold text-label hover:text-accent text-left leading-snug break-words flex items-center gap-1.5 mt-0.5" title="Open this item">
                                                            <ColourDot code={i.colour} />
                                                            <span>{i.code}</span>
                                                        </button>
                                                        {i.description !== i.code && <p className="text-[12px] text-label-2 mt-0.5 line-clamp-2">{i.description}</p>}
                                                        {/* Below the name, so the names line up across columns whether or not there is a picture. */}
                                                        {i.photoUrl && (
                                                            <img
                                                                key={i.id}
                                                                src={drivePhotoUrl(i.photoUrl)}
                                                                alt=""
                                                                className="w-full h-20 object-contain rounded-[10px] bg-card-2 mt-2"
                                                                referrerPolicy="no-referrer"
                                                                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                                            />
                                                        )}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleCompare(i.id)}
                                                        aria-label={`Take ${i.code} out of the comparison`}
                                                        title="Take out of the comparison"
                                                        className="w-7 h-7 grid place-items-center rounded-full text-label-3 hover:bg-hover text-lg leading-none flex-none -mr-1.5"
                                                    >
                                                        &times;
                                                    </button>
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-separator">
                                    {(() => {
                                        // A plain function, not a component: a component declared
                                        // here would be a new one every render and remount its row.
                                        const Row = (label: string, cell: (i: StockItem) => React.ReactNode) => (
                                            <tr key={label} className="align-top">
                                                <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-3 text-left align-top whitespace-nowrap"><span className="label">{label}</span></th>
                                                {compared.map(i => <td key={i.id} className="px-4 py-3 border-l border-separator">{cell(i)}</td>)}
                                            </tr>
                                        );
                                        // The largest stock is marked only when the units agree: 7,514 MTR is not more than 200 KGS.
                                        const sameUnit = compared.every(i => i.unit === compared[0].unit);
                                        const most = sameUnit && compared.length > 1 ? Math.max(...compared.map(i => i.quantity)) : NaN;
                                        return (
                                            <>
                                                {Row('Availability', i => { const a = availabilityOf(i); return <div className="flex items-center gap-1.5 flex-wrap"><Badge tone={AVAILABILITY_TONE[a]}>{AVAILABILITY_LABELS[a]}</Badge>{isCritical(i) && <Badge tone="dang">Critical</Badge>}</div>; })}
                                                {Row('In stock', i => { const a = availabilityOf(i); return <><span className={cx('num text-[18px] font-semibold', a === 'out' ? 'text-dang' : i.quantity === most ? 'text-pos' : 'text-label')}>{formatQty(i.quantity)}</span><span className="text-[11.5px] text-label-3"> {i.unit}</span>{i.quantityWithPo !== i.quantity && <span className="block text-[11.5px] text-label-3 num">+PO {formatQty(i.quantityWithPo)}</span>}</>; })}
                                                {Row('Levels', i => hasLevels(i) ? <><LevelBar item={i} /><p className="text-[11px] text-label-3 mt-1.5 num">min {formatQty(i.minLevel)} · max {formatQty(i.maxLevel)}</p></> : <span className="text-[11.5px] text-label-4">no levels{i.status === 'OD' ? ' · on demand' : ''}</span>)}
                                                {Row('Short by', i => hasLevels(i) && i.quantity < i.minLevel ? <span className="num font-semibold text-dang">{formatQty(i.minLevel - i.quantity, i.unit)}{showPrices && i.rate ? <span className="block text-[11.5px] font-normal text-label-3">{formatINR((i.minLevel - i.quantity) * i.rate)} to bring back</span> : null}</span> : <span className="text-label-4">—</span>)}
                                                {showPrices && Row('Rate', i => i.rate ? <span className="num text-label">{formatINR(i.rate)}<span className="text-[11.5px] text-label-3"> / {i.unit || 'unit'}</span></span> : <span className="text-label-4">—</span>)}
                                                {showPrices && Row('Value', i => <span className="num font-semibold text-label" title={formatINR(i.value)}>{formatCompact(i.value)}</span>)}
                                                {Row('Status', i => i.status ? <Badge tone={STATUS_TONE[i.status]}>{STOCK_STATUS_LABELS[i.status]}</Badge> : <span className="text-label-4">—</span>)}
                                                {Row('Movement', i => i.movement ? <Badge tone={MOVEMENT_TONE[i.movement]}>{MOVEMENT_LABELS[i.movement]}</Badge> : <span className="text-label-4">—</span>)}
                                                {Row('Last received', i => i.lastReceived ? <><span className="num text-label">{formatDate(i.lastReceived)}</span>{i.ageingDays !== undefined && <span className={cx('block text-[11.5px] num', i.ageingDays > 90 ? 'text-warn font-semibold' : 'text-label-3')}>{daysAgo(i.ageingDays)} · {STOCK_AGE_LABELS[stockAgeBucket(i)]}</span>}</> : <span className="text-label-4">No receipt on record</span>)}
                                                {Row('Avg sales qty', i => i.avgSales !== undefined ? <span className="num text-label">{formatQty(i.avgSales, i.unit)}</span> : <span className="text-label-4">—</span>)}
                                                {Row('Transactions', i => <span className="num text-label">{i.transactions.toLocaleString('en-IN')}</span>)}
                                                {Row('MOQ', i => i.moq !== undefined ? <span className="num text-label">{formatQty(i.moq, i.unit)}</span> : <span className="text-label-4">—</span>)}
                                                {Row('GST', i => i.taxPct !== undefined ? <span className="num text-label">{i.taxPct}%</span> : <span className="text-label-4">—</span>)}
                                                {Row('Colour', i => i.colour ? <span className="inline-flex items-center gap-1.5 text-label"><ColourDot code={i.colour} />{STOCK_COLOUR_LABELS[i.colour]}</span> : <span className="text-label-4">—</span>)}
                                                {Row('Sheet row', i => <span className="num text-label-2">#{i.serial}</span>)}
                                            </>
                                        );
                                    })()}
                                </tbody>
                            </table>
                        </div>

                        <div className="px-5 py-3 border-t border-separator flex items-center justify-between gap-3 flex-none pb-[calc(12px+env(safe-area-inset-bottom))]">
                            <span className="text-[12.5px] text-label-3">
                                {compared.length < COMPARE_MAX ? `Close this and tick more — up to ${COMPARE_MAX}.` : `${COMPARE_MAX} is the most that fits side by side.`}
                            </span>
                            <div className="flex items-center gap-2">
                                {canExport && (
                                    <Button size="sm" variant="quiet" icon={<DownloadIcon className="w-3.5 h-3.5" />} onClick={() => exportExcel(compared)} className="md:hidden">
                                        Export these
                                    </Button>
                                )}
                                <Button size="sm" variant="ghost" onClick={clearCompare} className="text-dang hover:bg-dang-bg hover:text-dang">Clear all</Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ---------- item drawer ---------- */}
            {selected && (() => {
                const a = availabilityOf(selected);
                return (
                <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={selected.code}>
                    <button type="button" aria-label="Close" onClick={() => setSelected(null)} className="absolute inset-0 bg-black/40 backdrop-blur-xs" />
                    <div className="absolute inset-y-0 right-0 w-full md:w-[460px] bg-card shadow-e3 flex flex-col animate-in slide-in-from-right-4 fade-in duration-150">
                        <div className="px-5 py-4 border-b border-separator flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-[12px] font-semibold uppercase tracking-wider text-label-3">
                                    {[selected.category, selected.subCategory].filter(Boolean).join(' · ') || 'Item'}
                                </p>
                                <h2 className="text-[18px] font-extrabold text-label leading-snug mt-0.5 break-words flex items-center gap-2">
                                    <ColourDot code={selected.colour} />
                                    <span>{selected.code}</span>
                                </h2>
                                {selected.description !== selected.code && (
                                    <p className="text-[13px] text-label-2 mt-1">{selected.description}</p>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelected(null)}
                                aria-label="Close"
                                className="w-10 h-10 grid place-items-center rounded-full text-label-3 hover:bg-hover text-2xl leading-none flex-none"
                            >
                                &times;
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 space-y-5">
                            {selected.photoUrl && (
                                <img
                                    key={selected.id}
                                    src={drivePhotoUrl(selected.photoUrl)}
                                    alt={selected.code}
                                    className="w-full max-h-64 object-contain rounded-[14px] bg-card-2"
                                    // Drive answers a request carrying this app's address with a
                                    // page rather than the picture, which the browser then refuses
                                    // to show as an image. With no referrer it serves the picture.
                                    referrerPolicy="no-referrer"
                                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                />
                            )}

                            <div className="flex items-center gap-1.5 flex-wrap">
                                <Badge tone={AVAILABILITY_TONE[a]}>{AVAILABILITY_LABELS[a]}</Badge>
                                {isCritical(selected) && <Badge tone="dang">Critical</Badge>}
                                {selected.isShort && <Badge tone="warn">Short of minimum{selected.shortSince ? ` since ${formatDate(selected.shortSince)}` : ''}</Badge>}
                                {selected.status && <Badge tone={STATUS_TONE[selected.status]}>{STOCK_STATUS_LABELS[selected.status]}</Badge>}
                                {selected.movement && <Badge tone={MOVEMENT_TONE[selected.movement]}>{MOVEMENT_LABELS[selected.movement]}</Badge>}
                                {selected.colour && <Badge tone="neutral">{STOCK_COLOUR_LABELS[selected.colour]}</Badge>}
                            </div>

                            <div className={cx('grid gap-2', showPrices ? 'grid-cols-3' : 'grid-cols-2')}>
                                <div className="bg-card-2 rounded-[14px] px-3.5 py-3">
                                    <p className="label">In stock</p>
                                    <p className={cx('num text-[20px] font-semibold mt-1 leading-none', a === 'out' ? 'text-dang' : 'text-label')}>{formatQty(selected.quantity)}</p>
                                    <p className="text-[11.5px] text-label-3 mt-1">{selected.unit || 'units'}{selected.quantityWithPo !== selected.quantity ? ` · +PO ${formatQty(selected.quantityWithPo)}` : ''}</p>
                                </div>
                                {showPrices ? (
                                    <>
                                        <div className="bg-card-2 rounded-[14px] px-3.5 py-3">
                                            <p className="label">Value</p>
                                            <p className="num text-[20px] font-semibold text-label mt-1 leading-none">{formatCompact(selected.value)}</p>
                                            <p className="text-[11.5px] text-label-3 mt-1">{formatINR(selected.value)}</p>
                                        </div>
                                        <div className="bg-card-2 rounded-[14px] px-3.5 py-3">
                                            <p className="label">Rate</p>
                                            <p className="num text-[20px] font-semibold text-label mt-1 leading-none">{selected.rate ? formatINR(selected.rate) : '—'}</p>
                                            <p className="text-[11.5px] text-label-3 mt-1">per {selected.unit || 'unit'}{selected.taxPct !== undefined ? ` · GST ${selected.taxPct}%` : ''}</p>
                                        </div>
                                    </>
                                ) : (
                                    <div className="bg-card-2 rounded-[14px] px-3.5 py-3">
                                        <p className="label">Unit</p>
                                        <p className="num text-[20px] font-semibold text-label mt-1 leading-none">{selected.unit || '—'}</p>
                                        <p className="text-[11.5px] text-label-3 mt-1">{selected.taxPct !== undefined ? `GST ${selected.taxPct}%` : 'per item'}</p>
                                    </div>
                                )}
                            </div>

                            {hasLevels(selected) ? (
                                <div className="bg-card-2 rounded-[14px] px-4 py-3.5">
                                    <div className="flex items-baseline justify-between text-[12.5px]">
                                        <span className="font-semibold text-label-2">Against its levels</span>
                                        <span className="num text-label-3">min {formatQty(selected.minLevel)} · max {formatQty(selected.maxLevel)}</span>
                                    </div>
                                    <LevelBar item={selected} className="mt-3" />
                                    <p className="text-[12.5px] mt-3 text-label-2">
                                        {selected.quantity < selected.minLevel
                                            ? <><span className="font-semibold text-dang">{formatQty(selected.minLevel - selected.quantity, selected.unit)} short</span> of the minimum{showPrices && selected.rate ? ` — about ${formatINR((selected.minLevel - selected.quantity) * selected.rate)} to bring back` : ''}.</>
                                            : selected.maxLevel > 0 && selected.quantity >= selected.maxLevel
                                                ? <span className="font-semibold text-pos">At or above the maximum.</span>
                                                : <span className="font-semibold text-warn">Between minimum and maximum.</span>}
                                    </p>
                                </div>
                            ) : (
                                <p className="text-[12.5px] text-label-3 bg-card-2 rounded-[14px] px-4 py-3">
                                    No minimum or maximum level is set for this item{selected.status === 'OD' ? ' — it is bought on demand.' : selected.status === 'D' ? ' — it is marked dead stock.' : '.'}
                                </p>
                            )}

                            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                                <div>
                                    <dt className="label">Last received</dt>
                                    <dd className="text-label mt-0.5 num">{selected.lastReceived ? formatDate(selected.lastReceived) : 'No receipt on record'}</dd>
                                    {selected.ageingDays !== undefined && <dd className={cx('text-[12px] num', selected.ageingDays > 90 ? 'text-warn font-semibold' : 'text-label-3')}>{daysAgo(selected.ageingDays)} · {STOCK_AGE_LABELS[stockAgeBucket(selected)]}</dd>}
                                </div>
                                <div>
                                    <dt className="label">Transactions</dt>
                                    <dd className="text-label mt-0.5 num">{selected.transactions.toLocaleString('en-IN')}</dd>
                                </div>
                                <div>
                                    <dt className="label">Average sales qty</dt>
                                    <dd className="text-label mt-0.5 num">{selected.avgSales !== undefined ? formatQty(selected.avgSales, selected.unit) : '—'}</dd>
                                </div>
                                <div>
                                    <dt className="label">MOQ</dt>
                                    <dd className="text-label mt-0.5 num">{selected.moq !== undefined ? formatQty(selected.moq, selected.unit) : '—'}</dd>
                                </div>
                                <div>
                                    <dt className="label">Sheet row</dt>
                                    <dd className="text-label mt-0.5 num">#{selected.serial}</dd>
                                </div>
                                <div>
                                    <dt className="label">Status code</dt>
                                    <dd className="text-label mt-0.5 font-mono">{selected.status || '—'}</dd>
                                </div>
                            </dl>
                        </div>

                        <div className="px-5 py-3.5 border-t border-separator flex items-center justify-between gap-2 pb-[calc(14px+env(safe-area-inset-bottom))]">
                            <span className="text-[12px] text-label-3">
                                {showPrices ? 'Edit in the sheet; this page follows it.' : 'Kept by the stores team; this page follows their sheet.'}
                            </span>
                            {showPrices && (
                                <a
                                    href={`${LIVE_STOCK_SHEET_URL}&range=A${selected.serial + 2}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="h-10 px-4 inline-flex items-center rounded-full text-[13.5px] font-bold bg-accent text-on-accent hover:bg-accent-press"
                                >
                                    Open in sheet ↗
                                </a>
                            )}
                        </div>
                    </div>
                </div>
                );
            })()}
        </div>
    );
};

export default LiveStockView;
