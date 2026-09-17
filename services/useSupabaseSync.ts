import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured } from './supabaseClient';

/**
 * Persists a collection of records to Supabase whenever it changes.
 *
 * App.tsx mutates `appData` / `pdcCheques` / `templates` from ~20 different
 * handlers. Rather than adding a write call to each one (and inevitably missing
 * some), this watches the array and diffs it against the last synced snapshot,
 * so every mutation path is covered by a single effect and only genuinely
 * changed rows hit the network.
 *
 * The first run after a load seeds the baseline without writing, so simply
 * reading data back from the server does not immediately write it all again.
 *
 * The baseline is **the last state this tab successfully saved**, row by row:
 * it is seeded from the loaded data, advanced for a row only once the server
 * has accepted that row, and left alone for a row whose write failed — so the
 * next change retries exactly the unsaved difference, and a second edit is
 * compared with the first edit's saved state, not with the morning's load.
 *
 * With `partial` set, a row the server already has is written as **the
 * columns that changed since the baseline and nothing else** (see
 * customerRowDiff in repository.ts). Without it — the cheques and templates
 * — a changed row still goes through `upsert` whole.
 *
 * A failed write used to be a one-line banner that vanished, while the row
 * sat unsaved until something else happened to change. Now the hook keeps a
 * list of what has not been saved and why, says so through `onStatus`,
 * retries on its own (backing off, and again when the tab comes back or the
 * network does), and lets a dialog wait for the verdict with `flush()` so it
 * can stay open and say "not saved" instead of closing as if it had been.
 */

export interface SyncFailure { id: string; message: string }

export interface SyncStatus {
    /** A pass is running right now. */
    saving: boolean;
    /** Rows whose latest state the server has not accepted (includes the ones that failed). */
    pending: number;
    /** What the server refused, and why, per row. */
    failed: SyncFailure[];
    lastSavedAt: number | null;
    /** When the next automatic retry is due, if anything failed. */
    retryAt: number | null;
}

export interface SyncPassResult {
    failed: SyncFailure[];
    accepted: number;
}

/** What a dialog is told after it asked for its save to be written now. */
export type SaveOutcome = { ok: true } | { ok: false; message: string };

/** The verdict for one row out of a pass: refused with its reason, or accepted. */
export function outcomeFor(id: string, result: SyncPassResult): SaveOutcome {
    const refused = result.failed.find((f) => f.id === id);
    return refused ? { ok: false, message: refused.message } : { ok: true };
}

export interface CollectionSync<T> {
    /** Saves what is pending now (no debounce) and reports the verdict per row. */
    flush: () => Promise<SyncPassResult>;
    /** Runs a pass immediately (the retry button). */
    retry: () => Promise<SyncPassResult>;
    /** Resolves when no pass is running. */
    idle: () => Promise<void>;
    /** Ids whose latest local state the server has not accepted. */
    pendingIds: () => string[];
    /**
     * Rows just read from the server: they become the baseline, so putting
     * them into the collection is not mistaken for a local change.
     */
    accept: (rows: T[]) => void;
    /** Rows that no longer exist on the server: dropping them locally must not issue a delete. */
    forget: (ids: string[]) => void;
}

export const IDLE_STATUS: SyncStatus = { saving: false, pending: 0, failed: [], lastSavedAt: null, retryAt: null };

/** The reason as a person would say it: a dropped connection is not a "TypeError". */
export const humanise = (e: unknown): string => {
    const raw = ((e as any)?.message || String(e)).replace(/^(TypeError|Error):\s*/, '');
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) return 'no connection to the server';
    return raw;
};

/** A reason as one sentence, so it reads on before the next one. */
export const sentence = (reason: string): string => {
    const t = (reason || '').trim();
    return t ? (/[.!?]$/.test(t) ? t : t + '.') : t;
};

/** Backoff between automatic retries of a failed write. */
const DEFAULT_RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 90_000];

