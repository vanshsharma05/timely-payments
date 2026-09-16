# 00 — MASTER STATUS

The authoritative continuation file. Read this first in every session; update it at the end of every meaningful work period.

PROJECT: Timely Payment — Shori Chemicals' receivables follow-up app (customer book, follow-up queue, PDC cheques, reports, live stock).
STACK: React 18 + TypeScript 5 + Vite 5 + Tailwind v4 (browser) · Express 5 dev server / Vercel serverless functions `api/*.ts` (server) · Supabase (Postgres + Auth + RLS) · Google Sheets CSV as the source of balances and stock · Nodemailer/Resend for the daily email · Google Gemini for the AI report · Vercel hosting. See 01-REPOSITORY-MAP.md.

CURRENT PHASE: Engineering batch 1 done (C1 fix + unit-test layer). Phases 0–3 done; Phase 4 (UX) and the remaining fix batches not started.
CURRENT SUBPHASE: —
LAST COMPLETED TASK: C1 session 2026-09-17 (fourth): Vitest layer added (`npm run test:run`, 36 tests, no network); 23 characterisation tests pin the money rules; 13 regression cases against the real edit dialog (11 red before the fix); `CustomerEditModal.handleSubmit` now preserves every field it does not own; probe re-run shows a no-change Save sends nothing. Production untouched.
CURRENT TASK: None in progress.
NEXT TASK: Engineering batch 2 — R1: Option A (column-level diff + partial `updateCustomers`) and Option B (stop persisting derived `status`) in their own controlled session, behind the unit layer and the interception probe. See RECOMMENDED NEXT SESSION START.

BASELINE BUILD STATUS (2026-09-16, commit de60fc7):
- `npm run typecheck` (tsc --noEmit, strict): PASS, 0 errors.
- `npm run build` (tsc + vite build + esbuild server bundle): PASS. One warning: main chunk `index-*.js` 724.6 kB minified (177.8 kB gzip) exceeds the 700 kB `chunkSizeWarningLimit`. Other chunks: sheets (xlsx) 492 kB / 161 kB gzip, react 134 kB, markdown 126 kB, CSS 153 kB / 22 kB gzip.
- `npm run check:classes`: 2 pre-existing findings (`grid-frame` in AppLogo.tsx, `stroke-based` in Icons.tsx — harmless false positives).
- `npm run check:empty`: clean.
- Lint: NO linter configured. Type-check is the only static gate.
- Unit/integration tests: NONE at baseline. **Since 2026-09-17: Vitest, 36 tests, `npm run test:run`.** Browser suites in `scripts/tests/` (no runner yet) and `scripts/` QA scripts.
- `npm audit --omit=dev`: nodemailer 9.0.6 HIGH (fix available), qs 6.15.3 MODERATE via express (fix available). Dev-only: `tar` critical and `undici` under the `vercel` CLI.
- Runtime: Node v24.15.0, npm 11.12.1. No `engines` field. Two lockfiles (`package-lock.json` AND `bun.lock`) — kept for now by owner's instruction (D5).
CURRENT BUILD STATUS: tsc clean; `npm run build` clean (same chunk warning); `check:classes` 2 pre-existing; `check:empty` clean — after the C1 fix. Dev deps added for the test harness only (vitest, jsdom, @testing-library/react, @testing-library/dom); `package-lock.json` updated accordingly; `bun.lock` untouched.
BASELINE TEST STATUS: browser suites were green at de60fc7 (see 12-TEST-STRATEGY.md). Classified for production safety in Phase 1: 7 READ ONLY, 2 CONTROLLED MUTATION WITH CLEANUP, 1 READ ONLY-but-fragile (`phone-test.cjs`), 0 UNSAFE. None executed this session.
CURRENT TEST STATUS: unit 36/36 (`tests/money.test.ts` 23, `tests/customerEditModal.dom.test.tsx` 13). Interception probe re-run after the fix: no PATCH on a no-change edit Save; follow-up urgency toggle still whole-row (R1) with the collector intact; the two production rows re-read unchanged. Browser suites not run this session (the change is confined to the edit dialog, which none of them open; the mutating ones remain classified in 12). No staging environment (Q6).

