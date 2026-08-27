import express from 'express';
import path from 'path';
import { createServer as createViteServer, loadEnv } from 'vite';
import { fetchGoogleSheetCsv } from './api/_lib/sheet';
import { buildReport } from './api/_lib/report';
import { handleTeamRequest } from './api/_lib/team';
import { runDailyReminders } from './api/_lib/reminders';
import { mailProvider } from './api/_lib/mailer';
import { bearerToken, currentProfile, isBackendConfigured } from './api/_lib/supabase';

/**
 * Local development server.
 *
 * Every route here is a thin wrapper over the same module the matching Vercel
 * function in api/ calls, so what you test locally is what runs in production.
 * Adding a route means adding it in both places — never re-implementing it.
 */
async function startServer() {
    const app = express();
    const PORT = 3000;

    // Vite only injects VITE_-prefixed values into the browser bundle. The API
    // routes below need the server-only ones from .env.local too (the Supabase
    // service role key, the Gemini key), so load the whole file here.
    Object.assign(process.env, loadEnv(process.env.NODE_ENV || 'development', process.cwd(), ''));

    app.use(express.json({ limit: '10mb' }));

    /** Mirrors api/fetch-sheet.ts — server-side proxy for Google Sheet CSV. */
    const sheetHandler = async (url: unknown, res: express.Response) => {
        if (!url || typeof url !== 'string') {
            return res
                .status(400)
                .json({ ok: false, error: 'Missing "url" (POST body or query parameter).' });
        }
        try {
            const { csv, sourceUrl } = await fetchGoogleSheetCsv(url);
            res.json({ ok: true, csv, sourceUrl });
        } catch (err: any) {
            res.status(500).json({
                ok: false,
                error: err?.message || 'Failed to fetch Google Sheet data.',
            });
        }
    };

    app.post('/api/fetch-sheet', (req, res) => sheetHandler(req.body?.url, res));
    app.get('/api/fetch-sheet', (req, res) => sheetHandler(req.query?.url, res));

    /** Mirrors api/team.ts — create / update / remove a teammate's login. */
    app.post('/api/team', async (req, res) => {
        try {
            const { status, body } = await handleTeamRequest(
                req.body || {},
                bearerToken(req.headers.authorization)
            );
            res.status(status).json(body);
        } catch (err: any) {
            res.status(500).json({
                ok: false,
                error: err?.message || 'Could not complete the request.',
            });
        }
    });

    /** Mirrors api/daily-report.ts — the daily reminder email. */
    app.post('/api/daily-report', async (req, res) => {
        try {
            const caller = await currentProfile(bearerToken(req.headers.authorization));
            if (!caller) return res.status(401).json({ ok: false, error: 'Not signed in.' });
            if (caller.role !== 'Admin' && caller.role !== 'Manager') {
                return res.status(403).json({ ok: false, error: 'Only an Admin or Manager can send this.' });
            }
            const body = req.body || {};
            const result = await runDailyReminders({
                onlyEmail: body.test ? body.to || undefined : undefined,
                triggeredBy: caller.legacyId,
            });
            res.status(result.status).json(result.body);
        } catch (err: any) {
            res.status(500).json({ ok: false, error: err?.message || 'Could not send the reminder.' });
        }
    });

    /** Mirrors api/alert-status.ts — can this deployment send email? */
    app.get('/api/alert-status', async (req, res) => {
        const caller = await currentProfile(bearerToken(req.headers.authorization));
        if (!caller) return res.status(401).json({ ok: false, error: 'Not signed in.' });
        res.json({ ok: true, provider: mailProvider(), scheduled: Boolean(process.env.CRON_SECRET?.trim()) });
    });

    app.get('/api/health', (_req, res) => {
        res.json({ status: 'ok', time: new Date().toISOString() });
    });

    /** Mirrors api/ai-status.ts — is the AI report backed by a real key? */
    app.get('/api/ai-status', (_req, res) => {
        const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
        res.json({ ok: true, hasApiKey: hasKey, model: 'gemini-3.7-flash' });
    });

    /** Mirrors api/gemini-report.ts — AI collection report, signed-in users only. */
    app.post('/api/gemini-report', async (req, res) => {
        try {
            if (isBackendConfigured()) {
                const caller = await currentProfile(bearerToken(req.headers.authorization));
                if (!caller) {
                    return res.status(401).json({ ok: false, error: 'Sign in to generate a report.' });
                }
            }
            const { status, body } = await buildReport(req.body || {});
            res.status(status).json(body);
        } catch (err: any) {
            console.error('Gemini Report Generation Error:', err);
            res.status(500).json({
                ok: false,
                error: err?.message || 'Failed to generate AI report using Gemini.',
            });
        }
    });

    // Vite middleware for development vs Static serving for production
    if (process.env.NODE_ENV !== 'production') {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'spa',
        });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist');
        app.use(express.static(distPath));
        // In Express v5, catch-all is '*all'
        app.get('*all', (_req, res) => {
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Timely Payment server running on http://0.0.0.0:${PORT}`);
    });
}

startServer();
