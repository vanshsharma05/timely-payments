# 00 — MASTER STATUS

The authoritative continuation file. Read this first in every session; update it at the end of every meaningful work period.

PROJECT: Timely Payment — Shori Chemicals' receivables follow-up app (customer book, follow-up queue, PDC cheques, reports, live stock).
STACK: React 18 + TypeScript 5 + Vite 5 + Tailwind v4 (browser) · Express 5 dev server / Vercel serverless functions `api/*.ts` (server) · Supabase (Postgres + Auth + RLS) · Google Sheets CSV as the source of balances and stock · Nodemailer/Resend for the daily email · Google Gemini for the AI report · Vercel hosting. See 01-REPOSITORY-MAP.md.

CURRENT PHASE: Engineering batch 6 done (reliability of daily use: honest saves + fresh tabs; committed locally, NOT deployed). Batches 2–5 live. Phases 0–3 done; Phase 4 (UX) not started; R1-B waits on Q15.
CURRENT SUBPHASE: —
LAST COMPLETED TASK: Reliability session 2026-09-17 (eleventh): `useCollectionSync` gained `flush()` (per-row verdict), automatic retry with backoff and on focus/online, `onStatus`, `accept`/`forget`; the follow-up, edit and cheque dialogs wait for the verdict and stay open with everything typed on a refusal; success messages only after acceptance; bulk actions report "saved N of M"; a persistent refused-write banner and a `SaveStatus` header line on every page; the book is re-read on return to the tab / every 5 min / reconnect / Refresh button with a pending-aware merge (`services/refresh.ts`) and paused while a dialog is open. 18 new tests (167). Browser probe with every write aborted confirmed the whole path. Production untouched.
CURRENT TASK: None in progress.
NEXT TASK: Owner approves the deploy of batch 6 (no SQL change; 17-RELEASE-CHECKLIST.md). Then Q15 → R1-B. See RECOMMENDED NEXT SESSION START.

