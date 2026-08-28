import { requireSupabase, supabase } from './supabaseClient';
import {
    ActivityEntry,
    ActivityKind,
    AlertLogEntry,
    AlertSettings,
    Outstanding,
    PdcCheque,
    PdcStatus,
    Template,
    User,
    UserPermissions,
    UserRole,
    DataVisibility,
    CompanyProfile,
    FollowUpStatus,
    BalanceType,
    DEFAULT_ROLE_PERMISSIONS,
} from '../types';

/**
 * Data access layer. Everything the app used to keep in localStorage lives
 * here instead, so all users of the deployed app share one dataset.
 *
 * Column names are snake_case in Postgres and camelCase in the app types, so
 * each entity gets an explicit row<->model mapper rather than relying on a
 * generic transform — the shapes differ in more than just casing (ageing and
 * notes are jsonb, dates are timestamptz).
 */

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const toDate = (v: any): Date | undefined => {
    if (!v) return undefined;
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
};

const toIso = (v: any): string | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
};

const num = (v: any): number => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isNaN(n) ? 0 : n;
};

/** Supabase caps a single request; chunk large imports so they don't time out. */
const CHUNK = 500;
async function inChunks<T>(rows: T[], fn: (chunk: T[]) => Promise<void>): Promise<void> {
    for (let i = 0; i < rows.length; i += CHUNK) {
        await fn(rows.slice(i, i + CHUNK));
    }
}

function fail(context: string, error: { message: string } | null): void {
    if (error) throw new Error(`${context}: ${error.message}`);
}

/**
 * Reads a whole table.
 *
 * PostgREST answers a plain select with at most 1000 rows, silently — which had
 * the app showing the first 1000 customers of several thousand as if that were
 * the entire book. Pages through by `id` (unique, so a row can neither be
 * skipped nor repeated between pages) until a short page arrives.
 */
const PAGE = 1000;
async function fetchAllRows(table: string, context: string): Promise<any[]> {
    const db = requireSupabase();
    const rows: any[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await db
            .from(table)
            .select('*')
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        fail(context, error);
        if (!data?.length) break;
        rows.push(...data);
        if (data.length < PAGE) break;
    }
    return rows;
}

// ---------------------------------------------------------------------------
// customers
// ---------------------------------------------------------------------------

export function rowToOutstanding(r: any): Outstanding {
    const ageing = r.ageing || {};
    return {
        id: r.id,
        company: r.company || '',
        contactPerson: r.contact_person || '',
        contactNumber: r.contact_number || '',
        contactPost: r.contact_post || undefined,
        additionalContacts: r.additional_contacts || [],
        email: r.email || undefined,
        city: r.city || undefined,
        state: r.state || undefined,
        address: r.address || undefined,
        gstin: r.gstin || undefined,
        pan: r.pan || undefined,
        creditLimit: r.credit_limit ?? undefined,
        paymentTermsDays: r.payment_terms_days ?? undefined,
        paymentRank: r.payment_rank || undefined,
        total: num(r.total),
        totalType: (r.total_type as BalanceType) || undefined,
        ageing: {
            '1-45': num(ageing['1-45']),
            '46-90': num(ageing['46-90']),
            '91-135': num(ageing['91-135']),
            '>135': num(ageing['>135']),
        },
        ageingTypes: r.ageing_types || undefined,
        over90: r.over90 ?? undefined,
        over90Type: (r.over90_type as BalanceType) || undefined,
        dueOver45: r.due_over45 ?? undefined,
        dueOver45Type: (r.due_over45_type as BalanceType) || undefined,
        crmOwnerId: r.crm_owner_id || '',
        assignedCollectorId: r.assigned_collector_id || undefined,
        followUpDate: toDate(r.follow_up_date),
        forecastAmount: r.forecast_amount ?? undefined,
        forecastDate: toDate(r.forecast_date),
        status: (r.status as FollowUpStatus) || FollowUpStatus.Pending,
        notes: Array.isArray(r.notes) ? r.notes : [],
        isUrgent: !!r.is_urgent,
        isNewCustomer: !!r.is_new_customer,
        addedAt: r.added_at || undefined,
        creationDate: toDate(r.creation_date) || new Date(),
        lastFollowUpOn: toDate(r.last_follow_up_on),
    };
}

