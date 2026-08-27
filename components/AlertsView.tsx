import React, { useCallback, useEffect, useState } from 'react';
import { AlertSettings, AlertLogEntry, UserRole } from '../types';
import * as repo from '../services/repository';
import { Button, Card, SectionHeader, Spinner, cx } from './ui/Primitives';
import { formatDate } from './ui/format';

/**
 * Alerts and reminders.
 *
 * One reminder actually exists — a daily email — so that is what this screen is
 * about. SMS and WhatsApp are listed as what they are: not connected, with the
 * one thing each would need. A switch that pretends to send a message nobody
 * receives is worse than no switch.
 */

const ROLES: { role: UserRole; hint: string }[] = [
    { role: UserRole.Admin, hint: 'company-wide summary' },
    { role: UserRole.Manager, hint: 'company-wide summary' },
    { role: UserRole.CRM, hint: 'their own accounts' },
    { role: UserRole.Collector, hint: 'accounts assigned to them' },
];

const Channel = ({
    name,
    state,
    detail,
    children,
}: {
    name: string;
    state: 'live' | 'off' | 'unavailable';
    detail: string;
    children?: React.ReactNode;
}) => (
    <div className="rounded-[14px] bg-card-2 p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
            <span
                className="w-2.5 h-2.5 rounded-full flex-none"
                style={{
                    background:
                        state === 'live' ? 'var(--age-1)' : state === 'off' ? 'var(--label-4)' : 'var(--age-2)',
                }}
                aria-hidden="true"
            />
            <span className="text-[14.5px] font-bold text-label">{name}</span>
            <span className="ml-auto text-[12px] font-semibold text-label-3 uppercase tracking-wider">
                {state === 'live' ? 'Ready' : state === 'off' ? 'Off' : 'Not connected'}
            </span>
        </div>
        <p className="text-[13px] text-label-3 leading-relaxed">{detail}</p>
        {children}
    </div>
);

