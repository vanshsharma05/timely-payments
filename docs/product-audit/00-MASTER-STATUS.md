# 00 — MASTER STATUS

The authoritative continuation file. Read this first in every session; update it at the end of every meaningful work period.

PROJECT: Timely Payment — Shori Chemicals' receivables follow-up app (customer book, follow-up queue, PDC cheques, reports, live stock).
STACK: React 18 + TypeScript 5 + Vite 5 + Tailwind v4 (browser) · Express 5 dev server / Vercel serverless functions `api/*.ts` (server) · Supabase (Postgres + Auth + RLS) · Google Sheets CSV as the source of balances and stock · Nodemailer/Resend for the daily email · Google Gemini for the AI report · Vercel hosting. See 01-REPOSITORY-MAP.md.

CURRENT PHASE: Engineering batch 2 done (R1 Option A — column-level customer writes). Phases 0–3 done; Phase 4 (UX) and the remaining fix batches (Option B, then the reset) not started.
CURRENT SUBPHASE: —
LAST COMPLETED TASK: Option A session 2026-09-17 (fifth): customer writes now carry only the columns that changed since this tab last saved the row (`customerRowDiff` → `updateCustomerColumns`), with a per-row last-successfully-saved baseline in `useCollectionSync`; whole-row `updateCustomers` removed. 41 new tests (77 total); five-scenario interception probe (all writes aborted). **Committed locally only — not pushed, not deployed** (session rule).
CURRENT TASK: None in progress.
NEXT TASK: Decide on pushing/deploying Option A (owner). Then Session 6 — Option B: stop persisting the derived `status` (R1-C), behind the unit layer and the probe. See RECOMMENDED NEXT SESSION START.

BASELINE BUILD STATUS (2026-09-16, commit de60fc7):
- `npm run typecheck` (tsc --noEmit, strict): PASS, 0 errors.
- `npm run build` (tsc + vite build + esbuild server bundle): PASS. One warning: main chunk `index-*.js` 724.6 kB minified (177.8 kB gzip) exceeds the 700 kB `chunkSizeWarningLimit`. Other chunks: sheets (xlsx) 492 kB / 161 kB gzip, react 134 kB, markdown 126 kB, CSS 153 kB / 22 kB gzip.
- `npm run check:classes`: 2 pre-existing findings (`grid-frame` in AppLogo.tsx, `stroke-based` in Icons.tsx — harmless false positives).
- `npm run check:empty`: clean.
- Lint: NO linter configured. Type-check is the only static gate.
- Unit/integration tests: NONE at baseline. **Since 2026-09-17: Vitest, 77 tests, `npm run test:run`.** Browser suites in `scripts/tests/` (no runner yet) and `scripts/` QA scripts.
- `npm audit --omit=dev`: nodemailer 9.0.6 HIGH (fix available), qs 6.15.3 MODERATE via express (fix available). Dev-only: `tar` critical and `undici` under the `vercel` CLI.
- Runtime: Node v24.15.0, npm 11.12.1. No `engines` field. Two lockfiles (`package-lock.json` AND `bun.lock`) — kept for now by owner's instruction (D5).
CURRENT BUILD STATUS: tsc clean; `npm run build` clean (same chunk warning); `check:classes` 2 pre-existing; `check:empty` clean — after Option A. No dependency change this session; `bun.lock` untouched.
BASELINE TEST STATUS: browser suites were green at de60fc7 (see 12-TEST-STRATEGY.md). Classified for production safety in Phase 1: 7 READ ONLY, 2 CONTROLLED MUTATION WITH CLEANUP, 1 READ ONLY-but-fragile (`phone-test.cjs`), 0 UNSAFE. None executed this session.
CURRENT TEST STATUS: unit 77/77 (money 23, edit dialog 13, `customerRowDiff` 11, `updateCustomerColumns` 5, `useCollectionSync` 12, `syncFlows` 13). Interception probe (all writes aborted) on the Option A build: no-change Save → 0 requests; phone → `[contact_number]`; owner dropdown → `[crm_owner_id]`; urgent → `[is_urgent,last_follow_up_on]`; balance sync 684 reviewed rows → 10 money-only PATCHes (avg 120 bytes). Three production rows re-read unchanged. Browser suites not run (none exercise the write path beyond what the probe covers; mutating ones remain classified in 12). No staging (Q6).

