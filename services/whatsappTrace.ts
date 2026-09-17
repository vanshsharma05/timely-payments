import * as repo from './repository';
import { Outstanding, User } from '../types';

/**
 * A WhatsApp reminder is composed here and sent from WhatsApp itself, which
 * never tells the app what became of it. So the record says exactly what
 * the app knows — that the reminder was opened, for whom, with which
 * template — and never "sent" (owner's decision, 2026-09-17).
 *
 * Best effort: a role that may not write to the thread, or a dropped
 * connection, does not stop WhatsApp from opening.
 */
export function recordWhatsAppOpened(
    customer: Pick<Outstanding, 'id'>,
    recipient: { name?: string; number?: string },
    templateName: string | undefined,
    user: User | null | undefined,
): void {
    if (!user) return;
    const who = [recipient.name?.trim(), recipient.number?.trim()].filter(Boolean).join(' · ') || 'a number';
    const body = `WhatsApp reminder opened for ${who}${templateName ? ` — "${templateName}"` : ''}. Sending happens in WhatsApp; delivery is not confirmed here.`;
    repo.addActivity({ customerId: customer.id, kind: 'system', body }, user).catch(() => { /* the reminder still opens */ });
}
