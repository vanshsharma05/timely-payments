import { SupabaseClient } from '@supabase/supabase-js';

/**
 * The daily reminder.
 *
 * Each person gets the accounts they are actually responsible for: what was
 * promised for today, what has slipped past its date, which cheques are ready
 * to present, and what nobody has scheduled at all. Whoever reads the whole
 * book also gets a line per CRM, so a manager can see where the work is stuck
 * without opening the app.
 *
 * The scoping rules are the same ones getOutstandingForUser() applies in the
 * browser, restated here against the database's column names.
 */

const PAGE = 1000;

export interface Recipient {
    authId: string;
    legacyId: string;
    name: string;
    email: string | null;
    role: string;
    dataVisibility: string;
    assignedCrms: string[];
    permissions: Record<string, boolean> | null;
}

interface CustomerRow {
    id: string;
    company: string;
    contact_person: string | null;
    contact_number: string | null;
    total: number | null;
    total_type: string | null;
    crm_owner_id: string | null;
    assigned_collector_id: string | null;
    follow_up_date: string | null;
    forecast_amount: number | null;
    forecast_date: string | null;
    status: string | null;
    notes: string[] | null;
    is_urgent: boolean | null;
    over90: number | null;
    due_over45: number | null;
}

interface ChequeRow {
    id: string;
    customer_id: string | null;
    customer_name: string | null;
    cheque_number: string | null;
    bank_name: string | null;
    amount: number | null;
    cheque_date: string | null;
    status: string | null;
    crm_owner_id: string | null;
}

/** An unanswered promise, joined to the account it was made on. */
export interface PromiseRow {
    id: string;
    customer_id: string;
    company: string;
    author_name: string;
    body: string;
    promised_amount: number | null;
    promised_on: string;
}

export interface Digest {
    recipient: Recipient;
    dueToday: CustomerRow[];
    overdue: CustomerRow[];
    promisedToday: CustomerRow[];
    /** Someone said they would pay today, and nobody has recorded the outcome. */
    promisesDue: PromiseRow[];
    /** The day came and went with no answer either way. */
    promisesBroken: PromiseRow[];
    chequesToday: ChequeRow[];
    noFollowUpCount: number;
    noFollowUpValue: number;
    bookValue: number;
    bookCount: number;
    /** Only for people who read the whole book. */
    perCrm: { crm: string; due: number; overdue: number; unattended: number; value: number }[];
    taskCount: number;
}

/* ------------------------------- helpers -------------------------------- */

const startOfDay = (d: Date) => {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
};

const sameDay = (iso: string | null, day: Date) => {
    if (!iso) return false;
    const d = startOfDay(new Date(iso));
    return d.getTime() === day.getTime();
};

const beforeDay = (iso: string | null, day: Date) => {
    if (!iso) return false;
    return startOfDay(new Date(iso)).getTime() < day.getTime();
};

const money = (n: number | null | undefined): string => {
    const v = Math.round(Math.abs(Number(n) || 0));
    const s = v.toString();
    if (s.length <= 3) return '₹' + s;
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    return '₹' + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
};

const compact = (n: number | null | undefined): string => {
    const v = Math.abs(Number(n) || 0);
    if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;
    if (v >= 100000) return `₹${(v / 100000).toFixed(1)} L`;
    return money(v);
};

const owes = (c: CustomerRow) => (c.total_type === 'Cr' ? 0 : Number(c.total) || 0);

async function fetchAll<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await db.from(table).select(columns).order('id').range(from, from + PAGE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        if (!data?.length) break;
        rows.push(...(data as T[]));
        if (data.length < PAGE) break;
    }
    return rows;
}

function seesWholeBook(r: Recipient): boolean {
    return (
        r.role === 'Admin' ||
        r.role === 'Manager' ||
        r.role === 'Viewer' ||
        r.dataVisibility === 'All' ||
        Boolean(r.permissions?.canViewAllCrms)
    );
}

const key = (v?: string | null): string => (v || '').trim().toUpperCase();

/**
 * Mirrors getOutstandingForUser() in the browser: an account reaches someone's
 * digest if they own it as CRM or are the collector working it. Scoping on one
 * field only means a handover silently empties somebody's morning email.
 */
