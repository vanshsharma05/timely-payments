import { requireSupabase, supabase } from './supabaseClient';
import {
    Outstanding,
    PdcCheque,
    PdcStatus,
    Template,
    User,
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
    const { data, error } = await requireSupabase()
        .from('customers')
        .select('*')
        .order('company', { ascending: true });
    fail('Could not load customers', error);
    return (data || []).map(rowToOutstanding);
}

export async function upsertCustomer(c: Outstanding): Promise<void> {
    const { error } = await requireSupabase().from('customers').upsert(outstandingToRow(c));
    fail('Could not save customer', error);
}

/** Used by the Google Sheet import; chunked so large sheets don't time out. */
export async function upsertCustomers(list: Outstanding[]): Promise<void> {
    const db = requireSupabase();
    await inChunks(list.map(outstandingToRow), async (chunk) => {
        const { error } = await db.from('customers').upsert(chunk);
        fail('Could not import customers', error);
    });
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
    const { data, error } = await requireSupabase()
        .from('pdc_cheques')
        .select('*')
        .order('cheque_date', { ascending: true });
    fail('Could not load PDC cheques', error);
    return (data || []).map(rowToPdc);
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

/** Admin-only: update an existing teammate's role, permissions or assignments. */
export async function updateUserProfile(user: User): Promise<void> {
    const { error } = await requireSupabase()
        .from('profiles')
        .update({
            name: user.name,
            role: user.role,
            data_visibility: user.dataVisibility ?? DataVisibility.AssignedOnly,
            permissions: user.permissions ?? DEFAULT_ROLE_PERMISSIONS[user.role],
            assigned_crms: user.assignedCrms ?? [],
        })
        .eq('legacy_id', user.id);
    fail('Could not update user', error);
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
