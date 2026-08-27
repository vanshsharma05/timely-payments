/**
 * Sending email from the server.
 *
 * Two providers, picked by whichever key is present, and an honest third state
 * when neither is: nothing is sent and the caller is told so, rather than the
 * app reporting a delivery that never happened.
 *
 *   RESEND_API_KEY   Resend's HTTP API. Simplest to set up; the sending domain
 *                    has to be verified with them first.
 *   SMTP_URL         Any SMTP server, e.g. Gmail with an app password:
 *                    smtps://timelypaymentsupport@gmail.com:APP_PASSWORD@smtp.gmail.com:465
 *
 * ALERT_FROM sets the From address; it must belong to the verified domain or
 * the SMTP account.
 */

export type MailProvider = 'resend' | 'smtp' | 'none';

export interface Mail {
    to: string;
    subject: string;
    html: string;
    text: string;
}

export interface SendResult {
    ok: boolean;
    provider: MailProvider;
    error?: string;
}

const env = (name: string): string | undefined => {
    const v = process.env[name];
    return v && v.trim() ? v.trim() : undefined;
};

export function mailProvider(): MailProvider {
    if (env('RESEND_API_KEY')) return 'resend';
    if (env('SMTP_URL')) return 'smtp';
    return 'none';
}

export function mailFrom(): string {
    return env('ALERT_FROM') || 'Timely Payment <onboarding@resend.dev>';
}

async function sendWithResend(mail: Mail): Promise<SendResult> {
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env('RESEND_API_KEY')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: mailFrom(),
            to: [mail.to],
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
        }),
    });

    if (res.ok) return { ok: true, provider: 'resend' };
    const detail = await res.text().catch(() => '');
    return { ok: false, provider: 'resend', error: `HTTP ${res.status} ${detail.slice(0, 200)}` };
}

async function sendWithSmtp(mail: Mail): Promise<SendResult> {
    // Imported lazily so a deployment using Resend never pays for the module.
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport(env('SMTP_URL')!);
    try {
        await transport.sendMail({
            from: mailFrom(),
            to: mail.to,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
        });
        return { ok: true, provider: 'smtp' };
    } catch (e: any) {
        return { ok: false, provider: 'smtp', error: (e?.message || String(e)).slice(0, 200) };
    }
}

export async function sendMail(mail: Mail): Promise<SendResult> {
    const provider = mailProvider();
    if (provider === 'none') {
        return {
            ok: false,
            provider: 'none',
            error: 'No email provider configured. Set RESEND_API_KEY or SMTP_URL.',
        };
    }
    try {
        return provider === 'resend' ? await sendWithResend(mail) : await sendWithSmtp(mail);
    } catch (e: any) {
        return { ok: false, provider, error: (e?.message || String(e)).slice(0, 200) };
    }
}
