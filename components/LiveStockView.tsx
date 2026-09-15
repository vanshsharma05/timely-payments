import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { User, can, matchesSearch } from '../types';
import {
    StockItem,
    StockStatus,
    StockMovement,
    StockAgeBucket,
    STOCK_STATUS_LABELS,
    MOVEMENT_LABELS,
    STOCK_AGE_LABELS,
    STOCK_COLOUR_LABELS,
    stockAgeBucket,
    hasLevels,
    drivePhotoUrl,
    LIVE_STOCK_SHEET_URL,
    LIVE_STOCK_REFRESH_MS,
} from '../services/liveStock';
import { Badge, Button, Card, EmptyState, SectionHeader, Stat, cx } from './ui/Primitives';
import { formatCompact, formatDate, formatINR, groupIndian } from './ui/format';
import { useIsPhone } from './ui/usePhone';
import { DownloadIcon, SyncIcon } from './icons/Icons';

/* ============================================================================
   Live stock — a window onto the stores sheet.

   Read-only by design: the stores team keeps the sheet, and this page shows
   what they keep, a minute behind at most. Everything here is arranged the
   way the rest of the app is — figures first, then the list those figures
   open onto, and a row that opens into the whole record.
   ============================================================================ */

interface LiveStockViewProps {
    items: StockItem[];
    fetchedAt?: string;
    loading: boolean;
    error?: string;
    fromCache: boolean;
    onRefresh: () => void;
    currentUser: User | null;
    /** Search text from the app bar. */
    globalSearch?: string;
}

type StatusFilter = 'ALL' | StockStatus;
type MovementFilter = 'ALL' | StockMovement;
type AgeFilter = 'all' | StockAgeBucket;
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
    active,
    onClick,
    tone = 'var(--accent)',
}: {
    label: string;
    value: number;
    max: number;
    sub?: string;
    active?: boolean;
    onClick?: () => void;
    tone?: string;
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
                {formatCompact(value)}
                {sub && <span className="text-label-3 font-normal"> · {sub}</span>}
            </span>
        </div>
        <div className="h-1.5 rounded-full bg-card-3 mt-1.5 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: tone }} />
        </div>
    </button>
);

