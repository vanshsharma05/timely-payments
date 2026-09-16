# 00 — MASTER STATUS

The authoritative continuation file. Read this first in every session; update it at the end of every meaningful work period.

PROJECT: Timely Payment — Shori Chemicals' receivables follow-up app (customer book, follow-up queue, PDC cheques, reports, live stock).
STACK: React 18 + TypeScript 5 + Vite 5 + Tailwind v4 (browser) · Express 5 dev server / Vercel serverless functions `api/*.ts` (server) · Supabase (Postgres + Auth + RLS) · Google Sheets CSV as the source of balances and stock · Nodemailer/Resend for the daily email · Google Gemini for the AI report · Vercel hosting. See 01-REPOSITORY-MAP.md.

CURRENT PHASE: Phase 3 — User journeys (first pass complete). Phases 0–2 done; the P1 findings from Phase 1 are now validated with evidence (11-SECURITY-RELIABILITY.md).
CURRENT SUBPHASE: —
LAST COMPLETED TASK: Validation session 2026-09-17 (third): R1 confirmed by captured write payloads; `processStatuses` traced; SEC3 traced to the database with production counts; SEC1/2/4/5 reclassified; C1 found (edit dialog corrupts money/collector); decision briefs Q7–Q14; journeys J1–J16 (05); UX U1–U23 classified (06); probe script `scripts/tests/write-payload-probe.cjs` added.
CURRENT TASK: None in progress.
NEXT TASK: Owner answers to Q6/Q8/Q14 are wanted but not blocking. Next engineering-grade step: the P1 fix batch (C1, then partial writes + derived status) behind unit tests — see RECOMMENDED NEXT SESSION START.

BASELINE BUILD STATUS (2026-09-16, commit de60fc7):
- `npm run typecheck` (tsc --noEmit, strict): PASS, 0 errors.
- `npm run build` (tsc + vite build + esbuild server bundle): PASS. One warning: main chunk `index-*.js` 724.6 kB minified (177.8 kB gzip) exceeds the 700 kB `chunkSizeWarningLimit`. Other chunks: sheets (xlsx) 492 kB / 161 kB gzip, react 134 kB, markdown 126 kB, CSS 153 kB / 22 kB gzip.
- `npm run check:classes`: 2 pre-existing findings (`grid-frame` in AppLogo.tsx, `stroke-based` in Icons.tsx — harmless false positives).
- `npm run check:empty`: clean.
- Lint: NO linter configured. Type-check is the only static gate.
- Unit/integration tests: NONE. Browser suites in `scripts/tests/` (no runner yet) and `scripts/` QA scripts.
- `npm audit --omit=dev`: nodemailer 9.0.6 HIGH (fix available), qs 6.15.3 MODERATE via express (fix available). Dev-only: `tar` critical and `undici` under the `vercel` CLI.
- Runtime: Node v24.15.0, npm 11.12.1. No `engines` field. Two lockfiles (`package-lock.json` AND `bun.lock`) — kept for now by owner's instruction (D5).
CURRENT BUILD STATUS: unchanged — no application code has changed since the baseline (commits 99146b8, 009bdd5 and this session are docs + one read-only probe script).
BASELINE TEST STATUS: browser suites were green at de60fc7 (see 12-TEST-STRATEGY.md). Classified for production safety in Phase 1: 7 READ ONLY, 2 CONTROLLED MUTATION WITH CLEANUP, 1 READ ONLY-but-fragile (`phone-test.cjs`), 0 UNSAFE. None executed this session.
CURRENT TEST STATUS: same as baseline. No staging environment (Q6). New: `write-payload-probe.cjs` (READ ONLY by interception) ran on 2026-09-17; the two rows it touched were re-read and are unchanged.

