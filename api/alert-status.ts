import type { VercelRequest, VercelResponse } from '@vercel/node';
import { mailProvider } from './_lib/mailer.js';
import { bearerToken, currentProfile } from './_lib/supabase.js';

/**
 * Whether the server can actually send email, so the Alerts screen can say so
 * rather than guess. Signed-in staff only: it describes the deployment.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    const caller = await currentProfile(bearerToken(req.headers.authorization));
    if (!caller) return res.status(401).json({ ok: false, error: 'Not signed in.' });

    return res.status(200).json({
        ok: true,
        provider: mailProvider(),
        scheduled: Boolean(process.env.CRON_SECRET?.trim()),
    });
}