export function useCollectionSync<T extends { id: string }, R extends object = Record<string, unknown>>(opts: {
    /** Current in-memory collection. */
    rows: T[];
    /** Only sync once the user is signed in and the initial load has finished. */
    enabled: boolean;
    /** Stable serialisation used to detect a real change. */
    toSignature: (row: T) => string;
    /**
     * Saves rows this hook has never seen on the server (`created` holds their
     * ids). Without `partial`, also saves every changed row, whole.
     */
    upsert: (rows: T[], created: Set<string>) => Promise<void>;
    remove?: (id: string) => Promise<void>;
    /**
     * Column-level writes for rows the server already has: `toRow` is the
     * row as the database sees it, `diff` the columns that differ between two
     * such rows, `update` writes just those columns for one row.
     */
    partial?: {
        toRow: (row: T) => R;
        diff: (before: R, after: R) => Partial<R>;
        update: (id: string, changes: Partial<R>) => Promise<void>;
        /** Rows written at once. PostgREST has no multi-row update; a sync can touch hundreds. */
        concurrency?: number;
    };
    /** Human-readable label used in error reporting. */
    label: string;
    onError?: (message: string) => void;
    /** Every change in what is saved, pending or refused. */
    onStatus?: (status: SyncStatus) => void;
    delayMs?: number;
    retryDelaysMs?: number[];
}): CollectionSync<T> {
    const { rows, enabled, toSignature, upsert, remove, partial, label, onError, onStatus, delayMs = 800, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS } = opts;

    /** id -> signature of the last state the server accepted (or was loaded with). */
    const synced = useRef<Map<string, string>>(new Map());
    /** id -> that same state as a database row, for the column diff. Only with `partial`. */
    const baseline = useRef<Map<string, R>>(new Map());
    /** Skip the write on the render that first receives server data. */
    const seeded = useRef(false);
    /** The collection as of the latest render — what a pass saves. */
    const latest = useRef<T[]>(rows);
    latest.current = rows;
    /** id -> why the server refused it, until it accepts it. */
    const failed = useRef<Map<string, string>>(new Map());
    /** The pass in progress, so two never run at once. */
    const inFlight = useRef<Promise<SyncPassResult> | null>(null);
    const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryCount = useRef(0);
    const lastSavedAt = useRef<number | null>(null);
    const retryAt = useRef<number | null>(null);
    const saving = useRef(false);
    const unmounted = useRef(false);
    /** The serialised runner, reachable from a retry timer set inside a pass. */
    const runRef = useRef<() => Promise<SyncPassResult>>(() => Promise.resolve({ failed: [], accepted: 0 }));

    // Latest callbacks, so a pass started earlier reports to the current ones.
    const callbacks = useRef({ toSignature, upsert, remove, partial, label, onError, onStatus });
    callbacks.current = { toSignature, upsert, remove, partial, label, onError, onStatus };

    const changedIds = useCallback((): { changed: T[]; created: Set<string>; removed: string[] } => {
        const { toSignature: sig } = callbacks.current;
        const current = new Set<string>();
        const changed: T[] = [];
        const created = new Set<string>();
        for (const row of latest.current) {
            current.add(row.id);
            if (synced.current.get(row.id) !== sig(row)) {
                changed.push(row);
                if (!synced.current.has(row.id)) created.add(row.id);
            }
        }
        const removed: string[] = [];
        for (const id of synced.current.keys()) if (!current.has(id)) removed.push(id);
        return { changed, created, removed };
    }, []);

    const emit = useCallback(() => {
        const { onStatus: report } = callbacks.current;
        if (!report || unmounted.current) return;
        const { changed, removed } = changedIds();
        report({
            saving: saving.current,
            pending: changed.length + removed.length,
            failed: Array.from(failed.current, ([id, message]) => ({ id, message })),
            lastSavedAt: lastSavedAt.current,
            retryAt: retryAt.current,
        });
    }, [changedIds]);

    const clearRetry = () => {
        if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
        retryAt.current = null;
    };

    /** One pass: write what differs from the baseline, accept what the server took. */
    const pass = useCallback(async (): Promise<SyncPassResult> => {
        const { toSignature: sig, upsert: up, remove: rm, partial: part, label: lbl, onError: reportError } = callbacks.current;
        // A pass supersedes any debounced one still waiting: the same rows would only be written twice.
        if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
        const { changed, created, removed } = changedIds();
        if (!changed.length && !removed.length) {
            return { failed: [], accepted: 0 };
        }

        saving.current = true;
        emit();

        const failures: SyncFailure[] = [];
        let accepted = 0;
        const accept = (row: T) => {
            synced.current.set(row.id, sig(row));
            if (part) baseline.current.set(row.id, part.toRow(row));
            failed.current.delete(row.id);
            accepted++;
        };
        const refuse = (id: string, e: unknown) => {
            const message = humanise(e);
            failed.current.set(id, message);
            failures.push({ id, message });
        };

        if (part) {
            const fresh = changed.filter((r) => created.has(r.id));
            const known = changed.filter((r) => !created.has(r.id));

            if (fresh.length) {
                try {
                    await up(fresh, created);
                    fresh.forEach(accept);
                } catch (e) {
                    fresh.forEach((r) => refuse(r.id, e));
                }
            }

            // Each known row carries only its own changed columns, and each
            // one advances the baseline on its own success — a failure
            // elsewhere in the batch does not make it unsaved again.
            const queue = [...known];
            const worker = async (): Promise<void> => {
                for (;;) {
                    const row = queue.shift();
                    if (!row) return;
                    const before = baseline.current.get(row.id);
                    const after = part.toRow(row);
                    const changes = before ? part.diff(before, after) : (after as Partial<R>);
                    try {
                        if (Object.keys(changes).length) await part.update(row.id, changes);
                        accept(row);
                    } catch (e) {
                        refuse(row.id, e);
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.min(part.concurrency ?? 8, queue.length) }, worker));
        } else if (changed.length) {
            try {
                await up(changed, created);
                changed.forEach(accept);
            } catch (e) {
                changed.forEach((r) => refuse(r.id, e));
            }
        }

        if (rm) {
            for (const id of removed) {
                try {
                    await rm(id);
                    synced.current.delete(id);
                    baseline.current.delete(id);
                    failed.current.delete(id);
                    accepted++;
                } catch (e) {
                    refuse(id, e);
                }
            }
        }

        saving.current = false;
        if (accepted) lastSavedAt.current = Date.now();

        if (failures.length) {
            // Whatever failed stays out of the baseline, so the next pass retries it —
            // and there will be a next pass: backing off, then again when the tab
            // or the network comes back.
            const more = failures.length > 1 ? ` (and ${failures.length - 1} more)` : '';
            reportError?.(`Could not save ${lbl}: ${failures[0].message}${more}`);
            clearRetry();
            const delay = retryDelaysMs[Math.min(retryCount.current, retryDelaysMs.length - 1)];
            retryCount.current++;
            retryAt.current = Date.now() + delay;
            retryTimer.current = setTimeout(() => { retryTimer.current = null; retryAt.current = null; void runRef.current(); }, delay);
        } else {
            retryCount.current = 0;
            clearRetry();
        }
        emit();
        return { failed: failures, accepted };
    }, [changedIds, emit, retryDelaysMs]);

    /** Serialises passes: a second request waits for the first to finish, then looks again. */
    const run = useCallback((): Promise<SyncPassResult> => {
        const next = (inFlight.current ?? Promise.resolve({ failed: [], accepted: 0 })).then(() => pass(), () => pass());
        const tracked = next.finally(() => { if (inFlight.current === tracked) inFlight.current = null; });
        inFlight.current = tracked;
        return next;
    }, [pass]);
    runRef.current = run;

    // Reset the baseline when sync is switched off (sign-out / project change).
    useEffect(() => {
        if (!enabled) {
            synced.current = new Map();
            baseline.current = new Map();
            failed.current = new Map();
            seeded.current = false;
            retryCount.current = 0;
            clearRetry();
        }
    }, [enabled]);

    useEffect(() => {
        if (!enabled || !isSupabaseConfigured) return;

        // First pass after load: record what the server already has.
        if (!seeded.current) {
            const seed = new Map<string, string>();
            const seedRows = new Map<string, R>();
            rows.forEach((r) => {
                seed.set(r.id, toSignature(r));
                if (partial) seedRows.set(r.id, partial.toRow(r));
            });
            synced.current = seed;
            baseline.current = seedRows;
            seeded.current = true;
            emit();
            return;
        }

        emit();
        debounce.current = setTimeout(() => { debounce.current = null; void run(); }, delayMs);
        return () => { if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; } };
    }, [rows, enabled, toSignature, partial, delayMs, run, emit]);

    // A failed write is tried again when the person comes back to the tab or the network returns.
    useEffect(() => {
        if (!enabled || !isSupabaseConfigured || typeof window === 'undefined') return;
        const again = () => { if (failed.current.size && !saving.current) void run(); };
        const onVisible = () => { if (document.visibilityState === 'visible') again(); };
        window.addEventListener('online', again);
        window.addEventListener('focus', again);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.removeEventListener('online', again);
            window.removeEventListener('focus', again);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [enabled, run]);

    // StrictMode mounts, unmounts and mounts again in development, so the
    // flag has to be reset on every mount, not just cleared once.
    useEffect(() => {
        unmounted.current = false;
        return () => { unmounted.current = true; clearRetry(); };
    }, []);

    const flush = useCallback(async (): Promise<SyncPassResult> => {
        if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
        // Let React commit the state change that prompted this before looking at `latest`.
        await new Promise<void>((r) => setTimeout(r, 0));
        if (!enabled || !isSupabaseConfigured) return { failed: [], accepted: 0 };
        return run();
    }, [enabled, run]);

    const retry = useCallback((): Promise<SyncPassResult> => {
        if (!enabled || !isSupabaseConfigured) return Promise.resolve({ failed: [], accepted: 0 });
        clearRetry();
        return run();
    }, [enabled, run]);

    const idle = useCallback(async () => { await inFlight.current?.catch(() => undefined); }, []);

    const pendingIds = useCallback(() => {
        const { changed, removed } = changedIds();
        return [...changed.map((r) => r.id), ...removed];
    }, [changedIds]);

    const accept = useCallback((incoming: T[]) => {
        const { toSignature: sig, partial: part } = callbacks.current;
        for (const row of incoming) {
            synced.current.set(row.id, sig(row));
            if (part) baseline.current.set(row.id, part.toRow(row));
            failed.current.delete(row.id);
        }
    }, []);

    const forget = useCallback((ids: string[]) => {
        for (const id of ids) {
            synced.current.delete(id);
            baseline.current.delete(id);
            failed.current.delete(id);
        }
    }, []);

    return { flush, retry, idle, pendingIds, accept, forget };
}