export function outstandingToRow(c: Outstanding): Record<string, any> {
    return {
        id: c.id,
        company: c.company,
        contact_person: c.contactPerson ?? '',
        contact_number: c.contactNumber ?? '',
        contact_post: c.contactPost ?? null,
        additional_contacts: c.additionalContacts ?? [],
        email: c.email ?? null,
        city: c.city ?? null,
        state: c.state ?? null,
        address: c.address ?? null,
        gstin: c.gstin ?? null,
        pan: c.pan ?? null,
        credit_limit: c.creditLimit ?? null,
        payment_terms_days: c.paymentTermsDays ?? null,
        payment_rank: c.paymentRank ?? null,
        total: c.total ?? 0,
        total_type: c.totalType ?? null,
        ageing: c.ageing ?? { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 },
        ageing_types: c.ageingTypes ?? {},
        over90: c.over90 ?? null,
        over90_type: c.over90Type ?? null,
        due_over45: c.dueOver45 ?? null,
        due_over45_type: c.dueOver45Type ?? null,
        crm_owner_id: c.crmOwnerId ?? '',
        assigned_collector_id: c.assignedCollectorId ?? null,
        follow_up_date: toIso(c.followUpDate),
        forecast_amount: c.forecastAmount ?? null,
        forecast_date: toIso(c.forecastDate),
        status: c.status ?? FollowUpStatus.Pending,
        notes: c.notes ?? [],
        is_urgent: !!c.isUrgent,
        is_new_customer: !!c.isNewCustomer,
        added_at: c.addedAt ?? null,
        creation_date: toIso(c.creationDate) ?? new Date().toISOString(),
        last_follow_up_on: toIso(c.lastFollowUpOn),
    };
}

export async function fetchCustomers(): Promise<Outstanding[]> {
    const rows = await fetchAllRows('customers', 'Could not load customers');
    return rows
        .map(rowToOutstanding)
        .sort((a, b) => a.company.localeCompare(b.company));
}


/** Used by the Google Sheet import; chunked so large sheets don't time out. */
export async function upsertCustomers(list: Outstanding[]): Promise<void> {
    const db = requireSupabase();
    await inChunks(list.map(outstandingToRow), async (chunk) => {
        const { error } = await db.from('customers').upsert(chunk);
        fail('Could not import customers', error);
    });
}

/**
 * Saves edits to customers that already exist.
 *
 * Deliberately an update rather than an upsert: upserting asks the database for
 * insert rights too, and creating an account is a separate permission from
 * recording a note on one. Rows are written one at a time because PostgREST has
 * no multi-row update, and an edit touches a handful of rows at most.
 */
export async function updateCustomers(list: Outstanding[]): Promise<void> {
    const db = requireSupabase();
    for (const c of list) {
        const row = outstandingToRow(c);
        delete row.id;
        const { error } = await db.from('customers').update(row).eq('id', c.id);
        fail('Could not save customer', error);
    }
}

export async function deleteCustomer(id: string): Promise<void> {
    const { error } = await requireSupabase().from('customers').delete().eq('id', id);
    fail('Could not delete customer', error);
}

// ---------------------------------------------------------------------------
// PDC cheques
// ---------------------------------------------------------------------------

const rowToPdc = (r: any): PdcCheque => ({
    id: r.id,
    customerId: r.customer_id || '',
    customerName: r.customer_name || '',
    chequeNumber: r.cheque_number || '',
    bankName: r.bank_name || '',
    chequeDate: toDate(r.cheque_date) || new Date(),
    amount: num(r.amount),
    status: (r.status as PdcStatus) || PdcStatus.Pending,
    receivedDate: toDate(r.received_date) || new Date(),
    clearedDate: toDate(r.cleared_date),
    remarks: r.remarks || undefined,
    crmOwnerId: r.crm_owner_id || undefined,
    addedBy: r.added_by || undefined,
});

const pdcToRow = (p: PdcCheque): Record<string, any> => ({
    id: p.id,
    customer_id: p.customerId || null,
    customer_name: p.customerName ?? '',
    cheque_number: p.chequeNumber ?? '',
    bank_name: p.bankName ?? '',
    cheque_date: toIso(p.chequeDate),
    amount: p.amount ?? 0,
    status: p.status ?? PdcStatus.Pending,
    received_date: toIso(p.receivedDate),
    cleared_date: toIso(p.clearedDate),
    remarks: p.remarks ?? null,
    crm_owner_id: p.crmOwnerId ?? null,
    added_by: p.addedBy ?? null,
});

export async function fetchPdcCheques(): Promise<PdcCheque[]> {
    const rows = await fetchAllRows('pdc_cheques', 'Could not load PDC cheques');
    return rows
        .map(rowToPdc)
        .sort((a, b) => a.chequeDate.getTime() - b.chequeDate.getTime());
}

