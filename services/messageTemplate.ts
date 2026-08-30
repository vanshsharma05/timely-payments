import { Outstanding } from '../types';
import { formatBalanceText } from '../components/BalanceAmount';

/**
 * Filling a reminder template with one customer's figures.
 *
 * Shared by the WhatsApp dialog and the follow-up screen, which used to carry a
 * copy each and had drifted apart.
 *
 * Three rules beyond plain substitution:
 *
 *  - Placeholders are replaced literally. The old code compiled "{{totalDue}}"
 *    into a regular expression, where braces are quantifier syntax; a template
 *    written a little differently silently matched nothing.
 *
 *  - A currency symbol written in front of an amount placeholder is dropped.
 *    Amounts are formatted with their own symbol, so "Total Due: ₹{{totalDue}}"
 *    was reaching customers as "Total Due: ₹₹1,25,000". Templates are hand-
 *    edited and stored in the database, so this is fixed at render time rather
 *    than only in the shipped default.
 *
 *  - A breakdown line whose figures are all nil is dropped. Most accounts owe
 *    money in one or two ageing buckets, so the standard template padded every
 *    reminder with "46-90 days: ₹0" lines that told the customer nothing.
 */

export interface TemplateRecipient {
    name: string;
    number: string;
}

interface Slot {
    value: string;
    /** True for a money placeholder, so its line can be dropped and its symbol de-duplicated. */
    isAmount: boolean;
    /** Nil figures let the whole line be dropped rather than printed as ₹0. */
    isZeroAmount: boolean;
}

const amount = (raw?: number, type?: 'Dr' | 'Cr'): Slot => ({
    value: formatBalanceText(raw, type),
    isAmount: true,
    isZeroAmount: !raw || Number(raw) === 0,
});

const text = (value?: string): Slot => ({
    value: value || '',
    isAmount: false,
    isZeroAmount: false,
});

/**
 * The two roll-ups the sheet carries in its own columns, worked out from the
 * buckets when it does not.
 *
 * ">90 days" is the figure the follow-up templates are written around — the
 * money that has stopped moving — and it is 91-135 plus >135. A reminder that
 * lists the buckets separately makes the customer add them up; the escalation
 * templates need to state the one number.
 *
 * A roll-up is a credit only when every bucket feeding it is, otherwise a small
 * advance against one bucket would flip the whole line to "Cr (Excess)".
 */
const rollUp = (parts: { value?: number; type?: 'Dr' | 'Cr' }[], stated?: number, statedType?: 'Dr' | 'Cr'): Slot => {
    if (stated !== undefined && stated !== null) return amount(stated, statedType);
    const owing = parts.filter(p => Number(p.value) > 0);
    const sum = owing.reduce((acc, p) => acc + Number(p.value || 0), 0);
    const allCredit = owing.length > 0 && owing.every(p => p.type === 'Cr');
    return amount(sum, allCredit ? 'Cr' : 'Dr');
};

/** Ways people write the rupee in front of a figure, longest first so "Rs." wins over "Rs". */
const CURRENCY_PREFIXES = ['₹ ', '₹', 'Rs. ', 'Rs.', 'Rs ', 'Rs', 'INR ', 'INR'];

export function renderTemplate(
    content: string,
    customer: Outstanding,
    recipient: TemplateRecipient,
): string {
    const slots: Record<string, Slot> = {
        '{{companyName}}': text(customer.company),
        '{{contactPerson}}': text(recipient.name),
        '{{contactNumber}}': text(recipient.number),
        '{{totalDue}}': amount(customer.total, customer.totalType),
        '{{ageing1_45}}': amount(customer.ageing?.['1-45'], customer.ageingTypes?.['1-45']),
        '{{ageing46_90}}': amount(customer.ageing?.['46-90'], customer.ageingTypes?.['46-90']),
        '{{ageing91_135}}': amount(customer.ageing?.['91-135'], customer.ageingTypes?.['91-135']),
        '{{ageingOver135}}': amount(customer.ageing?.['>135'], customer.ageingTypes?.['>135']),
        '{{totalOver90}}': rollUp(
            [
                { value: customer.ageing?.['91-135'], type: customer.ageingTypes?.['91-135'] },
                { value: customer.ageing?.['>135'], type: customer.ageingTypes?.['>135'] },
            ],
            customer.over90,
            customer.over90Type,
        ),
        '{{dueOver45}}': rollUp(
            [
                { value: customer.ageing?.['46-90'], type: customer.ageingTypes?.['46-90'] },
                { value: customer.ageing?.['91-135'], type: customer.ageingTypes?.['91-135'] },
                { value: customer.ageing?.['>135'], type: customer.ageingTypes?.['>135'] },
            ],
            customer.dueOver45,
            customer.dueOver45Type,
        ),
    };

    const entries = Object.entries(slots);

    let body = content;
    for (const [placeholder, slot] of entries) {
        if (!slot.isAmount) continue;
        for (const prefix of CURRENCY_PREFIXES) {
            body = body.split(prefix + placeholder).join(placeholder);
        }
    }

    const kept = body.split('\n').filter(line => {
        const onThisLine = entries.filter(([placeholder]) => line.includes(placeholder));
        if (!onThisLine.length) return true;
        // Keep the total even at zero — a reminder missing "Total Due" entirely
        // leaves the customer guessing what it is about.
        if (onThisLine.some(([placeholder]) => placeholder === '{{totalDue}}')) return true;
        if (onThisLine.some(([, slot]) => !slot.isAmount)) return true;
        return !onThisLine.every(([, slot]) => slot.isZeroAmount);
    });

    return kept
        .map(line =>
            entries.reduce(
                (acc, [placeholder, slot]) => acc.split(placeholder).join(slot.value),
                line,
            ),
        )
        .join('\n')
        // Dropping every bucket can leave a heading stranded above a blank run.
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
