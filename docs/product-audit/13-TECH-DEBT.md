# 13 — TECH DEBT

Status: Phase 0 list (evidence-backed; first-guess priorities).

| # | Item | Evidence | Prio | Confidence |
|---|---|---|---|---|
| T1 | `App.tsx` god component | 3,302 lines; 48 state slices; three page renderers inline | P1 | HIGH |
| T2 | Browser suites had no home in the repo (now `scripts/tests/`, no runner yet) | see 12-TEST-STRATEGY.md | P1 | HIGH |
| T3 | Two lockfiles (`bun.lock`, `package-lock.json`) | both tracked; scripts use npm | P2 | HIGH |
| T4 | No lint, no `engines` | package.json | P3 | HIGH |
| T5 | `ARCHITECTURE.md` §9.1–9.2 and file map describe removed `components/work/` | `git show 7232940` | P2 | HIGH |
| T6 | Every API route duplicated between `api/*.ts` and `server.ts` | server.ts lines 55–124 | P3 | HIGH |
| T7 | Dead animation classes (`animate-in`, `slide-in-from-*`, `fade-in`) — plugin not installed | grep; `check:classes` does not flag them | P3 | HIGH |
| T8 | Reports and older dialogs use remapped stock-Tailwind colour names instead of tokens | `styles/theme.css` "Palette remap" comment: "the original 13k lines were written against stock Tailwind" | P3 | HIGH |
| T9 | Schema without migration history | single `schema.sql` with `add column if not exists` blocks | P3 | HIGH |
| T10 | 61 `any`/suppressions | grep count | P3 | MEDIUM (not yet reviewed individually) |
| T11 | `metadata.json`, `logo.svg` unreferenced at root | grep found no references | P4 | MEDIUM |

Added in Phase 1 (2026-09-16):

| # | Item | Evidence | Prio | Confidence |
|---|---|---|---|---|
| T12 | Scoping rule duplicated between `types.ts` and `api/_lib/digest.ts` (D1) | 03 §9 | P2 | HIGH |
| T13 | Follow-up status stored and derived (D2) — readers fixed (Option B); two inline writers remain (T34) | 03 §9 | P3 (was P2) | HIGH |
| T14 | Notes mirrored into `customers.notes[]` from the activity table (D3) | 03 §9 | P2 | HIGH |
| T15 | Two "expected payment" notions (D4) — needs a business decision before code | 03 §9 | P3 | HIGH |
| T16 | Performance score computed twice (D5); roll-up netting three times (D6) | 03 §9 | P3 | HIGH |
| T17 | Official sheet URLs hard-coded and in `app_settings` (D7) | `App.tsx` 99–101 | P3 | HIGH |
| T18 | Dead: `customers.updated_by` column never written; `canEditFinancials` gates nothing | `repository.ts`, grep | P4 | HIGH |
| T19 | `outstandingData` (derived slice) kept in state alongside `appData` | `App.tsx` | P3 | HIGH |
| T20 | Seven boolean+target dialog state pairs in `App.tsx` | 09 §A.1 | P3 | HIGH |
| T21 | Two dashboards render the same tab components twice with near-identical props | 09 §A.4 | P3 | HIGH |
| T22 | No optimistic concurrency / version column on `customers` (R1) | `schema.sql`, `useSupabaseSync.ts` | P1 | HIGH |

Added in the validation session (2026-09-17):

| # | Item | Evidence | Prio | Confidence |
|---|---|---|---|---|
| T23 | ~~**C1** `CustomerEditModal.handleSave` rebuilds the row from form state~~ — **fixed 2026-09-17**, regression tests in `tests/customerEditModal.dom.test.tsx` | 11 §1.4 | done | HIGH |
| T24 | ~~Whole-row PATCH on every customer write~~ — **fixed 2026-09-17 (Option A)**: column diff + `updateCustomerColumns`; the missing version predicate is R1-B, still open | 11 R1 table | done (R1-A) | HIGH |
| T25 | ~~`processStatuses` persists a derived field~~ — **fixed 2026-09-17 (Option B)**: it only normalises dates; readers derive | 11 R1-C | done | HIGH |
| T26 | The reset re-ids 672 legacy `out_*` accounts (delete + re-create) because it merges into `[]` | 11 Part 3 | P1 (as part of SEC3) | HIGH |
| T27 | Four password minimums (6/6/8/8) across dialog, server, repository, Supabase | U20 | P3 | HIGH |
| T28 | Reset clears cheques/templates/profile in memory *before* the sheet fetch that can fail | `App.tsx:753–757` | P2 | HIGH |

