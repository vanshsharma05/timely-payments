# 00 — MASTER STATUS

The authoritative continuation file. Read this first in every session; update it at the end of every meaningful work period.

PROJECT: Timely Payment — Shori Chemicals' receivables follow-up app (customer book, follow-up queue, PDC cheques, reports, live stock).
STACK: React 18 + TypeScript 5 + Vite 5 + Tailwind v4 (browser) · Express 5 dev server / Vercel serverless functions `api/*.ts` (server) · Supabase (Postgres + Auth + RLS) · Google Sheets CSV as the source of balances and stock · Nodemailer/Resend for the daily email · Google Gemini for the AI report · Vercel hosting. See 01-REPOSITORY-MAP.md.

CURRENT PHASE: Engineering batch 3 done (R1-C Option B — the follow-up status is derived, never rewritten). Phases 0–3 done; Phase 4 (UX) and the remaining fix batches (R1-B concurrency, then the reset) not started.
CURRENT SUBPHASE: —
LAST COMPLETED TASK: Option B session 2026-09-17 (sixth): `processStatuses` no longer writes `status`; `followUpStatusOf()` added and every reader of the derived reading (book Status filter/counts/badge/colour, Reports badge, export column, priority filter, AI summary) switched to it; the stored word is trusted only for `Completed`. 16 new tests (93 total); probe with the tab clock moved to the next day: one urgency toggle sent 90 requests before, 1 after. **Committed locally only — not pushed, not deployed** (same rule as Option A; both await the owner).
CURRENT TASK: None in progress.
NEXT TASK: Owner decides on pushing/deploying Options A + B together (ee61d6f + this session). Then R1-B — optimistic concurrency on `updated_at` for the same-field last-writer-wins case — in its own session, since it changes what a user sees on a conflict. See RECOMMENDED NEXT SESSION START.

