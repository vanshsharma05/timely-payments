import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase access, shared by the API routes.
 *
 * Two different clients, for two different jobs:
 *  - `serviceClient()` bypasses Row Level Security and can touch auth accounts.
 *    Only /api/team needs it, and only after the caller is proven to be Admin.
 *  - `userClient()` carries the caller's own access token, so every query it
 *    makes is still filtered by the same policies the browser would hit.
 */

const env = (...names: string[]): string | undefined => {
    for (const n of names) {
        const v = process.env[n];
        if (v && v.trim()) return v.trim();
    }
    return undefined;
};

export const supabaseUrl = (): string | undefined => env('SUPABASE_URL', 'VITE_SUPABASE_URL');
const anonKey = (): string | undefined => env('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
const serviceKey = (): string | undefined => env('SUPABASE_SERVICE_ROLE_KEY');

/** False for a demo deployment with no database behind it. */
export const isBackendConfigured = (): boolean => Boolean(supabaseUrl() && anonKey());

export function serviceClient(): SupabaseClient | null {
    const url = supabaseUrl();
    const key = serviceKey();
    if (!url || !key) return null;
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function userClient(accessToken: string): SupabaseClient | null {
    const url = supabaseUrl();
    const key = anonKey();
    if (!url || !key || !accessToken) return null;
    return createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
}

export interface CallerProfile {
    authId: string;
    legacyId: string;
    role: string;
}

/**
 * Resolves an access token to the profile behind it, or null when the token is
 * missing, expired or has no profile. Uses the service client when one is
 * available (it works even if policies change) and the caller's own token
 * otherwise.
 */
export async function currentProfile(accessToken: string): Promise<CallerProfile | null> {
    if (!accessToken) return null;
    const db = serviceClient() || userClient(accessToken);
    if (!db) return null;

    const { data: auth, error } = await db.auth.getUser(accessToken);
    if (error || !auth?.user) return null;

    const { data } = await db
        .from('profiles')
        .select('id, legacy_id, role')
        .eq('id', auth.user.id)
        .maybeSingle();
    if (!data) return null;

    return { authId: data.id, legacyId: data.legacy_id, role: data.role };
}

/** Bearer token out of an Authorization header, in either casing. */
export function bearerToken(header: string | string[] | undefined): string {
    const raw = Array.isArray(header) ? header[0] : header || '';
    return raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : '';
}
