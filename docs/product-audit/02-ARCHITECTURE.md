# 02 — ARCHITECTURE

Status: Phase 0 summary. The detailed, mostly-current engineering handbook is `/ARCHITECTURE.md` (1,862 lines); this file is the audit's view of it and records where the two disagree.

## Shape (confirmed)

- **Single-page React app** (`App.tsx`) with hash-based tabs, no router library, no global store; state lives in `App.tsx` and is passed down as props.
- **Data**: Supabase Postgres behind Row Level Security; the browser talks to it directly with the anon key through `services/repository.ts` and `services/useSupabaseSync.ts`. Server-side work that needs the service role (team logins, sheet proxy, daily email, AI report, stock prices) is in `api/*.ts` (Vercel) with `api/_lib/*` shared modules, mirrored for local dev by `server.ts` (Express).
- **Sources of truth**: money (balances, ageing) is imported from Google Sheets and never edited in-app; the app owns follow-ups, promises, notes, cheques, ranks, ownership, templates and settings (`ARCHITECTURE.md` §8).
- **Roles**: Admin, Manager, CRM, Collector, Viewer with per-login permission overrides and data-visibility scoping (`types.ts`: `DEFAULT_ROLE_PERMISSIONS`, `can`, `seesWholeBook`, `scopeTo`), enforced again by RLS policies in `supabase/schema.sql`.
- **Deploy**: Vite static build + Vercel functions; cron for the daily email.

## Known disagreements between the handbook and the code (Phase 0)

| Handbook | Code | Action |
|---|---|---|
| §9.1 "Today — the workspace" describes `components/work/Workspace.tsx`, `Worklist.tsx`, `AccountPanel.tsx` with six queues | Those files were deleted in commit 7232940 ("Put the old layout back"); Today is `renderCompanyDashboard` / `renderUserDashboard` in `App.tsx` with four Stat cards + the bad-debt strip | Rewrite §9.1–9.2 (Phase 8, docs batch) |
| File map (§13) lists `work/*.tsx` | absent | same |

## To be assessed in Phase 8

- Whether `App.tsx` should be split (by page renderer and by handler group) — evidence: 3,302 lines, ~48 state slices, 29 memo/effects.
- Whether the Express/Vercel route duplication needs a single route table.
- Whether `supabase/schema.sql` should gain a migrations directory.
