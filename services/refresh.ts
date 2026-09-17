/** The item under this id replaced if present, added at the front if not: a retried save must not add twice. */
export function replaceOrAdd<T extends { id: string }>(list: T[], item: T): T[] {
    return list.some(x => x.id === item.id) ? list.map(x => (x.id === item.id ? item : x)) : [item, ...list];
}

/**
 * Folding a fresh read of a collection into the copy a tab holds.
 *
 * The server's rows win — except a row this tab has changed and not yet
 * saved, which keeps its local state exactly (the unsaved change is what the
 * next pass writes). A row the server no longer has is dropped unless it is
 * pending here (a new account not yet accepted, or an edit to something
 * deleted elsewhere — that one is kept until it is saved or the next refresh
 * finds it still gone). What was taken from the server is handed back as
 * `accepted`, so the sync baseline can move to it; what was dropped as
 * `dropped`, so no delete is issued for it.
 */
export function mergeServerRows<T extends { id: string }>(
    local: T[],
    server: T[],
    pendingIds: Iterable<string>,
): { merged: T[]; accepted: T[]; dropped: string[] } {
    const pending = new Set(pendingIds);
    const localById = new Map<string, T>(local.map(r => [r.id, r]));
    const serverIds = new Set(server.map(r => r.id));

    const merged: T[] = server.map(row => (pending.has(row.id) ? localById.get(row.id) ?? row : row));
    for (const row of local) if (!serverIds.has(row.id) && pending.has(row.id)) merged.push(row);

    const accepted = server.filter(row => !pending.has(row.id));
    const dropped = local.filter(row => !serverIds.has(row.id) && !pending.has(row.id)).map(row => row.id);
    return { merged, accepted, dropped };
}
