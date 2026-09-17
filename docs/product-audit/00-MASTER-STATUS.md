# 00 — MASTER STATUS

The authoritative continuation file. Read this first in every session; update it at the end of every meaningful work period.

PROJECT: Timely Payment — Shori Chemicals' receivables follow-up app (customer book, follow-up queue, PDC cheques, reports, live stock).
STACK: React 18 + TypeScript 5 + Vite 5 + Tailwind v4 (browser) · Express 5 dev server / Vercel serverless functions `api/*.ts` (server) · Supabase (Postgres + Auth + RLS) · Google Sheets CSV as the source of balances and stock · Nodemailer/Resend for the daily email · Google Gemini for the AI report · Vercel hosting. See 01-REPOSITORY-MAP.md.

CURRENT PHASE: Engineering batches 2–4 (Option A, Option B, status contract) **DEPLOYED 2026-09-17**. Phases 0–3 done; Phase 4 (UX) and the remaining fix batches (R1-B after the owner answers Q15, then the reset) not started.
CURRENT SUBPHASE: —
LAST COMPLETED TASK: Deploy session 2026-09-17 (eighth): `ee61d6f` + `2afb5d8` + `de2d1c5` pushed to `restore-and-fix` and `main` (both at `de2d1c5`), deployed as `dpl_8NB7JLzJoSuCKsecBwz7WiycZBgJ` (10:49:47 IST, Ready, production); live bundles byte-identical to the local build of `de2d1c5`; production smoke 11/11 (read-only); both probes against the live site match the recorded results; no destructive action. The two probes now take `PROBE_BASE`.
CURRENT TASK: None in progress.
NEXT TASK: Owner answers Q15 (conflict policy). Then Session 9 implements R1-B per 11 §2.2. See RECOMMENDED NEXT SESSION START.

