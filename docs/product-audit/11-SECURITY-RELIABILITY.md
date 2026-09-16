# 11 — SECURITY & RELIABILITY

Status: Phases 11–12 not started. Phase 1 (2026-09-16) reconstructed the permission model and recorded the findings below; the full matrix and enforcement layers are in 03-PRODUCT-MODEL.md §8.

## Findings from Phase 1 (recorded, not fixed)

| # | Finding | Prio | Confidence | Evidence |
|---|---|---|---|---|
| SEC1 | Every signed-in role can read the whole book (customers, cheques, activity, profiles incl. staff emails) through PostgREST — per-person scoping is client-only | P2 | CONFIRMED | `schema.sql` `customers_read using (true)` etc.; `scopeTo` in `types.ts` |
| SEC2 | Column-level rights (`canEditFinancials`, `canReassignCrm`, rank, Admin-only bulk date) are client-only; RLS `customers_update` checks role only | P2 | CONFIRMED | `schema.sql` lines 315–316 |
| SEC3 | A Manager can run "COMPLETE FRESH START" (deletes every cheque, clears owners/notes, re-imports) behind one `window.confirm`; RLS lets the cheque deletes and row overwrites through | P1 | CONFIRMED | `App.tsx` `rights.canSyncSheets`, `handleResetAllDataAndUsers` |
| SEC4 | `handle_new_user` trusts sign-up metadata for `role`; safe only while `disable_signup` stays true on the Supabase project (it is, read 2026-09-16) | P2 latent | CONFIRMED | `schema.sql` lines 190–216; management API |
| SEC5 | Customer names, amounts and last notes go to Google Gemini for the AI report, callable by any signed-in role | P3 / business | CONFIRMED | `api/_lib/report.ts`, `AiReportModal.tsx` |
| SEC6 | `/api/health`, `/api/ai-status` unauthenticated (harmless) | P4 | CONFIRMED | |
| SEC7 | Sign-in protected only by Supabase defaults (no captcha; JWT 1 h; password min 8) | P3 | CONFIRMED | management API config |

## Reliability findings from Phase 1

| # | Finding | Prio | Confidence |
|---|---|---|---|
| R1 | Last-writer-wins on whole rows between concurrent users; no realtime/polling/version column; `processStatuses` rewrites every date-crossed row from a stale snapshot | P1 | mechanism CONFIRMED |
| R2 | A failed write-back retries only on the next local change; closing the tab loses it | P2 | CONFIRMED |
| R3 | Deletion by array diff: shrinking `appData`/`pdcCheques` deletes server rows (cascading threads/cheques) | P2 | CONFIRMED |
| R4 | Cheque ids from `Date.now()`; customer ids from normalised company name (two firms with one name merge) | P3 | CONFIRMED |
| R5 | No documented backup/rollback for Supabase; the reset has no snapshot step | P2 | LIKELY |

Known from Phase 0 and recent work (to be re-verified in the audit):

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
