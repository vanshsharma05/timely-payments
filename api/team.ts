import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleTeamRequest } from './_lib/team.js';
import { bearerToken } from './_lib/supabase.js';

/**
 * Create / update / remove a teammate's login.
 *
 * Runs server-side because it needs the Supabase service role key: the browser
 * only ever holds the anon key, which cannot create auth accounts.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Use POST.' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        const { status, body: payload } = await handleTeamRequest(
            body,
            bearerToken(req.headers.authorization)
        );
        return res.status(status).json(payload);
    } catch (err: any) {
        return res
            .status(500)
            .json({ ok: false, error: err?.message || 'Could not complete the request.' });
    }
}