CRITICAL ISSUES (P0): none confirmed.
IMPORTANT ISSUES:
- ~~P1 · **C1**~~ **RESOLVED 2026-09-17** — the edit dialog no longer rebuilds the row (collector, Dr/Cr types, netted roll-ups, `settled_at`, PAN, Completed status and owner spelling all survive an unrelated Save). Regression: 13 cases in `tests/customerEditModal.dom.test.tsx`. Deployment: see DEPLOY NOTE below.
- P1 · **R1 — OPEN.** Every customer write is still a 36-column PATCH of the tab's snapshot with no version predicate, no realtime, no polling; separate sessions overwrite each other's unrelated fields; `processStatuses` still rewrites every date-crossed row on any follow-up save. C1 removed the dialog's *self-inflicted* corruption only. Remediation options in 11 §2.1; recommended A+B (D7).
- P1 · **SEC3 (CONFIRMED, traced)** The reset is one `confirm()` for Admin or Manager; for an Admin it deletes 144 cheques, 672 legacy-id accounts *with their threads*, ~2,700 settled accounts, and re-creates the sheet's accounts under new ids; no audit, backup or undo; not transactional. Technical requirements T1–T6 vs business decision Q8 in 11 §3.2.
- P1 · No unit tests for the money rules in `types.ts`; no single test command. (12)
- P1 · `App.tsx` god component — now mapped in 09 §A with extraction boundaries; do not split before tests exist.
- P2 · **SEC1** reclassified INTENTIONAL TRUST MODEL (documented in schema/ARCHITECTURE) + pending policy decision Q14. **SEC2** DEFENSE-IN-DEPTH WEAKNESS, a documented consequence of whole-row writes (fixable after Option A). **SEC4** DEFENSE-IN-DEPTH (latent; depends on a dashboard switch). **SEC5** PRIVACY/POLICY (Q9; exact payload in 11 Part 5).
- P2 · Duplicated business logic D1–D8 (scoping rule in browser and digest; status stored+derived ×3; notes mirrored; two "expected payment" notions; two performance scores; roll-up netting ×3; sheet URLs ×2). (03 §9)
- P2 · Production dependency advisories (nodemailer, qs). Docs drift (`ARCHITECTURE.md` §9.1–9.2). Bundle size (xlsx for everyone).
- P3 · Dead right `canEditFinancials`; dead column `customers.updated_by`; legacy enum values; stray root files.

CURRENT DESIGN WORK: none. UX findings U1–U23 classified in 06 (17 CONFIRMED BY CODE, 3 CONFIRMED BY RUNNING UI, 3 BUSINESS-DEPENDENT/HYPOTHESIS); journeys J1–J16 in 05.
CURRENT ENGINEERING WORK: batch 1 complete (C1). DEPLOY NOTE: the owner's standing instruction is to push every finished update live; the C1 commit is pushed to both branches and deployed with the usual sequence at the end of this session (recorded in 16-CHANGELOG.md).
FILES REVIEWED: 13 Full + 20 Partial of 89 (18-FILE-AUDIT-LEDGER.md). This session: `CustomerEditModal.tsx` Partial → Full (fixed); new Full: `vitest.config.ts`, `tests/fixtures.ts`, `tests/money.test.ts`, `tests/customerEditModal.dom.test.tsx`.
FILES REMAINING: 56 not yet opened at audit depth; 20 partials to complete in Phase 8.
CHANGES NOT YET VERIFIED: none — the C1 fix is verified by unit tests, typecheck, build and the interception probe; it has not yet been exercised by a human in the running app.
OPEN QUESTIONS: Q1–Q14 in 19-OPEN-QUESTIONS.md, now as decision briefs for Q7, Q8, Q9, Q11, Q12, Q13, Q14. Blocking nothing; Q6 (staging), Q8 (reset) and Q14 (isolation) shape the fix batches.
DECISIONS REQUIRED: none to continue Phase 4. Before the reset fix: Q8. Before RLS tightening: Q14. Before destructive tests: Q6. D7 records the recommended R1 remediation.
REGRESSION RISKS: the C1 change alters what the edit dialog hands to `handleSaveCustomer`: an unchanged owner keeps its stored spelling (was normalised); an unchanged date keeps its stored status (was re-derived); an Admin's untouched money block is no longer rewritten. All three are intended and documented in 11 §1.4. Standing: any change to `App.tsx`, `types.ts`, `googleSheetService.ts`, `useSupabaseSync.ts` or `repository.ts` without the unit layer and the browser suites, and (for sync/reset) a staging project.
RECOMMENDED NEXT SESSION START:
1. Read this file, 11-SECURITY-RELIABILITY.md §1.1–§2.1 and 15-DECISIONS.md D7. Run `npm run test:run` (expect 36/36) and `npm run typecheck`.
2. Engineering batch 2 — **R1, Option A**: in `services/useSupabaseSync.ts` keep the last-synced *row object* (`outstandingToRow`) per id alongside the signature; on change, compute the column diff and call a new `repo.updateCustomerColumns(id, partial)` (PATCH only changed keys; a cleared field must still go as `null`). Write `tests/useCollectionSync.test.ts` with `renderHook` + fake timers and a fake upsert to prove: no change → no call; one field → one key; cleared field → `null`. Verify with the interception probe: an urgency toggle must send `is_urgent` and `last_follow_up_on` only.
3. **Option B** in the same or the following session: `processStatuses` stops writing `status` (readers switch to `getFollowUpCategory`); pin with tests; probe: a follow-up save must not PATCH rows the user did not touch.
4. Then Phase 4 UX audit screen by screen, continuing the ledger.
5. Update this file.
LAST UPDATED: 2026-09-17 (C1 session).
