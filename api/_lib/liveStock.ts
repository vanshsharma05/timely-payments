import { fetchGoogleSheetCsv } from './sheet.js';

/**
 * The stores sheet, read for the Live stock tab — with the prices taken out
 * for anyone who is not allowed to see them.
 *
 * Rate and value are for the Admin and the Managers. Hiding two columns in
 * the browser would leave them one "Network" tab away, so the columns are
 * blanked here, before the sheet leaves the server: a CRM's copy of the
 * sheet never carried a price. The columns stay in the CSV, empty, so the
 * one parser on the client reads both shapes.
 */

export const LIVE_STOCK_SHEET_URL =
    'https://docs.google.com/spreadsheets/d/1DDp-DNuRi40g5QDkTfmZKg-HhFugyifPZ2EistdiKO0/edit?gid=1795046886#gid=1795046886';

/** Header names (letters and digits only, lower-cased) that carry money. */
const PRICE_COLUMNS = new Set(['latestrate', 'rate', 'amount', 'value', 'stockvalue', 'l1rate']);

export const seesPrices = (role: string | null | undefined): boolean => role === 'Admin' || role === 'Manager';

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A CSV as rows of cells. RFC-style quoting; a copy of the browser's parser, which this file cannot import. */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [[]];
    let row = rows[0];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];
        if (c === '"' && quoted && next === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = !quoted;
        else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
        else if ((c === '\r' || c === '\n') && !quoted) {
            if (c === '\r' && next === '\n') i++;
            row.push(cell); cell = '';
            row = []; rows.push(row);
        } else cell += c;
    }
    if (cell || row.length) row.push(cell);
    return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const toCsv = (rows: string[][]): string => rows.map(r => r.map(quote).join(',')).join('\n');

/** The same sheet with every price cell emptied. The header row keeps its names. */
export function stripPrices(csv: string): string {
    const rows = parseCsv(csv);
    if (!rows.length) return csv;
    const priceCols = rows[0].map((h, i) => (PRICE_COLUMNS.has(key(h)) ? i : -1)).filter(i => i >= 0);
    if (!priceCols.length) return csv;
    return toCsv(rows.map((r, n) => (n === 0 ? r : r.map((cell, i) => (priceCols.includes(i) ? '' : cell)))));
}

export async function readLiveStock(role: string | null | undefined): Promise<{ csv: string; priced: boolean; sourceUrl: string }> {
    const { csv, sourceUrl } = await fetchGoogleSheetCsv(LIVE_STOCK_SHEET_URL);
    const priced = seesPrices(role);
    return { csv: priced ? csv : stripPrices(csv), priced, sourceUrl };
}
