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
 */
export function useCollectionSync<T extends { id: string }>(opts: {
    /** Current in-memory collection. */
    rows: T[];
    /** Only sync once the user is signed in and the initial load has finished. */
    enabled: boolean;
    /** Stable serialisation used to detect a real change. */
    toSignature: (row: T) => string;
    /**
     * Saves the changed rows. `created` holds the ids this hook has never seen
     * on the server, so an adapter can insert those and update the rest.
     */
    upsert: (rows: T[], created: Set<string>) => Promise<void>;
    remove?: (id: string) => Promise<void>;
    /** Human-readable label used in error reporting. */
    label: string;
    onError?: (message: string) => void;
    delayMs?: number;
}) {
    const { rows, enabled, toSignature, upsert, remove, label, onError, delayMs = 800 } = opts;

    /** id -> last successfully-synced signature. */
    const synced = useRef<Map<string, string>>(new Map());
    /** Skip the write on the render that first receives server data. */
    const seeded = useRef(false);

    // Reset the baseline when sync is switched off (sign-out / project change).
    useEffect(() => {
        if (!enabled) {
            synced.current = new Map();
            seeded.current = false;
        }
    }, [enabled]);

    useEffect(() => {
        if (!enabled || !isSupabaseConfigured) return;

        // First pass after load: record what the server already has.
        if (!seeded.current) {
            const seed = new Map<string, string>();
            rows.forEach((r) => seed.set(r.id, toSignature(r)));
            synced.current = seed;
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

            try {
                if (changed.length) await upsert(changed, created);
                if (remove) {
                    for (const id of removed) await remove(id);
                }
                synced.current = current;
            } catch (e: any) {
                // Leave the baseline untouched so the next change retries.
                onError?.(`Could not save ${label}: ${e?.message || e}`);
            }
        }, delayMs);

        return () => clearTimeout(timer);
    }, [rows, enabled, upsert, remove, toSignature, label, onError, delayMs]);
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
