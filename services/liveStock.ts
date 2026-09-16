import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCSVMatrix } from './googleSheetService';
import { authHeaders } from './repository';

/* ============================================================================
   Live stock — the "Live stock" page of the stores sheet, read as it is.

   Unlike the book, nothing here is stored: the sheet is the master record for
   stock, the stores team maintains it, and the app is a window onto it. The
   page is fetched through the same server-side proxy the balance import uses,
   parsed into items, and re-read every minute while somebody is looking.
   ============================================================================ */

export const LIVE_STOCK_SHEET_URL =
    'https://docs.google.com/spreadsheets/d/1DDp-DNuRi40g5QDkTfmZKg-HhFugyifPZ2EistdiKO0/edit?gid=1795046886#gid=1795046886';

/** How often the sheet is re-read while the tab is open and visible. */
export const LIVE_STOCK_REFRESH_MS = 60_000;

/**
 * The sheet's Stock_Status column.
 *
 *   FM — the item carries min and max levels and is kept in stock against
 *        them. Every FM row in the sheet has levels; almost no other row does.
 *   OD — ordered on demand: no levels, bought when a customer asks.
 *   D  — dead stock: no levels, no movement, nothing received in months.
 */
export type StockStatus = 'FM' | 'OD' | 'D' | '';

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
    FM: 'Stocked',
    OD: 'On demand',
    D: 'Dead stock',
    '': 'Unclassified',
};

export type StockMovement = 'FAST MOVING' | 'SLOW MOVING' | 'REVIEW' | '';

export const MOVEMENT_LABELS: Record<StockMovement, string> = {
    'FAST MOVING': 'Fast moving',
    'SLOW MOVING': 'Slow moving',
    REVIEW: 'Review',
    '': 'No movement data',
};

/** The sheet's colour tag — a product attribute, not a health indicator. */
export const STOCK_COLOUR_LABELS: Record<string, string> = {
    R: 'Red',
    M: 'Magenta',
    Y: 'Yellow',
    G: 'Green',
};

export interface StockItem {
    /** Item code, trimmed and upper-cased; unique across the sheet. */
    id: string;
    serial: number;
    /** Prod_Category — the brand or supplier line (SAKATA, PIDILITE…). */
    category: string;
    subCategory: string;
    code: string;
    description: string;
    unit: string;
    taxPct?: number;
    moq?: number;
    minLevel: number;
    maxLevel: number;
    photoUrl?: string;
    rate: number;
    quantity: number;
    /** Stock plus what is on purchase order. */
    quantityWithPo: number;
    /** Quantity × rate, as the sheet computes it. */
    value: number;
    avgSales?: number;
    movement: StockMovement;
    transactions: number;
    lastReceived?: Date;
    /** Days since the last receipt, as the sheet computes it. */
    ageingDays?: number;
    colour?: string;
    /** Below its minimum level — the sheet's "S" flag. */
    isShort: boolean;
    shortSince?: Date;
    status: StockStatus;
}

/* --------------------------------- parsing -------------------------------- */

const num = (v: string | undefined): number | undefined => {
    const s = (v || '').replace(/[,₹%\s]/g, '');
    if (!s || s === '#N/A' || s === '#REF!') return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
};

/** dd/mm/yyyy, optionally followed by a time. */
const date = (v: string | undefined): Date | undefined => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec((v || '').trim());
    if (!m) return undefined;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? undefined : d;
};

/** "Prod_Category" / "Latest Rate" / "No of Tran." → "prodcategory" / "latestrate" / "nooftran". */
const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Columns by meaning, not by position: the stores team may add or move a
 * column, and the page should keep reading rather than reading the wrong one.
 */
const COLUMNS = {
    serial: ['sno', 'serial'],
    category: ['prodcategory', 'category', 'brand'],
    subCategory: ['subcategory'],
    code: ['itemcode', 'code'],
    description: ['itemdescription', 'description'],
    unit: ['units', 'unit', 'uom'],
    tax: ['tax', 'taxpct', 'gst'],
    moq: ['moq'],
    min: ['minlevel', 'min'],
    max: ['maxlevel', 'max'],
    photo: ['photo', 'image', 'link'],
    rate: ['latestrate', 'rate'],
    quantity: ['actualquantity', 'quantity', 'qty', 'stock'],
    quantityWithPo: ['actualpo', 'actualplusp', 'withpo'],
    value: ['amount', 'value', 'stockvalue'],
    avgSales: ['avgsalesqty', 'avgsales', 'averagesales'],
    movement: ['itemsmovements', 'movement', 'movements'],
    transactions: ['nooftran', 'transactions', 'notran'],
    lastReceived: ['lastrecvdt', 'lastreceived', 'lastrecv'],
    ageing: ['ageing', 'aging'],
    colour: ['color', 'colour'],
    short: ['shortstkstatus', 'shortstock', 'short'],
    shortSince: ['shortstockdate', 'shortdate'],
    status: ['stockstatus'],
    statusFallback: ['status'],
} as const;

