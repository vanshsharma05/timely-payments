import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client.
 *
 * Both values are safe to ship to the browser: the anon key only grants what
 * the Row Level Security policies in supabase/schema.sql allow. The service
 * role key must NEVER appear in this file or any other client-side code.
 */
const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const anonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False when the app is running without a backend (local demo mode). */
export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
    ? createClient(url!, anonKey!, {
          auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
          },
      })
    : null;

/**
 * Narrow the nullable client at call sites. Throws rather than silently
 * no-opping, so a misconfigured deployment fails loudly instead of looking
 * like it saved data when it did not.
 */
export function requireSupabase(): SupabaseClient {
    if (!supabase) {
        throw new Error(
            'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
        );
    }
    return supabase;
}