export const LiveStockView = ({
    items,
    fetchedAt,
    loading,
    error,
    fromCache,
    onRefresh,
    currentUser,
    globalSearch = '',
}: LiveStockViewProps) => {
    const isPhone = useIsPhone();
    const canExport = can(currentUser, 'canExportData');

    /* ------------------------------- filters ------------------------------ */
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('ALL');
    const [subCategory, setSubCategory] = useState('ALL');
    const [status, setStatus] = useState<StatusFilter>('ALL');
    const [movement, setMovement] = useState<MovementFilter>('ALL');
    const [age, setAge] = useState<AgeFilter>('all');
    const [shortOnly, setShortOnly] = useState(false);
    const [inStockOnly, setInStockOnly] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey>('value');
    const [sortDesc, setSortDesc] = useState(true);
    const [phoneFiltersOpen, setPhoneFiltersOpen] = useState(false);
    const [selected, setSelected] = useState<StockItem | null>(null);

    // A sub-category belongs to a category; changing the category clears it.
    useEffect(() => { setSubCategory('ALL'); }, [category]);

    const PAGE = 60;
    const [visible, setVisible] = useState(PAGE);
    useEffect(() => { setVisible(PAGE); }, [search, globalSearch, category, subCategory, status, movement, age, shortOnly, inStockOnly, sortKey, sortDesc]);

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
            if (status !== 'ALL' && i.status !== status) return false;
            if (movement !== 'ALL' && i.movement !== movement) return false;
            if (age !== 'all' && stockAgeBucket(i) !== age) return false;
            if (shortOnly && !i.isShort) return false;
            if (inStockOnly && i.quantity <= 0) return false;
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
    }, [items, globalSearch, search, category, subCategory, status, movement, age, shortOnly, inStockOnly, sortKey, sortDesc]);

    /** The figures on the tiles are of the whole sheet, never of the filter. */
    const summary = useMemo(() => {
        const s = {
            items: items.length,
            inStock: 0,
            value: 0,
            short: 0,
            shortValue: 0,
            dead: 0,
            deadValue: 0,
            fast: 0,
            fastValue: 0,
            stale: 0,
            staleValue: 0,
            byStatus: { FM: 0, OD: 0, D: 0, '': 0 } as Record<StockStatus, number>,
            byMovement: { 'FAST MOVING': 0, REVIEW: 0, 'SLOW MOVING': 0, '': 0 } as Record<StockMovement, number>,
            byCategory: new Map<string, { items: number; value: number }>(),
        };
        items.forEach(i => {
            s.value += i.value;
            if (i.quantity > 0) s.inStock++;
            if (i.isShort) { s.short++; s.shortValue += Math.max(0, i.minLevel - i.quantity) * i.rate; }
            if (i.status === 'D') { s.dead++; s.deadValue += i.value; }
            if (i.movement === 'FAST MOVING') { s.fast++; s.fastValue += i.value; }
            if (stockAgeBucket(i) === '90+') { s.stale++; s.staleValue += i.value; }
            s.byStatus[i.status] += i.value;
            s.byMovement[i.movement] += i.value;
            const c = s.byCategory.get(i.category || '(none)') || { items: 0, value: 0 };
            c.items++; c.value += i.value; s.byCategory.set(i.category || '(none)', c);
        });
        return s;
    }, [items]);

    const topCategories = useMemo(
        () => [...summary.byCategory.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 8),
        [summary],
    );

    const viewValue = useMemo(() => filtered.reduce((a, i) => a + i.value, 0), [filtered]);

    const filtersOn = [category !== 'ALL', subCategory !== 'ALL', status !== 'ALL', movement !== 'ALL', age !== 'all', shortOnly, inStockOnly].filter(Boolean).length;
    const clearFilters = () => {
        setSearch(''); setCategory('ALL'); setSubCategory('ALL'); setStatus('ALL'); setMovement('ALL');
        setAge('all'); setShortOnly(false); setInStockOnly(false);
    };

    /** A tile is a filter: pressing it again clears it. */
    const tileIs = (want: { status?: StatusFilter; movement?: MovementFilter; age?: AgeFilter; short?: boolean }) =>
        (want.status === undefined || status === want.status)
        && (want.movement === undefined || movement === want.movement)
        && (want.age === undefined || age === want.age)
        && (want.short === undefined || shortOnly === want.short)
        && filtersOn === Object.keys(want).length;
    const applyTile = (want: { status?: StatusFilter; movement?: MovementFilter; age?: AgeFilter; short?: boolean }) => {
        const already = tileIs(want);
        clearFilters();
        if (already) return;
        if (want.status !== undefined) setStatus(want.status);
        if (want.movement !== undefined) setMovement(want.movement);
        if (want.age !== undefined) setAge(want.age);
        if (want.short !== undefined) setShortOnly(want.short);
    };

    const sortBy = (k: SortKey) => {
        if (sortKey === k) setSortDesc(d => !d);
        else { setSortKey(k); setSortDesc(k !== 'name' && k !== 'category'); }
    };

    const exportExcel = () => {
        const rows = filtered.map(i => ({
            'Item Code': i.code,
            'Description': i.description,
            'Brand / Category': i.category,
            'Sub-category': i.subCategory,
            'Unit': i.unit,
            'Quantity': i.quantity,
            'Quantity + PO': i.quantityWithPo,
            'Rate (₹)': i.rate,
            'Value (₹)': i.value,
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

    const nothingYet = items.length === 0;

    return (
        <div className="space-y-5 max-md:space-y-4">
            {/* ---------- freshness ---------- */}
            <div className={cx(
                'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] px-4 py-2.5 text-[13px]',
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
                                ? `Showing the last read (${agoText(fetchedAt)}) while the sheet loads`
                                : `Live from the stock sheet · read ${agoText(fetchedAt)}`}
                </span>
                {error && <span className="opacity-90">— {error}{fetchedAt ? ` Showing the read from ${agoText(fetchedAt)}.` : ''}</span>}
                {!error && !fromCache && (
                    <span className="text-label-3">Re-reads every {Math.round(LIVE_STOCK_REFRESH_MS / 1000)}s while this page is open.</span>
                )}
                <span className="ml-auto flex items-center gap-2">
                    <a
                        href={LIVE_STOCK_SHEET_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-8 px-3 inline-flex items-center rounded-full text-[12.5px] font-semibold text-accent hover:bg-accent-tint"
                    >
                        Open the sheet ↗
                    </a>
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
                    {/* ---------- tiles: the whole sheet, each one a filter ---------- */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 max-md:flex max-md:overflow-x-auto max-md:snap-x max-md:snap-mandatory max-md:-mx-4 max-md:px-4 max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&>*]:min-w-[180px] max-md:[&>*]:snap-start">
                        <Stat
                            label="Stock value"
                            tone="brand"
                            active={filtersOn === 0 && !search}
                            onClick={() => clearFilters()}
                            value={formatCompact(summary.value)}
                            sub={<>{summary.items.toLocaleString('en-IN')} items · <span className="num font-semibold text-label-2">{summary.inStock.toLocaleString('en-IN')}</span> in stock</>}
                        />
                        <Stat
                            label="Short of minimum"
                            tone="dang"
                            active={tileIs({ short: true })}
                            onClick={() => applyTile({ short: true })}
                            value={summary.short}
                            sub={<><span className="num font-semibold text-label-2">{formatCompact(summary.shortValue)}</span> to bring back to minimum</>}
                        />
                        <Stat
                            label="Dead stock"
                            tone="age4"
                            active={tileIs({ status: 'D' })}
                            onClick={() => applyTile({ status: 'D' })}
                            value={summary.dead}
                            sub={<><span className="num font-semibold text-label-2">{formatCompact(summary.deadValue)}</span> sitting</>}
                        />
                        <Stat
                            label="Fast moving"
                            tone="pos"
                            active={tileIs({ movement: 'FAST MOVING' })}
                            onClick={() => applyTile({ movement: 'FAST MOVING' })}
                            value={summary.fast}
                            sub={<><span className="num font-semibold text-label-2">{formatCompact(summary.fastValue)}</span> in stock</>}
                        />
                        <Stat
                            label="Not received in 90 days"
                            tone="warn"
                            active={tileIs({ age: '90+' })}
                            onClick={() => applyTile({ age: '90+' })}
                            value={summary.stale}
                            sub={<><span className="num font-semibold text-label-2">{formatCompact(summary.staleValue)}</span> of stock</>}
                        />
                    </div>

                    {/* ---------- breakdowns ---------- */}
                    <div className="grid lg:grid-cols-2 gap-3.5">
                        <Card className="p-6 max-md:p-5">
                            <SectionHeader
                                title="Stock by brand"
                                subtitle="Where the value sits. Tap a brand to see its items."
                            />
                            <div className="mt-5 space-y-1">
                                {topCategories.map(([name, c]) => (
                                    <BarRow
                                        key={name}
                                        label={name}
                                        value={c.value}
                                        max={topCategories[0]?.[1].value || 1}
                                        sub={`${c.items} items`}
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

                        <Card className="p-6 max-md:p-5 flex flex-col gap-6">
                            <div>
                                <SectionHeader
                                    title="How the stock is held"
                                    subtitle="Stocked items are kept between a minimum and a maximum; on-demand items are bought against orders; dead stock is neither."
                                />
                                <div className="mt-5 flex h-3 rounded-full overflow-hidden bg-card-3 gap-[2px]" role="img" aria-label="Stock value by status">
                                    {(['FM', 'OD', 'D'] as const).map(k => (
                                        <div
                                            key={k}
                                            title={`${STOCK_STATUS_LABELS[k]}: ${formatINR(summary.byStatus[k])}`}
                                            style={{
                                                width: `${summary.value > 0 ? (summary.byStatus[k] / summary.value) * 100 : 0}%`,
                                                background: k === 'FM' ? 'var(--pos)' : k === 'OD' ? 'var(--accent)' : 'var(--dang)',
                                            }}
                                        />
                                    ))}
                                </div>
                                <div className="grid grid-cols-3 gap-2 mt-3">
                                    {(['FM', 'OD', 'D'] as const).map(k => (
                                        <button
                                            key={k}
                                            type="button"
                                            onClick={() => setStatus(status === k ? 'ALL' : k)}
                                            aria-pressed={status === k}
                                            className={cx(
                                                'text-left rounded-[12px] px-3 py-2.5 transition-colors',
                                                status === k ? 'bg-accent-tint ring-1 ring-accent' : 'bg-card-2 hover:bg-hover',
                                            )}
                                        >
                                            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-label-2">
                                                <span className="w-2 h-2 rounded-full" style={{ background: k === 'FM' ? 'var(--pos)' : k === 'OD' ? 'var(--accent)' : 'var(--dang)' }} aria-hidden="true" />
                                                {STOCK_STATUS_LABELS[k]}
                                            </span>
                                            <span className="block num text-[16px] font-semibold text-label mt-1">{formatCompact(summary.byStatus[k])}</span>
                                            <span className="block text-[11.5px] text-label-3">{items.filter(i => i.status === k).length} items</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="label">Movement</p>
                                <div className="mt-2.5 space-y-1">
                                    {(['FAST MOVING', 'REVIEW', 'SLOW MOVING'] as const).map(k => (
                                        <BarRow
                                            key={k}
                                            label={MOVEMENT_LABELS[k]}
                                            value={summary.byMovement[k]}
                                            max={Math.max(...(['FAST MOVING', 'REVIEW', 'SLOW MOVING'] as const).map(m => summary.byMovement[m]), 1)}
                                            sub={`${items.filter(i => i.movement === k).length} items`}
                                            active={movement === k}
                                            onClick={() => setMovement(movement === k ? 'ALL' : k)}
                                            tone={k === 'FAST MOVING' ? 'var(--pos)' : k === 'REVIEW' ? 'var(--warn)' : 'var(--age-3)'}
                                        />
                                    ))}
                                </div>
                            </div>
                        </Card>
                    </div>

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
                                <select
                                    aria-label="Brand / category"
                                    value={category}
                                    onChange={e => setCategory(e.target.value)}
                                    className="w-full h-10 px-3 text-[13px] rounded-xl border border-separator-strong bg-card-2 text-label font-semibold focus:ring-2 focus:ring-accent max-md:h-11"
                                >
                                    <option value="ALL">All brands ({items.length})</option>
                                    {categories.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
                                </select>
                            </div>
                            <div className={cx('lg:col-span-3', !phoneFiltersOpen && 'max-md:hidden')}>
                                <select
                                    aria-label="Sub-category"
                                    value={subCategory}
                                    onChange={e => setSubCategory(e.target.value)}
                                    className="w-full h-10 px-3 text-[13px] rounded-xl border border-separator-strong bg-card-2 text-label font-semibold focus:ring-2 focus:ring-accent max-md:h-11"
                                >
                                    <option value="ALL">All sub-categories</option>
                                    {subCategories.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
                                </select>
                            </div>
                            <div className={cx('lg:col-span-2', !phoneFiltersOpen && 'max-md:hidden')}>
                                <select
                                    aria-label="Sort by"
                                    value={`${sortKey}:${sortDesc ? 'desc' : 'asc'}`}
                                    onChange={e => { const [k, d] = e.target.value.split(':'); setSortKey(k as SortKey); setSortDesc(d === 'desc'); }}
                                    className="w-full h-10 px-3 text-[13px] rounded-xl border border-separator-strong bg-card-2 text-label font-semibold focus:ring-2 focus:ring-accent max-md:h-11"
                                >
                                    <option value="value:desc">Highest value first</option>
                                    <option value="value:asc">Lowest value first</option>
                                    <option value="quantity:desc">Most quantity first</option>
                                    <option value="quantity:asc">Least quantity first</option>
                                    <option value="ageing:desc">Longest since receipt</option>
                                    <option value="ageing:asc">Most recently received</option>
                                    <option value="rate:desc">Highest rate first</option>
                                    <option value="name:asc">Item code A–Z</option>
                                    <option value="category:asc">Brand A–Z</option>
                                </select>
                            </div>
                        </div>

                        <div className={cx('flex flex-wrap items-center gap-1.5 pt-3 border-t border-separator', !phoneFiltersOpen && 'max-md:hidden')}>
                            <span className="text-[11.5px] font-bold uppercase tracking-wider text-label-3 mr-1">Status</span>
                            {(['ALL', 'FM', 'OD', 'D'] as StatusFilter[]).map(k => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => setStatus(k)}
                                    aria-pressed={status === k}
                                    className={cx('h-8 px-3 rounded-full text-[12.5px] font-semibold transition-colors', status === k ? 'bg-label text-card' : 'bg-card-2 text-label-2 hover:bg-hover')}
                                >
                                    {k === 'ALL' ? 'All' : STOCK_STATUS_LABELS[k]}
                                </button>
                            ))}
                            <span className="text-[11.5px] font-bold uppercase tracking-wider text-label-3 mx-1 ml-3">Movement</span>
                            {(['ALL', 'FAST MOVING', 'REVIEW', 'SLOW MOVING'] as MovementFilter[]).map(k => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => setMovement(k)}
                                    aria-pressed={movement === k}
                                    className={cx('h-8 px-3 rounded-full text-[12.5px] font-semibold transition-colors', movement === k ? 'bg-label text-card' : 'bg-card-2 text-label-2 hover:bg-hover')}
                                >
                                    {k === 'ALL' ? 'All' : MOVEMENT_LABELS[k]}
                                </button>
                            ))}
                        </div>
                        <div className={cx('flex flex-wrap items-center gap-1.5', !phoneFiltersOpen && 'max-md:hidden')}>
                            <span className="text-[11.5px] font-bold uppercase tracking-wider text-label-3 mr-1">Last received</span>
                            {(['all', '0-30', '31-60', '61-90', '90+', 'never'] as AgeFilter[]).map(k => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => setAge(k)}
                                    aria-pressed={age === k}
                                    className={cx('h-8 px-3 rounded-full text-[12.5px] font-semibold transition-colors', age === k ? 'bg-label text-card' : 'bg-card-2 text-label-2 hover:bg-hover')}
                                >
                                    {k === 'all' ? 'Any time' : k === 'never' ? 'No receipt' : k === '90+' ? '90+ days' : `${k} days`}
                                </button>
                            ))}
                            <label className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-card-2 text-[12.5px] font-semibold text-label-2 cursor-pointer ml-3">
                                <input type="checkbox" checked={shortOnly} onChange={e => setShortOnly(e.target.checked)} className="w-4 h-4 rounded" />
                                Short of minimum
                            </label>
                            <label className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-card-2 text-[12.5px] font-semibold text-label-2 cursor-pointer">
                                <input type="checkbox" checked={inStockOnly} onChange={e => setInStockOnly(e.target.checked)} className="w-4 h-4 rounded" />
                                In stock only
                            </label>
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
                                <span className="font-semibold text-label-3"> · </span>
                                <span className="num font-semibold text-label-2">{formatCompact(viewValue)}</span>
                                <span className="text-label-3 font-medium"> in view</span>
                            </span>
                            {canExport && filtered.length > 0 && (
                                <button
                                    type="button"
                                    onClick={exportExcel}
                                    className="h-8 px-3 inline-flex items-center gap-1.5 rounded-full text-[12.5px] font-semibold bg-card border border-separator-strong text-label-2 hover:bg-hover"
                                >
                                    <DownloadIcon className="w-3.5 h-3.5" />
                                    Export {filtered.length === items.length ? 'all' : 'these'}
                                </button>
                            )}
                        </div>

                        {filtered.length === 0 ? (
                            <EmptyState
                                title="No items match"
                                hint="Try another search, or clear the filters."
                                action={<Button size="sm" variant="secondary" onClick={clearFilters}>Clear filters</Button>}
                            />
                        ) : isPhone ? (
                            <div className="divide-y divide-separator">
                                {filtered.slice(0, visible).map(item => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setSelected(item)}
                                        className="w-full text-left px-4 py-3 active:bg-press"
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
                                                <p className={cx('num text-[15px] font-bold leading-tight', item.quantity <= 0 ? 'text-label-3' : 'text-label')}>
                                                    {formatQty(item.quantity, item.unit)}
                                                </p>
                                                <p className="num text-[12px] text-label-3 mt-0.5">{formatCompact(item.value)}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap mt-2">
                                            {item.status && <Badge tone={STATUS_TONE[item.status]}>{STOCK_STATUS_LABELS[item.status]}</Badge>}
                                            {item.isShort && <Badge tone="dang">Short</Badge>}
                                            {item.movement && <Badge tone={MOVEMENT_TONE[item.movement]}>{MOVEMENT_LABELS[item.movement]}</Badge>}
                                            <span className="text-[11.5px] text-label-3 ml-auto num">
                                                {item.lastReceived ? `Recd ${formatDate(item.lastReceived)}` : 'No receipt'}
                                            </span>
                                        </div>
                                        <LevelBar item={item} className="mt-2.5" />
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-[13px] min-w-[960px]">
                                    <thead className="bg-card-2 text-[11.5px] text-label-3 border-b border-separator">
                                        <tr>
                                            <SortHead k="name" className="min-w-[280px]">Item</SortHead>
                                            <SortHead k="quantity" className="text-right">Stock</SortHead>
                                            <th className="px-3 py-2.5 uppercase tracking-wider font-bold w-[150px]">Level</th>
                                            <SortHead k="rate" className="text-right">Rate</SortHead>
                                            <SortHead k="value" className="text-right">Value</SortHead>
                                            <th className="px-3 py-2.5 uppercase tracking-wider font-bold">Movement</th>
                                            <SortHead k="ageing">Last received</SortHead>
                                            <th className="px-3 py-2.5 uppercase tracking-wider font-bold">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-separator">
                                        {filtered.slice(0, visible).map(item => (
                                            <tr
                                                key={item.id}
                                                onClick={() => setSelected(item)}
                                                className={cx('cursor-pointer transition-colors hover:bg-hover', selected?.id === item.id && 'bg-accent-tint')}
                                            >
                                                <td className="px-3 py-2.5">
                                                    <div className="flex items-center gap-2">
                                                        <ColourDot code={item.colour} />
                                                        <span className="font-bold text-label">{item.code}</span>
                                                        {item.isShort && <Badge tone="dang">Short</Badge>}
                                                    </div>
                                                    <p className="text-[12px] text-label-3 mt-0.5">
                                                        {[item.category, item.subCategory].filter(Boolean).join(' · ')}
                                                        {item.taxPct !== undefined ? ` · GST ${item.taxPct}%` : ''}
                                                    </p>
                                                </td>
                                                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                                    <span className={cx('num font-semibold', item.quantity <= 0 ? 'text-label-3' : 'text-label')}>{formatQty(item.quantity)}</span>
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
                                                <td className="px-3 py-2.5 text-right whitespace-nowrap num text-label-2">{item.rate ? formatINR(item.rate) : '—'}</td>
                                                <td className="px-3 py-2.5 text-right whitespace-nowrap num font-semibold text-label" title={formatINR(item.value)}>{formatCompact(item.value)}</td>
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    {item.movement ? <Badge tone={MOVEMENT_TONE[item.movement]}>{MOVEMENT_LABELS[item.movement]}</Badge> : <span className="text-label-4">—</span>}
                                                </td>
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    {item.lastReceived ? (
                                                        <>
                                                            <span className="text-label-2 num">{formatDate(item.lastReceived)}</span>
                                                            {item.ageingDays !== undefined && (
                                                                <span className={cx('block text-[11.5px] num', item.ageingDays > 90 ? 'text-warn font-semibold' : 'text-label-3')}>
                                                                    {item.ageingDays} days ago
                                                                </span>
                                                            )}
                                                        </>
                                                    ) : <span className="text-label-4">—</span>}
                                                </td>
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    {item.status ? <Badge tone={STATUS_TONE[item.status]}>{STOCK_STATUS_LABELS[item.status]}</Badge> : <span className="text-label-4">—</span>}
                                                </td>
                                            </tr>
                                        ))}
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

            {/* ---------- item drawer ---------- */}
            {selected && (
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
                                {selected.status && <Badge tone={STATUS_TONE[selected.status]}>{STOCK_STATUS_LABELS[selected.status]}</Badge>}
                                {selected.isShort && <Badge tone="dang">Short of minimum{selected.shortSince ? ` since ${formatDate(selected.shortSince)}` : ''}</Badge>}
                                {selected.movement && <Badge tone={MOVEMENT_TONE[selected.movement]}>{MOVEMENT_LABELS[selected.movement]}</Badge>}
                                {selected.colour && <Badge tone="neutral">{STOCK_COLOUR_LABELS[selected.colour]}</Badge>}
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                <div className="bg-card-2 rounded-[14px] px-3.5 py-3">
                                    <p className="label">In stock</p>
                                    <p className={cx('num text-[20px] font-semibold mt-1 leading-none', selected.quantity <= 0 ? 'text-label-3' : 'text-label')}>{formatQty(selected.quantity)}</p>
                                    <p className="text-[11.5px] text-label-3 mt-1">{selected.unit || 'units'}{selected.quantityWithPo !== selected.quantity ? ` · +PO ${formatQty(selected.quantityWithPo)}` : ''}</p>
                                </div>
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
                                            ? <><span className="font-semibold text-dang">{formatQty(selected.minLevel - selected.quantity, selected.unit)} short</span> of the minimum{selected.rate ? ` — about ${formatINR((selected.minLevel - selected.quantity) * selected.rate)} to bring back` : ''}.</>
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
                                    {selected.ageingDays !== undefined && <dd className={cx('text-[12px] num', selected.ageingDays > 90 ? 'text-warn font-semibold' : 'text-label-3')}>{selected.ageingDays} days ago · {STOCK_AGE_LABELS[stockAgeBucket(selected)]}</dd>}
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
                            <span className="text-[12px] text-label-3">Edit in the sheet; this page follows it.</span>
                            <a
                                href={`${LIVE_STOCK_SHEET_URL}&range=A${selected.serial + 2}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="h-10 px-4 inline-flex items-center rounded-full text-[13.5px] font-bold bg-accent text-on-accent hover:bg-accent-press"
                            >
                                Open in sheet ↗
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LiveStockView;