BASELINE BUILD STATUS (2026-09-16, commit de60fc7):
- `npm run typecheck` (tsc --noEmit, strict): PASS, 0 errors.
- `npm run build` (tsc + vite build + esbuild server bundle): PASS. One warning: main chunk `index-*.js` 724.6 kB minified (177.8 kB gzip) exceeds the 700 kB `chunkSizeWarningLimit`. Other chunks: sheets (xlsx) 492 kB / 161 kB gzip, react 134 kB, markdown 126 kB, CSS 153 kB / 22 kB gzip.
- `npm run check:classes`: 2 pre-existing findings (`grid-frame` in AppLogo.tsx, `stroke-based` in Icons.tsx — harmless false positives).
- `npm run check:empty`: clean.
- Lint: NO linter configured. Type-check is the only static gate.
- Unit/integration tests: NONE at baseline. **Since 2026-09-17: Vitest, 93 tests, `npm run test:run`.** Browser suites in `scripts/tests/` (no runner yet) and `scripts/` QA scripts.
- `npm audit --omit=dev`: nodemailer 9.0.6 HIGH (fix available), qs 6.15.3 MODERATE via express (fix available). Dev-only: `tar` critical and `undici` under the `vercel` CLI.
- Runtime: Node v24.15.0, npm 11.12.1. No `engines` field. Two lockfiles (`package-lock.json` AND `bun.lock`) — kept for now by owner's instruction (D5).
CURRENT BUILD STATUS: tsc clean; `npm run build` clean (same chunk warning); `check:classes` 2 pre-existing; `check:empty` clean — after Option B. No dependency change; `bun.lock` untouched.
BASELINE TEST STATUS: browser suites were green at de60fc7 (see 12-TEST-STRATEGY.md). Classified for production safety in Phase 1: 7 READ ONLY, 2 CONTROLLED MUTATION WITH CLEANUP, 1 READ ONLY-but-fragile (`phone-test.cjs`), 0 UNSAFE. None executed this session.
CURRENT TEST STATUS: unit 93/93 (money 23, edit dialog 13, `customerRowDiff` 11, `updateCustomerColumns` 5, `useCollectionSync` 12, `syncFlows` 13, `derivedStatus` 16). Interception probe (all writes aborted) on the Option B build with the tab clock shifted +1 day after load, one urgency toggle on 3 BROTHERS: BEFORE (Option A build) 90 requests = 89 `[status]` PATCHes + the toggle; AFTER 1 request `[is_urgent,last_follow_up_on,status]` (the `status` is the follow-up dialog's own write for the opened account, unchanged behaviour). With the real clock: 1 request `[is_urgent,last_follow_up_on]`. Production rows re-read unchanged. Read-only facts: stored status counts Pending 3365 / Upcoming 527 / Completed 18 / Today 109 / Overdue 8; 172 rows stale at the time; 0 rows without a date that would use the stored-word fallback. No staging (Q6).

CRITICAL ISSUES (P0): none confirmed.
IMPORTANT ISSUES:
- ~~P1 · **C1**~~ **RESOLVED 2026-09-17** — the edit dialog no longer rebuilds the row (collector, Dr/Cr types, netted roll-ups, `settled_at`, PAN, Completed status and owner spelling all survive an unrelated Save). Regression: 13 cases in `tests/customerEditModal.dom.test.tsx`. Deployment: see DEPLOY NOTE below.
- **R1 split (11, R1 status table):** ~~R1-A unrelated-field overwrite by whole-row PATCH~~ **FIXED (Option A, local)**; ~~R1-C derived `status` persisted by `processStatuses`~~ **FIXED (Option B, local)**; **R1-B same-field last-writer-wins — OPEN (P2)**: two people editing the same field of the same account within the sync window still lose the earlier write silently; needs an `updated_at` predicate (optimistic concurrency) and a conflict message.
- P1 · **SEC3 (CONFIRMED, traced)** The reset is one `confirm()` for Admin or Manager; for an Admin it deletes 144 cheques, 672 legacy-id accounts *with their threads*, ~2,700 settled accounts, and re-creates the sheet's accounts under new ids; no audit, backup or undo; not transactional. Technical requirements T1–T6 vs business decision Q8 in 11 §3.2.
- P1 · No unit tests for the money rules in `types.ts`; no single test command. (12)
- P1 · `App.tsx` god component — now mapped in 09 §A with extraction boundaries; do not split before tests exist.
- P2 · **SEC1** reclassified INTENTIONAL TRUST MODEL (documented in schema/ARCHITECTURE) + pending policy decision Q14. **SEC2** DEFENSE-IN-DEPTH WEAKNESS, a documented consequence of whole-row writes (fixable after Option A). **SEC4** DEFENSE-IN-DEPTH (latent; depends on a dashboard switch). **SEC5** PRIVACY/POLICY (Q9; exact payload in 11 Part 5).
- P2 · Duplicated business logic D1–D8 (scoping rule in browser and digest; status stored+derived ×3; notes mirrored; two "expected payment" notions; two performance scores; roll-up netting ×3; sheet URLs ×2). (03 §9)
- P2 · Production dependency advisories (nodemailer, qs). Docs drift (`ARCHITECTURE.md` §9.1–9.2). Bundle size (xlsx for everyone).
- P3 · Dead right `canEditFinancials`; dead column `customers.updated_by`; legacy enum values; stray root files.

CURRENT DESIGN WORK: none. UX findings U1–U23 classified in 06 (17 CONFIRMED BY CODE, 3 CONFIRMED BY RUNNING UI, 3 BUSINESS-DEPENDENT/HYPOTHESIS); journeys J1–J16 in 05.
CURRENT ENGINEERING WORK: batch 3 complete (Option B), **committed locally on `restore-and-fix` on top of Option A, not pushed, not deployed** — the session rule overrides the standing push-live instruction; the owner decides after reading the report. Deploy sequence when approved: push `restore-and-fix` and `restore-and-fix:main`, `git branch -f main restore-and-fix`, `npx vercel deploy --prod --yes`, then re-run `scripts/tests/write-payload-probe.cjs` (aborts every write) and confirm the five Option A results plus a single request on an urgency toggle.
FILES REVIEWED: 18 Full + 22 Partial of 94 (18-FILE-AUDIT-LEDGER.md). This session: `types.ts` re-reviewed after the change; `ReportsView.tsx` and `CustomerDashboardView.tsx` No → Partial (status readers traced); new Full: `tests/derivedStatus.dom.test.tsx`.
FILES REMAINING: 54 not yet opened at audit depth; 22 partials to complete in Phase 8.
CHANGES NOT YET VERIFIED: Options A and B are verified by 93 unit tests, typecheck, build and the interception probe, but neither has been deployed or exercised by a human; the C1 fix is live since a0f0a31.
OPEN QUESTIONS: Q1–Q14 in 19-OPEN-QUESTIONS.md, now as decision briefs for Q7, Q8, Q9, Q11, Q12, Q13, Q14. Blocking nothing; Q6 (staging), Q8 (reset) and Q14 (isolation) shape the fix batches.
DECISIONS REQUIRED: none to continue Phase 4. Before the reset fix: Q8. Before RLS tightening: Q14. Before destructive tests: Q6. D7 records the recommended R1 remediation.
REGRESSION RISKS (Option B): a screen that shows the stored word would now be wrong only if it bypasses `followUpStatusOf` — every reader was traced (11 status contract); the digest already derived. Rows whose stored word is stale stay stale in the database (harmless: nothing reads it except `Completed`). The bulk date tool computes its own word (Today/Upcoming; past dates are refused there). The no-date fallback keeps the stored word (0 production rows). Standing: any change to `App.tsx`, `types.ts`, `googleSheetService.ts`, `useSupabaseSync.ts` or `repository.ts` without the unit layer, and (for sync/reset) a staging project.
RECOMMENDED NEXT SESSION START:
1. Read this file, then 11-SECURITY-RELIABILITY.md (R1 status table and "The status contract after Option B") and 09-ENGINEERING-AUDIT.md §C. Run `npm run test:run` (expect 93/93) and `npm run typecheck`.
2. If the owner approved: push `restore-and-fix` and `restore-and-fix:main`, `git branch -f main restore-and-fix`, `npx vercel deploy --prod --yes`; then run `node scripts/tests/write-payload-probe.cjs <out> "SHREE ATAM UDYOG" "BHAVYA PRINT-O-FLEX" "3 BROTHERS ( THUKRAL HOSIERY )"` (it aborts every write) and confirm the five results; an urgency toggle must be one request.
3. Session 7 — **R1-B (optimistic concurrency)**: `updateCustomerColumns` gains an `updated_at` predicate (`.eq('updated_at', baselineUpdatedAt)`), a zero-row result is a conflict, the hook reloads the row and tells the user which field was overtaken; decide with the owner what the user sees (silent merge of unrelated columns is already the case; only same-field collisions remain). Pin with the hook tests and the probe. Do not touch the reset, RLS, Gemini or Q11.
4. Then SEC3 (the reset) once Q8 is answered and a staging project exists (Q6).
5. Then Phase 4 UX audit screen by screen, continuing the ledger.
6. Update this file.
LAST UPDATED: 2026-09-17 (Option B session).