BASELINE BUILD STATUS (2026-09-16, commit de60fc7):
- `npm run typecheck` (tsc --noEmit, strict): PASS, 0 errors.
- `npm run build` (tsc + vite build + esbuild server bundle): PASS. One warning: main chunk `index-*.js` 724.6 kB minified (177.8 kB gzip) exceeds the 700 kB `chunkSizeWarningLimit`. Other chunks: sheets (xlsx) 492 kB / 161 kB gzip, react 134 kB, markdown 126 kB, CSS 153 kB / 22 kB gzip.
- `npm run check:classes`: 2 pre-existing findings (`grid-frame` in AppLogo.tsx, `stroke-based` in Icons.tsx — harmless false positives).
- `npm run check:empty`: clean.
- Lint: NO linter configured. Type-check is the only static gate.
- Unit/integration tests: NONE at baseline. **Since 2026-09-17: Vitest, 109 tests, `npm run test:run`.** Browser suites in `scripts/tests/` (no runner yet) and `scripts/` QA scripts.
- `npm audit --omit=dev`: nodemailer 9.0.6 HIGH (fix available), qs 6.15.3 MODERATE via express (fix available). Dev-only: `tar` critical and `undici` under the `vercel` CLI.
- Runtime: Node v24.15.0, npm 11.12.1. No `engines` field. Two lockfiles (`package-lock.json` AND `bun.lock`) — kept for now by owner's instruction (D5).
CURRENT BUILD STATUS: tsc clean; `npm run build` clean (same chunk warning); `check:classes` 2 pre-existing; `check:empty` clean — after the status contract. No dependency change; `bun.lock` untouched.
BASELINE TEST STATUS: browser suites were green at de60fc7 (see 12-TEST-STRATEGY.md). Classified for production safety in Phase 1: 7 READ ONLY, 2 CONTROLLED MUTATION WITH CLEANUP, 1 READ ONLY-but-fragile (`phone-test.cjs`), 0 UNSAFE. None executed this session.
CURRENT TEST STATUS: unit 109/109 (money 23, edit dialog 13, `customerRowDiff` 11, `updateCustomerColumns` 5, `useCollectionSync` 12, `syncFlows` 14, `derivedStatus` 16, `statusContract` 15). Probes (all writes aborted): `write-payload-probe.cjs` five Option A results (fifth session); `status-contract-probe.cjs` with the tab clock +1 day: urgency → `[is_urgent,last_follow_up_on]`; collected → `[follow_up_date,is_urgent,last_follow_up_on,status]` status "Completed" (is_urgent rides along from the aborted first scenario); edit-dialog date on a second account → `[follow_up_date]`. Production re-read unchanged (4,027 rows; newest write 2026-09-17T01:03Z; stored words Pending 3365 / Upcoming 527 / Completed 18 / Today 109 / Overdue 8; 172 stale; 0 no-date rows with a derived word). No staging (Q6).

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
CURRENT ENGINEERING WORK: nothing in flight. DEPLOYMENT STATE (verified 2026-09-17 10:55 IST): production = `dpl_8NB7JLzJoSuCKsecBwz7WiycZBgJ` = commit `de2d1c5` (C1 `a0f0a31`, Option A `ee61d6f`, Option B `2afb5d8`, status contract `de2d1c5` all live); `origin/restore-and-fix` = `origin/main` = local `main` = `de2d1c5`. Previous production deployment `dpl_7Ty9spNVb8zqPATuisZbUzvHf1sv` (C1 build) remains promotable for rollback. Deploy procedure recorded in 17-RELEASE-CHECKLIST.md.
FILES REVIEWED: 20 Full + 22 Partial of 96 (18-FILE-AUDIT-LEDGER.md). This session: `FollowUpModal.tsx` save path and `CustomerEditModal.tsx` re-read after the change; new Full: `tests/statusContract.dom.test.tsx`, `scripts/tests/status-contract-probe.cjs`.
FILES REMAINING: 54 not yet opened at audit depth; 22 partials to complete in Phase 8.
CHANGES NOT YET VERIFIED: none by tooling — Options A, B and the status contract are live and verified by unit tests, byte comparison of the deployed bundles, a read-only smoke test and both interception probes against the live site (verification re-run in full at 11:00 IST after the owner's own push/deploy: production still `dpl_8NB7JLzJoSuCKsecBwz7WiycZBgJ`, no newer deployment; branches at `6e81948`; bundles identical; smoke 11/11; probes identical; newest production write still 05:15Z, before the deploy). Not yet exercised by a human on the live build (the team was saving follow-ups on the previous build at 10:45 IST the same morning; their three saves carried the old status words, as expected of that build).
OPEN QUESTIONS: Q1–Q14 in 19-OPEN-QUESTIONS.md, now as decision briefs for Q7, Q8, Q9, Q11, Q12, Q13, Q14. Blocking nothing; Q6 (staging), Q8 (reset) and Q14 (isolation) shape the fix batches.
DECISIONS REQUIRED: none to continue Phase 4. Before the reset fix: Q8. Before RLS tightening: Q14. Before destructive tests: Q6. D7 records the recommended R1 remediation.
REGRESSION RISKS (status contract): a reopen now writes `Pending` where it wrote Today/Upcoming/Overdue — no reader distinguishes them. A row with no date and a stale word now reads Pending instead of the word (0 production rows). The follow-up dialog's default outcome still reopens a collected account on a plain Save (U24 — unchanged, pinned). Standing: any change to `App.tsx`, `types.ts`, `googleSheetService.ts`, `useSupabaseSync.ts`, `repository.ts` or the two dialogs without the unit layer, and (for sync/reset) a staging project.
RECOMMENDED NEXT SESSION START:
1. Read this file, then 11-SECURITY-RELIABILITY.md (R1 status table, the status contract with the writer table, §2.2 the concurrency brief) and 19 Q15. Run `npm run test:run` (expect 109/109) and `npm run typecheck`. Confirm `npx vercel ls --prod` still shows `dpl_8NB7JLzJoSuCKsecBwz7WiycZBgJ`.
2. Session 9 — **R1-B per 11 §2.2, only after Q15 is answered**: `updateCustomerColumns(id, changes, expected)` with one `eq`/`is` per changed column from Option A's baseline (never `last_follow_up_on`; `notes` auto-merged), zero rows → re-fetch by id → conflict (or "removed"); the hook reports the conflict with field, attempted value and server value; the smallest conflict experience the owner accepts (toast first). Probe the jsonb `eq` on `notes` before relying on it. Do not touch the reset, RLS, Gemini or Q11. Deploy only with the gate + both probes (17-RELEASE-CHECKLIST.md).
3. Then a focus/visibility refetch of the book following `services/liveStock.ts` (T39), with the merge rule for rows holding unsaved local edits.
4. Then SEC3 (the reset) once Q8 is answered and a staging project exists (Q6); then Phase 4 UX audit, continuing the ledger (U24, T36, T37 are on the list).
5. Update this file.
LAST UPDATED: 2026-09-17 (deploy session, eighth; post-deploy verification re-run 11:00 IST).
