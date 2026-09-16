# 00 — MASTER STATUS

The authoritative continuation file. Read this first in every session; update it at the end of every meaningful work period.

PROJECT: Timely Payment — Shori Chemicals' receivables follow-up app (customer book, follow-up queue, PDC cheques, reports, live stock).
STACK: React 18 + TypeScript 5 + Vite 5 + Tailwind v4 (browser) · Express 5 dev server / Vercel serverless functions `api/*.ts` (server) · Supabase (Postgres + Auth + RLS) · Google Sheets CSV as the source of balances and stock · Nodemailer/Resend for the daily email · Google Gemini for the AI report · Vercel hosting. See 01-REPOSITORY-MAP.md.

CURRENT PHASE: Phase 0 — Repository reconnaissance (complete).
CURRENT SUBPHASE: —
LAST COMPLETED TASK: Phase 0 — repository map, baseline, audit ledger, audit file skeletons; browser suites preserved under `scripts/tests/` (this session, 2026-09-16).
CURRENT TASK: None in progress.
NEXT TASK: Phase 1 — Product model (03-PRODUCT-MODEL.md) from `types.ts`, `supabase/schema.sql`, `App.tsx` handlers and `ARCHITECTURE.md` §4–§8; then Phase 2 user types. Start with the "RECOMMENDED NEXT SESSION START" below.

BASELINE BUILD STATUS (2026-09-16, commit de60fc7):
- `npm run typecheck` (tsc --noEmit, strict): PASS, 0 errors.
- `npm run build` (tsc + vite build + esbuild server bundle): PASS. One warning: main chunk `index-*.js` 724.6 kB minified (177.8 kB gzip) exceeds the 700 kB `chunkSizeWarningLimit`. Other chunks: sheets (xlsx) 492 kB / 161 kB gzip, react 134 kB, markdown 126 kB, CSS 153 kB / 22 kB gzip.
- `npm run check:classes`: 2 pre-existing findings (`grid-frame` in AppLogo.tsx, `stroke-based` in Icons.tsx — words in comments/attributes the checker mistakes for classes; harmless).
- `npm run check:empty`: clean.
- Lint: NO linter configured (no ESLint/Biome). Type-check is the only static gate.
- Unit/integration tests: NONE. QA is browser automation only (`scripts/smoke.cjs`, `audit.cjs`, `interact.cjs`, `contrast.cjs`, `tour.cjs`) plus ad-hoc puppeteer suites written during recent work that live OUTSIDE the repo (Claude scratchpad) — see 12-TEST-STRATEGY.md.
- `npm audit --omit=dev`: 2 findings — nodemailer 9.0.6 HIGH (fix available, ≤9.1.0 range), qs 6.15.3 MODERATE via express/body-parser (fix available). `npm audit` (all): 32 (1 critical `tar` under `vercel`→`@vercel/fun`, dev-only CLI tooling; many `undici` under `vercel`, dev-only).
- Runtime: Node v24.15.0, npm 11.12.1. No `engines` field. Two lockfiles present (`package-lock.json` AND `bun.lock`).
CURRENT BUILD STATUS: same as baseline (no code changed in Phase 0).
BASELINE TEST STATUS: no automated test suite in the repo. Browser suites run ad hoc (see 12-TEST-STRATEGY.md) were green at commit de60fc7: book filters 25/25, chips 20/20, phone 38/38, live stock 45/45, overview 38/38, compare 54/54, prices 12/12 (admin leg), bad debt 15/15, temp-CRM 9/9.
CURRENT TEST STATUS: same as baseline.

CRITICAL ISSUES (P0): none confirmed in Phase 0.
IMPORTANT ISSUES (P1/P2, preliminary — to be confirmed in later phases):
- P1 · No unit test runner and no single test command. The nine working browser suites were copied into `scripts/tests/` in Phase 0 (a safety step, no app code touched); a runner and a unit layer come in Phase 13. (12-TEST-STRATEGY.md)
- P1 · `App.tsx` is 3,302 lines holding routing, data loading, ~48 pieces of state, all handlers and three page renderers. Highest regression-risk file in the product. (13-TECH-DEBT.md)
- P2 · Production dependency vulnerabilities: nodemailer HIGH, qs MODERATE — both have non-breaking fixes. (11-SECURITY-RELIABILITY.md)
- P2 · Two lockfiles (`bun.lock`, `package-lock.json`) — the installed tree is ambiguous across machines/CI. (13-TECH-DEBT.md)
- P2 · `ARCHITECTURE.md` §9.1–9.2 describe a `components/work/` Workspace that was removed in commit 7232940 ("Put the old layout back"); the file map still lists it. Documentation drift. (13-TECH-DEBT.md)
- P2 · Main JS chunk is 725 kB minified; xlsx (492 kB) is loaded for every visitor though only Admin/Manager export. (10-PERFORMANCE.md)
- P3 · 61 uses of `any` / `as any` / suppressions across first-party code (count only — not yet reviewed).
- P3 · Stray root files with no references: `logo.svg`, `metadata.json` (AI Studio scaffold leftover). (14-REMOVAL-CANDIDATES.md)

CURRENT DESIGN WORK: none (Phase 0).
CURRENT ENGINEERING WORK: none (Phase 0).
FILES REVIEWED: 0 of 84 first-party files at audit depth (Phase 0 is reconnaissance; see 18-FILE-AUDIT-LEDGER.md).
FILES REMAINING: 84 (see ledger).
CHANGES NOT YET VERIFIED: none.
OPEN QUESTIONS: see 19-OPEN-QUESTIONS.md (Q1–Q6).
DECISIONS REQUIRED: none blocking. Two branch/process decisions recorded in 15-DECISIONS.md (D1, D2).
REGRESSION RISKS: none introduced. Standing risk: any change to `App.tsx`, `types.ts` (ageing/rank rules) or `services/repository.ts` (write-back) without the browser suites.
RECOMMENDED NEXT SESSION START:
1. Read this file, then 01-REPOSITORY-MAP.md.
2. Phase 1: read `types.ts` (867 lines) in full, `supabase/schema.sql` (492), `ARCHITECTURE.md` §4 (data model) §6 (ownership) §7 (domain rules) §8 (data flow); then the handlers in `App.tsx` (search `const handle`). Write 03-PRODUCT-MODEL.md, separating confirmed facts from assumptions.
3. Mark those files Reviewed in 18-FILE-AUDIT-LEDGER.md with findings.
4. Phase 2: 04-USER-TYPES.md from `DEFAULT_ROLE_PERMISSIONS`, `can()`, `seesWholeBook()`, `scopeTo()` in `types.ts` and the RLS policies in `supabase/schema.sql`.
5. Update this file.
LAST UPDATED: 2026-09-16 (Phase 0 session).
