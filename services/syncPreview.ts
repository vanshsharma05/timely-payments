import { Outstanding, companyKey } from '../types';
import { mergeWithExistingFollowUps, needsClearing } from './googleSheetService';
import { customerRowDiff, outstandingToRow } from './repository';

/** What a sync will do to one account. */
export type SyncEffect = 'changed' | 'unchanged' | 'added' | 'settled';

export interface SyncPreviewRow {
    id: string;
    company: string;
    effect: SyncEffect;
    /** The balance before the sync (0 for a new customer). */
    before: number;
    /** The balance after it (0 when settled). */
    after: number;
    /** For a changed row: whether the balance itself moves, or only the ageing behind the same balance. */
    balanceMoves?: boolean;
}

export interface SyncPreview {
    rows: SyncPreviewRow[];
    /** Rows read from the sheet. */
    incoming: number;
    /** Accounts on file whose figures the sheet moves (balance or ageing). */
    changed: number;
    /** Of those, how many see the balance itself move; the rest re-age the same balance. */
    balancesMoved: number;
    /** Accounts the sheet lists with the same figures as the book already holds. */
    unchanged: number;
    /** Names the customer list has never seen — added with no CRM owner. */
    added: number;
    /** Accounts the sheet no longer lists and that still carried a balance — settled to zero. */
    settled: number;
    settledAmount: number;
    /** Accounts the sheet no longer lists that were already at zero — nothing to do. */
    untouched: number;
    /** Sum of balances after minus before over the changed rows, so the review can say "₹4.2 L more owed". */
    netChange: number;
}

/**
 * The columns a sync would actually write for this account, worked out the
 * way the save does: the merged row against the row on file, column by
 * column. Comparing the sheet's figures with the book's directly flagged
 * every account — the sheet's rows carry undefined where the book carries
 * 0 or "Dr" — on a morning when ten had really moved.
 */
export const columnsChanged = (existing: Outstanding, merged: Outstanding): string[] =>
    Object.keys(customerRowDiff(outstandingToRow(existing), outstandingToRow(merged)));

/**
 * What the next sync does, before it does it.
 *
 * The review used to call every account the sheet lists "Figures updated" —
 * 684 of them on a morning when ten had moved — so the person confirming
 * could not tell a routine refresh from a sheet that had been re-cut. This
 * runs the same merge the sync runs (mergeWithExistingFollowUps) and diffs
 * each account against the book, so "changes" here is exactly the set of
 * rows the save will write.
 *
 * Nothing here is written.
 */
export function previewSync(existingRecords: Outstanding[], incomingRecords: Outstanding[]): SyncPreview {
    const existingByKey = new Map<string, Outstanding>();
    existingRecords.forEach(item => {
        existingByKey.set(companyKey(item.company), item);
        existingByKey.set(item.id, item);
    });
    const mergedById = new Map(mergeWithExistingFollowUps(existingRecords, incomingRecords).map(r => [r.id, r]));

    const rows: SyncPreviewRow[] = [];
    const matchedIds = new Set<string>();
    let changed = 0, unchanged = 0, added = 0, netChange = 0, balancesMoved = 0;

    incomingRecords.forEach(item => {
        const existing = existingByKey.get(companyKey(item.company)) || existingByKey.get(item.id);
        if (existing) {
            if (matchedIds.has(existing.id)) return;      // the sheet lists the name twice; the merge keeps one
            matchedIds.add(existing.id);
            const merged = mergedById.get(existing.id) || existing;
            const cols = columnsChanged(existing, merged);
            const moved = cols.length > 0;
            const after = merged.total || 0;
            const balanceMoves = moved && (cols.includes('total') || cols.includes('total_type'));
            if (moved) { changed++; netChange += after - (existing.total || 0); if (balanceMoves) balancesMoved++; } else unchanged++;
            rows.push({ id: existing.id, company: existing.company, effect: moved ? 'changed' : 'unchanged', before: existing.total || 0, after, balanceMoves });
        } else {
            added++;
            rows.push({ id: item.id, company: item.company, effect: 'added', before: 0, after: item.total || 0 });
        }
    });

    // On file, not in this sheet. The sheet is the whole of what is owed, so
    // a balance still standing against one of these has been paid.
    const unlisted = existingRecords.filter(item => !matchedIds.has(item.id));
    const settling = unlisted.filter(needsClearing);
    settling.forEach(item => {
        rows.push({ id: item.id, company: item.company, effect: 'settled', before: item.total || 0, after: 0 });
    });

    // The rows a person needs to look at first: what moves, then what
    // arrives, then what settles; the unchanged ones last.
    const order: Record<SyncEffect, number> = { changed: 0, added: 1, settled: 2, unchanged: 3 };
    rows.sort((a, b) => order[a.effect] - order[b.effect] || Math.abs(b.after - b.before) - Math.abs(a.after - a.before) || a.company.localeCompare(b.company));

    return {
        rows,
        incoming: incomingRecords.length,
        changed,
        balancesMoved,
        unchanged,
        added,
        settled: settling.length,
        settledAmount: settling.reduce((sum, i) => sum + Math.abs(Number(i.total) || 0), 0),
        untouched: unlisted.length - settling.length,
        netChange,
    };
}

/** "10 balances change · 3 new customers · 2 settled · 669 unchanged", for a status line. */
export function describePreview(p: SyncPreview): string {
    const parts: string[] = [];
    parts.push(p.changed === 0 ? 'no figures change' : `${p.changed} account${p.changed === 1 ? '' : 's'} change (${p.balancesMoved} balance${p.balancesMoved === 1 ? '' : 's'}, ${p.changed - p.balancesMoved} ageing only)`);
    if (p.added) parts.push(`${p.added} new customer${p.added === 1 ? '' : 's'}`);
    if (p.settled) parts.push(`${p.settled} settled to zero`);
    parts.push(`${p.unchanged} unchanged`);
    return parts.join(' · ');
}

/** How old the last sync is, in words a manager can act on. */
export type SyncAge = { tone: 'never' | 'fresh' | 'ageing' | 'stale'; label: string; detail: string };

export function syncAge(lastSyncTime: string | null | undefined, now: Date = new Date()): SyncAge {
    if (!lastSyncTime) return { tone: 'never', label: 'Never synced', detail: 'Balances have not been read from the sheet yet.' };
    const at = new Date(lastSyncTime);
    if (isNaN(at.getTime())) return { tone: 'never', label: 'Never synced', detail: 'Balances have not been read from the sheet yet.' };
    const hours = (now.getTime() - at.getTime()) / 3_600_000;
    const when = at.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
    const ago = hours < 1 ? 'just now' : hours < 24 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)}d ago`;
    if (hours <= 36) return { tone: 'fresh', label: 'Up to date', detail: `Last synced ${when} (${ago}).` };
    if (hours <= 24 * 7) return { tone: 'ageing', label: 'Getting old', detail: `Last synced ${when} (${ago}). Sync when the accounts team has updated the sheet.` };
    return { tone: 'stale', label: 'Stale', detail: `Last synced ${when} (${ago}). The balances on screen are probably out of date.` };
}