function scopeFor(r: Recipient, customers: CustomerRow[]): CustomerRow[] {
    if (seesWholeBook(r)) return customers;

    const mine = new Set([key(r.legacyId), key(r.name)].filter(Boolean));
    const allowed = new Set((r.assignedCrms || []).map(key).filter(Boolean));

    return customers.filter(c => {
        const owner = key(c.crm_owner_id);
        const collector = key(c.assigned_collector_id);
        return mine.has(owner) || mine.has(collector) || allowed.has(owner);
    });
}

/* ------------------------------- building ------------------------------- */

export async function loadRecipients(db: SupabaseClient): Promise<Recipient[]> {
    const { data, error } = await db
        .from('profiles')
        .select('id, legacy_id, name, email, role, data_visibility, assigned_crms, permissions');
    if (error) throw new Error(`profiles: ${error.message}`);
    return (data || []).map(p => ({
        authId: p.id,
        legacyId: p.legacy_id,
        name: p.name || p.legacy_id,
        email: p.email,
        role: p.role,
        dataVisibility: p.data_visibility,
        assignedCrms: p.assigned_crms || [],
        permissions: p.permissions || null,
    }));
}

export async function buildDigests(db: SupabaseClient, recipients: Recipient[]): Promise<Digest[]> {
    const today = startOfDay(new Date());

    const customers = await fetchAll<CustomerRow>(
        db,
        'customers',
        'id, company, contact_person, contact_number, total, total_type, crm_owner_id, assigned_collector_id, follow_up_date, forecast_amount, forecast_date, status, notes, is_urgent, over90, due_over45'
    );
    const cheques = await fetchAll<ChequeRow>(
        db,
        'pdc_cheques',
        'id, customer_id, customer_name, cheque_number, bank_name, amount, cheque_date, status, crm_owner_id'
    );

    // Promises recorded on the account, and the entries that answered them. A
    // promise nobody has answered is still owed, whatever the follow-up date on
    // the account happens to say.
    const activity = await fetchAll<{
        id: string; customer_id: string; author_name: string; kind: string;
        body: string; promised_amount: number | null; promised_on: string | null;
        resolves_id: string | null;
    }>(db, 'customer_activity', 'id, customer_id, author_name, kind, body, promised_amount, promised_on, resolves_id');

    const answered = new Set(activity.map(a => a.resolves_id).filter(Boolean) as string[]);
    const companyOf = new Map(customers.map(c => [c.id, c.company]));
    const openPromises: PromiseRow[] = activity
        .filter(a => a.kind === 'promise' && a.promised_on && !answered.has(a.id))
        .map(a => ({
            id: a.id,
            customer_id: a.customer_id,
            company: companyOf.get(a.customer_id) || 'Unknown account',
            author_name: a.author_name,
            body: a.body,
            promised_amount: a.promised_amount,
            promised_on: a.promised_on as string,
        }));

    const byValue = (a: CustomerRow, b: CustomerRow) => owes(b) - owes(a);

    return recipients.map(recipient => {
        const mine = scopeFor(recipient, customers);
        const open = mine.filter(c => c.status !== 'Completed');

        const dueToday = open.filter(c => sameDay(c.follow_up_date, today)).sort(byValue);
        const overdue = open.filter(c => beforeDay(c.follow_up_date, today)).sort(byValue);
        const promisedToday = open
            .filter(c => Number(c.forecast_amount) > 0 && sameDay(c.forecast_date || c.follow_up_date, today))
            .sort((a, b) => Number(b.forecast_amount) - Number(a.forecast_amount));
        const noFollowUp = open.filter(c => !c.follow_up_date);

        const mineIds = new Set(mine.map(c => c.id));

        const myPromises = openPromises.filter(p => mineIds.has(p.customer_id));
        const byPromised = (a: PromiseRow, b: PromiseRow) =>
            Number(b.promised_amount || 0) - Number(a.promised_amount || 0);
        const promisesDue = myPromises.filter(p => sameDay(p.promised_on, today)).sort(byPromised);
        const promisesBroken = myPromises
            .filter(p => beforeDay(p.promised_on, today))
            .sort((a, b) => a.promised_on.localeCompare(b.promised_on));
        const chequesToday = cheques.filter(q => {
            const ready = q.status === 'Pending' || q.status === 'DueToday';
            if (!ready || !sameDay(q.cheque_date, today)) return false;
            if (seesWholeBook(recipient)) return true;
            return mineIds.has(q.customer_id || '');
        });

        const perCrm: Digest['perCrm'] = [];
        if (seesWholeBook(recipient)) {
            const map = new Map<string, { due: number; overdue: number; unattended: number; value: number }>();
            for (const c of open) {
                const key = (c.crm_owner_id || '').trim() || 'Unassigned';
                const row = map.get(key) || { due: 0, overdue: 0, unattended: 0, value: 0 };
                if (sameDay(c.follow_up_date, today)) row.due++;
                else if (beforeDay(c.follow_up_date, today)) row.overdue++;
                else if (!c.follow_up_date) row.unattended++;
                row.value += owes(c);
                map.set(key, row);
            }
            for (const [crm, row] of map) perCrm.push({ crm, ...row });
            perCrm.sort((a, b) => b.overdue - a.overdue || b.value - a.value);
        }

        return {
            recipient,
            dueToday,
            overdue,
            promisedToday,
            promisesDue,
            promisesBroken,
            chequesToday,
            noFollowUpCount: noFollowUp.length,
            noFollowUpValue: noFollowUp.reduce((s, c) => s + owes(c), 0),
            bookValue: mine.reduce((s, c) => s + owes(c), 0),
            // Accounts that owe something. The Customer Master sheet puts the
            // whole customer list on the book, most of it settled; counting that
            // told people they were carrying thousands of accounts.
            bookCount: mine.filter(c => Math.abs(Number(c.total) || 0) > 0).length,
            perCrm,
            taskCount:
                dueToday.length + overdue.length + chequesToday.length +
                promisesDue.length + promisesBroken.length,
        };
    });
}

