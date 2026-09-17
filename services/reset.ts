import { Outstanding, PdcCheque, Template, CompanyProfile, hasOutstanding, companyKey } from '../types';
import { mergeWithExistingFollowUps } from './googleSheetService';
import { outstandingToRow, pdcToRow, CustomerRow } from './repository';
import { requireSupabase } from './supabaseClient';

/**
 * "Complete fresh start", planned in the browser and carried out by the
 * database in one transaction (supabase/reset.sql, `reset_book`).
 *
 * The browser used to do the whole thing itself: empty the cheques, rebuild
 * the customer list from the sheet under new ids, and let the sync hooks
 * write the difference as hundreds of separate requests — deleting 672
 * legacy-id accounts with their cheques and their activity threads on the
 * way, and stopping halfway if any one request failed. Now the browser only
 * works out *what* the reset means for the book it has loaded (this file),
 * shows that to the person as counts, and hands the plan to `reset_book()`,
 * which snapshots everything first and applies the lot or nothing.
 */

/** What the reset writes for one account already on file: money and settlement, nothing else. */
export interface MoneyUpdate {
    id: string;
    total: number;
    total_type: CustomerRow['total_type'];
    ageing: CustomerRow['ageing'];
    ageing_types: CustomerRow['ageing_types'];
    over90: number | null;
    over90_type: CustomerRow['over90_type'];
    due_over45: number | null;
    due_over45_type: CustomerRow['due_over45_type'];
    settled_at: string | null;
}

export interface ResetPlan {
    /** One per account on file — the database refuses the plan if the book has changed since. */
    updates: MoneyUpdate[];
    /** Sheet names the book has never seen, as full rows. */
    inserts: CustomerRow[];
    updatedTillDate: string;
    counts: {
        onFile: number;
        /** Accounts the sheet lists: their money is re-imported. */
        listed: number;
        /** Accounts that owed something and come out of this at nil, stamped — unlisted by the sheet, or listed at nil. */
        settled: number;
        /** Accounts the sheet does not list that were already at nil: their money does not move. */
        untouched: number;
        added: number;
        cheques: number;
        /** Accounts carrying any follow-up work (date, notes, forecast, urgency) that will be cleared. */
        withFollowUpWork: number;
    };
}

const moneyOf = (row: CustomerRow): MoneyUpdate => ({
    id: row.id,
    total: row.total,
    total_type: row.total_type,
    ageing: row.ageing,
    ageing_types: row.ageing_types,
    over90: row.over90,
    over90_type: row.over90_type,
    due_over45: row.due_over45,
    due_over45_type: row.due_over45_type,
    settled_at: row.settled_at,
});

/**
 * The reset as the balance sync would fold this sheet into this book —
 * matched accounts keep their id and take the sheet's figures, unlisted ones
 * are settled, new names are added — reduced to the columns the database
 * function is allowed to write. The follow-up clearing is the function's own
 * step and applies to every account, so it is not part of the plan.
 */
export function buildResetPlan(book: Outstanding[], sheetRecords: Outstanding[], cheques: PdcCheque[], updatedTillDate = ''): ResetPlan {
    if (!sheetRecords.length) throw new Error('The sheet returned no rows, so there is nothing to reset to.');
    const onFile = new Map(book.map(c => [c.id, c]));
    const sheetKeys = new Set(sheetRecords.flatMap(r => [companyKey(r.company), r.id]));
    const merged = mergeWithExistingFollowUps(book, sheetRecords);

    const updates: MoneyUpdate[] = [];
    const inserts: CustomerRow[] = [];
    let listed = 0;
    let settled = 0;
    let untouched = 0;
    for (const row of merged) {
        const before = onFile.get(row.id);
        if (before) {
            const after = outstandingToRow(row);
            updates.push(moneyOf(after));
            const isListed = sheetKeys.has(companyKey(before.company)) || sheetKeys.has(before.id);
            if (isListed) listed++;
            if (hasOutstanding(before) && !hasOutstanding(row)) settled++;
            else if (!isListed) untouched++;
        } else {
            inserts.push(outstandingToRow(row));
        }
    }
    // An account the merge dropped (it cannot — but the database checks the count, so the plan must be complete).
    for (const c of book) if (!updates.some(u => u.id === c.id)) updates.push(moneyOf(outstandingToRow(c)));

    const withFollowUpWork = book.filter(c => c.followUpDate || (c.notes && c.notes.length) || c.forecastAmount || c.isUrgent || c.lastFollowUpOn).length;
    return {
        updates,
        inserts,
        updatedTillDate,
        counts: { onFile: book.length, listed, settled, untouched, added: inserts.length, cheques: cheques.length, withFollowUpWork },
    };
}

export interface ResetDefaults {
    templates: Template[];
    profile: CompanyProfile;
    settings: { data_source_mode: 'google' | 'excel'; google_sheet_url: string; sheet_updated_till_date: string; last_sync_time: string };
}

export interface ResetResult {
    backup_id: string;
    accounts_on_file: number;
    accounts_updated: number;
    accounts_settled: number;
    accounts_added: number;
    cheques_deleted: number;
}

/** Hands the plan to the database. Either everything in it happens, or nothing does and the error says why. */
export async function resetBook(plan: ResetPlan, defaults: ResetDefaults, phrase: string): Promise<ResetResult> {
    let response: { data: unknown; error: { message?: string } | null };
    try {
        response = await requireSupabase().rpc('reset_book', {
            p_updates: plan.updates,
            p_inserts: plan.inserts,
            p_templates: defaults.templates.map(t => ({ id: t.id, name: t.name, content: t.content })),
            p_profile: defaults.profile,
            p_settings: defaults.settings,
            p_phrase: phrase,
        });
    } catch (e: any) {
        // The request never reached the database (offline, blocked): nothing ran.
        throw new Error(`Could not reach the database, so nothing was changed: ${e?.message || e}`);
    }
    if (response.error) throw new Error(response.error.message || 'The reset was refused; nothing was changed.');
    if (!response.data || typeof response.data !== 'object') throw new Error('The database did not confirm the reset. Reload to see the current state.');
    return response.data as ResetResult;
}

/**
 * A copy of the book for the person's own keeping, from the data this tab
 * has loaded. The database keeps its own snapshot inside the reset; this one
 * is the copy that survives anything happening to the database.
 */
export function backupFileContents(book: Outstanding[], cheques: PdcCheque[], templates: Template[], profile: CompanyProfile): string {
    return JSON.stringify({
        exportedAt: new Date().toISOString(),
        customers: book.map(outstandingToRow),
        pdc_cheques: cheques.map(pdcToRow),
        templates,
        company_profile: profile,
    }, null, 1);
}

export const backupFileName = (): string => `timely-payment-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
