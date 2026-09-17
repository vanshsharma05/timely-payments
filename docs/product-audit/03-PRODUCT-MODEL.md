# 03 — PRODUCT MODEL

Status: Phase 1 complete (2026-09-16), from reading `types.ts`, `supabase/schema.sql`, `services/repository.ts`, `services/useSupabaseSync.ts`, `services/googleSheetService.ts`, the handlers in `App.tsx`, `components/FollowUpModal.tsx` (save path), `api/_lib/digest.ts` (scoping), `api/_lib/reminders.ts`, `api/_lib/report.ts` and the production Supabase auth config (read-only via the management API).

Labels: **CONFIRMED** = read in code · **LIKELY** = strong evidence, not fully traced · **UNCLEAR** = needs the business owner · **PROPOSED** = our idea, not a requirement.

## 1. Purpose

Shori Chemicals sells textile chemicals on credit to ~4,000 trade customers (screen printers, dyers, dealers…). Its accounts team keeps the receivables ledger in a Google Sheet. Timely Payment is the **collections workbench on top of that ledger**: it tells each CRM/collector whom to chase today, records what was said and promised, tracks post-dated cheques, keeps a shared per-account history, and gives management a view of ageing, workload and defaulters. It does not invoice, receive payments or post to the ledger.

## 2. Where each kind of data comes from (CONFIRMED)

| Kind | Examples | Origin | Authority | Editable in app? |
|---|---|---|---|---|
| **Source-of-truth sheet data (money)** | `total`, `totalType`, `ageing[4]`, `ageingTypes`, `over90(+Type)`, `dueOver45(+Type)`, "Book as of" date | Transactions Google Sheet → `/api/fetch-sheet` → `parseGoogleSheetCsv` → reconciliation → `mergeWithExistingFollowUps` → `customers` table | The sheet. `financialsFromSheet()` is the whole list of columns the sheet owns | Only via sync. (`canEditFinancials` exists as a right but no screen edits these fields — see §9) |
| **Seeded master data** | company name, contact person/number, city/state/address, GSTIN/PAN, credit limit, terms, category, CRM owner (first import only) | Customer Master Google Sheet (one-time import) or the transactions sheet for a never-seen name | App, after seeding: the import "fills blanks and overwrites nothing" | Yes (CustomerEditModal, FollowUpModal contacts) |
| **Application-owned (user-entered)** | follow-up date, status (partly derived), forecast amount/date, urgency, notes[], additional contacts, `paymentRank` (declared), `category`, `crmOwnerId`, `assignedCollectorId`, cheques, activity thread, templates, company profile, settings, alert settings | Users in the app | Supabase | Yes, per role |
| **Derived (computed at read time, never stored)** | ageing netting (`overdueAgeing`), follow-up category, payment rank when not declared, promise state, cheque state, every tile/count/score, bad-debt exclusion | `types.ts` pure functions, evaluated in the browser (and re-implemented in the digest for email) | Code | n/a |
| **Derived and stored** | `status` (Today/Upcoming/Overdue/Pending/Completed) rewritten by `processStatuses()` from the date; `settledAt` stamped when a balance goes to nil; `lastFollowUpOn`; `isUrgent` seeded from thresholds on import | Browser | Supabase (stale by design until the next mutation) | Indirectly |
| **Server-generated** | `customer_activity.created_at` (DB clock), `system` activity entries (rank/category changes, bulk date moves), `alert_log`, profiles created by `/api/team` or the auth trigger, daily email content, AI report text | Server / DB | Supabase / mail | No |
| **Live stock (not stored)** | 1,415 stock items with quantity, levels, status, movement, rate/value | Stores Google Sheet → `/api/live-stock` (prices blanked unless Admin/Manager) → localStorage cache | The sheet | No |

## 3. Core entities

### 3.1 `profiles` — a login and its rights
- Source: `/api/team` (service role) or the `handle_new_user` trigger on `auth.users` insert. `id` = auth uuid; `legacy_id` = the CRM code used on customer rows ("ANKUR"); `role` ∈ Admin/Manager/CRM/Collector/Viewer; `data_visibility` All/AssignedOnly; `permissions` jsonb overrides; `assigned_crms[]`.
- Ownership: Admin only (RLS `profiles_admin_all`; no self-update policy — deliberate, so nobody can promote themselves).
- Read: every signed-in user reads every profile incl. emails (RLS `profiles_read using (true)`).
- Lifecycle: created → edited (role/rights/password/email via `/api/team`) → deleted (auth user + profile). `legacy_id` cannot change after creation (customer rows point at it by text).
- Invariants: `legacy_id` unique; first ever profile becomes Admin (trigger); a CRM's `assigned_crms` defaults to `[legacy_id]`.

