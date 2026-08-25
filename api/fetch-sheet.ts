import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchGoogleSheetCsv } from './_lib/sheet.js';

/**
 * Server-side proxy for Google Sheet CSV exports.
 * Runs server-side because the browser cannot fetch docs.google.com directly
 * (CORS), and because Google redirects unauthenticated CSV requests to a login
 * page that has to be detected and retried against alternate URL shapes.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
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