Added in the C1 session (2026-09-17):

| # | Item | Evidence | Prio | Confidence |
|---|---|---|---|---|
| T29 | The edit dialog's date field is seeded with `toISOString().split('T')[0]` (UTC), so near midnight IST it shows the previous day; a changed date is parsed as UTC midnight | `CustomerEditModal.tsx` seed effect | P3 | HIGH |
| T30 | `tsconfig.json` includes `tests/**` (via `./**/*.ts(x)`) — fine, but `tests/` should be excluded from any future emit | `tsconfig.json` | P4 | HIGH |

Added in the Option A session (2026-09-17):

| # | Item | Evidence | Prio | Confidence |
|---|---|---|---|---|
| T31 | Roll-up netting produces floating-point noise (`due_over45: 80.60000000000036` seen in a sync payload); stored as `numeric` | probe scenario 5 | P4 | HIGH |
| T32 | The sync error banner names the account by id ("Could not save the changes to out_86_…") since the per-row write; the company name would read better | `useSupabaseSync.ts` onError | P4 | HIGH |
| T33 | Cheques and templates still write whole rows through `upsert` (small tables, low risk) | `App.tsx` adapters | P4 | HIGH |

Added in the Option B session (2026-09-17):

| # | Item | Evidence | Prio | Confidence |
|---|---|---|---|---|
| T34 | ~~`FollowUpModal.handleSave` and `CustomerEditModal.statusFor` still compute the follow-up word inline~~ — **fixed 2026-09-17 (seventh session)**: neither writes a derived word; `statusFor` removed | 11 status contract | done | HIGH |
| T35 | `customers.status` is legacy for everything but `Completed`; a later cleanup could narrow it (no migration this session) | 11 status contract | P4 | HIGH |

Added in the status-contract session (2026-09-17, seventh):