export async function upsertPdcCheque(p: PdcCheque): Promise<void> {
    const { error } = await requireSupabase().from('pdc_cheques').upsert(pdcToRow(p));
    fail('Could not save PDC cheque', error);
}

export async function deletePdcCheque(id: string): Promise<void> {
    const { error } = await requireSupabase().from('pdc_cheques').delete().eq('id', id);
    fail('Could not delete PDC cheque', error);
}

// ---------------------------------------------------------------------------
// profiles (users)
// ---------------------------------------------------------------------------

/**
 * `User.id` is deliberately the profile's `legacy_id` (the CRM code from the
 * accounts sheet, e.g. 'ANKUR'), not the auth UUID. That keeps every existing
 * ownership comparison in getOutstandingForUser() working unchanged.
 */
export const rowToUser = (r: any): User & { authId: string } => ({
    authId: r.id,
    id: r.legacy_id,
    name: r.name || r.legacy_id,
    email: r.email || undefined,
    role: (r.role as UserRole) || UserRole.CRM,
    dataVisibility: (r.data_visibility as DataVisibility) || DataVisibility.AssignedOnly,
    permissions:
        r.permissions && Object.keys(r.permissions).length
            ? r.permissions
            : DEFAULT_ROLE_PERMISSIONS[(r.role as UserRole) || UserRole.CRM],
    assignedCrms: r.assigned_crms || [],
});

export async function fetchUsers(): Promise<User[]> {
    const { data, error } = await requireSupabase()
        .from('profiles')
        .select('*')
        .order('name', { ascending: true });
    fail('Could not load users', error);
    return (data || []).map(rowToUser);
}

/** Returns the signed-in user's profile, or null when not signed in. */
export async function fetchCurrentProfile(): Promise<User | null> {
    if (!supabase) return null;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return null;
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', auth.user.id)
        .maybeSingle();
    if (error || !data) return null;
    return rowToUser(data);
}

// ---------------------------------------------------------------------------
// team administration (Team & access)
//
// A teammate is two things: a Supabase Auth login and a profiles row. Only the
// service role key can create a login, and that key never reaches the browser,
// so every change goes through /api/team, which checks the caller is an Admin
// before it touches anything.
// ---------------------------------------------------------------------------

export interface TeamMemberInput {
    /** CRM code (profiles.legacy_id). Fixed once the teammate exists. */
    id: string;
    name: string;
    email?: string;
    /** Only when setting or changing it. */
    password?: string;
    role: UserRole;
    dataVisibility: DataVisibility;
    permissions: UserPermissions;
    assignedCrms?: string[];
}

/** Thrown when /api/team cannot be reached or is not configured. */
class TeamApiUnavailable extends Error {}

const toPayload = (u: TeamMemberInput) => ({
    id: u.id.trim(),
    name: u.name.trim(),
    email: u.email?.trim() ? u.email.trim().toLowerCase() : undefined,
    password: u.password || undefined,
    role: u.role,
    dataVisibility: u.dataVisibility,
    permissions: u.permissions,
    assignedCrms: u.assignedCrms ?? [],
});

async function callTeamApi(action: 'create' | 'update' | 'delete', user: unknown): Promise<void> {
    const auth = await authHeaders();
    if (!auth.Authorization) throw new Error('Your session has expired. Sign in again.');

    let response: Response;
    try {
        response = await fetch('/api/team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...auth },
            body: JSON.stringify({ action, user }),
        });
    } catch {
        throw new TeamApiUnavailable('The server could not be reached. Check your connection and try again.');
    }

    // A host with no API routes answers with the app's index.html, which is not
    // JSON — treat anything unparseable as "this deployment has no endpoint".
    let payload: any = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (response.ok && payload?.ok) return;
    if (!payload || response.status === 404 || payload.code === 'service_key_missing') {
        throw new TeamApiUnavailable(
            'Accounts cannot be managed on this deployment: the server has no Supabase service role key. ' +
                'Set SUPABASE_SERVICE_ROLE_KEY and redeploy.'
        );
    }
    throw new Error(payload.error || `Could not save the teammate (HTTP ${response.status}).`);
}

/** Creates the login and the profile. Returns once the teammate really exists. */
export async function createTeamMember(input: TeamMemberInput): Promise<void> {
    if (!input.email?.trim()) {
        throw new Error('An email address is required — it is what the teammate signs in with.');
    }
    if (!input.password || input.password.length < 8) {
        throw new Error('Set a password of at least 8 characters for the new teammate.');
    }
    await callTeamApi('create', toPayload(input));
}

