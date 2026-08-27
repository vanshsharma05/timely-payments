import { SupabaseClient } from '@supabase/supabase-js';
import { currentProfile, serviceClient } from './supabase.js';

/**
 * Team administration, shared by the local Express dev server (server.ts) and
 * the Vercel serverless function (api/team.ts) so both behave identically.
 *
 * Creating a teammate means creating a Supabase Auth account, and that can only
 * be done with the service role key, which must stay on the server. The browser
 * therefore posts here with the signed-in admin's access token; this module
 * verifies that token really belongs to an Admin before touching anything.
 */

export type TeamAction = 'create' | 'update' | 'delete';

export interface TeamMemberPayload {
    /** profiles.legacy_id — the CRM code used on customer rows ('ANKUR'). */
    id?: string;
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    dataVisibility?: string;
    permissions?: Record<string, boolean>;
    assignedCrms?: string[];
}

export interface TeamRequestBody {
    action?: TeamAction;
    user?: TeamMemberPayload;
}

export interface TeamResponse {
    status: number;
    body: Record<string, unknown>;
}

const ROLES = ['Admin', 'Manager', 'CRM', 'Collector', 'Viewer'];
const VISIBILITIES = ['All', 'AssignedOnly'];

/** Sent when the deployment has no service role key, so the client can fall back. */
const SERVICE_KEY_MISSING: TeamResponse = {
    status: 501,
    body: {
        ok: false,
        code: 'service_key_missing',
        error:
            'SUPABASE_SERVICE_ROLE_KEY is not set on the server, so accounts cannot be created here.',
    },
};

const fail = (status: number, error: string): TeamResponse => ({
    status,
    body: { ok: false, error },
});

/** The columns the app is allowed to set, mapped from the camelCase payload. */
function profileColumns(u: TeamMemberPayload): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    if (u.name !== undefined) row.name = u.name;
    if (u.role !== undefined) row.role = u.role;
    if (u.dataVisibility !== undefined) row.data_visibility = u.dataVisibility;
    if (u.permissions !== undefined) row.permissions = u.permissions;
    if (u.assignedCrms !== undefined) row.assigned_crms = u.assignedCrms;
    if (u.email !== undefined) row.email = u.email;
    return row;
}

function validate(u: TeamMemberPayload, isCreate: boolean): string | null {
    if (isCreate) {
        if (!u.id?.trim()) return 'A CRM code is required.';
        if (!u.name?.trim()) return 'A name is required.';
        if (!u.email?.trim()) {
            return 'An email address is required — it is what the teammate signs in with.';
        }
        if (!u.password || u.password.length < 6) return 'Password must be at least 6 characters.';
    }
    if (u.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email.trim())) {
        return 'That email address does not look valid.';
    }
    if (u.password && u.password.length < 6) {
        return 'Password must be at least 6 characters.';
    }
    if (u.role !== undefined && !ROLES.includes(u.role)) return `Unknown role "${u.role}".`;
    if (u.dataVisibility !== undefined && !VISIBILITIES.includes(u.dataVisibility)) {
        return `Unknown data visibility "${u.dataVisibility}".`;
    }
    return null;
}

export async function handleTeamRequest(
    body: TeamRequestBody,
    accessToken: string
): Promise<TeamResponse> {
    const svc = serviceClient();
    if (!svc) return SERVICE_KEY_MISSING;
    if (!accessToken) return fail(401, 'Not signed in.');

    // --- the caller must be a signed-in Admin -------------------------------
    const caller = await currentProfile(accessToken);
    if (!caller) return fail(401, 'Your session has expired. Sign in again.');
    if (caller.role !== 'Admin') return fail(403, 'Only an Admin can manage team accounts.');

    const action = body?.action;
    const user = body?.user || {};

    if (action === 'create') return createMember(svc, user);
    if (action === 'update') return updateMember(svc, user);
    if (action === 'delete') return deleteMember(svc, user, caller.authId);
    return fail(400, `Unknown action "${action}".`);
}

