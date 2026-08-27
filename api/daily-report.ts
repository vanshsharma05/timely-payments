import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runDailyReminders } from './_lib/reminders.js';
import { bearerToken, currentProfile } from './_lib/supabase.js';

/**
 * The daily reminder email.
 *
 * Two ways in, and both have to prove themselves:
 *   - Vercel's scheduler, which sends CRON_SECRET as a bearer token
 *   - an Admin pressing "Send me a test", which sends their session token
 *
 * Left open, this endpoint would let anyone on the internet mail the whole team
 * as often as they liked.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    const token = bearerToken(req.headers.authorization);
    const cronSecret = process.env.CRON_SECRET?.trim();

    // Vercel Cron calls with the secret; it is also the only GET we accept.
    const fromCron = Boolean(cronSecret && token === cronSecret);

    if (!fromCron) {
        const caller = await currentProfile(token);
        if (!caller) {
            return res.status(401).json({ ok: false, error: 'Not signed in.' });
        }
        if (caller.role !== 'Admin' && caller.role !== 'Manager') {
            return res.status(403).json({ ok: false, error: 'Only an Admin or Manager can send this.' });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        const result = await runDailyReminders({
            onlyEmail: body.test ? body.to || undefined : undefined,
            triggeredBy: caller.legacyId,
        });
        return res.status(result.status).json(result.body);
    }

    const result = await runDailyReminders({ triggeredBy: 'cron' });
    return res.status(result.status).json(result.body);
}
