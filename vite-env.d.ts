/// <reference types="vite/client" />

/**
 * Build-time environment variables. Only `VITE_`-prefixed values are exposed to
 * the browser bundle — GEMINI_API_KEY is deliberately absent here because it is
 * server-side only and must never reach the client.
 */
interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL?: string;
    readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