async function createMember(svc: SupabaseClient, u: TeamMemberPayload): Promise<TeamResponse> {
    const invalid = validate(u, true);
    if (invalid) return fail(400, invalid);

    const legacyId = u.id!.trim();
    const email = u.email!.trim().toLowerCase();

    const { data: clash } = await svc
        .from('profiles')
        .select('legacy_id')
        .eq('legacy_id', legacyId)
        .maybeSingle();
    if (clash) return fail(409, `The CRM code "${legacyId}" already belongs to another teammate.`);

    const { data: created, error: createError } = await svc.auth.admin.createUser({
        email,
        password: u.password,
        email_confirm: true, // an Admin set the password, so skip the confirmation mail
        user_metadata: { name: u.name, legacy_id: legacyId, role: u.role },
    });
    if (createError || !created?.user) {
        return fail(400, createError?.message || 'Could not create the account.');
    }

    // The schema's on_auth_user_created trigger inserts the profile; upserting
    // keeps this working on a database where that trigger is missing, and lets
    // the permission matrix from the form win over the trigger's defaults.
    const { error: profileError } = await svc.from('profiles').upsert({
        id: created.user.id,
        legacy_id: legacyId,
        ...profileColumns({ ...u, email }),
    });
    if (profileError) {
        // Never leave a login behind that has no profile to sign in with.
        await svc.auth.admin.deleteUser(created.user.id);
        return fail(400, `Account created but its profile failed to save: ${profileError.message}`);
    }

    return { status: 200, body: { ok: true, id: legacyId } };
}

async function updateMember(svc: SupabaseClient, u: TeamMemberPayload): Promise<TeamResponse> {
    const invalid = validate(u, false);
    if (invalid) return fail(400, invalid);
    if (!u.id?.trim()) return fail(400, 'Missing the teammate to update.');

    const legacyId = u.id.trim();
    const { data: profile } = await svc
        .from('profiles')
        .select('id')
        .eq('legacy_id', legacyId)
        .maybeSingle();
    if (!profile) return fail(404, `No teammate found with the CRM code "${legacyId}".`);

    const email = u.email?.trim() ? u.email.trim().toLowerCase() : undefined;
    const columns = profileColumns({ ...u, email: undefined });
    if (Object.keys(columns).length) {
        const { error } = await svc.from('profiles').update(columns).eq('id', profile.id);
        if (error) return fail(400, `Could not update the profile: ${error.message}`);
    }

    // Credentials live in auth, not in profiles.
    if (u.password || email) {
        const attrs: Record<string, unknown> = {};
        if (u.password) attrs.password = u.password;
        if (email) {
            attrs.email = email;
            attrs.email_confirm = true;
        }
        const { error } = await svc.auth.admin.updateUserById(profile.id, attrs);
        if (error) {
            return fail(400, `Profile saved, but the login could not be updated: ${error.message}`);
        }
        if (email) await svc.from('profiles').update({ email }).eq('id', profile.id);
    }

    return { status: 200, body: { ok: true, id: legacyId } };
}

async function deleteMember(
    svc: SupabaseClient,
    u: TeamMemberPayload,
    callerId: string
): Promise<TeamResponse> {
    const legacyId = u.id?.trim();
    if (!legacyId) return fail(400, 'Missing the teammate to remove.');

    const { data: profile } = await svc
        .from('profiles')
        .select('id, role')
        .eq('legacy_id', legacyId)
        .maybeSingle();
    if (!profile) return fail(404, `No teammate found with the CRM code "${legacyId}".`);
    if (profile.id === callerId) return fail(400, 'You cannot remove your own account.');

    if (profile.role === 'Admin') {
        const { count } = await svc
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('role', 'Admin');
        if ((count ?? 0) <= 1) {
            return fail(400, 'This is the only Admin — promote someone else first.');
        }
    }

    // profiles.id references auth.users on delete cascade, so this clears both.
    const { error } = await svc.auth.admin.deleteUser(profile.id);
    if (error) return fail(400, `Could not remove the account: ${error.message}`);

    return { status: 200, body: { ok: true, id: legacyId } };
}