CRITICAL ISSUES (P0): none confirmed.
IMPORTANT ISSUES:
- ~~P1 · **C1**~~ **RESOLVED 2026-09-17** — the edit dialog no longer rebuilds the row (collector, Dr/Cr types, netted roll-ups, `settled_at`, PAN, Completed status and owner spelling all survive an unrelated Save). Regression: 13 cases in `tests/customerEditModal.dom.test.tsx`. Deployment: see DEPLOY NOTE below.
- **R1 split (11, R1 status table):** ~~R1-A unrelated-field overwrite by whole-row PATCH~~ **EXPECTED FIXED (Option A, committed locally)**; **R1-B same-field last-writer-wins — OPEN (P2)**, needs optimistic concurrency; **R1-C derived `status` persisted by `processStatuses` — REDUCED to one-column writes, still redundant (P2)**: 172 rows carried a stale status at 00:45 IST on 2026-09-17, so the first edit today issues 172 `{status}` PATCHes; Option B (Session 6) removes them.
- P1 · **SEC3 (CONFIRMED, traced)** The reset is one `confirm()` for Admin or Manager; for an Admin it deletes 144 cheques, 672 legacy-id accounts *with their threads*, ~2,700 settled accounts, and re-creates the sheet's accounts under new ids; no audit, backup or undo; not transactional. Technical requirements T1–T6 vs business decision Q8 in 11 §3.2.
- P1 · No unit tests for the money rules in `types.ts`; no single test command. (12)
- P1 · `App.tsx` god component — now mapped in 09 §A with extraction boundaries; do not split before tests exist.
- P2 · **SEC1** reclassified INTENTIONAL TRUST MODEL (documented in schema/ARCHITECTURE) + pending policy decision Q14. **SEC2** DEFENSE-IN-DEPTH WEAKNESS, a documented consequence of whole-row writes (fixable after Option A). **SEC4** DEFENSE-IN-DEPTH (latent; depends on a dashboard switch). **SEC5** PRIVACY/POLICY (Q9; exact payload in 11 Part 5).
- P2 · Duplicated business logic D1–D8 (scoping rule in browser and digest; status stored+derived ×3; notes mirrored; two "expected payment" notions; two performance scores; roll-up netting ×3; sheet URLs ×2). (03 §9)
- P2 · Production dependency advisories (nodemailer, qs). Docs drift (`ARCHITECTURE.md` §9.1–9.2). Bundle size (xlsx for everyone).
- P3 · Dead right `canEditFinancials`; dead column `customers.updated_by`; legacy enum values; stray root files.

CURRENT DESIGN WORK: none. UX findings U1–U23 classified in 06 (17 CONFIRMED BY CODE, 3 CONFIRMED BY RUNNING UI, 3 BUSINESS-DEPENDENT/HYPOTHESIS); journeys J1–J16 in 05.
CURRENT ENGINEERING WORK: batch 2 complete (Option A), **committed locally on `restore-and-fix`, not pushed, not deployed** — this session's rule overrides the standing push-live instruction; the owner decides after reading the report. Deploy sequence when approved: push both branches, `npx vercel deploy --prod --yes`, then re-run the interception probe against the live site (it can point at production because it aborts every write).
FILES REVIEWED: 17 Full + 20 Partial of 93 (18-FILE-AUDIT-LEDGER.md). This session: `useSupabaseSync.ts` and `repository.ts` re-reviewed in full after the change; new Full: `tests/customerRowDiff.test.ts`, `tests/updateCustomerColumns.test.ts`, `tests/useCollectionSync.dom.test.tsx`, `tests/syncFlows.test.ts`; probe script updated.
FILES REMAINING: 56 not yet opened at audit depth; 20 partials to complete in Phase 8.
CHANGES NOT YET VERIFIED: Option A is verified by 77 unit tests, typecheck, build and the interception probe, but has not been deployed or exercised by a human; the C1 fix is live since a0f0a31.
OPEN QUESTIONS: Q1–Q14 in 19-OPEN-QUESTIONS.md, now as decision briefs for Q7, Q8, Q9, Q11, Q12, Q13, Q14. Blocking nothing; Q6 (staging), Q8 (reset) and Q14 (isolation) shape the fix batches.
DECISIONS REQUIRED: none to continue Phase 4. Before the reset fix: Q8. Before RLS tightening: Q14. Before destructive tests: Q6. D7 records the recommended R1 remediation.
REGRESSION RISKS (Option A): the persistence contract changed for customers only — cheques/templates unchanged. A row whose only difference is jsonb key order no longer writes (intended). A failed row no longer blocks other rows' baseline advance (intended; each retries on its own). The sync error banner now names the account id rather than the company (T32). If `outstandingToRow` ever gains a column, the diff picks it up automatically; if a column were removed from it, that column could never be written again — `CustomerRow` is the single place to look. Standing: any change to `App.tsx`, `types.ts`, `googleSheetService.ts`, `useSupabaseSync.ts` or `repository.ts` without the unit layer, and (for sync/reset) a staging project.
RECOMMENDED NEXT SESSION START:
1. Read this file, then 11-SECURITY-RELIABILITY.md (R1 status table at the top) and 09-ENGINEERING-AUDIT.md §C. Run `npm run test:run` (expect 77/77) and `npm run typecheck`.
2. If the owner approved: push `restore-and-fix` and `restore-and-fix:main`, `git branch -f main restore-and-fix`, `npx vercel deploy --prod --yes`; then run `node scripts/tests/write-payload-probe.cjs <out> "SHREE ATAM UDYOG" "BHAVYA PRINT-O-FLEX" "3 BROTHERS ( THUKRAL HOSIERY )"` against a dev server pointed at the deployed build (it aborts every write) and confirm the same five results.
3. Session 6 — **Option B (R1-C)**: `processStatuses` stops writing `status` (readers switch to `getFollowUpCategory`: the book's Status filter, `StatusBadge`, the digest's tag, `FollowUpModal.handleSave` branches, `notificationSummary`); keep `status` writes only for user outcomes (Completed / explicit date). Pin with `tests/syncFlows.test.ts` ("a follow-up save must not touch rows the user did not open") and the probe (an urgency toggle after midnight → one PATCH, not 172). Do not touch the reset, RLS or Q11.
4. Then decide R1-B (optimistic concurrency on `updated_at`) with the owner — it changes what the user sees on a conflict.
5. Then Phase 4 UX audit screen by screen, continuing the ledger.
6. Update this file.
LAST UPDATED: 2026-09-17 (Option A session).
