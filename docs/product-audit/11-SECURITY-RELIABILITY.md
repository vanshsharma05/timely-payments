# 11 — SECURITY & RELIABILITY

Status: NOT STARTED — Phases 11–12. Known from Phase 0 and recent work (to be re-verified in the audit):

CONFIRMED
- Secrets: `.env.local` / `.deploy.local` git-ignored; `.env.example` documents names only; `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only (`vite-env.d.ts` deliberately omits them). The service role key is used only under `api/_lib`.
- `/api/fetch-sheet` requires an Admin/Manager session; `/api/live-stock` any session, prices stripped server-side by role; `/api/team` Admin only; `/api/daily-report` CRON_SECRET or Admin/Manager session.
- RLS enabled on every table (`supabase/schema.sql` lines 233–238, 404–405, 471) with read/write policies per role.
- Dependencies: nodemailer 9.0.6 HIGH advisory (fix available, non-breaking range), qs 6.15.3 MODERATE via express (fix available). Dev-only: `tar` critical and several `undici` under the `vercel` CLI package.

NEEDS VALIDATION
- Whether RLS policies match the client-side `can()` matrix for every write (bulk rank, reassign, follow-up date, cheque delete, customer delete).
- Rate limiting / brute force on sign-in (Supabase defaults only?).
- `express.json({ limit: '10mb' })` on the dev server — the Vercel functions' own body limits apply in prod.
- Duplicate-submission protection on follow-up save, cheque save, bulk actions.
- Behaviour when Supabase is unreachable, when a sheet read fails mid-sync, when the session expires mid-edit.

Note: the Live stock Google Sheet itself is shared "anyone with the link"; the app no longer shows the link to non-priced roles, but the sharing setting is outside the app (19-OPEN-QUESTIONS Q4).
