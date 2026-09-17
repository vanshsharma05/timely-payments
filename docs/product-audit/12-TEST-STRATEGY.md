# 12 — TEST STRATEGY

Status: unit layer started 2026-09-17 (fourth session); the full strategy is written in Phase 13.

## Unit / regression layer (new)

- **Runner**: Vitest 3.2.7 (`vitest.config.ts`, node environment; a file that renders components declares `// @vitest-environment jsdom`). Dev dependencies added: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`. No production dependency changed.
- **Commands**: `npm run test:run` (once) · `npm test` (watch). Needs nothing but `npm install` — no Supabase, no sheet, no sign-in (`supabaseClient` sees no `VITE_*` env and never creates a client).
- **Files**: `tests/fixtures.ts` (synthetic accounts and users — `mixedAccount()` carries a collector, a Cr bucket among Dr ones, sheet-netted roll-ups, a settlement stamp, a declared rank, a forecast and a follow-up) · `tests/money.test.ts` (23 characterisation tests pinning M1–M8: `parseAmountAndType`, `netRollUp`, `overdueAgeing`, rank/bad debt, `hasOutstanding`, settlement, `mergeWithExistingFollowUps`, `processStatuses`, `chequeState`, the row mappers) · `tests/customerEditModal.dom.test.tsx` (13 C1 regression cases against the real dialog: no-change Save as CRM and Admin, the four corruption modes, collected-stays-collected, contact-only edits ×3, urgent, rank, note, changed date, an Admin's intentional money edit).
- **Result**: 36/36 pass at the C1 fix; 11 of the 13 dialog cases failed on the code before it.
- **Option A layer (2026-09-17, fifth session)**: `tests/customerRowDiff.test.ts` (11 — cases A–E, J of the diff contract, id never carried, key-order stability, money-only sync diff, status flip, ordered notes) · `tests/updateCustomerColumns.test.ts` (5 — exact body against a fake client, `null` kept, nothing sent for `{}`, stray `id` dropped, DB error surfaced) · `tests/useCollectionSync.dom.test.tsx` (12 — the real hook with fake timers: A no change, B one column, C two columns, D null, F failed write keeps the baseline and the retry carries the unsaved difference, G success advances, H sequential writes carry only the new change, I two customers independent, J sensitive fixture, new id via upsert then column writes, partial failure isolated per row, removal, status flip one column) · `tests/syncFlows.test.ts` (13 — follow-up save, activity mirror, owner/collector/rank/category, bulk date, `processStatuses` across midnight, balance sync: changed rows money-only, unchanged rows nothing, settled rows nil+stamp+urgency, new names via upsert). **77/77.**
- **Known gaps**: `useCollectionSync` (a hook with timers — testable with `renderHook` + fake timers in the R1 batch); `updateCustomers` (needs a fake Supabase client); the digest's scoping (server module, testable with fixture rows); Excel/master import mapping.


What exists in the repo
- No unit/integration test runner (no vitest/jest/playwright in `package.json`).
- Puppeteer scripts in `scripts/`: `smoke.cjs` (screenshots), `audit.cjs` (UI/UX audit light/dark), `interact.cjs` (functional click sweep), `contrast.cjs`, `tour.cjs`, with `signin.cjs` shared sign-in (credentials from env or `.deploy.local`). Static checks: `deadclasses.cjs`, `emptycontrols.cjs`. All run against a local dev server on :3000 signed in to the production Supabase project (read-only by convention).

Brought into the repo in Phase 0 (`scripts/tests/`, with a README)
- During recent feature work a set of puppeteer suites was written outside the repo; they were copied in verbatim as a safety step: `stock-test.cjs` (45 checks), `overview-test.cjs` (38), `compare-test.cjs` (54), `price-ui-test.cjs` (12 admin / 24 with a CRM), `crm-test.cjs` (9; creates and removes a throwaway CRM login through `/api/team`), `baddebt-test.cjs` (15), `book-filters-test.cjs` (25), `chips-test.cjs` (20), `phone-test.cjs` (38), plus an offline digest check. They assert internal consistency (counts add up, filters agree) rather than remembered numbers, so they survive the data changing daily.
- Proposal (Phase 13): give them one runner (`npm run test:browser`), and document the credential requirement. Add a small unit layer (vitest) for the pure domain rules in `types.ts` (`overdueAgeing`, `getCustomerPaymentRank`, `isBadDebt`, `getFollowUpCategory`, `chequeState`, `netRollUp`) and `services/liveStock.ts` (parser, `availabilityOf`, `isCritical`) — the rules money decisions depend on, and pure functions today.

Highest-value coverage gaps (preliminary)
1. Domain rules in `types.ts` — no tests at all.
2. Sheet import/reconciliation (`googleSheetService.ts`) — writes back to the book.
3. Permissions: client `can()` vs RLS.
4. Daily digest content per role.

## Production-safety classification (Phase 1, inspected before execution; nothing executed)

| Script | Class | Notes |
|---|---|---|
| `scripts/tests/stock-test.cjs`, `overview-test.cjs`, `compare-test.cjs`, `price-ui-test.cjs` (admin leg), `book-filters-test.cjs`, `chips-test.cjs`, `baddebt-test.cjs` | READ ONLY | filters, tabs, drawers, browser storage only |
| `scripts/tests/crm-test.cjs`; `price-ui-test.cjs` CRM leg | CONTROLLED MUTATION WITH CLEANUP | creates and removes a throwaway CRM login via `/api/team`; touches production `auth.users`/`profiles` |
| `scripts/tests/phone-test.cjs` | READ ONLY, fragile | presses the Admin bulk "Set follow-up" on "Select all" and relies on the confirm being dismissed — rewrite that step before running against production |
| `scripts/interact.cjs`, `smoke.cjs`, `audit.cjs`, `tour.cjs` | READ ONLY (likely) | no save/confirm-accept found; not exhaustively traced |
| `scripts/tests/write-payload-probe.cjs` (new) | READ ONLY by construction | Puppeteer request interception aborts every non-GET to `/rest/v1/*` and the app's mutating API routes before they leave the browser; the rows touched were re-read afterwards and unchanged. Use this pattern for any future "what would the app write" evidence. |
| none | UNSAFE FOR PRODUCTION | any future test of sync, reset, delete, bulk rank/reassign or the cheque lifecycle needs staging (Q6) |

## What a staging environment needs (not pursued this session)
1. A second Supabase project; run `supabase/schema.sql`; disable sign-up; create an Admin.
2. Seed: either a scrubbed copy of production (`customers`, `pdc_cheques`, `customer_activity`, `profiles` with fake emails) or a generated book of ~4,000 rows with realistic Dr/Cr and ageing.
3. `.env.staging` + a `TIMELY_ENV=staging` switch in `scripts/signin.cjs` and `npm run dev`, and a Vercel preview project pointed at it.
4. Only then: write the S0 tests (sync/reconciliation, write-back, reset) and the destructive-edge-case tests.
