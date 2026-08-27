import { buildDigests, loadRecipients, renderDigest } from './digest.js';
import { mailProvider, sendMail } from './mailer.js';
import { serviceClient } from './supabase.js';

/**
 * The daily reminder run, shared by the cron entry point and the "send now"
 * button in the app.
 *
 * Everything it does is written to alert_log, including a run that sent
 * nothing and why — the panel reports what happened rather than what was
 * supposed to happen.
 */

export interface RunOptions {
    /** Ignore the on/off switch and the empty-digest rule: one person, now. */
    onlyEmail?: string;
    triggeredBy?: string;
}

export interface RunResult {
    status: number;
    body: Record<string, unknown>;
}

const APP_URL = () =>
    process.env.APP_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://timely-payment.vercel.app');

export async function runDailyReminders(opts: RunOptions = {}): Promise<RunResult> {
    const db = serviceClient();
    if (!db) {
        return {
            status: 501,
            body: { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' },
        };
    }

    const provider = mailProvider();
    const test = Boolean(opts.onlyEmail);

    const { data: settings } = await db.from('alert_settings').select('*').eq('id', 1).maybeSingle();
    const enabled = Boolean(settings?.daily_email);
    const roles: string[] = settings?.recipient_roles || ['Admin', 'Manager', 'CRM', 'Collector'];
    const skipEmpty = settings?.skip_when_empty !== false;
    const extra: string[] = settings?.extra_recipients || [];

    if (!enabled && !test) {
        await db.from('alert_log').insert({
            kind: 'daily_email',
            recipients: 0,
            delivered: 0,
            failed: 0,
            provider,
            detail: 'Daily email is switched off.',
            triggered_by: opts.triggeredBy || 'cron',
        });
        return { status: 200, body: { ok: true, skipped: 'disabled' } };
    }

    const everyone = await loadRecipients(db);
    const wanted = test
        ? everyone.filter(r => (r.email || '').toLowerCase() === opts.onlyEmail!.toLowerCase())
        : everyone.filter(r => roles.includes(r.role) && r.email);

    if (!wanted.length) {
        const detail = test ? `No profile with the address ${opts.onlyEmail}.` : 'Nobody matched the chosen roles.';
        await db.from('alert_log').insert({
            kind: test ? 'test_email' : 'daily_email',
            recipients: 0, delivered: 0, failed: 0, provider, detail,
            triggered_by: opts.triggeredBy || 'cron',
        });
        return { status: 200, body: { ok: false, error: detail } };
    }

    const digests = await buildDigests(db, wanted);
    const appUrl = APP_URL();

    let delivered = 0;
    let failed = 0;
    const problems: string[] = [];
    const skipped: string[] = [];

    for (const digest of digests) {
        if (!test && skipEmpty && digest.taskCount === 0) {
            skipped.push(digest.recipient.name);
            continue;
        }
        const mail = renderDigest(digest, appUrl);
        const res = await sendMail({
            to: digest.recipient.email!,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
        });
        if (res.ok) delivered++;
        else {
            failed++;
            problems.push(`${digest.recipient.email}: ${res.error}`);
        }
    }

    // Extra addresses get the company-wide view, built once.
    if (!test && extra.length) {
        const wholeBook = digests.find(d => d.perCrm.length) || digests[0];
        if (wholeBook) {
            const mail = renderDigest(wholeBook, appUrl);
            for (const address of extra) {
                const res = await sendMail({ to: address, subject: mail.subject, html: mail.html, text: mail.text });
                if (res.ok) delivered++;
                else {
                    failed++;
                    problems.push(`${address}: ${res.error}`);
                }
            }
        }
    }

    const detail =
        provider === 'none'
            ? 'No email provider configured. Set RESEND_API_KEY or SMTP_URL and try again.'
            : [
                  skipped.length ? `${skipped.length} had nothing to chase` : '',
                  problems.slice(0, 3).join(' | '),
              ]
                  .filter(Boolean)
                  .join(' · ') || 'Sent.';

    await db.from('alert_log').insert({
        kind: test ? 'test_email' : 'daily_email',
        recipients: delivered + failed,
        delivered,
        failed,
        provider,
        detail: detail.slice(0, 500),
        triggered_by: opts.triggeredBy || 'cron',
    });

    return {
        status: failed && !delivered ? 502 : 200,
        body: {
            ok: delivered > 0 || (!failed && !delivered),
            provider,
            delivered,
            failed,
            skipped: skipped.length,
            detail,
        },
    };
}
