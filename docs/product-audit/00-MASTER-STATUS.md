# 00 — MASTER STATUS

The authoritative continuation file. Read this first in every session; update it at the end of every meaningful work period.

PROJECT: Timely Payment — Shori Chemicals' receivables follow-up app (customer book, follow-up queue, PDC cheques, reports, live stock).
STACK: React 18 + TypeScript 5 + Vite 5 + Tailwind v4 (browser) · Express 5 dev server / Vercel serverless functions `api/*.ts` (server) · Supabase (Postgres + Auth + RLS) · Google Sheets CSV as the source of balances and stock · Nodemailer/Resend for the daily email · Google Gemini for the AI report · Vercel hosting. See 01-REPOSITORY-MAP.md.

CURRENT PHASE: Phase 2 — User types (complete). Phases 0–2 done.
CURRENT SUBPHASE: —
LAST COMPLETED TASK: Phase 1 product model + permission matrix (03), Phase 2 user types (04), App.tsx responsibility map (09 §A), preliminary UX (06), security/reliability (11), test-safety classification (12), tech debt (13), questions Q7–Q13 (19). Session of 2026-09-16 (second session).
CURRENT TASK: None in progress.
NEXT TASK: Phase 3 — user journeys (05), then Phase 4 UX audit screen by screen. See RECOMMENDED NEXT SESSION START.

BASELINE BUILD STATUS (2026-09-16, commit de60fc7):
- `npm run typecheck` (tsc --noEmit, strict): PASS, 0 errors.
- `npm run build` (tsc + vite build + esbuild server bundle): PASS. One warning: main chunk `index-*.js` 724.6 kB minified (177.8 kB gzip) exceeds the 700 kB `chunkSizeWarningLimit`. Other chunks: sheets (xlsx) 492 kB / 161 kB gzip, react 134 kB, markdown 126 kB, CSS 153 kB / 22 kB gzip.
- `npm run check:classes`: 2 pre-existing findings (`grid-frame` in AppLogo.tsx, `stroke-based` in Icons.tsx — harmless false positives).
- `npm run check:empty`: clean.
- Lint: NO linter configured. Type-check is the only static gate.
- Unit/integration tests: NONE. Browser suites in `scripts/tests/` (no runner yet) and `scripts/` QA scripts.
- `npm audit --omit=dev`: nodemailer 9.0.6 HIGH (fix available), qs 6.15.3 MODERATE via express (fix available). Dev-only: `tar` critical and `undici` under the `vercel` CLI.
- Runtime: Node v24.15.0, npm 11.12.1. No `engines` field. Two lockfiles (`package-lock.json` AND `bun.lock`) — kept for now by owner's instruction (D5).
CURRENT BUILD STATUS: unchanged — no application code has changed since the baseline (commit 99146b8 and this session are docs only).
BASELINE TEST STATUS: browser suites were green at de60fc7 (see 12-TEST-STRATEGY.md). Classified for production safety in Phase 1: 7 READ ONLY, 2 CONTROLLED MUTATION WITH CLEANUP, 1 READ ONLY-but-fragile (`phone-test.cjs`), 0 UNSAFE. None executed this session.
CURRENT TEST STATUS: same as baseline. No staging environment exists (assumed; Q6) — all suites sign in to production.

CRITICAL ISSUES (P0): none confirmed.
IMPORTANT ISSUES:
- P1 · **SEC3** A Manager can run "COMPLETE FRESH START" (deletes every cheque, clears every owner/note, re-imports) behind one `window.confirm`. No backup step. (03 §8.3, Q8)
- P1 · **R1** Concurrent edits overwrite each other: each tab writes whole rows from its sign-in snapshot; no realtime, polling or version column; `processStatuses` rewrites every date-crossed row from a stale copy. (03 §10, T22)
- P1 · No unit tests for the money rules in `types.ts`; no single test command. (12)
- P1 · `App.tsx` god component — now mapped in 09 §A with extraction boundaries; do not split before tests exist.
- P2 · **SEC1/SEC2** Whole-book read and column-level write rights are client-only (RLS is role-level, read-all). (03 §8.3)
- P2 · **SEC4** Auth trigger trusts sign-up metadata — safe only while `disable_signup` stays true (verified true on 2026-09-16).
- P2 · Duplicated business logic D1–D8 (scoping rule in browser and digest; status stored+derived ×3; notes mirrored; two "expected payment" notions; two performance scores; roll-up netting ×3; sheet URLs ×2). (03 §9)
- P2 · Production dependency advisories (nodemailer, qs). Docs drift (`ARCHITECTURE.md` §9.1–9.2). Bundle size (xlsx for everyone).
- P3 · Dead right `canEditFinancials`; dead column `customers.updated_by`; legacy enum values; stray root files.

CURRENT DESIGN WORK: none. Preliminary UX pressure points U1–U16 recorded in 06 (not redesigned).
CURRENT ENGINEERING WORK: none. App.tsx responsibility map and extraction boundaries in 09 §A.
FILES REVIEWED: 7 Full + 12 Partial of 84 (18-FILE-AUDIT-LEDGER.md). Full: `types.ts`, `supabase/schema.sql`, `services/repository.ts`, `services/useSupabaseSync.ts`, `api/alert-status.ts`, `api/ai-status.ts`, `api/team.ts`. Partial: `App.tsx`, `services/googleSheetService.ts`, `FollowUpModal`, `CustomerActivityPanel`, `SyncReconciliationModal`, `api/_lib/digest|reminders|report|team`, `api/gemini-report.ts`, `services/messageTemplate.ts`, `DEPLOYMENT.md`.
FILES REMAINING: 65 not yet opened at audit depth; 12 partials to complete in Phase 8.
CHANGES NOT YET VERIFIED: none (docs only).
OPEN QUESTIONS: Q1–Q13 in 19-OPEN-QUESTIONS.md. Blocking nothing; Q6 (staging) and Q8 (who may reset) matter most.
DECISIONS REQUIRED: none to continue Phase 3–4. Before Phase 11/12 fixes: Q8 (reset), Q6 (staging), Q10 (`canEditFinancials`).
REGRESSION RISKS: none introduced. Standing: any change to `App.tsx`, `types.ts`, `googleSheetService.ts`, `useSupabaseSync.ts` or `repository.ts` without the browser suites and (for sync/reset) a staging project.
RECOMMENDED NEXT SESSION START:
1. Read this file, then 03-PRODUCT-MODEL.md §5–§8 and 04-USER-TYPES.md.
2. Phase 3 (05-USER-JOURNEYS.md): walk each journey listed in 05 as the role that performs it, on laptop and phone, against the dev server signed in as Admin (read-only — open dialogs, do not save). For CRM/Collector journeys use the code paths (`renderUserDashboard`, `FollowUpModal`, `PhoneAccountRow`) rather than creating a login unless the owner has answered Q6. Record starting condition, steps, decision points, missing feedback, ideal steps.
3. Phase 4 (06-UX-AUDIT.md): confirm or drop U1–U16 screen by screen; add findings; prioritise by user impact × frequency.
4. Continue the ledger: mark screens Partial/Full as they are read (CustomerDashboardView, ReportsView, PdcChequesView, LiveStockView, AppShell, Primitives, LoginScreen, UserModal, AlertsView).
5. Update this file.
LAST UPDATED: 2026-09-16 (Phase 1–2 session).
