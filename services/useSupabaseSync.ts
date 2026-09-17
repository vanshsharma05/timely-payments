import { useEffect, useRef } from 'react';
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
 */
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
    delayMs?: number;
}) {
    const { rows, enabled, toSignature, upsert, remove, partial, label, onError, delayMs = 800 } = opts;

    /** id -> signature of the last state the server accepted (or was loaded with). */
    const synced = useRef<Map<string, string>>(new Map());
    /** id -> that same state as a database row, for the column diff. Only with `partial`. */
    const baseline = useRef<Map<string, R>>(new Map());
    /** Skip the write on the render that first receives server data. */
    const seeded = useRef(false);

    // Reset the baseline when sync is switched off (sign-out / project change).
    useEffect(() => {
        if (!enabled) {
            synced.current = new Map();
            baseline.current = new Map();
            seeded.current = false;
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
            return;
        }

        const timer = setTimeout(async () => {
            const current = new Map<string, string>();
            const changed: T[] = [];
            const created = new Set<string>();

            for (const row of rows) {
                const sig = toSignature(row);
                current.set(row.id, sig);
                if (synced.current.get(row.id) !== sig) {
                    changed.push(row);
                    if (!synced.current.has(row.id)) created.add(row.id);
                }
            }

            const removed: string[] = [];
            for (const id of synced.current.keys()) {
                if (!current.has(id)) removed.push(id);
            }

            if (!changed.length && !removed.length) return;

            const failures: string[] = [];
            /** The server has this row as it is now. */
            const accept = (row: T) => {
                synced.current.set(row.id, current.get(row.id)!);
                if (partial) baseline.current.set(row.id, partial.toRow(row));
            };

            if (partial) {
                const fresh = changed.filter((r) => created.has(r.id));
                const known = changed.filter((r) => !created.has(r.id));

                if (fresh.length) {
                    try {
                        await upsert(fresh, created);
                        fresh.forEach(accept);
                    } catch (e: any) {
                        failures.push(e?.message || String(e));
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
                        const after = partial.toRow(row);
                        const changes = before ? partial.diff(before, after) : (after as Partial<R>);
                        try {
                            if (Object.keys(changes).length) await partial.update(row.id, changes);
                            accept(row);
                        } catch (e: any) {
                            failures.push(e?.message || String(e));
                        }
                    }
                };
                await Promise.all(Array.from({ length: Math.min(partial.concurrency ?? 8, queue.length) }, worker));
            } else if (changed.length) {
                try {
                    await upsert(changed, created);
                    changed.forEach(accept);
                } catch (e: any) {
                    failures.push(e?.message || String(e));
                }
            }

            if (remove) {
                for (const id of removed) {
                    try {
                        await remove(id);
                        synced.current.delete(id);
                        baseline.current.delete(id);
                    } catch (e: any) {
                        failures.push(e?.message || String(e));
                    }
                }
            }

            if (failures.length) {
                // Whatever failed stays out of the baseline, so the next change retries it.
                const more = failures.length > 1 ? ` (and ${failures.length - 1} more)` : '';
                onError?.(`Could not save ${label}: ${failures[0]}${more}`);
            }
        }, delayMs);

        return () => clearTimeout(timer);
    }, [rows, enabled, upsert, remove, partial, toSignature, label, onError, delayMs]);
}

/**
 * Same idea for a single JSON-ish value (company profile, app settings).
 */
export function useValueSync<T>(opts: {
    value: T;
    enabled: boolean;
    save: (value: T) => Promise<void>;
    label: string;
    onError?: (message: string) => void;
    delayMs?: number;
}) {
    const { value, enabled, save, label, onError, delayMs = 800 } = opts;
    const synced = useRef<string | null>(null);

    useEffect(() => {
        if (!enabled) synced.current = null;
    }, [enabled]);

    useEffect(() => {
        if (!enabled || !isSupabaseConfigured) return;

        const sig = JSON.stringify(value);
        if (synced.current === null) {
            synced.current = sig;
            return;
        }
        if (synced.current === sig) return;

        const timer = setTimeout(async () => {
            try {
                await save(value);
                synced.current = sig;
            } catch (e: any) {
                onError?.(`Could not save ${label}: ${e?.message || e}`);
            }
        }, delayMs);

        return () => clearTimeout(timer);
    }, [value, enabled, save, label, onError, delayMs]);
}