export function parseLiveStockCsv(csv: string): StockItem[] {
    const rows = parseCSVMatrix(csv);
    if (!rows.length) return [];

    const header = rows[0].map(key);
    const at = (names: readonly string[]) => {
        for (const n of names) {
            const i = header.indexOf(n);
            if (i >= 0) return i;
        }
        return -1;
    };
    const col: Record<keyof typeof COLUMNS, number> = {} as any;
    (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).forEach(k => { col[k] = at(COLUMNS[k]); });
    if (col.code < 0) throw new Error('The Live stock page has no Item_Code column.');

    const cell = (r: string[], k: keyof typeof COLUMNS) => (col[k] >= 0 ? (r[col[k]] || '') : '');
    const items: StockItem[] = [];
    const seen = new Set<string>();

    for (const r of rows.slice(1)) {
        const code = cell(r, 'code').trim();
        // The second row of the sheet is the stores team's own legend (DES,
        // UNI, Formula…) with no code; blank rows have none either.
        if (!code) continue;
        const id = code.toUpperCase();
        if (seen.has(id)) continue;
        seen.add(id);

        const quantity = num(cell(r, 'quantity')) ?? 0;
        const rate = num(cell(r, 'rate')) ?? 0;
        const rawStatus = (cell(r, 'status') || cell(r, 'statusFallback')).trim().toUpperCase();
        const rawMovement = cell(r, 'movement').trim().toUpperCase();
        const photo = cell(r, 'photo').trim();

        items.push({
            id,
            serial: num(cell(r, 'serial')) ?? items.length + 1,
            category: cell(r, 'category').trim().toUpperCase(),
            subCategory: cell(r, 'subCategory').trim().toUpperCase(),
            code,
            description: cell(r, 'description').trim() || code,
            unit: cell(r, 'unit').trim().toUpperCase(),
            taxPct: num(cell(r, 'tax')),
            moq: num(cell(r, 'moq')),
            minLevel: num(cell(r, 'min')) ?? 0,
            maxLevel: num(cell(r, 'max')) ?? 0,
            photoUrl: /^https?:\/\//.test(photo) ? photo : undefined,
            rate,
            quantity,
            quantityWithPo: num(cell(r, 'quantityWithPo')) ?? quantity,
            value: num(cell(r, 'value')) ?? quantity * rate,
            avgSales: num(cell(r, 'avgSales')),
            movement: (['FAST MOVING', 'SLOW MOVING', 'REVIEW'].includes(rawMovement) ? rawMovement : '') as StockMovement,
            transactions: num(cell(r, 'transactions')) ?? 0,
            lastReceived: date(cell(r, 'lastReceived')),
            ageingDays: num(cell(r, 'ageing')),
            colour: STOCK_COLOUR_LABELS[cell(r, 'colour').trim().toUpperCase()] ? cell(r, 'colour').trim().toUpperCase() : undefined,
            isShort: cell(r, 'short').trim().toUpperCase() === 'S',
            shortSince: date(cell(r, 'shortSince')),
            status: (['FM', 'OD', 'D'].includes(rawStatus) ? rawStatus : '') as StockStatus,
        });
    }
    return items;
}

/* --------------------------------- helpers -------------------------------- */

/** Ageing bucket, on the sheet's days-since-receipt figure. */
export type StockAgeBucket = '0-30' | '31-60' | '61-90' | '90+' | 'never';

export function stockAgeBucket(item: Pick<StockItem, 'ageingDays' | 'lastReceived'>): StockAgeBucket {
    if (item.ageingDays === undefined && !item.lastReceived) return 'never';
    const d = item.ageingDays ?? 0;
    if (d <= 30) return '0-30';
    if (d <= 60) return '31-60';
    if (d <= 90) return '61-90';
    return '90+';
}

export const STOCK_AGE_LABELS: Record<StockAgeBucket, string> = {
    '0-30': 'Received in the last 30 days',
    '31-60': '31–60 days ago',
    '61-90': '61–90 days ago',
    '90+': 'Over 90 days ago',
    never: 'No receipt on record',
};

/** Whether this item is managed against min–max levels. */
export const hasLevels = (item: Pick<StockItem, 'minLevel' | 'maxLevel'>) => item.minLevel > 0 || item.maxLevel > 0;

/**
 * Whether the item is on the shelf — the question a call is usually about.
 *
 *   out — nothing there (a negative quantity is not "in stock" either)
 *   low — something there, but under the item's minimum
 *   in  — there, and not under a minimum
 *
 * Every item is exactly one of the three, so the three counts add up to the
 * sheet, and "low + out" is the share of the range that needs buying.
 */
export type Availability = 'in' | 'low' | 'out';

export const AVAILABILITY_LABELS: Record<Availability, string> = {
    in: 'In stock',
    low: 'Low stock',
    out: 'Out of stock',
};