BASELINE BUILD STATUS (2026-09-16, commit de60fc7):
- `npm run typecheck` (tsc --noEmit, strict): PASS, 0 errors.
- `npm run build` (tsc + vite build + esbuild server bundle): PASS. One warning: main chunk `index-*.js` 724.6 kB minified (177.8 kB gzip) exceeds the 700 kB `chunkSizeWarningLimit`. Other chunks: sheets (xlsx) 492 kB / 161 kB gzip, react 134 kB, markdown 126 kB, CSS 153 kB / 22 kB gzip.
- `npm run check:classes`: 2 pre-existing findings (`grid-frame` in AppLogo.tsx, `stroke-based` in Icons.tsx — harmless false positives).
- `npm run check:empty`: clean.
- Lint: NO linter configured. Type-check is the only static gate.
- Unit/integration tests: NONE at baseline. **Since 2026-09-17: Vitest, 167 tests, `npm run test:run`** (incl. 24 SQL tests in PGlite). Browser suites in `scripts/tests/` (no runner yet) and `scripts/` QA scripts.
- `npm audit --omit=dev`: nodemailer 9.0.6 HIGH (fix available), qs 6.15.3 MODERATE via express (fix available). Dev-only: `tar` critical and `undici` under the `vercel` CLI.
- Runtime: Node v24.15.0, npm 11.12.1. No `engines` field. Two lockfiles (`package-lock.json` AND `bun.lock`) — kept for now by owner's instruction (D5).
CURRENT BUILD STATUS: tsc clean; `npm run build` clean (same chunk warning); `check:classes` 2 pre-existing; `check:empty` clean — after the reliability batch. No dependency change.
BASELINE TEST STATUS: browser suites were green at de60fc7 (see 12-TEST-STRATEGY.md). Classified for production safety in Phase 1: 7 READ ONLY, 2 CONTROLLED MUTATION WITH CLEANUP, 1 READ ONLY-but-fragile (`phone-test.cjs`), 0 UNSAFE. None executed this session.
CURRENT TEST STATUS: unit 167/167 (money 23, edit dialog 13, `customerRowDiff` 11, `updateCustomerColumns` 5, `useCollectionSync` 12, `syncFlows` 14, `derivedStatus` 16, `statusContract` 15, `resetPlan` 10, `resetSql` 24, `resetConfirmModal` 6, `saveFailures` 13, `refreshMerge` 5). Local browser probe (every write aborted) on the reliability batch: refused save → dialog open with the reason, typed values kept; header "1 change not saved · Retry now"; persistent banner with countdown; one write attempt; automatic retry at +5.2 s; Refresh re-reads 5 pages and keeps the unsaved row; Retry now. Production re-read unchanged (4,027 / 144; newest write 12:29 IST). Live-site probes unchanged since the fresh-start deploy.

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
CURRENT ENGINEERING WORK: batch 6 (reliability) **committed locally on `restore-and-fix`, not pushed, not deployed**. No SQL prerequisite. DEPLOYMENT STATE: production = `dpl_7mKQWQGhHHNKGnLcDe7Y13EgvHKq` = `3fbe7f7` (+ docs `373af34` on the branches). When approved: gate + push + deploy per 17, then the smoke test and both probes, plus the reliability probe (`scratchpad/reliability-probe.cjs` pattern: a refused save must show in the dialog and the header).
FILES REVIEWED: 31 Full + 22 Partial of 107 (18-FILE-AUDIT-LEDGER.md). This session: `useSupabaseSync.ts` rewritten (Full); `PdcModal.tsx` submit path (Partial); new Full: `services/refresh.ts`, `components/SaveStatus.tsx`, two test files.
FILES REMAINING: 54 not yet opened at audit depth; 22 partials to complete in Phase 8.
CHANGES NOT YET VERIFIED: the reliability batch is verified by 18 unit tests, typecheck, build and a write-aborted browser probe on the local build, but is not deployed and not yet exercised by a human.
OPEN QUESTIONS: Q1–Q14 in 19-OPEN-QUESTIONS.md, now as decision briefs for Q7, Q8, Q9, Q11, Q12, Q13, Q14. Blocking nothing; Q6 (staging), Q8 (reset) and Q14 (isolation) shape the fix batches.
DECISIONS REQUIRED: none to continue Phase 4. Before the reset fix: Q8. Before RLS tightening: Q14. Before destructive tests: Q6. D7 records the recommended R1 remediation.
REGRESSION RISKS (reliability batch): dialogs now wait ~0–1 s for the server before closing (a "Saving…" state); a slow network shows that wait where it used to close instantly. A refused write is now loud (banner stays until saved) — expected. The refresh replaces rows the tab has not changed; a dialog open on a row pauses it (T46). `handleUpdateOutstanding` / `handleSaveCustomer` / `handleSavePdc` return promises — any new caller that ignores the outcome still gets the old fire-and-forget behaviour. Standing: any change to `App.tsx`, `types.ts`, `googleSheetService.ts`, `useSupabaseSync.ts`, `repository.ts`, the dialogs or `supabase/*.sql` without the unit layer.
RECOMMENDED NEXT SESSION START:
1. Read this file, then 11-SECURITY-RELIABILITY.md (Part 3b the reliability batch; §2.2 the concurrency brief) and 19 Q15. Run `npm run test:run` (expect 167/167) and `npm run typecheck`.
2. If the owner approved: deploy batch 6 per 17-RELEASE-CHECKLIST.md (no SQL step), then the smoke test, both probes and a write-aborted check that a refused save is shown in the dialog and the header.
3. Session 12 — R1-B per 11 §2.2, only after Q15 is answered (field-aware compare-and-set on the baseline; conflict shown through the same `SaveOutcome` path the dialogs now have).
4. Then T44 (refresh cheques/templates the same way); then Phase 4 UX audit, continuing the ledger (U24, T36, T37, T40, T45, T46 are on the list).
5. Update this file.
LAST UPDATED: 2026-09-17 (reliability session, eleventh).
