import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchGoogleSheetCsv } from './_lib/sheet.js';
import { bearerToken, currentProfile } from './_lib/supabase.js';
import { seesPrices } from './_lib/liveStock.js';

/**
 * Server-side proxy for Google Sheet CSV exports.
 * Runs server-side because the browser cannot fetch docs.google.com directly
 * (CORS), and because Google redirects unauthenticated CSV requests to a login
 * page that has to be detected and retried against alternate URL shapes.
 *
 * Admin and Manager only. Its two callers — the balance sync and the customer
 * import — already are, and an open proxy would hand anyone the stores sheet
 * with its prices, which /api/live-stock takes care to withhold.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    const caller = await currentProfile(bearerToken(req.headers.authorization));
    if (!caller) {
        return res.status(401).json({ ok: false, error: 'Not signed in.' });
    }
    if (!seesPrices(caller.role)) {
        return res.status(403).json({ ok: false, error: 'Only an Admin or Manager can read a sheet directly.' });
    }

    const url =
        req.method === 'POST'
            ? (req.body?.url as string | undefined)
            : (req.query?.url as string | undefined);

    if (!url || typeof url !== 'string') {
        return res
            .status(400)
            .json({ ok: false, error: 'Missing "url" (POST body or query parameter).' });
    }

    try {
        const { csv, sourceUrl } = await fetchGoogleSheetCsv(url);
        return res.status(200).json({ ok: true, csv, sourceUrl });
    } catch (err: any) {
        return res
            .status(500)
            .json({ ok: false, error: err?.message || 'Failed to fetch Google Sheet data.' });
    }
}