/* ------------------------------- rendering ------------------------------ */

const NAVY = '#173A66';
const YELLOW = '#FCF000';
const INK = '#15171C';
const MUTED = '#5D616B';
const LINE = '#E3E5EC';
const DANG = '#B6263A';
const WARN = '#865609';
const POS = '#0D6F4D';

const esc = (s: string | null | undefined) =>
    (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function customerRows(list: CustomerRow[], accent: string, limit = 12): string {
    return list
        .slice(0, limit)
        .map(
            c => `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid ${LINE};font-size:14px;color:${INK};">
          <strong>${esc(c.company)}</strong>${c.is_urgent ? ` <span style="color:${DANG};font-size:11px;font-weight:700;">URGENT</span>` : ''}
          <div style="color:${MUTED};font-size:12px;margin-top:2px;">
            ${esc(c.contact_person) || 'No contact'}${c.contact_number ? ' · ' + esc(c.contact_number) : ''}
          </div>
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid ${LINE};font-size:14px;color:${accent};font-weight:700;text-align:right;white-space:nowrap;">
          ${compact(owes(c))}
        </td>
      </tr>`
        )
        .join('');
}

function section(title: string, count: number, accent: string, body: string, note?: string): string {
    if (!body) return '';
    return `
    <tr><td style="padding:22px 24px 0 24px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${accent};">
        ${esc(title)} · ${count}
      </div>
      ${note ? `<div style="font-size:12.5px;color:${MUTED};margin-top:4px;">${esc(note)}</div>` : ''}
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;border-collapse:collapse;">
        ${body}
      </table>
    </td></tr>`;
}

export function renderDigest(d: Digest, appUrl: string): { subject: string; html: string; text: string } {
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const first = (d.recipient.name || '').split(/\s+/)[0] || 'there';

    const headline =
        d.taskCount === 0
            ? 'Nothing needs chasing today'
            : `${d.taskCount} thing${d.taskCount === 1 ? '' : 's'} to chase today`;

    // The subject has to agree with the body. Counting only follow-up dates
    // meant an email listing three promises to chase announced itself as
    // "0 due today, 0 overdue".
    const subject = (() => {
        if (d.taskCount === 0) return 'Timely Payment · nothing due today';
        const parts: string[] = [];
        const due = d.dueToday.length + d.promisesDue.length;
        if (due) parts.push(`${due} due today`);
        if (d.overdue.length) parts.push(`${d.overdue.length} overdue`);
        if (d.promisesBroken.length) parts.push(`${d.promisesBroken.length} promise${d.promisesBroken.length === 1 ? '' : 's'} unanswered`);
        if (d.chequesToday.length) parts.push(`${d.chequesToday.length} cheque${d.chequesToday.length === 1 ? '' : 's'}`);
        return `Timely Payment · ${parts.join(', ')}`;
    })();

    const chequeRows = d.chequesToday
        .map(
            q => `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid ${LINE};font-size:14px;color:${INK};">
          <strong>${esc(q.customer_name)}</strong>
          <div style="color:${MUTED};font-size:12px;margin-top:2px;">
            Cheque ${esc(q.cheque_number)}${q.bank_name ? ' · ' + esc(q.bank_name) : ''}
          </div>
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid ${LINE};font-size:14px;color:${POS};font-weight:700;text-align:right;white-space:nowrap;">
          ${compact(q.amount)}
        </td>
      </tr>`
        )
        .join('');

    // A promise reads better with who took it and what was said — that is the
    // context the person ringing today actually needs.
    const promiseRows = (list: PromiseRow[], tint: string) =>
        list
            .map(p => {
                const said = p.body ? esc(p.body.slice(0, 90)) : '';
                const taken = `taken by ${esc(p.author_name)} · due ${esc(
                    new Date(p.promised_on).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                )}`;
                return `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid ${LINE};font-size:14px;color:${INK};">
          <strong>${esc(p.company)}</strong>
          <div style="color:${MUTED};font-size:12px;margin-top:2px;">${taken}</div>
          ${said ? `<div style="color:${MUTED};font-size:12px;margin-top:2px;font-style:italic;">&ldquo;${said}&rdquo;</div>` : ''}
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid ${LINE};font-size:14px;color:${tint};font-weight:700;text-align:right;white-space:nowrap;">
          ${p.promised_amount ? compact(p.promised_amount) : '—'}
        </td>
      </tr>`;
            })
            .join('');

    const promisedRows = d.promisedToday
        .map(
            c => `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid ${LINE};font-size:14px;color:${INK};">
          <strong>${esc(c.company)}</strong>
          <div style="color:${MUTED};font-size:12px;margin-top:2px;">promised for today</div>
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid ${LINE};font-size:14px;color:${POS};font-weight:700;text-align:right;white-space:nowrap;">
          ${compact(c.forecast_amount)}
        </td>
      </tr>`
        )
        .join('');

    const perCrmRows = d.perCrm
        .slice(0, 12)
        .map(
            r => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid ${LINE};font-size:13.5px;color:${INK};">${esc(r.crm)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${LINE};font-size:13.5px;text-align:right;">${r.due}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${LINE};font-size:13.5px;text-align:right;color:${r.overdue ? DANG : MUTED};font-weight:${r.overdue ? 700 : 400};">${r.overdue}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${LINE};font-size:13.5px;text-align:right;color:${r.unattended ? WARN : MUTED};">${r.unattended}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${LINE};font-size:13.5px;text-align:right;white-space:nowrap;">${compact(r.value)}</td>
      </tr>`
        )
        .join('');

    const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#F1F3F7;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F1F3F7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="620" style="max-width:620px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;">

        <tr><td style="background:${NAVY};padding:24px;border-bottom:4px solid ${YELLOW};">
          <div style="color:#FFFFFF;font-size:19px;font-weight:800;letter-spacing:-.02em;">Timely Payment</div>
          <div style="color:#B9C6DA;font-size:12.5px;margin-top:3px;">Shori Chemicals · ${esc(today)}</div>
        </td></tr>

        <tr><td style="padding:24px 24px 0 24px;">
          <div style="font-size:15px;color:${INK};">Good morning ${esc(first)},</div>
          <div style="font-size:22px;font-weight:800;color:${INK};letter-spacing:-.02em;margin-top:6px;">${esc(headline)}</div>
          <div style="font-size:13.5px;color:${MUTED};margin-top:6px;">
            You are carrying ${d.bookCount} account${d.bookCount === 1 ? '' : 's'} worth ${compact(d.bookValue)}.
          </div>
        </td></tr>

        ${section('Due today', d.dueToday.length, NAVY, customerRows(d.dueToday, NAVY))}
        ${section('Past their promised date', d.overdue.length, DANG, customerRows(d.overdue, DANG), 'Oldest promises first — these cost the most.')}
        ${section('They said they would pay today', d.promisesDue.length, NAVY, promiseRows(d.promisesDue, NAVY), 'Ring these and record what they say.')}
        ${section('Promised, and the day passed', d.promisesBroken.length, DANG, promiseRows(d.promisesBroken, DANG), 'Nobody has recorded whether the money arrived.')}
        ${section('Cheques to present today', d.chequesToday.length, POS, chequeRows)}
        ${section('Money promised for today', d.promisedToday.length, POS, promisedRows)}
        ${
            d.noFollowUpCount
                ? `<tr><td style="padding:22px 24px 0 24px;">
                     <div style="background:#FCF1DA;border-radius:12px;padding:14px 16px;">
                       <div style="font-size:13.5px;color:${WARN};font-weight:700;">
                         ${d.noFollowUpCount} account${d.noFollowUpCount === 1 ? '' : 's'} with no follow-up planned
                       </div>
                       <div style="font-size:12.5px;color:${MUTED};margin-top:3px;">${compact(d.noFollowUpValue)} sitting unattended.</div>
                     </div>
                   </td></tr>`
                : ''
        }
        ${
            perCrmRows
                ? `<tr><td style="padding:22px 24px 0 24px;">
                     <div style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${NAVY};">By CRM</div>
                     <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;border-collapse:collapse;">
                       <tr>
                         <th align="left" style="padding:6px 12px;font-size:11.5px;color:${MUTED};text-transform:uppercase;letter-spacing:.05em;">CRM</th>
                         <th align="right" style="padding:6px 12px;font-size:11.5px;color:${MUTED};text-transform:uppercase;letter-spacing:.05em;">Today</th>
                         <th align="right" style="padding:6px 12px;font-size:11.5px;color:${MUTED};text-transform:uppercase;letter-spacing:.05em;">Overdue</th>
                         <th align="right" style="padding:6px 12px;font-size:11.5px;color:${MUTED};text-transform:uppercase;letter-spacing:.05em;">No plan</th>
                         <th align="right" style="padding:6px 12px;font-size:11.5px;color:${MUTED};text-transform:uppercase;letter-spacing:.05em;">Book</th>
                       </tr>
                       ${perCrmRows}
                     </table>
                   </td></tr>`
                : ''
        }

        <tr><td style="padding:26px 24px 28px 24px;">
          <a href="${esc(appUrl)}" style="display:inline-block;background:${NAVY};color:#FFFFFF;text-decoration:none;font-size:14.5px;font-weight:700;padding:12px 22px;border-radius:999px;">
            Open the collections book
          </a>
        </td></tr>

        <tr><td style="padding:0 24px 24px 24px;border-top:1px solid ${LINE};">
          <div style="font-size:11.5px;color:${MUTED};padding-top:14px;">
            Sent once a day by Timely Payment. An Admin can turn this off under Settings → Alerts &amp; reminders.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    const lines: string[] = [
        `Timely Payment — ${today}`,
        '',
        `Good morning ${first}, ${headline.toLowerCase()}.`,
        `You are carrying ${d.bookCount} accounts worth ${compact(d.bookValue)}.`,
    ];
    const listOut = (title: string, items: string[]) => {
        if (!items.length) return;
        lines.push('', `${title}:`);
        items.slice(0, 12).forEach(i => lines.push(`  - ${i}`));
    };
    listOut('Due today', d.dueToday.map(c => `${c.company} — ${compact(owes(c))}`));
    listOut('Past their promised date', d.overdue.map(c => `${c.company} — ${compact(owes(c))}`));
    listOut('They said they would pay today', d.promisesDue.map(p =>
        `${p.company} — ${p.promised_amount ? compact(p.promised_amount) : 'amount not stated'} (taken by ${p.author_name})`));
    listOut('Promised, and the day passed', d.promisesBroken.map(p =>
        `${p.company} — ${p.promised_amount ? compact(p.promised_amount) : 'amount not stated'}, due ${p.promised_on}`));
    listOut('Cheques to present today', d.chequesToday.map(q => `${q.customer_name} — ${compact(q.amount)} (${q.cheque_number})`));
    listOut('Promised for today', d.promisedToday.map(c => `${c.company} — ${compact(c.forecast_amount)}`));
    if (d.noFollowUpCount) {
        lines.push('', `${d.noFollowUpCount} accounts have no follow-up planned (${compact(d.noFollowUpValue)}).`);
    }
    lines.push('', appUrl);

    return { subject, html, text: lines.join('\n') };
}
