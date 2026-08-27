import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildReport } from './_lib/report.js';
import { bearerToken, currentProfile, isBackendConfigured } from './_lib/supabase.js';

/**
 * AI collection report.
 *
 * Runs server-side so the Gemini key stays out of the browser, and requires a
 * signed-in user: the endpoint spends real money per call, and this URL is
 * public.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' });
    }

    try {
        if (isBackendConfigured()) {
            const caller = await currentProfile(bearerToken(req.headers.authorization));
            if (!caller) {
                return res.status(401).json({ ok: false, error: 'Sign in to generate a report.' });
            }
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        const { status, body: payload } = await buildReport(body);
        return res.status(status).json(payload);
    } catch (err: any) {
        console.error('Gemini Report Generation Error:', err);
        return res
            .status(500)
            .json({ ok: false, error: err?.message || 'Failed to generate AI report using Gemini.' });
    }
}
