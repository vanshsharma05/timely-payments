/**
 * Ids made on the client, so a record can be saved under the same id twice
 * without becoming two records — the case where the server stored it but
 * the answer never came back.
 */
export const newEntryId = (): string =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        // Old WebViews: still a v4-shaped uuid, from Math.random.
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
