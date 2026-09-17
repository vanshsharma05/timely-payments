# 00 — MASTER STATUS

The authoritative continuation file. Read this first in every session; update it at the end of every meaningful work period.

PROJECT: Timely Payment — Shori Chemicals' receivables follow-up app (customer book, follow-up queue, PDC cheques, reports, live stock).
STACK: React 18 + TypeScript 5 + Vite 5 + Tailwind v4 (browser) · Express 5 dev server / Vercel serverless functions `api/*.ts` (server) · Supabase (Postgres + Auth + RLS) · Google Sheets CSV as the source of balances and stock · Nodemailer/Resend for the daily email · Google Gemini for the AI report · Vercel hosting. See 01-REPOSITORY-MAP.md.

CURRENT PHASE: Phase 4 (UX) — batch 2 (the Manager's Today + Reports, and the Live-stock search fix) **committed locally, NOT deployed**. Batches 2–6 and the CRM UX batch (1 + 1b) live.
CURRENT SUBPHASE: —
LAST COMPLETED TASK: CRM-workflow session 2026-09-17 (twelfth): live UI inspected at 1366×768; nine usability problems recorded (06 W1–W9); the follow-up dialog restructured (context header, outcome first, four folded sections, prev/next through the list, Esc, "Save follow-up"); the book decluttered (toolbar, foldable overview by role, uniform two-line rows, plain follow-up wording, hover-only delete, empty-state reset); Esc on every workflow dialog. New `Disclosure` and `useEscape` primitives. 16 new tests (190). No rule, permission, schema or backend change.
CURRENT TASK: None in progress.
NEXT TASK: Owner reviews the Manager/Reports batch (`npm run dev`, sign in as Admin/Manager) and approves its deploy (no SQL step). Then Phase 4 batch 3 (the Data source tab, U14) or R1-B after Q15. See RECOMMENDED NEXT SESSION START.

BASELINE BUILD STATUS (2026-09-16, commit de60fc7):
- `npm run typecheck` (tsc --noEmit, strict): PASS, 0 errors.
- `npm run build` (tsc + vite build + esbuild server bundle): PASS. One warning: main chunk `index-*.js` 724.6 kB minified (177.8 kB gzip) exceeds the 700 kB `chunkSizeWarningLimit`. Other chunks: sheets (xlsx) 492 kB / 161 kB gzip, react 134 kB, markdown 126 kB, CSS 153 kB / 22 kB gzip.
- `npm run check:classes`: 2 pre-existing findings (`grid-frame` in AppLogo.tsx, `stroke-based` in Icons.tsx — harmless false positives).
- `npm run check:empty`: clean.
- Lint: NO linter configured. Type-check is the only static gate.
- Unit/integration tests: NONE at baseline. **Since 2026-09-17: Vitest, 222 tests, `npm run test:run`** (incl. 24 SQL tests in PGlite). Browser suites in `scripts/tests/` (no runner yet) and `scripts/` QA scripts.
- `npm audit --omit=dev`: nodemailer 9.0.6 HIGH (fix available), qs 6.15.3 MODERATE via express (fix available). Dev-only: `tar` critical and `undici` under the `vercel` CLI.
- Runtime: Node v24.15.0, npm 11.12.1. No `engines` field. Two lockfiles (`package-lock.json` AND `bun.lock`) — kept for now by owner's instruction (D5).
CURRENT BUILD STATUS: tsc clean; `npm run build` clean (same chunk warning); `check:classes` 2 pre-existing; `check:empty` clean — after the CRM-workflow batch. No dependency change.
BASELINE TEST STATUS: browser suites were green at de60fc7 (see 12-TEST-STRATEGY.md). Classified for production safety in Phase 1: 7 READ ONLY, 2 CONTROLLED MUTATION WITH CLEANUP, 1 READ ONLY-but-fragile (`phone-test.cjs`), 0 UNSAFE. None executed this session.
CURRENT TEST STATUS: unit 222/222 (money 23, edit dialog 13, `customerRowDiff` 11, `updateCustomerColumns` 5, `useCollectionSync` 12, `syncFlows` 14, `derivedStatus` 16, `statusContract` 16, `resetPlan` 10, `resetSql` 24, `resetConfirmModal` 6, `saveFailures` 13, `refreshMerge` 5, `retryIdempotency` 7, `crmWorkflow` 21, `searchScope` 9, `managerReports` 17). Live-site probes unchanged since the CRM UX deploy. Local visual QA of the Manager/Reports workflow at 1366×768, 1440×900, 1024×768 (every write aborted): 0 findings.

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

CURRENT DESIGN WORK: Phase 4 batch 1 done (06 "Phase 4, batch 1"); batch 2 not started. UX findings U1–U24 in 06; journeys J1–J16 in 05.
CURRENT ENGINEERING WORK: the Manager/Reports batch is **committed locally on `restore-and-fix`, not pushed, not deployed**. DEPLOYMENT STATE: production = `dpl_HeLAK1WcbkKNHo9N8rsunT98YPq5` = commit `6a33c29` (bundles byte-identical); `origin/restore-and-fix` = `origin/main` = `c547770` (docs). Previous deployment `dpl_GfxvXMy7gxHCRTbHSBLJeAkxQn1o` (`7e1136a`) remains promotable. Post-deploy: smoke 12/12, both probes identical to the records, CRM workflow QA at 1366×768 on the live site 0 findings, production unchanged.
FILES REVIEWED: 34 Full + 22 Partial of 110 (18-FILE-AUDIT-LEDGER.md). This session: `FollowUpModal.tsx` restructured (Partial → read end to end for the layout; logic untouched), `CustomerDashboardView.tsx` toolbar/rows re-read; new Full: `Disclosure.tsx`, `useEscape.ts`, `tests/crmWorkflow.dom.test.tsx`.
FILES REMAINING: 54 not yet opened at audit depth; 22 partials to complete in Phase 8.
CHANGES NOT YET VERIFIED: the Manager/Reports batch is verified by 25 unit tests, typecheck, build and local QA at three laptop sizes, but not deployed, not seen by the owner, not used by a manager. The smoke script's Reports check (chips *Overdue / Due today / Upcoming* present, rows > 0) still holds on the new markup; the probes touch the book only.
OPEN QUESTIONS: Q1–Q14 in 19-OPEN-QUESTIONS.md, now as decision briefs for Q7, Q8, Q9, Q11, Q12, Q13, Q14. Blocking nothing; Q6 (staging), Q8 (reset) and Q14 (isolation) shape the fix batches.
DECISIONS REQUIRED: none to continue Phase 4. Before the reset fix: Q8. Before RLS tightening: Q14. Before destructive tests: Q6. D7 records the recommended R1 remediation.
REGRESSION RISKS (CRM workflow): the follow-up dialog's sections are the same markup in a new order inside folds — every field, id and handler is unchanged (pinned: statusContract, saveFailures, retryIdempotency all still pass) — but a fold that is closed hides its fields until opened, so anything that relied on scrolling to "Assign Collector" now opens *Account settings* first; the book rows truncate long contact lines (full text in the tooltip); the delete button is hidden until hover/focus (still there for the roles that had it). Standing: any change to `App.tsx`, `types.ts`, `googleSheetService.ts`, `useSupabaseSync.ts`, `repository.ts`, the dialogs or `supabase/*.sql` without the unit layer.
RECOMMENDED NEXT SESSION START:
1. Read this file, then 06-UX-AUDIT.md ("Phase 4, batch 2") and 11 §2.2 / 19 Q15. Run `npm run test:run` (expect 222/222) and `npm run typecheck`.
2. Confirm `npx vercel ls --prod` still shows `dpl_HeLAK1WcbkKNHo9N8rsunT98YPq5`. The probes now press "Follow up" / "Save follow-up"; the smoke script clears the shared search before leaving the book.
3. If the owner approved the Manager/Reports batch: deploy per 17-RELEASE-CHECKLIST.md (no SQL step), then the smoke test and both probes; the probes press "Follow up" / "Save follow-up" and are unaffected by this batch (the book is untouched).
4. Phase 4 batch 3: the Data source tab (U14); or R1-B after Q15 — the owner's order. Two small follow-ups recorded as T50/T51 (collector drill-down; the with-dues definition).
5. Update this file.
LAST UPDATED: 2026-09-17 (Manager/Reports batch + Live-stock search fix, fifteenth).
