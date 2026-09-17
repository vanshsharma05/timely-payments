# 00 — MASTER STATUS

The authoritative continuation file. Read this first in every session; update it at the end of every meaningful work period.

PROJECT: Timely Payment — Shori Chemicals' receivables follow-up app (customer book, follow-up queue, PDC cheques, reports, live stock).
STACK: React 18 + TypeScript 5 + Vite 5 + Tailwind v4 (browser) · Express 5 dev server / Vercel serverless functions `api/*.ts` (server) · Supabase (Postgres + Auth + RLS) · Google Sheets CSV as the source of balances and stock · Nodemailer/Resend for the daily email · Google Gemini for the AI report · Vercel hosting. See 01-REPOSITORY-MAP.md.

CURRENT PHASE: Engineering batch 5 done (SEC3 — the fresh start is one database transaction with a snapshot; committed locally, NOT deployed, needs `supabase/reset.sql` applied first). Batches 2–4 live. Phases 0–3 done; Phase 4 (UX) not started; R1-B waits on Q15.
CURRENT SUBPHASE: —
LAST COMPLETED TASK: Fresh-start session 2026-09-17 (ninth): reset re-traced (11 §3.1) and rebuilt — `supabase/reset.sql` (`book_backups`, `reset_book()` one transaction with snapshot + counts + phrase + stale-plan refusal, `restore_book_backup()` Admin-only and itself reversible), `services/reset.ts` (plan via the sync's own merge: ids kept, money only, unlisted settled), `components/ResetConfirmModal.tsx` (counts, what will not happen, backup download + checkbox, typed RESET), `App.tsx` handler (sheet first → plan → dialog → one RPC → reload from server). 37 new tests incl. 21 running the real SQL in PGlite (146 total). Local flow probe against the real book with every write aborted: 0 requests before confirmation, one `rpc/reset_book` on confirm. Production untouched.
CURRENT TASK: None in progress.
NEXT TASK: Owner (a) applies `supabase/reset.sql` in the SQL editor, then approves the deploy of this batch (17-RELEASE-CHECKLIST.md); (b) answers Q8 (who may press it; should owners/collectors be cleared; should threads be cleared) and Q15 (conflict policy). Then R1-B. See RECOMMENDED NEXT SESSION START.

BASELINE BUILD STATUS (2026-09-16, commit de60fc7):
- `npm run typecheck` (tsc --noEmit, strict): PASS, 0 errors.
- `npm run build` (tsc + vite build + esbuild server bundle): PASS. One warning: main chunk `index-*.js` 724.6 kB minified (177.8 kB gzip) exceeds the 700 kB `chunkSizeWarningLimit`. Other chunks: sheets (xlsx) 492 kB / 161 kB gzip, react 134 kB, markdown 126 kB, CSS 153 kB / 22 kB gzip.
- `npm run check:classes`: 2 pre-existing findings (`grid-frame` in AppLogo.tsx, `stroke-based` in Icons.tsx — harmless false positives).
- `npm run check:empty`: clean.
- Lint: NO linter configured. Type-check is the only static gate.
- Unit/integration tests: NONE at baseline. **Since 2026-09-17: Vitest, 146 tests, `npm run test:run`** (incl. 21 SQL tests in PGlite). Browser suites in `scripts/tests/` (no runner yet) and `scripts/` QA scripts.
- `npm audit --omit=dev`: nodemailer 9.0.6 HIGH (fix available), qs 6.15.3 MODERATE via express (fix available). Dev-only: `tar` critical and `undici` under the `vercel` CLI.
- Runtime: Node v24.15.0, npm 11.12.1. No `engines` field. Two lockfiles (`package-lock.json` AND `bun.lock`) — kept for now by owner's instruction (D5).
CURRENT BUILD STATUS: tsc clean; `npm run build` clean (same chunk warning); `check:classes` 2 pre-existing; `check:empty` clean — after the fresh-start batch. Dev dependency added: `@electric-sql/pglite` (test-only; `package-lock.json` updated, `bun.lock` untouched).
BASELINE TEST STATUS: browser suites were green at de60fc7 (see 12-TEST-STRATEGY.md). Classified for production safety in Phase 1: 7 READ ONLY, 2 CONTROLLED MUTATION WITH CLEANUP, 1 READ ONLY-but-fragile (`phone-test.cjs`), 0 UNSAFE. None executed this session.
CURRENT TEST STATUS: unit 146/146 (money 23, edit dialog 13, `customerRowDiff` 11, `updateCustomerColumns` 5, `useCollectionSync` 12, `syncFlows` 14, `derivedStatus` 16, `statusContract` 15, `resetPlan` 10, `resetSql` 21, `resetConfirmModal` 6). Probes on the live site (eighth session) unchanged. Fresh-start flow probe on the local build against the real book, every write aborted: dialog counts 144 cheques · 709 with follow-up work · 684 listed · 1 to settle · 3,342 at nil · 0 new · 4,027 on file; 0 mutating requests before confirmation; confirm → exactly one `POST /rest/v1/rpc/reset_book` (aborted); production re-read unchanged (newest write 2026-09-17T05:15Z). No staging (Q6); the SQL is exercised only in PGlite.

CRITICAL ISSUES (P0): none confirmed.
IMPORTANT ISSUES:
- ~~P1 · **C1**~~ **RESOLVED 2026-09-17** — the edit dialog no longer rebuilds the row (collector, Dr/Cr types, netted roll-ups, `settled_at`, PAN, Completed status and owner spelling all survive an unrelated Save). Regression: 13 cases in `tests/customerEditModal.dom.test.tsx`. Deployment: see DEPLOY NOTE below.
- **R1 split (11, R1 status table):** ~~R1-A~~ **FIXED (Option A, local)**; ~~R1-C~~ **FIXED (Option B + status contract, local)**; **R1-B same-field last-writer-wins — OPEN, designed (11 §2.2)**: scenarios S1–S7; evidence 1 customer-day in 561 with two authors; recommended field-aware compare-and-set on Option A's baseline, not row-level `updated_at` (trigger confirmed in production, but it would reject unrelated-field edits after every bulk event: 3,235 / 504 rows in a day); owner policy Q15.
- P1 · **SEC3 (CONFIRMED, traced)** The reset is one `confirm()` for Admin or Manager; for an Admin it deletes 144 cheques, 672 legacy-id accounts *with their threads*, ~2,700 settled accounts, and re-creates the sheet's accounts under new ids; no audit, backup or undo; not transactional. Technical requirements T1–T6 vs business decision Q8 in 11 §3.2.
- P1 · No unit tests for the money rules in `types.ts`; no single test command. (12)
- P1 · `App.tsx` god component — now mapped in 09 §A with extraction boundaries; do not split before tests exist.
- P2 · **SEC1** reclassified INTENTIONAL TRUST MODEL (documented in schema/ARCHITECTURE) + pending policy decision Q14. **SEC2** DEFENSE-IN-DEPTH WEAKNESS, a documented consequence of whole-row writes (fixable after Option A). **SEC4** DEFENSE-IN-DEPTH (latent; depends on a dashboard switch). **SEC5** PRIVACY/POLICY (Q9; exact payload in 11 Part 5).
- P2 · Duplicated business logic D1–D8 (scoping rule in browser and digest; status stored+derived ×3; notes mirrored; two "expected payment" notions; two performance scores; roll-up netting ×3; sheet URLs ×2). (03 §9)
- P2 · Production dependency advisories (nodemailer, qs). Docs drift (`ARCHITECTURE.md` §9.1–9.2). Bundle size (xlsx for everyone).
- P3 · Dead right `canEditFinancials`; dead column `customers.updated_by`; legacy enum values; stray root files.

CURRENT DESIGN WORK: none. UX findings U1–U23 classified in 06 (17 CONFIRMED BY CODE, 3 CONFIRMED BY RUNNING UI, 3 BUSINESS-DEPENDENT/HYPOTHESIS); journeys J1–J16 in 05.
CURRENT ENGINEERING WORK: batch 5 (fresh start) **committed locally on `restore-and-fix`, not pushed, not deployed**. DEPLOY ORDER when approved: (1) run `supabase/reset.sql` in the project's SQL editor (idempotent; adds `book_backups`, `reset_book`, `restore_book_backup`); (2) gate + push + `npx vercel deploy --prod --yes` per 17; (3) post-deploy: the smoke test, both probes, and a read-only check that `select proname from pg_proc where proname in ('reset_book','restore_book_backup')` returns both. Production deployment today is still `dpl_8NB7JLzJoSuCKsecBwz7WiycZBgJ` = `de2d1c5`.
FILES REVIEWED: 27 Full + 22 Partial of 103 (18-FILE-AUDIT-LEDGER.md). This session: seven new files (all Full); the reset handler in `App.tsx` re-read and rewritten.
FILES REMAINING: 54 not yet opened at audit depth; 22 partials to complete in Phase 8.
CHANGES NOT YET VERIFIED: the fresh-start batch is verified by 37 unit tests (the SQL in PGlite against the real schema), typecheck, build and a write-aborted flow probe, but the SQL has not run on the real project and the batch is not deployed; nothing has been exercised by a human.
OPEN QUESTIONS: Q1–Q14 in 19-OPEN-QUESTIONS.md, now as decision briefs for Q7, Q8, Q9, Q11, Q12, Q13, Q14. Blocking nothing; Q6 (staging), Q8 (reset) and Q14 (isolation) shape the fix batches.
DECISIONS REQUIRED: none to continue Phase 4. Before the reset fix: Q8. Before RLS tightening: Q14. Before destructive tests: Q6. D7 records the recommended R1 remediation.
REGRESSION RISKS (fresh start): behaviour changes by design — accounts the sheet no longer lists are settled instead of deleted; owners, collectors, contacts and threads are kept (they were wiped); the reset refuses if the book changed between reading the sheet and confirming ("reload and try again"). A Manager now gets the full clean reset instead of a broken partial one (same two roles as before — Q8 still open). PGlite is Postgres 18; the project runs Supabase's Postgres (15/17) — the SQL uses nothing version-specific, but the first run on the real project should be watched. Standing: any change to `App.tsx`, `types.ts`, `googleSheetService.ts`, `useSupabaseSync.ts`, `repository.ts`, the dialogs or `supabase/*.sql` without the unit layer.
RECOMMENDED NEXT SESSION START:
1. Read this file, then 11-SECURITY-RELIABILITY.md (§3.0 the reset as it is now; §2.2 the concurrency brief) and 19 Q8 / Q15. Run `npm run test:run` (expect 146/146) and `npm run typecheck`.
2. If the owner approved: apply `supabase/reset.sql` in the SQL editor first, then the deploy sequence in 17-RELEASE-CHECKLIST.md, then the smoke test and both probes against the live site, then a read-only catalog check that both functions exist. Do not press the live reset to "test" it; the SQL tests are the test.
3. If Q8 changed policy (Admin-only / clear owners / clear threads): each is a one-line change in `reset_book()` (+ the button gate for Admin-only), with a test in `tests/resetSql.test.ts`.
4. Session 10 — R1-B per 11 §2.2, only after Q15 is answered.
5. Then a focus/visibility refetch of the book (T39); then Phase 4 UX audit, continuing the ledger (U24, T36, T37, T40 are on the list).
6. Update this file.
LAST UPDATED: 2026-09-17 (fresh-start session, ninth).
