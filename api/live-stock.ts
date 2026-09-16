import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readLiveStock } from './_lib/liveStock.js';
import { bearerToken, currentProfile } from './_lib/supabase.js';

/**
 * The stores sheet for the Live stock tab.
 *
 * Signed-in callers only, and what comes back depends on who is asking: an
 * Admin or Manager gets the sheet as it is; everyone else gets it with the
 * rate and value columns emptied before it leaves the server. See
 * _lib/liveStock.ts for why that is done here and not in the browser.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    const caller = await currentProfile(bearerToken(req.headers.authorization));
    if (!caller) {
        return res.status(401).json({ ok: false, error: 'Not signed in.' });
    }
    try {
        const { csv, priced, sourceUrl } = await readLiveStock(caller.role);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ ok: true, csv, priced, sourceUrl });
    } catch (err: any) {
        return res.status(502).json({ ok: false, error: err?.message || 'The stock sheet could not be read.' });
    }
}