export const AlertsView = ({ canEdit }: { canEdit: boolean }) => {
    const [settings, setSettings] = useState<AlertSettings | null>(null);
    const [log, setLog] = useState<AlertLogEntry[]>([]);
    const [provider, setProvider] = useState<string>('unknown');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);
    const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [s, l, status] = await Promise.all([
                repo.fetchAlertSettings(),
                repo.fetchAlertLog(),
                repo.fetchAlertStatus(),
            ]);
            setSettings(s);
            setLog(l);
            setProvider(status.provider);
        } catch (e: any) {
            setMessage({ tone: 'bad', text: e?.message || 'Could not load the reminder settings.' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const save = async (next: AlertSettings) => {
        setSettings(next);
        setSaving(true);
        setMessage(null);
        try {
            await repo.saveAlertSettings(next);
        } catch (e: any) {
            setMessage({ tone: 'bad', text: e?.message || 'Could not save.' });
        } finally {
            setSaving(false);
        }
    };

    const sendTest = async () => {
        setSending(true);
        setMessage(null);
        try {
            const result = await repo.sendTestReminder();
            setMessage({
                tone: result.delivered ? 'ok' : 'bad',
                text: result.delivered
                    ? `Sent. Check your inbox — it went to ${result.to}.`
                    : result.detail || 'Nothing was sent.',
            });
            setLog(await repo.fetchAlertLog());
        } catch (e: any) {
            setMessage({ tone: 'bad', text: e?.message || 'Could not send the test.' });
        } finally {
            setSending(false);
        }
    };

    if (loading || !settings) {
        return (
            <div className="flex items-center gap-3 py-16 justify-center text-label-3">
                <Spinner className="w-5 h-5" />
                <span className="text-[14px]">Loading reminders…</span>
            </div>
        );
    }

    const emailReady = provider !== 'none';
    const toggleRole = (role: UserRole) => {
        const has = settings.recipientRoles.includes(role);
        save({
            ...settings,
            recipientRoles: has
                ? settings.recipientRoles.filter(r => r !== role)
                : [...settings.recipientRoles, role],
        });
    };

    return (
        <div className="flex flex-col gap-5">
            <Card className="p-6">
                <SectionHeader
                    title="Daily reminder email"
                    subtitle="Sent at 9:00 am India time, to each person, listing only what they have to chase."
                    actions={
                        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={settings.dailyEmail}
                                disabled={!canEdit || saving}
                                onChange={e => save({ ...settings, dailyEmail: e.target.checked })}
                                className="w-4 h-4 rounded"
                            />
                            <span className="text-[14px] font-semibold text-label">
                                {settings.dailyEmail ? 'On' : 'Off'}
                            </span>
                        </label>
                    }
                />

                {!emailReady && (
                    <div className="mt-5 rounded-[12px] bg-warn-bg text-warn px-4 py-3 text-[13.5px] font-medium leading-relaxed">
                        No email provider is connected yet, so nothing will actually be delivered. Add
                        <code className="font-mono text-[12.5px] mx-1">RESEND_API_KEY</code>
                        or
                        <code className="font-mono text-[12.5px] mx-1">SMTP_URL</code>
                        to the deployment and this starts working — the rest of this screen is ready.
                    </div>
                )}

                <div className="mt-6">
                    <p className="label mb-2.5">Who gets it</p>
                    <div className="grid sm:grid-cols-2 gap-2.5">
                        {ROLES.map(({ role, hint }) => {
                            const on = settings.recipientRoles.includes(role);
                            return (
                                <label
                                    key={role}
                                    className={cx(
                                        'flex items-start gap-3 rounded-[12px] border p-3 transition-colors',
                                        canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-70',
                                        on
                                            ? 'bg-accent-tint border-accent-tint-2'
                                            : 'bg-card-2 border-separator hover:bg-hover'
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        checked={on}
                                        disabled={!canEdit || saving}
                                        onChange={() => toggleRole(role)}
                                        className="w-4 h-4 mt-0.5 rounded"
                                    />
                                    <span>
                                        <span className="block text-[14px] font-semibold text-label">{role}</span>
                                        <span className="block text-[12.5px] text-label-3 mt-0.5">{hint}</span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </div>

                <label className="flex items-start gap-3 mt-4 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={settings.skipWhenEmpty}
                        disabled={!canEdit || saving}
                        onChange={e => save({ ...settings, skipWhenEmpty: e.target.checked })}
                        className="w-4 h-4 mt-0.5 rounded"
                    />
                    <span>
                        <span className="block text-[14px] font-semibold text-label">
                            Skip people with nothing to chase
                        </span>
                        <span className="block text-[12.5px] text-label-3 mt-0.5">
                            An empty reminder every morning is how a reminder gets ignored.
                        </span>
                    </span>
                </label>

                <div className="flex items-center gap-3 mt-6 flex-wrap">
                    <Button variant="primary" onClick={sendTest} disabled={!canEdit || sending}>
                        {sending && <Spinner className="w-4 h-4" />}
                        {sending ? 'Sending…' : 'Send me a test now'}
                    </Button>
                    <span className="text-[12.5px] text-label-3">
                        Goes to your own address only, whatever the switch above says.
                    </span>
                </div>

                {message && (
                    <p
                        role="status"
                        className={cx(
                            'mt-4 rounded-[12px] px-4 py-3 text-[13.5px] font-medium',
                            message.tone === 'ok' ? 'bg-pos-bg text-pos' : 'bg-dang-bg text-dang'
                        )}
                    >
                        {message.text}
                    </p>
                )}
            </Card>

            <Card className="p-6">
                <SectionHeader title="Channels" subtitle="What this app can send today, and what each one needs." />
                <div className="grid sm:grid-cols-3 gap-3 mt-5">
                    <Channel
                        name="Email"
                        state={emailReady ? (settings.dailyEmail ? 'live' : 'off') : 'unavailable'}
                        detail={
                            emailReady
                                ? `Connected through ${provider === 'resend' ? 'Resend' : 'SMTP'}.`
                                : 'Needs RESEND_API_KEY or SMTP_URL on the deployment.'
                        }
                    />
                    <Channel
                        name="WhatsApp"
                        state="unavailable"
                        detail="Sent by hand today, from the WhatsApp button on each account. Automatic sending needs a WhatsApp Business API number."
                    />
                    <Channel
                        name="SMS"
                        state="unavailable"
                        detail="Needs an SMS gateway account and a registered sender ID with TRAI."
                    />
                </div>
            </Card>

            <Card className="p-6">
                <SectionHeader
                    title="Recent runs"
                    subtitle="What was actually sent, not what was scheduled."
                    actions={<Button size="sm" variant="quiet" onClick={load}>Refresh</Button>}
                />
                {log.length === 0 ? (
                    <p className="text-[13.5px] text-label-3 mt-5">Nothing has run yet.</p>
                ) : (
                    <div className="overflow-x-auto mt-5">
                        <table className="min-w-full text-left">
                            <thead>
                                <tr className="border-b border-separator">
                                    {['When', 'Kind', 'Sent', 'Failed', 'By', 'Detail'].map(h => (
                                        <th key={h} className="label py-2 pr-4 whitespace-nowrap">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {log.map(row => (
                                    <tr key={row.id} className="border-b border-separator last:border-0">
                                        <td className="py-2.5 pr-4 text-[13.5px] text-label whitespace-nowrap">
                                            {formatDate(row.sentAt)}{' '}
                                            <span className="text-label-3">
                                                {new Date(row.sentAt).toLocaleTimeString('en-IN', {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </span>
                                        </td>
                                        <td className="py-2.5 pr-4 text-[13.5px] text-label-2 whitespace-nowrap">
                                            {row.kind === 'test_email' ? 'Test' : 'Daily'}
                                        </td>
                                        <td className="py-2.5 pr-4 text-[13.5px] num text-label">{row.delivered}</td>
                                        <td
                                            className={cx(
                                                'py-2.5 pr-4 text-[13.5px] num',
                                                row.failed ? 'text-dang font-semibold' : 'text-label-3'
                                            )}
                                        >
                                            {row.failed}
                                        </td>
                                        <td className="py-2.5 pr-4 text-[13.5px] text-label-3 whitespace-nowrap">
                                            {row.triggeredBy || 'cron'}
                                        </td>
                                        <td className="py-2.5 text-[13px] text-label-3">{row.detail}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
};

export default AlertsView;