CRITICAL ISSUES (P0): none confirmed.
IMPORTANT ISSUES:
- P1 · **C1 (new, CONFIRMED)** `CustomerEditModal` Save rebuilds the row: drops the collector (137 accounts exposed), flattens Dr/Cr ageing types (13), recomputes `over90`/`due_over45` as absolute sums (6 owing accounts would change), clears `settled_at` (69) — even with the money inputs disabled. Captured PATCH bodies in 11 §1.4.
- P1 · **R1 (CONFIRMED by evidence)** Every customer write is a 36-column PATCH of the tab's snapshot with no version predicate, no realtime, no polling; separate sessions overwrite each other's unrelated fields. `processStatuses` turns every follow-up save into a whole-row rewrite of every date-crossed row (126 due today flip at midnight). Remediation options designed in 11 §2.1 (recommended A+B+C1 fix, D7).
- P1 · **SEC3 (CONFIRMED, traced)** The reset is one `confirm()` for Admin or Manager; for an Admin it deletes 144 cheques, 672 legacy-id accounts *with their threads*, ~2,700 settled accounts, and re-creates the sheet's accounts under new ids; no audit, backup or undo; not transactional. Technical requirements T1–T6 vs business decision Q8 in 11 §3.2.
- P1 · No unit tests for the money rules in `types.ts`; no single test command. (12)
- P1 · `App.tsx` god component — now mapped in 09 §A with extraction boundaries; do not split before tests exist.
- P2 · **SEC1** reclassified INTENTIONAL TRUST MODEL (documented in schema/ARCHITECTURE) + pending policy decision Q14. **SEC2** DEFENSE-IN-DEPTH WEAKNESS, a documented consequence of whole-row writes (fixable after Option A). **SEC4** DEFENSE-IN-DEPTH (latent; depends on a dashboard switch). **SEC5** PRIVACY/POLICY (Q9; exact payload in 11 Part 5).
- P2 · Duplicated business logic D1–D8 (scoping rule in browser and digest; status stored+derived ×3; notes mirrored; two "expected payment" notions; two performance scores; roll-up netting ×3; sheet URLs ×2). (03 §9)
- P2 · Production dependency advisories (nodemailer, qs). Docs drift (`ARCHITECTURE.md` §9.1–9.2). Bundle size (xlsx for everyone).
- P3 · Dead right `canEditFinancials`; dead column `customers.updated_by`; legacy enum values; stray root files.

CURRENT DESIGN WORK: none. UX findings U1–U23 classified in 06 (17 CONFIRMED BY CODE, 3 CONFIRMED BY RUNNING UI, 3 BUSINESS-DEPENDENT/HYPOTHESIS); journeys J1–J16 in 05.
CURRENT ENGINEERING WORK: none. App.tsx responsibility map and extraction boundaries in 09 §A.
FILES REVIEWED: 8 Full + 21 Partial of 85 (18-FILE-AUDIT-LEDGER.md). Newly Partial this session: `CustomerEditModal`, `AiReportModal`, `WhatsAppReminderModal`, `PdcModal`, `UserModal`, `LoginScreen`, `AlertsView`, `README.md`, `ARCHITECTURE.md`; deepened: `App.tsx`, `googleSheetService.ts`, `FollowUpModal`, `api/_lib/report.ts`. New Full: `scripts/tests/write-payload-probe.cjs`.
FILES REMAINING: 56 not yet opened at audit depth; 21 partials to complete in Phase 8.
CHANGES NOT YET VERIFIED: none (docs only).
OPEN QUESTIONS: Q1–Q14 in 19-OPEN-QUESTIONS.md, now as decision briefs for Q7, Q8, Q9, Q11, Q12, Q13, Q14. Blocking nothing; Q6 (staging), Q8 (reset) and Q14 (isolation) shape the fix batches.
DECISIONS REQUIRED: none to continue Phase 4. Before the reset fix: Q8. Before RLS tightening: Q14. Before destructive tests: Q6. D7 records the recommended R1 remediation.
REGRESSION RISKS: none introduced. Standing: any change to `App.tsx`, `types.ts`, `googleSheetService.ts`, `useSupabaseSync.ts` or `repository.ts` without the browser suites and (for sync/reset) a staging project.
RECOMMENDED NEXT SESSION START:
1. Read this file, then 11-SECURITY-RELIABILITY.md Parts 1–3 and 15-DECISIONS.md D7.
2. If the owner has answered Q8/Q14, record the answers in 19 and 15.
3. Engineering batch 1 (smallest, highest value, no policy dependency): **fix C1** — make `CustomerEditModal.handleSave` spread the existing record and stop recomputing the sheet's money block (keep only the fields the form actually edits; money inputs write only when `canEditFinancials` and changed). Add a vitest unit layer first for `outstandingToRow`, `overdueAgeing`, `processStatuses`, `mergeWithExistingFollowUps` (pure functions), then a test that a no-change save of a fixture with a collector and a Cr bucket produces no diff.
4. Engineering batch 2: Option A (column-level diff in `useCollectionSync` + partial `updateCustomers`) and Option B (stop persisting derived `status`), with the unit tests above and the browser suites (read-only ones) green. Verify with the payload probe: a no-change save must send nothing; an urgency toggle must send `is_urgent` (+ `last_follow_up_on`) only.
5. Then Phase 4 UX audit screen by screen, continuing the ledger (CustomerDashboardView, ReportsView, PdcChequesView, LiveStockView, AppShell, Primitives).
6. Update this file.
LAST UPDATED: 2026-09-17 (validation session).