/** Saves role, rights and login details of an existing teammate. */
export async function updateTeamMember(input: TeamMemberInput): Promise<void> {
    if (input.password && input.password.length < 8) {
        throw new Error('A new password must be at least 8 characters.');
    }
    await callTeamApi('update', toPayload(input));
}

/** Removes a teammate's access, login and profile together. */
export async function deleteTeamMember(legacyId: string): Promise<void> {
    await callTeamApi('delete', { id: legacyId });
}

/**
 * Changes the signed-in user's own password. Supabase requires a live session,
 * so this works for every role without touching the service key.
 */
export async function changeOwnPassword(newPassword: string): Promise<void> {
    if (newPassword.length < 8) throw new Error('Use at least 8 characters.');
    const { error } = await requireSupabase().auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
}


// ---------------------------------------------------------------------------
// alerts and reminders
// ---------------------------------------------------------------------------

export async function fetchAlertSettings(): Promise<AlertSettings> {
    const { data, error } = await requireSupabase()
        .from('alert_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
    fail('Could not load the reminder settings', error);
    return {
        dailyEmail: Boolean(data?.daily_email),
        recipientRoles: (data?.recipient_roles || []) as UserRole[],
        skipWhenEmpty: data?.skip_when_empty !== false,
        extraRecipients: data?.extra_recipients || [],
    };
}

export async function saveAlertSettings(s: AlertSettings): Promise<void> {
    const { error } = await requireSupabase().from('alert_settings').upsert({
        id: 1,
        daily_email: s.dailyEmail,
        recipient_roles: s.recipientRoles,
        skip_when_empty: s.skipWhenEmpty,
        extra_recipients: s.extraRecipients,
    });
    fail('Could not save the reminder settings', error);
}

export async function fetchAlertLog(limit = 12): Promise<AlertLogEntry[]> {
    const { data, error } = await requireSupabase()
        .from('alert_log')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(limit);
    fail('Could not load the reminder history', error);
    return (data || []).map((r: any) => ({
        id: r.id,
        sentAt: r.sent_at,
        kind: r.kind,
        recipients: r.recipients,
        delivered: r.delivered,
        failed: r.failed,
        provider: r.provider,
        detail: r.detail,
        triggeredBy: r.triggered_by,
    }));
}

/** Which email provider the server has, so the panel can say so plainly. */
export async function fetchAlertStatus(): Promise<{ provider: string }> {
    try {
        const res = await fetch('/api/alert-status', { headers: await authHeaders() });
        if (!res.ok) return { provider: 'none' };
        const json = await res.json();
        return { provider: json.provider || 'none' };
    } catch {
        return { provider: 'none' };
    }
}

/** Sends the reminder to the signed-in person only, switch or no switch. */
export async function sendTestReminder(): Promise<{ delivered: number; to: string; detail?: string }> {
    const db = requireSupabase();
    const { data: auth } = await db.auth.getUser();
    const to = auth?.user?.email || '';

    const res = await fetch('/api/daily-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ test: true, to }),
    });
    const json = await res.json().catch(() => null);
    if (!json) throw new Error('The server did not answer. Is the deployment up to date?');
    return { delivered: json.delivered || 0, to, detail: json.detail || json.error };
}

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

export async function fetchTemplates(): Promise<Template[]> {
    const { data, error } = await requireSupabase().from('templates').select('*').order('name');
    fail('Could not load templates', error);
    return (data || []).map((r: any) => ({ id: r.id, name: r.name, content: r.content || '' }));
}

export async function upsertTemplate(t: Template): Promise<void> {
    const { error } = await requireSupabase()
        .from('templates')
        .upsert({ id: t.id, name: t.name, content: t.content });
    fail('Could not save template', error);
}

export async function deleteTemplate(id: string): Promise<void> {
    const { error } = await requireSupabase().from('templates').delete().eq('id', id);
    fail('Could not delete template', error);
}

// ---------------------------------------------------------------------------
// singletons: company profile + app settings
// ---------------------------------------------------------------------------

export async function fetchCompanyProfile(): Promise<CompanyProfile | null> {
    const { data, error } = await requireSupabase()
        .from('company_profile')
        .select('profile')
        .eq('id', 1)
        .maybeSingle();
    if (error || !data?.profile || !Object.keys(data.profile).length) return null;
    return data.profile as CompanyProfile;
}

export async function saveCompanyProfile(profile: CompanyProfile): Promise<void> {
    const { error } = await requireSupabase()
        .from('company_profile')
        .upsert({ id: 1, profile });
    fail('Could not save company profile', error);
}