### 3.2 `customers` — an account (`Outstanding` in the app)
- Source: transactions sheet (money) + master sheet (details) + app edits.
- Key: `id = 'cust_' + companyKey(company)` — deterministic from the normalised company name (`customerIdFor`), so re-importing never mints a second id for one firm and cheques/activity never cascade away on a sync. **Renaming a company in the app does not change its id** (matching on sync is by `companyKey(company)` OR id).
- Important fields: money block (§2 row 1), `crm_owner_id` (text code, '' = unassigned), `assigned_collector_id`, `follow_up_date`, `status`, `forecast_amount/date`, `is_urgent`, `payment_rank`, `category`, `notes` (jsonb string[] — legacy mirror of the activity thread), `settled_at`, `last_follow_up_on`, `is_new_customer` (means "created in the app", not "recent"), `updated_by` (never set by the client — column exists, `outstandingToRow` does not write it → LIKELY dead column).
- Relationships: → profile by text code (no FK); ← `pdc_cheques.customer_id` (FK, cascade delete); ← `customer_activity.customer_id` (FK, cascade delete).
- Read: everyone signed in reads every row (RLS `using (true)`); the per-person slice is CLIENT-ONLY (`scopeTo`).
- Write: any Admin/Manager/CRM/Collector may UPDATE any row, any column (RLS `customers_update using can_write()`); INSERT needs `canAddCustomer`; DELETE needs Admin/Manager role + `canDeleteCustomer` (Manager's default is false → effectively Admin).
- Lifecycle: seeded by import or created in app → worked (follow-ups, activity, cheques) → settled to nil when the sheet stops listing it (`settleUnlisted`, `settledAt` stamped) → may owe again (stamp cleared) → deleted only by hand (cascades cheques + thread).
- Invariants (CONFIRMED in code): the sheet never changes owner, contacts or name; a sync never deletes; an account absent from the sheet is settled, not removed; a name the app has never seen arrives **unassigned**.

### 3.3 `pdc_cheques` — post-dated cheques
- Source: app (PdcModal; FollowUpModal can mark cleared).
- Fields: customer_id, customer_name (denormalised), cheque_number, bank, cheque_date, amount, status (Pending/Hold/Cleared/Bounced; `DueToday` legacy read-only), received/cleared dates, remarks, crm_owner_id, added_by. Id = `pdc_<Date.now()>` (LIKELY collision-safe enough for one user; not guaranteed across two tabs saving in the same millisecond).
- State: `chequeState()` from the date — due / overdue (in hand, date passed) / upcoming / hold / cleared / bounced. `CHEQUE_ACTIVE` = due, overdue, upcoming, hold = "money in hand".
- Read: everyone. Write/delete: `can_write() AND canManagePdc` (Admin, Manager, CRM, Collector by default).
- Invariant: a cheque belongs to one customer; deleting the customer deletes its cheques.

### 3.4 `customer_activity` — the shared, append-only thread
- Kinds: note, no_answer, declined, promise, payment, visit, dispute, system. `promise` carries `promised_amount` + `promised_on`; a later entry may `resolves_id` a promise (payment → kept; anything else → broken).
- Read: everyone signed in. Insert: `canEditFollowUp` and `author_id = auth.uid()`. No update policy at all. Delete: own entries or Admin.
- `created_at` is the DB clock (a wrong laptop date cannot backdate a call).
- Duplicated mirror: every logged entry is also appended as a formatted string to `customers.notes[]` (`FollowUpModal.handleActivityLogged`), because the Today list, Reports "Last note" column, the AI report and the digest read `notes`. See §9 D3.

### 3.5 Follow-up (a state on the customer, not a table)
- `follow_up_date` + `status` + `forecast_amount/date` + `is_urgent` + `last_follow_up_on`.
- Outcome choices in FollowUpModal: **collected** → `status = Completed`, `followUpDate = today`; **follow_up** with a date → date set, status from date; **no_follow_up** → date cleared, `Pending`. Any Save stamps `lastFollowUpOn = now` even if only a contact changed (CONFIRMED; whether that should count as contact is UNCLEAR).
- Category (derived): `getFollowUpCategory` → completed / today / future / overdue / no_follow_up — **the date wins over the stored status**; only with no usable date does the stored status decide.

### 3.6 Promise — an activity entry of kind `promise`
- Open until resolved; `due` on the day; `overdue` after; `kept` if resolved by a `payment`; `broken` if resolved by anything else (`promiseState`). Shown in the thread and in the digest ("They said they would pay today", "Promised, and the day passed").
- Not linked to `forecast_amount` (the follow-up form's "expected" figure) — two separate notions of "what they will pay" (§9 D4).

### 3.7 Templates, company profile, app settings, alert settings, alert log
- `templates`: WhatsApp message templates with `{{companyName}} {{contactPerson}} {{contactNumber}} {{totalDue}} {{ageing…}} {{totalOver90}} {{dueOver45}}` placeholders; a money line whose figure is nil is dropped. Write: Admin/Manager (RLS).
- `company_profile` (singleton): name, address, GSTIN, bank details for messages/reports. Write: Admin (RLS).
- `app_settings` (singleton): data source mode (google/excel), sheet URLs, "book as of" date, last sync time. Write: Admin/Manager (RLS). Note the two official sheet URLs are also hard-coded in `App.tsx` as defaults.
- `alert_settings` (singleton): daily email on/off, recipient roles, skip-when-empty, extra recipients. Write: Admin/Manager. `alert_log`: server-only writes; everyone reads.

### 3.8 Live stock (read-only window)
- `StockItem` parsed from the stores sheet: code, description, brand/category, sub-category, quantity (+PO), unit, min/max, short flag & date, status FM/OD/D, movement, ageing days, last received, avg sales, transactions, tax %, colour, photo link, rate & value.
- Rate/value are **blanked on the server** for anyone not Admin/Manager (`api/_lib/liveStock.ts`); the browser additionally hides every rupee (`showPrices`). Nothing is stored server-side; a 60 s poll while the tab is visible; localStorage cache keyed by whether it carried prices.

## 4. Money logic — every rule, and where it lives

| # | Rule | Where | Layer |
|---|---|---|---|
| M1 | **Dr/Cr parsing.** A cell is credit if it contains "CR", is wrapped in parentheses, or starts with "-"; amount is `|digits|`. | `parseAmountAndType` (`googleSheetService.ts`) | client (import) |
| M2 | **Roll-ups the sheet did not supply** are netted signed: `over90 = net(a3, a4)`, `dueOver45 = net(a2, a3, a4)`; sign of the net decides Dr/Cr. Sheet-supplied roll-ups win when present. | `netRollUp`, `parseGoogleSheetCsv` | client (import) |
| M3 | **What is actually overdue.** An account in credit overall (`totalType = Cr` or `total ≤ 0`) has nothing overdue. Otherwise each bucket is signed (Cr negative) and floored at 0; `over135 = max(0, s4)`; `over90` / `over45` use the sheet's typed roll-up when present (Cr → 0), else net the buckets, floored at 0. | `overdueAgeing` (`types.ts`) | client (every screen), and the digest reads `over90`/`due_over45` raw with its own `owes()` — see §9 D1 |
| M4 | **Payment rank.** Hand-set rank wins (the only way to be `Bad`); else Cr/zero → Good; else any `over45` or `over90` → Late; else Good. | `getCustomerPaymentRank` | client; digest tags rows from the stored `payment_rank` only |
| M5 | **Bad debt is not routine work.** `isBadDebt = rank === 'Bad'` removes an account from Due today / Overdue / No follow-up / Scheduled everywhere those are counted or listed, the attention banner, the per-CRM score and the morning email; carried on the recovery list instead. Money stays in every total. | `isBadDebt` (`types.ts`), used in `App.tsx`, `ReportsView`; digest filters `payment_rank = 'Bad'` | client + server (duplicated by rule, not by function) |
| M6 | **Urgency seeded on import**: `dueOver45 (Dr) > ₹10,00,000` or `>135 (Dr) > ₹5,00,000` → `isUrgent = true`; cleared when settled; editable by hand afterwards. | `parseGoogleSheetCsv`, `clearedFinancials` | client (import) |
| M7 | **Settlement.** An account the sheet no longer lists keeps everything but its money goes to nil (`clearedFinancials`), `settledAt` stamped; owing again clears the stamp. | `settleUnlisted`, `stampSettlement` | client (sync) |
| M8 | **What counts as work**: `hasOutstanding = |total| > 0` (so a Cr balance counts as "with dues" in the book and in CRM totals, but as nothing overdue). | `hasOutstanding`, `matchesSettlement` | client; digest `bookCount` uses the same `|total| > 0` |
| M9 | **Cheque money in hand** = cheques in state due/overdue/upcoming/hold; "cheques today" = in hand and dated today; "held in hand" amount sums active cheques; "promised today" = forecast amount with forecast (or follow-up) date today. | `chequeState`, `CHEQUE_ACTIVE`, `todayPdcMetrics`, `cashFlowForecastMetrics` (`App.tsx`) | client; digest recomputes from raw `status` + `cheque_date` |
| M10 | **Per-CRM workload and timely score** = timely (done + today + future) / accounts with dues, defaulters and no-dues excluded; an account with a distinct collector counts on both rows. | `crmPerformanceStats` (`App.tsx`) | client |
| M11 | **Reports' performance score / coverage** = same idea on the report's scope, with `workCount = total − badDebt`. | `boxMetrics` (`ReportsView`) | client (a second implementation of M10's idea) |
| M12 | **Portfolio ageing tiles** sum `overdueAgeing` buckets over the scope; "Outstanding" sums Dr totals (Cr excluded) in one place and signed totals in another (book: `totalSum = Dr − Cr`, `debitSum`, `creditSum`). | `portfolioAgeing`, `myAgeing` (`App.tsx`), `metrics` (`CustomerDashboardView`) | client |
| M13 | **Template amounts**: rendered with their Dr/Cr type; a money line for nil is dropped; `{{totalOver90}}`/`{{dueOver45}}` use the sheet roll-up or net the buckets. | `renderTemplate` (`messageTemplate.ts`) | client (third copy of the roll-up idea) |
| M14 | **AI report inputs**: top 15 "critical" accounts (by overdue), metric summary, last note — sent to Gemini as text. | `AiReportModal` → `api/_lib/report.ts` | client builds, server prompts |
| M15 | **Live stock**: availability (out ≤ 0 / low below min / in), critical = out AND (stocked or fast-moving), health = in-stock share, value = quantity × rate (from the sheet's Amount column). | `services/liveStock.ts` | client; server only blanks price columns |

**Where the money is computed:** almost entirely in the browser from imported figures. The database stores what the sheet said and what people typed; it computes nothing. The server recomputes a subset for the email (§9 D1). Nothing is computed in the sheet by the app.

## 5. Data flows (CONFIRMED)

**Sheet → book (balance sync).** Admin/Manager presses Sync → `fetchGoogleSheetData(url)` → `POST /api/fetch-sheet` with bearer token (server checks Admin/Manager, fetches CSV via gviz then export URL, 12 s each) → `parseGoogleSheetCsv` (header-mapped; `#N/A` names skipped; CRM column read but only used for never-seen names… and even then dropped by `asNewCustomer`) → if the book is non-empty, `pendingSync` → **SyncReconciliationModal** shows what will change/settle/arrive → on confirm `mergeWithExistingFollowUps(existing, incoming)`: matched by `companyKey` or id → money replaced, everything else kept, `settledAt` stamped; unmatched existing → settled; new names → unassigned customers → `processStatuses` → `setAppData` → **`useCollectionSync` diffs against the last-synced signature and writes whole changed rows** (updates for known ids, upserts for new) 800 ms later → `lastSyncTime` and "book as of" saved to `app_settings`.

**Excel upload** follows the same path from a file (`parseRawDataArray` with fixed `EXPECTED_HEADERS`).

**Master import (one-time seeding).** `fetchCustomerMasterSheetData` → `mergeCustomerMasterIntoAppData`: fills blanks only, adds never-seen names as owner-less accounts, reports CRM conflicts without changing owners.

**CRM action → shared state.** FollowUpModal "Save" → `onUpdate(updatedCustomer)` → `handleUpdateOutstanding` → `processStatuses` on the whole array → `setAppData` → sync hook writes the changed row(s) → other users see it **only after they reload** (no realtime, no polling of `customers`). Activity entries go straight to the DB (`repo.addActivity`) and are read back per account when the dialog opens.

**Cheque action** → `setPdcCheques` → hook upserts/deletes.

**Daily email.** Vercel cron 09:00 IST → `/api/daily-report` (CRON_SECRET) → `runDailyReminders`: settings → recipients by role → per recipient `scopeFor` (server copy of `scopeTo`) → digest (due today, overdue, promises due/broken, cheques today/overdue, promised today, no-follow-up count, bad-debt line, per-CRM table for whole-book readers) → Resend/SMTP → `alert_log`. "Send me a test" uses the same path for one address.

**AI report.** Client scopes and summarises → `POST /api/gemini-report` (any session) → Gemini `gemini-3.7-flash` (or a rule-based fallback without a key) → markdown back.

**Team.** Team & access → `/api/team` (Admin session) → service role creates auth user + profile / updates / deletes.

## 6. Business rules

### CONFIRMED
1. **The sheet owns money; the app owns the customer.** A sync changes only the money columns; name, contacts, owner, notes, cheques and history survive. (`financialsFromSheet`, merge comments.)
2. **Ownership is decided in the app, never by the sheet.** New names arrive unassigned; the master import never overrides an owner set here; "#N/A"/"#REF!" read as blank.
3. **An account absent from the sheet is settled, never deleted.** Deleting is a deliberate act from the customer list (Admin by RLS in practice).
4. **The follow-up date wins over the stored status**; stored status is rewritten from the date after every mutation and import.
5. **`Bad` rank is declared, never calculated**, and a hand-set rank of any kind wins over the ageing-derived one.
6. **Declared defaulters are out of the routine worklists and on the recovery list** (Today strip, Reports chip, digest line, CRM score).
7. **Responsibility runs both ways**: a person sees an account if they own it as CRM *or* are its collector *or* it belongs to a CRM in their `assigned_crms`; an explicit "All" visibility or `canViewAllCrms` shows the whole book; Admin always does.
8. **A CRM may claim an unowned account or their own, but not move a colleague's account to a third person** (`mayClaimForSelf`).
9. **Exporting the book takes a management role AND the export right** (`canExportBook`); the cheque register export needs only the right.
10. **Cheque due-ness comes from the date, never the stored status**; `DueToday` is legacy and read as Pending.
11. **A promise is kept only by a payment entry**; anything else resolving it marks it broken; overdue the day after `promised_on`.
12. **The activity thread is append-only**: no edits; own-entry or Admin delete.
13. **Bulk follow-up date is Admin-only**, refuses past dates, and writes a `system` entry per account naming the owner who had not rescheduled.
14. **Rank and category changes write a `system` entry** (best-effort — the change saves even if the note fails).
15. **Public sign-up is disabled** on the production Supabase project (`disable_signup: true`, read 2026-09-16); logins exist only through `/api/team` or the dashboard.
16. **Prices on Live stock are Admin/Manager only**, enforced on the server by blanking columns.

### LIKELY
17. "Urgent" thresholds (₹10 L past 45 days / ₹5 L past 135) are a business rule the import applies; nothing documents who chose them.
18. `lastFollowUpOn` is meant to mean "last human contact" (the digest and CRM table treat it so), but Save stamps it even when only a contact detail changed.
19. `forecast_amount` ("expected") is the CRM's cash forecast; a `promise` entry is the customer's commitment. They are meant to be different things.

### UNCLEAR / REQUIRES BUSINESS CONFIRMATION
20. Should a `Cr` (advance) account count as "with dues" in CRM workload and the Receivables tile? Today `hasOutstanding` says yes (|total| > 0) while `overdueAgeing` says nothing is overdue. (Q7)
21. Who is allowed to run the **"COMPLETE FRESH START"** reset? Code: Admin *or Manager* (`rights.canSyncSheets`), guarded by one `window.confirm`. (Q8)
22. Should customer names, amounts and last notes be sent to Google Gemini for the AI report? (Q9)
23. Should `canEditFinancials` exist? No screen edits money; the right is dead in the UI. (Q10)

## 7. Critical workflows, by damage if broken

| Sev | Workflow | Why | Where it lives |
|---|---|---|---|
| S0 | **Balance sync + reconciliation** | Rewrites every balance; a wrong merge settles real debts to nil or duplicates accounts | `handleGoogleSync` → `SyncReconciliationModal` → `mergeWithExistingFollowUps` → sync hook |
| S0 | **Write-back (`useCollectionSync` + `updateCustomers`)** | Every edit passes through it; a fault loses or overwrites work silently | `useSupabaseSync.ts`, `repository.ts` |
| S0 | **"Fresh start" reset** | Deletes every cheque, clears every owner/note, re-imports | `handleResetAllDataAndUsers` |
| S1 | Loading the book after sign-in (`loadAll`, 4,000+ rows paged by 1,000) | Nothing works without it | `repository.fetchAllRows` |
| S1 | Recording a follow-up / promise / note | The daily job of every CRM | FollowUpModal, CustomerActivityPanel |
| S1 | Recording and clearing cheques | Money in hand; the daily banking list | PdcModal, PdcChequesView |
| S1 | Daily reminder email | The team's morning list; a scoping bug leaks other people's accounts | `api/_lib/digest.ts`, `reminders.ts` |
| S2 | Finding a customer (search, filters, scoping) | Speed of every call | `matchesSearch`, `scopeTo`, book filters |
| S2 | Management reporting (Reports, CRM table, ageing tiles) | Decisions and the agency list | `ReportsView`, `App.tsx` memos |
| S2 | Team & access | Onboarding/offboarding; wrong rights = wrong visibility | `UserModal`, `/api/team` |
| S3 | AI report, WhatsApp templates, Live stock, company profile | Helpful, not load-bearing | |

## 8. Permission and security model (Part B)

### 8.1 Layers
- **Client**: `can()` / `permissionsOf()` / `seesWholeBook()` / `scopeTo()` in `types.ts`; `rights` memo in `App.tsx`; per-screen `can()` calls. Hides controls and filters lists.
- **RLS** (`supabase/schema.sql`): `has_perm()` mirrors `DEFAULT_ROLE_PERMISSIONS` exactly (checked column by column — they agree); `can_write()` = Admin/Manager/CRM/Collector; `is_admin()`.
- **Server/API**: `/api/team` Admin; `/api/fetch-sheet` Admin/Manager; `/api/live-stock` any session (prices by role); `/api/daily-report` CRON_SECRET or Admin/Manager; `/api/gemini-report` any session; `/api/alert-status` session (LIKELY); `/api/health`, `/api/ai-status` open.
- **Auth**: Supabase email+password; sign-up disabled; JWT 1 h; no captcha; Supabase's default rate limits.

### 8.2 Matrix — what each role can do, and which layer actually enforces it

Roles are the defaults; per-login overrides can add or remove any right except Admin's (unconditional).

| Capability | Admin | Manager | CRM | Collector | Viewer | Enforced by |
|---|---|---|---|---|---|---|
| Read every customer, cheque, activity entry, profile (incl. staff emails) | ✔ | ✔ | ✔* | ✔* | ✔ | **RLS allows all**; the per-person slice is CLIENT ONLY (`scopeTo`) |
| See other CRMs' accounts on screen | ✔ | ✔ | only if `canViewAllCrms`/All | same | ✔ | CLIENT ONLY |
| Create a customer | ✔ | ✔ | ✔ | ✗ | ✗ | RLS (`canAddCustomer`) + client |
| Edit customer contacts/details | ✔ | ✔ | ✔ | ✔ | ✗ | client only for *which columns*; RLS `customers_update` lets any writer change any column |
| Edit money columns (`canEditFinancials`) | ✔ | ✔ | ✗ | ✗ | ✗ | client (no UI exists); RLS does not distinguish columns |
| Record follow-up / forecast / urgency | ✔ | ✔ | ✔ | ✔ | ✗ | client; RLS `customers_update` (role only) |
| Log activity / promise | ✔ | ✔ | ✔ | ✔ | ✗ | RLS (`canEditFollowUp`, author = self) + client |
| Delete own activity entry / any entry | own / any | own | own | own | — | RLS |
| Set payment rank / category (single or bulk) | ✔ | ✔ | ✔ (`canEditCustomer`) | ✔ | ✗ | CLIENT ONLY (RLS: any writer) |
| Reassign CRM owner (single or bulk) | ✔ | ✔ | self-claim only | ✗ | ✗ | CLIENT ONLY (RLS: any writer) |
| Assign collector | ✔ | ✔ | ✔ | ✗ | ✗ | CLIENT ONLY |
| Bulk follow-up date | ✔ | ✗ | ✗ | ✗ | ✗ | CLIENT ONLY (`currentUser.role === Admin`); RLS: any writer |
| Delete a customer (cascades cheques + thread) | ✔ | ✗ (default) | ✗ | ✗ | ✗ | RLS (Admin/Manager + `canDeleteCustomer`) + client |
| Add / edit / clear / delete cheques (single or bulk) | ✔ | ✔ | ✔ | ✔ | ✗ | RLS (`canManagePdc`) + client |
| Export the book (Excel) | ✔ | ✔ | ✗ | ✗ | ✗ | CLIENT ONLY (`canExportBook`) — the data is readable anyway |
| Export cheques / stock | ✔ | ✔ | ✔ | ✗ | ✗ | CLIENT ONLY |
| Balance sync, Excel upload, master import | ✔ | ✔ | ✗ | ✗ | ✗ | server (`/api/fetch-sheet` Admin/Manager) + client; the write-back itself is RLS `customers_update` |
| **"Fresh start" reset** | ✔ | ✔ | ✗ | ✗ | ✗ | CLIENT ONLY (`canSyncSheets`) + one `confirm()`; RLS lets a Manager overwrite rows and delete cheques but not delete customers |
| Templates, alert settings, app settings | ✔ | ✔ | ✗ | ✗ | ✗ | RLS + client |
| Company profile | ✔ | ✗ | ✗ | ✗ | ✗ | RLS + client |
| Team & access (create/edit/delete logins) | ✔ | ✗ | ✗ | ✗ | ✗ | server (`/api/team`) + RLS + client |
| Send daily email test | ✔ | ✔ | ✗ | ✗ | ✗ | server |
| AI report | ✔ | ✔ | ✔ | ✔ | ✔ | server (session only); data scoped client-side |
| Live stock prices | ✔ | ✔ | ✗ | ✗ | ✗ | server (columns blanked) + client |
| CRM performance table, team views | ✔ | ✔ | ✗ | ✗ | ✗ | CLIENT ONLY (`runsTheTeam`) — underlying rows readable |

\* reads everything through the API; the screen shows their slice.

### 8.3 Findings for the security phase (recorded, not fixed)

| # | Finding | Prio | Confidence |
|---|---|---|---|
| SEC1 | **Whole-book read for every role.** RLS `using (true)` on customers, cheques, activity and profiles: a CRM/Collector/Viewer session (anon key is in the bundle) can pull all 4,000 accounts, contacts, balances, everyone's notes and staff emails with one PostgREST call. Documented as a design choice in the schema; the digest's careful scoping suggests the leak was not intended to be this easy. | P2 (internal staff; offboarding risk) | CONFIRMED |
| SEC2 | **Column-level rights are client-only.** `customers_update` checks role only; `canEditFinancials`, `canReassignCrm`, `paymentRank`, bulk follow-up (Admin-only in UI) are all enforceable by any writer via PostgREST. | P2 | CONFIRMED |
| SEC3 | **Manager can run the destructive reset** (deletes every cheque, clears owners/notes) behind one `confirm()`. | P1 (data loss, no undo, no backup step) | CONFIRMED |
| SEC4 | **Auth trigger trusts sign-up metadata** (`role`, `legacy_id`). Safe only because `disable_signup = true`; if that dashboard switch is ever flipped, anyone could self-register as Admin. | P2 latent | CONFIRMED (config read 2026-09-16) |
| SEC5 | Customer names, amounts and last notes are sent to a third party (Gemini) by any signed-in role. | P3 / business decision | CONFIRMED |
| SEC6 | `/api/health` and `/api/ai-status` unauthenticated; harmless content. | P4 | CONFIRMED |
| SEC7 | No captcha / lockout beyond Supabase defaults on sign-in. | P3 | CONFIRMED (config) |

## 9. Duplicated or contradictory logic

| # | What | Where | Risk |
|---|---|---|---|
| D1 | **Scoping and "sees whole book" exist twice** — `types.ts` (`seesWholeBook`, `scopeTo`, `ownerKey`) and `api/_lib/digest.ts` (`seesWholeBook`, `scopeFor`, `key`). Kept in step by comment ("must agree… it did not"). `types.ts` has no browser imports and could be shared. | client + server | drift leaks accounts into the wrong inbox (it already happened once per the comment) |
| D2 | ~~**Follow-up status is both stored and derived.**~~ **Resolved for readers 2026-09-17 (Option B):** `processStatuses` no longer writes `status`; every reader derives via `followUpStatusOf()`; the stored word is trusted only for `Completed`. Two writers (`FollowUpModal.handleSave`, `CustomerEditModal.statusFor`) still compute the word inline at action time — a snapshot the app no longer depends on (T34). | `types.ts` | none for readers; the inline writers are a tidy-up |
| D3 | **Notes are stored twice**: `customer_activity` rows and a formatted string appended to `customers.notes[]`. Readers of "last note" (Today list, Reports column, AI report, digest) use `notes[]`; the thread UI uses the table. Deleting an activity entry does not remove its mirror line. | FollowUpModal, digest, ReportsView, AiReportModal | contradiction after a delete; double writes |
| D4 | **Two "expected payment" notions**: `forecast_amount/date` on the row (drives "Promised today"/"commitments" tiles and the digest's "Money promised for today") and `promise` activity entries (drive "They said they would pay today" and promise states). | App.tsx metrics, digest | the same customer can appear twice in one email under two headings |
| D5 | **Performance score computed twice** with different denominators/inclusions: `crmPerformanceStats` (App.tsx, per CRM, collectors double-counted) and `boxMetrics` (ReportsView, per scope). | | two "timely %" figures that need not agree |
| D6 | **Roll-up netting implemented three times**: `netRollUp` (import), `overdueAgeing` (read), `renderTemplate.rollUp` (messages). Same rule, three functions. | | a fix in one is missed in the others |
| D7 | **Official sheet URLs** hard-coded in `App.tsx` and also stored in `app_settings`. | | which one wins is a code path, not a setting |
| D8 | **Status enum drift**: `PdcStatus.DueToday` and `FollowUpStatus.Pending/Overdue/Today/Upcoming` are legacy stored values that the date now overrides; the DB `check` constraints still accept them. | | harmless today; confusing forever |

## 10. Reliability observations (for Phase 11)

| # | Observation | Prio | Confidence |
|---|---|---|---|
| R1 | **Last-writer-wins on whole rows.** Each browser holds a snapshot from sign-in; the sync hook writes the *entire* changed row from that snapshot. Two people touching the same account (owner + collector; a manager's bulk action) silently overwrite each other's follow-up/notes/owner. No realtime, no polling, no version column. `processStatuses` makes it worse: a client open across midnight rewrites every account whose date crossed, from its stale copy. | P1 | mechanism CONFIRMED; frequency LIKELY |
| R2 | **Failed writes retry only on the next change.** A rejected batch leaves the baseline untouched and shows a banner; if the user makes no further change (or closes the tab) the edit is lost. | P2 | CONFIRMED |
| R3 | **Removal by diff.** Any code path that shrinks `appData`/`pdcCheques` while sync is enabled deletes rows server-side (cascading cheques and threads). Today only `handleDeleteCustomer`, the cheque deletes and the reset do this — but it is one accidental filter away from a mass delete. | P2 | CONFIRMED |
| R4 | Cheque ids from `Date.now()`; customer ids from company name (a second firm with the same normalised name merges into the first). | P3 | CONFIRMED |
| R5 | No backups/rollback path documented for Supabase; the reset has no snapshot step. | P2 | LIKELY (nothing in repo) |

## 11. Test safety classification (Part of this session's brief)

Inspected before any execution; none were executed this session.

| Script | Class | Notes |
|---|---|---|
| `scripts/tests/stock-test.cjs`, `overview-test.cjs`, `compare-test.cjs`, `price-ui-test.cjs` (admin leg), `book-filters-test.cjs`, `chips-test.cjs`, `baddebt-test.cjs` | READ ONLY | Filters, tabs, drawers, sessionStorage/localStorage only. `chips-test` hard-codes counts and will go stale. |
| `scripts/tests/crm-test.cjs`; `price-ui-test.cjs` CRM leg | CONTROLLED MUTATION WITH CLEANUP | Creates `ZZ_TEST_CRM` through `/api/team` as Admin, deletes it in `finally`, checks it is gone. Writes to `auth.users`/`profiles` in production. |
| `scripts/tests/phone-test.cjs` | READ ONLY **but fragile** | Selects all customers and presses the Admin bulk "Set follow-up" relying on the `window.confirm` being auto-dismissed. If the confirm is ever removed it becomes a bulk write on production. Do not run against production until that step is rewritten. |
| `scripts/interact.cjs`, `smoke.cjs`, `audit.cjs`, `tour.cjs` | READ ONLY (LIKELY) | Navigation, dialogs opened and closed with Escape, a search typed. No save/confirm accepted found by grep; not exhaustively traced. |
| — | UNSAFE FOR PRODUCTION | None found. Any future test of sync, reset, delete, bulk rank/reassign, or cheque lifecycle must not run against production. |

**Staging requirement (not pursued this session):** a second Supabase project with the schema applied, a copy of production data (or a generated book), `.env.staging`, and a `TIMELY_ENV` switch in `scripts/signin.cjs` / the tests. Vercel preview deployments could point at it. Estimated: a few hours; blocked on the owner creating the project (Q6).
