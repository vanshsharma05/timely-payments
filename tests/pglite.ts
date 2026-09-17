/**
 * A throwaway Postgres for the SQL under test — PGlite (Postgres compiled to
 * WebAssembly) running inside the test process. It applies the real
 * supabase/schema.sql plus whatever file the test names, on top of just
 * enough of Supabase's `auth` schema for the policies and helpers to compile.
 * Nothing here can reach the production project.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export async function freshDatabase(extraSqlFiles: string[] = []): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(`
        create role anon; create role authenticated; create role service_role;
        create schema auth;
        create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
        create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
    `);
    await db.exec(readFileSync(resolve(process.cwd(), 'supabase/schema.sql'), 'utf8'));
    for (const f of extraSqlFiles) await db.exec(readFileSync(resolve(process.cwd(), f), 'utf8'));
    return db;
}

/** Makes auth.uid() answer with this person for the rest of the session. */
export async function actAs(db: PGlite, authId: string | null): Promise<void> {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [authId ?? '']);
}

/** A login with a profile (the auth trigger creates the profile from the metadata). */
export async function addLogin(db: PGlite, authId: string, legacyId: string, name: string, role: string): Promise<void> {
    await db.query(
        `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`,
        [authId, `${legacyId.toLowerCase()}@example.test`, JSON.stringify({ role, legacy_id: legacyId, name })],
    );
}

export async function count(db: PGlite, table: string, where = 'true'): Promise<number> {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${where}`);
    return r.rows[0].n;
}