export interface AppSettings {
    dataSourceMode: 'excel' | 'google';
    googleSheetUrl: string;
    customerMasterSheetUrl: string;
    sheetUpdatedTillDate: string;
    lastSyncTime: string;
}

export async function fetchAppSettings(): Promise<Partial<AppSettings>> {
    const { data, error } = await requireSupabase()
        .from('app_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
    if (error || !data) return {};
    return {
        dataSourceMode: data.data_source_mode,
        googleSheetUrl: data.google_sheet_url || '',
        customerMasterSheetUrl: data.customer_master_sheet_url || '',
        sheetUpdatedTillDate: data.sheet_updated_till_date || '',
        lastSyncTime: data.last_sync_time || '',
    };
}

export async function saveAppSettings(s: Partial<AppSettings>): Promise<void> {
    const row: Record<string, any> = { id: 1 };
    if (s.dataSourceMode !== undefined) row.data_source_mode = s.dataSourceMode;
    if (s.googleSheetUrl !== undefined) row.google_sheet_url = s.googleSheetUrl;
    if (s.customerMasterSheetUrl !== undefined) row.customer_master_sheet_url = s.customerMasterSheetUrl;
    if (s.sheetUpdatedTillDate !== undefined) row.sheet_updated_till_date = s.sheetUpdatedTillDate;
    if (s.lastSyncTime !== undefined) row.last_sync_time = s.lastSyncTime;
    const { error } = await requireSupabase().from('app_settings').upsert(row);
    fail('Could not save settings', error);
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

export async function signIn(email: string, password: string): Promise<User> {
    const db = requireSupabase();
    const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message);
    const profile = await fetchCurrentProfile();
    if (!profile) {
        throw new Error('Signed in, but no profile exists for this account. Ask an Admin to add you.');
    }
    return profile;
}

export async function signOut(): Promise<void> {
    if (supabase) await supabase.auth.signOut();
}

/**
 * Authorization header for this app's own API routes (/api/team,
 * /api/gemini-report). They verify the token server-side, so a request without
 * one is rejected rather than served.
 */
export async function authHeaders(): Promise<Record<string, string>> {
    if (!supabase) return {};
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ----------------------------- activity log ------------------------------ */

const rowToActivity = (r: any): ActivityEntry => ({
    id: r.id,
    customerId: r.customer_id,
    authorId: r.author_id || undefined,
    authorName: r.author_name || 'Unknown',
    kind: r.kind,
    body: r.body || '',
    promisedAmount: r.promised_amount ?? undefined,
    promisedOn: r.promised_on || undefined,
    resolvesId: r.resolves_id || undefined,
    createdAt: r.created_at,
});

/** One customer's thread, oldest first, the way you would read a conversation. */
export async function fetchActivity(customerId: string): Promise<ActivityEntry[]> {
    const { data, error } = await requireSupabase()
        .from('customer_activity')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: true });
    fail('Could not load the activity for this customer', error);
    return (data || []).map(rowToActivity);
}

export interface NewActivity {
    customerId: string;
    kind: ActivityKind;
    body: string;
    promisedAmount?: number;
    promisedOn?: string;
    resolvesId?: string;
}

/**
 * Appends one entry, stamped with the signed-in author and the server's clock.
 *
 * The timestamp is the database default rather than anything the browser sends:
 * a laptop with the wrong date should not be able to file yesterday's call.
 */
export async function addActivity(entry: NewActivity, author: User): Promise<ActivityEntry> {
    const db = requireSupabase();
    const { data: session } = await db.auth.getSession();
    const authorId = session.session?.user?.id;

    const { data, error } = await db
        .from('customer_activity')
        .insert({
            customer_id: entry.customerId,
            author_id: authorId,
            author_name: author.name,
            kind: entry.kind,
            body: entry.body,
            promised_amount: entry.promisedAmount ?? null,
            promised_on: entry.promisedOn || null,
            resolves_id: entry.resolvesId || null,
        })
        .select()
        .single();
    fail('Could not save that entry', error);
    return rowToActivity(data);
}

export async function deleteActivity(id: string): Promise<void> {
    const { error } = await requireSupabase().from('customer_activity').delete().eq('id', id);
    fail('Could not remove that entry', error);
}

/** Loads everything the dashboard needs in one pass. */
export async function loadAll() {
    const [customers, pdcCheques, users, templates, companyProfile, settings] = await Promise.all([
        fetchCustomers(),
        fetchPdcCheques(),
        fetchUsers(),
        fetchTemplates(),
        fetchCompanyProfile(),
        fetchAppSettings(),
    ]);
    return { customers, pdcCheques, users, templates, companyProfile, settings };
}