| # | Item | Evidence | Prio | Confidence |
|---|---|---|---|---|
| T36 | An account whose sheet email is `#REF!` (or any non-address) cannot be saved from the edit dialog: the browser's form validation blocks Save with "Please include an '@'" — the sheet garbage should be treated as blank on import, or the field should not be `type=email`-validated against imported values | probe on 3 BROTHERS ( THUKRAL HOSIERY ): 0 requests, `form :invalid` = email `#REF!` | P2 | HIGH |
| T37 | Both dialogs pre-fill the follow-up date with `toISOString().split('T')[0]` — the UTC day — so a date stored at local midnight IST shows as the previous day and, if saved untouched, moves the follow-up back a day | `FollowUpModal.tsx:35–44`, `CustomerEditModal.tsx:99` | P2 | HIGH (by reading; not yet reproduced on a stored local-midnight date — the app stores what the date input gives, UTC midnight, so today's rows are unaffected) |
| T38 | `customers.updated_by` exists and is never set (0 of 4,027 rows) — a conflict message cannot say who | read-only query | P3 | HIGH |
| T39 | ~~The book is loaded once at sign-in and never refreshed~~ — **fixed 2026-09-17 (reliability batch)**: focus/visibility, 5-min interval, reconnect and a Refresh button, with a pending-aware merge; cheques and templates are still not refreshed (T44) | `App.tsx` `refreshBook`, `services/refresh.ts` | done | HIGH |

Added in the fresh-start session (2026-09-17, ninth):

| # | Item | Evidence | Prio | Confidence |
|---|---|---|---|---|
| T40 | No screen for restoring a `book_backups` snapshot: an Admin runs `select public.restore_book_backup('<id>')` in the Supabase SQL editor (procedure in DEPLOYMENT.md). A small Admin-only list-and-restore panel would close this | `supabase/reset.sql` | P3 | HIGH |
| T41 | `book_backups` rows are ~4 MB each and nothing prunes them; a dozen resets is fine, a habit is not | schema | P4 | HIGH |
| T42 | A write from another open tab landing right after a reset overwrites that one row's cleared follow-up (last-writer-wins, R1-B territory); the tab that ran the reset reloads, others do not until they refresh (T39) | 11 §3.0 | P3 | HIGH |
| T43 | `customer_activity` is not in the snapshot because the reset does not touch it; if Q8 ever says threads should be cleared, add them to the snapshot first | 19 Q8 | P4 | HIGH |

Added in the reliability session (2026-09-17, eleventh):

| # | Item | Evidence | Prio | Confidence |
|---|---|---|---|---|
| T44 | Only the customer book is refreshed on focus; cheques and templates keep the sign-in snapshot until reload (the same `accept`/`forget` path would serve them). Felt more now that the register is the morning's list | `App.tsx` `refreshBook` | P3 | HIGH |
| T52 | The follow-up dialog's Cheques fold keeps its own layout ("PDCs in Hand", "Uncovered Dues", "+ Add Cheque", "✓ Clear") beside the register's; only the badge is shared now. One `ChequeRow` used by both would close it | `FollowUpModal.tsx` Cheques section | P4 | HIGH |
| T54 | A "Presented / Deposited" cheque state (in hand → presented → cleared/bounced) was asked about and declined for this release; it would be a new stored status (schema, `chequeState()`, the strip, the email). Design it as its own batch if the team asks | `types.ts` `PdcStatus` | P4 | HIGH |
| ~~T57~~ | **CLOSED 2026-09-18 (batch 6, local)**: `components/ui/DialogShell.tsx`; every dialog is on it. Was: the twelve dialogs share the hook (`useModal`) but not a shell: each still carries its own overlay/panel/header markup and a slightly different header style (three of them stock-grey). One `DialogShell` (overlay, panel, header with title id, phone sheet) would cut ~400 lines and end the drift | `components/*Modal.tsx` | P3 | HIGH |
| ~~T58~~ | **CLOSED 2026-09-18 (batch 6, local)**: every footer uses `Button` (quiet / primary / the new filled `destructive`). Was: dialog footers use two literal class strings (accent pill / quiet pill, h-9) rather than the `Button` primitive, whose `sm` is h-8 and `md` h-10; a `Button size="dialog"` (or making `sm` h-9) would let them use the primitive | `components/ui/Primitives.tsx` | P4 | HIGH |
| T59 | `@supabase/supabase-js` brings realtime, phoenix and storage (~80 kB minified) that the app never uses; the client cannot drop them without a custom build of the library. Nothing to do unless a slimmer client appears | `dist` analysis (esbuild metafile) | P4 | HIGH |
| ~~T53~~ | **CLOSED 2026-09-18 (batch 6, local)**: all five ask in the app through `ConfirmDialog`; `grep window.confirm` finds nothing in `components/` or `App.tsx`. Was: `window.confirm()` remains on: delete customer (App), remove contact (FollowUpModal), remove user, delete template, bulk follow-up date (Reports); ~~master import~~ (asked in the app since batch 4; the `confirm()` in `handleCustomerMasterSync` remains only for a caller that has not confirmed). `ConfirmDialog` exists now; each is a small swap | `App.tsx`, `FollowUpModal.tsx`, `ReportsView.tsx` | P3 | HIGH |
| ~~T55~~ | **CLOSED 2026-09-18 (batch 6, local)**: the wrapper frames only Reports now. Was: the Data source page renders inside the Settings wrapper card, so it is a card inside a card; the other Setup tabs (team, templates, alerts) still have their own older layout. Lifting the wrapper when those tabs are redone would remove the double frame | `App.tsx` settings wrapper | P4 | HIGH |
| T60 | `FIELD`/`LABEL` (`components/ui/fields.ts`) are used by the Template, User and Company profile forms; the Customer edit, Cheque, WhatsApp and Reset dialogs still carry the same class strings inline. A mechanical swap, one dialog at a time | `components/*Modal.tsx` | P4 | HIGH |
| T61 | Live stock's two dialogs use `useModal` but not `DialogShell` (they are sheets of their own design); the Reports page keeps the Settings wrapper card on desktop (approved as deployed) — the last card-in-card | `LiveStockView.tsx`, `App.tsx` | P4 | HIGH |
| T62 | Three `formatCurrency` copies (`CustomerDashboardView`, `ReportsView` — identical: Intl, absolute, no decimals; `FollowUpModal` — no symbol, up to 2 decimals) beside `formatINR`/`formatCompact`/`formatCurrencyValue`. They differ in rounding and sign handling, so one canonical formatter changes rendered text; decide the format, then swap | `components/*` | P4 | HIGH |
| T63 | Two browser `alert()`s remain: "Column headers copied…" (`useDataSource.copyHeaders`) and "You cannot delete the last template." (`useTemplates`). Both are notices, not questions; `notify()` would do | `hooks/useDataSource.tsx`, `hooks/useTemplates.tsx` | P4 | HIGH |
| T64 | `PdcModal` still takes `isOpen` (always true: App mounts it only when open) and resets its draft id on it; `SyncReconciliationModal`/`ResetConfirmModal` likewise mount-only. Dropping the prop is a small change inside the modal | `components/PdcModal.tsx` | P4 | HIGH |
| T56 | A sync confirmed from the review writes 4,027 rows through the hook's diff (10 PATCHes) — fine — but `handleConfirmSyncReconciliation` still calls `setAppData` with the whole merged book and `processStatuses`, so an unrelated tab's refresh can race it (R1-B territory). The preview count is right; the write set is unchanged | `App.tsx` | P4 | HIGH |
| T45 | The refused-write reason still names the account by id (`Could not save the changes to out_86_…`) — T32 restated; the dialog shows which account, the header/banner do not | `repository.ts` `updateCustomerColumns` | P4 | HIGH |
| T46 | A refresh while the follow-up dialog is open is skipped rather than merged; a very long dialog (minutes) means the tab is as stale as the dialog is old | `App.tsx` `dialogOpenRef` | P4 | HIGH |
| T47 | Two creates are not idempotent but are also never retried automatically: `addActivities` (the bulk date tool's system notes — a re-run of the tool skips accounts already on the date, so no double) and `reset_book` (a second press after a lost answer is refused when the plan added accounts, and otherwise runs an identical reset with one more snapshot row). A client id on both would close it | `repository.ts`, `supabase/reset.sql` | P4 | HIGH |

Added in the CRM-workflow session (2026-09-17, twelfth):

| # | Item | Evidence | Prio | Confidence |
|---|---|---|---|---|
| T48 | The follow-up dialog still carries its own WhatsApp recipient picker + template beside `WhatsAppReminderModal` — two copies of one flow (now folded, still duplicated) | `FollowUpModal.tsx` WhatsApp section | P3 | HIGH |
| T49 | ~~Two search boxes act on the book~~ — **fixed 2026-09-17**: one term, edited from either box; Live stock has its own term (`services/search.ts` `searchScopeFor`) so a customer search never filters stock; Reports shares the customer term | `CustomerDashboardView.tsx`, `App.tsx`, `ReportsView.tsx` | done | HIGH |
| T50 | Reports filters by CRM *owner* only; the team table counts accounts handed to a collector for the collector too, so a collector's row cannot drill into Reports (its numbers are plain text). A collector filter on Reports would close it | `ReportsView.tsx` `crmScopedData`, `CrmPerformanceTable.tsx` `drillable` | P4 | HIGH |
| T51 | ~~The team table's "Accounts with dues" excludes bad debt; Reports' *With dues* includes it~~ — **fixed 2026-09-17 (owner's decision)**: the count opens Reports on `working` (with dues, bad debt aside — a chip shown only while that list is open), so it lists exactly the accounts it counted; Reports' *Completed* no longer holds a defaulter either (0 such accounts in production on the day). The name (not a count) still opens the whole book with the *Bad debt* badges | `CrmPerformanceTable.tsx`, `ReportsView.tsx` | done | HIGH |
| T50 | `FollowUpModal.tsx` (≈1,180 lines) and `CustomerDashboardView.tsx` (≈1,760) still use the old `gray-*` Tailwind dialect inside a token-based shell; the polish reused tokens where it touched, the rest is Phase 4 work | both files | P3 | HIGH |
