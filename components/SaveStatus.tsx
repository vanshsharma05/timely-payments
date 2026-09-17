import React from 'react';
import type { SyncStatus } from '../services/useSupabaseSync';

/** Every collection's status folded into one: what the header shows. */
export function combineStatus(parts: SyncStatus[]): SyncStatus {
    return parts.reduce<SyncStatus>((acc, s) => ({
        saving: acc.saving || s.saving,
        pending: acc.pending + s.pending,
        failed: [...acc.failed, ...s.failed],
        lastSavedAt: Math.max(acc.lastSavedAt ?? 0, s.lastSavedAt ?? 0) || null,
        retryAt: acc.retryAt && s.retryAt ? Math.min(acc.retryAt, s.retryAt) : (acc.retryAt ?? s.retryAt),
    }), { saving: false, pending: 0, failed: [], lastSavedAt: null, retryAt: null });
}

export const ago = (at: number | null, now = Date.now()): string => {
    if (!at) return '';
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return `${h} h ago`;
};

export interface SaveStatusProps {
    status: SyncStatus;
    /** When this tab last re-read the book from the server. */
    refreshedAt: number | null;
    refreshing?: boolean;
    onRetry: () => void;
    onRefresh: () => void;
    now?: number;
}

/**
 * One line in the header that is always true: what has been saved, what is
 * being saved, what the server refused (with a way to try again), and how
 * fresh this tab's copy of the book is (with a way to refresh it).
 *
 * A refused save used to be a banner that disappeared after twelve seconds
 * while the change sat unsaved in the tab; this stays until it is saved.
 */
export const SaveStatus: React.FC<SaveStatusProps> = ({ status, refreshedAt, refreshing, onRetry, onRefresh, now = Date.now() }) => {
    const { saving, pending, failed } = status;
    const dot = <span className="w-1 h-1 rounded-full bg-label-3" aria-hidden="true" />;

    let state: React.ReactNode;
    if (failed.length) {
        const n = failed.length;
        state = (
            <span className="inline-flex items-center gap-2 text-dang font-semibold" role="alert" title={failed.map(f => `${f.id}: ${f.message}`).join('\n')}>
                {n} change{n === 1 ? '' : 's'} not saved
                <button type="button" onClick={onRetry} disabled={saving} className="underline underline-offset-2 font-bold disabled:opacity-60">
                    {saving ? 'Retrying…' : 'Retry now'}
                </button>
            </span>
        );
    } else if (saving || pending > 0) {
        state = <span className="text-label-2 font-semibold" role="status">Saving…</span>;
    } else {
        state = <span className="text-pos font-semibold" role="status">All changes saved</span>;
    }

    return (
        <span className="inline-flex items-center gap-2.5 flex-wrap">
            {state}
            {refreshedAt !== null && (
                <>
                    {dot}
                    <span className="text-label-3">
                        Book refreshed {ago(refreshedAt, now)}
                    </span>
                </>
            )}
            <button
                type="button"
                onClick={onRefresh}
                disabled={!!refreshing}
                className="text-label-2 underline underline-offset-2 font-semibold disabled:opacity-60"
                title="Re-read the book from the server. Nothing you have not yet saved is lost."
            >
                {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
        </span>
    );
};

export default SaveStatus;