export function availabilityOf(item: Pick<StockItem, 'quantity' | 'minLevel' | 'maxLevel'>): Availability {
    if (item.quantity <= 0) return 'out';
    if (hasLevels(item) && item.quantity < item.minLevel) return 'low';
    return 'in';
}

/**
 * Out of stock where it matters: an item the stores keep against levels, or
 * one that moves fast, with nothing on the shelf. Dead stock at zero is not
 * a problem; a fast-moving ink at zero is.
 */
export const isCritical = (item: Pick<StockItem, 'quantity' | 'minLevel' | 'maxLevel' | 'status' | 'movement'>): boolean =>
    item.quantity <= 0 && (item.status === 'FM' || item.movement === 'FAST MOVING');

/**
 * A Google Drive share link as an image the browser can show. The sheet
 * stores `uc?id=…&export=download`, which serves a download, not a picture;
 * the thumbnail endpoint serves the picture, for files shared with a link.
 */
export function drivePhotoUrl(url: string | undefined, width = 480): string | undefined {
    if (!url) return undefined;
    const m = /[?&]id=([A-Za-z0-9_-]+)/.exec(url) || /\/d\/([A-Za-z0-9_-]+)/.exec(url);
    return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w${width}` : url;
}

/* --------------------------------- fetching ------------------------------- */

export interface LiveStockRead {
    items: StockItem[];
    /** When the sheet was read, ISO. */
    fetchedAt: string;
    /**
     * Whether rate and value came with it. The server empties both for
     * anyone who is not an Admin or Manager, so a page reading `false` has
     * no prices to show and must not pretend to.
     */
    priced: boolean;
}

/**
 * Reads the sheet through /api/live-stock, which wants the session and
 * decides from it whether the prices come along — see api/_lib/liveStock.ts.
 */
export async function fetchLiveStock(): Promise<LiveStockRead> {
    const res = await fetch('/api/live-stock', { headers: await authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok || !body.csv) {
        throw new Error(body.error || `The stock sheet could not be read (HTTP ${res.status}).`);
    }
    const items = parseLiveStockCsv(body.csv);
    if (!items.length) throw new Error('The stock sheet came back empty.');
    const priced = body.priced === true;
    const fetchedAt = new Date().toISOString();
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ csv: body.csv, fetchedAt, priced }));
    } catch { /* private mode, or a full store — the read still works */ }
    return { items, fetchedAt, priced };
}

/**
 * The last read, kept in the browser so the page opens on figures rather
 * than a spinner. Marked with when it was read, so it is never mistaken for
 * live; the live read replaces it within a second or two.
 */
const CACHE_KEY = 'timely_live_stock_v2';

/**
 * Only a cache of the same shape the caller is entitled to: a Manager's
 * priced read must not flash up for a CRM who signs in on the same laptop.
 */
function readCache(allowPrices: boolean): LiveStockRead | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const { csv, fetchedAt, priced } = JSON.parse(raw);
        if (typeof csv !== 'string' || typeof fetchedAt !== 'string') return null;
        if (Boolean(priced) !== allowPrices) return null;
        const items = parseLiveStockCsv(csv);
        return items.length ? { items, fetchedAt, priced: Boolean(priced) } : null;
    } catch {
        return null;
    }
}

export interface LiveStockState extends Partial<LiveStockRead> {
    items: StockItem[];
    /** False until a read says otherwise — the page never assumes prices. */
    priced: boolean;
    /** True while a read is in flight. */
    loading: boolean;
    /** The last read failed; `items` are from the read before it. */
    error?: string;
    /** True until the first read of this session lands — the items are cached. */
    fromCache: boolean;
    refresh: () => void;
}

/**
 * Keeps the stock current while the page is being looked at.
 *
 * Reads once when enabled, then every LIVE_STOCK_REFRESH_MS — but only while
 * the tab is visible: a phone in a pocket should not be pulling a 300KB sheet
 * every minute. Coming back to the tab reads at once, so what is on screen is
 * never older than a moment after somebody looks at it.
 */
export function useLiveStock(enabled: boolean, allowPrices: boolean): LiveStockState {
    const [read, setRead] = useState<LiveStockRead | null>(() => readCache(allowPrices));
    const [fromCache, setFromCache] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const inFlight = useRef(false);

    const refresh = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setLoading(true);
        try {
            const next = await fetchLiveStock();
            setRead(next);
            setFromCache(false);
            setError(undefined);
        } catch (e: any) {
            setError(e?.message || 'The stock sheet could not be read.');
        } finally {
            inFlight.current = false;
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!enabled) return;
        let timer: number | undefined;
        const tick = () => {
            if (document.visibilityState === 'visible') void refresh();
        };
        tick();
        timer = window.setInterval(tick, LIVE_STOCK_REFRESH_MS);
        const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return () => {
            if (timer) window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
        };
    }, [enabled, refresh]);

    return {
        items: read?.items ?? [],
        fetchedAt: read?.fetchedAt,
        priced: Boolean(read?.priced) && allowPrices,
        loading,
        error,
        fromCache,
        refresh: () => { void refresh(); },
    };
}