/**
 * Same idea for a single JSON-ish value (company profile, app settings).
 * A refused save is retried with the same backoff, and reported the same way.
 */
export function useValueSync<T>(opts: {
    value: T;
    enabled: boolean;
    save: (value: T) => Promise<void>;
    label: string;
    onError?: (message: string) => void;
    onStatus?: (status: SyncStatus) => void;
    delayMs?: number;
    retryDelaysMs?: number[];
}) {
    const { value, enabled, save, label, onError, onStatus, delayMs = 800, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS } = opts;
    const synced = useRef<string | null>(null);
    const retryCount = useRef(0);
    const [attempt, setAttempt] = useState(0);
    const callbacks = useRef({ save, onError, onStatus, label });
    callbacks.current = { save, onError, onStatus, label };

    useEffect(() => {
        if (!enabled) { synced.current = null; retryCount.current = 0; }
    }, [enabled]);

    useEffect(() => {
        if (!enabled || !isSupabaseConfigured) return;

        const sig = JSON.stringify(value);
        if (synced.current === null) {
            synced.current = sig;
            return;
        }
        if (synced.current === sig) return;

        const { onStatus: report } = callbacks.current;
        report?.({ saving: false, pending: 1, failed: [], lastSavedAt: null, retryAt: null });
        const timer = setTimeout(async () => {
            const { save: persist, onError: reportError, onStatus: status, label: lbl } = callbacks.current;
            status?.({ saving: true, pending: 1, failed: [], lastSavedAt: null, retryAt: null });
            try {
                await persist(value);
                synced.current = sig;
                retryCount.current = 0;
                status?.({ saving: false, pending: 0, failed: [], lastSavedAt: Date.now(), retryAt: null });
            } catch (e: any) {
                const message = humanise(e);
                reportError?.(`Could not save ${lbl}: ${message}`);
                const delay = retryDelaysMs[Math.min(retryCount.current, retryDelaysMs.length - 1)];
                retryCount.current++;
                status?.({ saving: false, pending: 1, failed: [{ id: lbl, message }], lastSavedAt: null, retryAt: Date.now() + delay });
                setTimeout(() => setAttempt((n) => n + 1), delay);
            }
        }, delayMs);

        return () => clearTimeout(timer);
    }, [value, enabled, delayMs, attempt, retryDelaysMs]);
}
