# 11 — SECURITY & RELIABILITY

Status: Phase 1 findings **validated with evidence on 2026-09-17** (third session). **C1 fixed** in the fourth session (see §1.4); R1, SEC3 and the rest are still open. Phases 11–12 (the remaining fixes) not started.

Evidence used: code paths cited by file:line; two read-only queries of the production database (counts only); one browser probe (`scripts/tests/write-payload-probe.cjs`) that signs in as Admin and **aborts every mutating request at the network layer** before it leaves the browser, so the captured PATCH bodies are what the app *would* send — the two rows involved were re-read afterwards and are unchanged (`updated_at` 2026-09-14).

---

## Part 1 — R1 lost updates: VALIDATED (CONFIRMED)

### 1.1 The write path, end to end

Every customer edit in the app follows one path:

1. A handler in `App.tsx` builds a new `Outstanding` by **spreading the in-memory row** and changing one or more fields, and calls `setAppData(...)` (e.g. `handleUpdateOutstanding` App.tsx:620–628, `handleReassignCrm` :838–843, `handleBulkSetRank` :853–866, `handleBulkReassignCrm` :867–881, `handleBulkSetFollowUp` :899–976, `handleSaveCustomer` :242–259).
2. `useCollectionSync` (`services/useSupabaseSync.ts:16–99`) runs 800 ms later, computes `toSignature(row)` = `JSON.stringify(outstandingToRow(row))` for every row, and collects rows whose signature differs from **this tab's last-synced signature** (`synced.current`, seeded once at load — line 56–62). The comparison is against the tab's own baseline, never against the server.
3. `saveCustomerRows` (App.tsx:485–490) sends known ids to `repo.updateCustomers`, new ids to `repo.upsertCustomers`.
4. `updateCustomers` (`services/repository.ts:225–249`): `const row = outstandingToRow(c); delete row.id; db.from('customers').update(row).eq('id', c.id)` — **the whole row, 36 columns**, with no `updated_at`/version predicate. Eight rows in flight at once.
5. PostgREST applies `PATCH /rest/v1/customers?id=eq.<id>` with the JSON body: every column in the body is written, unchanged or not.

**Captured evidence** (probe, Admin session, all requests aborted):
- Saving the **edit dialog without changing anything** on `SHREE ATAM UDYOG` produced `PATCH /rest/v1/customers?id=eq.out_86_SHREE_ATAM_UDYO` with **36 columns**; 29 of them identical to the loaded row and re-sent anyway (`company, contact_*, additional_contacts, email, city, state, address, gstin, pan, credit_limit, payment_terms_days, payment_rank, category, total, total_type, ageing, over90_type, due_over45_type, crm_owner_id, assigned_collector_id, forecast_amount, status, notes, is_urgent, is_new_customer, added_at, settled_at, …`).
- Toggling only **Urgent** in the follow-up dialog on `BHAVYA PRINT-O-FLEX` produced a 36-column PATCH in which only `is_urgent` and `last_follow_up_on` were intended changes; `crm_owner_id`, `follow_up_date`, `notes`, `payment_rank`, `forecast_*`, contacts and the money block were all re-sent from the snapshot.
- After an aborted write, the next unrelated change re-sent the earlier row as well (five PATCHes for three saves) — the R2 "retry on next change" behaviour, seen live.

**No optimistic-concurrency mechanism exists.** `rowToOutstanding` does not read `updated_at` (repository.ts:95–140); no version/revision column exists (`schema.sql:37–89`); no `.eq('updated_at', …)` guard; no `If-Match`. **No realtime subscription or polling exists** (grep for `channel(`, `postgres_changes`, `setInterval` in `App.tsx`/`services/*` — none except the stock poll). A tab's copy of the book is the state at sign-in plus its own edits.

**Separate sessions overwrite unrelated fields: YES.** Session B's PATCH carries B's snapshot of every column; any column A changed on the server after B loaded is reverted to B's snapshot value. Same-column conflicts are ordinary last-writer-wins; the defect is that *unrelated* columns are clobbered.

### 1.2 Write operations, one table

Handler line numbers are `App.tsx` unless noted. "Columns written" is always the full 36-column row (via `updateCustomers`) unless the row is new (upsert, full row) — the *intended* change is listed.

| Action | Handler | DB function | Intended change | Source of the other 30+ values | Can overwrite unrelated changes? | Likely collision | Sev | Conf |
|---|---|---|---|---|---|---|---|---|
| Follow-up "Save Follow-up & Contacts" | `FollowUpModal.handleSave` → `handleUpdateOutstanding` :620 | `updateCustomers` (PATCH all) | follow_up_date, status, forecast_*, is_urgent, contacts, additional_contacts, last_follow_up_on, optionally collector/owner/rank/category | `{...customer}` = the live row from this tab's `appData` (`liveSelectedCustomer` :610) | **Yes** | CRM saves next date at 10:00; Manager's tab (loaded 09:00) reassigns owner at 11:00 → Manager's PATCH restores the 09:00 date | P1 | CONFIRMED (probe #4) |
| Log activity (note / no answer / promise / payment…) | `CustomerActivityPanel` → `repo.addActivity` (INSERT `customer_activity`) **and** `FollowUpModal.handleActivityLogged` → `handleUpdateOutstanding` | INSERT (safe) + `updateCustomers` (PATCH all) | notes[] += line, last_follow_up_on | snapshot | **Yes** (the mirror line write carries the whole row) | as above; two people logging notes on one account: second write drops the first's `notes[]` line (the activity row itself survives) | P1 | CONFIRMED (code) |
| Promise save | same as activity | same | same | same | Yes | same | P1 | CONFIRMED |
| Edit customer "Save" | `CustomerEditModal.handleSubmit` → `handleSaveCustomer` :242 | `updateCustomers` | contacts, master fields, rank, category, urgency, note; owner/date/money only when changed | `{...customerToEdit}` **since the C1 fix** (was rebuilt from form state — Part 1.4) | Yes (R1, whole row) — the self-inflicted corruption is gone | any concurrent change | P1 (R1) | CONFIRMED (probe #1, #3 before; no PATCH on a no-change Save after) |
| Owner assignment (row dropdown) | `handleReassignCrm` :838 | `updateCustomers` | crm_owner_id | snapshot | Yes | CRM records a follow-up while the Manager reassigns | P1 | CONFIRMED |
| Bulk reassign / bulk rank | `handleBulkReassignCrm` :867, `handleBulkSetRank` :853 | `updateCustomers` × N | crm_owner_id / payment_rank | snapshot (N rows) | Yes, N rows at once | Manager grades 200 accounts from a morning tab; every follow-up any CRM saved that day on those 200 reverts | **P1** | CONFIRMED |
| Bulk follow-up date (Admin) | `handleBulkSetFollowUp` :899 | `updateCustomers` × N + `addActivities` | follow_up_date, status | snapshot | Yes | as bulk above | P1 | CONFIRMED |
| Collector assignment | via follow-up Save | as follow-up | assigned_collector_id | snapshot | Yes | | P1 | CONFIRMED |
| Status change (collected / no follow-up) | via follow-up Save | as follow-up | status, follow_up_date | snapshot | Yes | | P1 | CONFIRMED |
| **Automatic status processing** | `processStatuses` inside :250, :266, :622–626, :963, :987, and the merges | `updateCustomers` × (rows whose derived status differs from the snapshot's) | status | snapshot | **Yes — rows the user never touched** | see Part 2 | **P1** | CONFIRMED |
| Balance sync confirm | `handleConfirmSyncReconciliation` :984 | `updateCustomers` × matched + `upsertCustomers` × new | money block, settled_at, status | `{...existing}` from the snapshot for every matched row (`mergeWithExistingFollowUps`) | **Yes — every account in the sheet (~700)** | a Manager syncs from a tab opened before the CRMs' morning: the morning's follow-ups on every synced account revert | **P1** | CONFIRMED (code) |
| Master import | `handleCustomerMasterSync` :1076 | `updateCustomers` × enriched + upserts | blanks filled | snapshot | Yes, on every "enriched" row | as sync | P2 (rare, one-time) | CONFIRMED |
| Delete customer | `handleDeleteCustomer` :261 → hook `remove` | `deleteCustomer` | row gone (cascade) | — | n/a | | — | — |
| Cheques (save/status/bulk/delete) | :1668–1727 | `upsertPdcCheque` (full cheque row) / `deletePdcCheque` | cheque fields | cheque snapshot | Yes, within a cheque | two people clearing/editing one cheque | P3 | CONFIRMED |
| Team, templates, settings, profile | `/api/team`, `upsertTemplate`, `saveAppSettings`, `saveCompanyProfile` | upserts | singletons / rows | current form | last-writer-wins on singletons (acceptable) | | P4 | CONFIRMED |

### 1.3 Which user actions are exposed
All customer writes by all writer roles (Admin, Manager, CRM, Collector). Exposure is highest where a tab is long-lived and the action touches many rows: **balance sync confirm, bulk rank/reassign/date, and any first edit in a tab after midnight** (Part 2). Cheques are exposed only per cheque.

### 1.4 A second, independent defect found by the probe: the edit dialog rebuilds the row

`CustomerEditModal.handleSave` (`components/CustomerEditModal.tsx:177–253`) does not spread the existing record; it constructs `savedRecord` from form state and:
- omits `pan`, `assignedCollectorId`, `settledAt` entirely → written as **null** (`outstandingToRow` maps `undefined` → `null`). Captured: `assigned_collector_id: "MUNSHI_RAM" → null` on a no-change Save.
- sets every `ageingTypes` bucket to `totalType` and recomputes `over90 = |91-135| + |>135|`, `dueOver45 = |46-90| + over90` (absolute sums, lines 177–178), discarding the sheet's netted roll-ups. Captured: `over90 116,028 → 285,906`, `due_over45 204,772 → 374,650`, `ageing_types {">135":"Cr"} → "Dr"` on a no-change Save of `SHREE ATAM UDYOG`.
- This happens even though the money inputs are **disabled** for anyone without `canEditFinancials` (lines 570–632): the disabled fields' values are still written back through the recomputation.

Blast radius today (read-only counts, 2026-09-17): **137** accounts carry a collector that one edit-dialog Save would drop; **13** owing accounts have a Cr bucket whose type would flatten; **6** owing accounts' `over90` differs from the absolute sum and would change; **69** `settled_at` stamps would clear; 0 PANs (column unused). Any Manager, CRM or Collector with `canEditCustomer` triggers it by editing a phone number.

Classification: **C1 — data corruption on save, P1, CONFIRMED** (independent of concurrency). Not a business decision; a defect.

**RESOLVED 2026-09-17 (fourth session).** `CustomerEditModal.handleSubmit` now builds an edited record as `{ ...customerToEdit, ...details }` — the existing record is the authority for everything the form does not own — and touches the owner, the follow-up date/status and the money block **only when the corresponding field was actually changed** from the value the form opened with (a `useRef` snapshot taken when the form is seeded; money additionally requires `canEditFinancials`). A new customer is still built from the form as before. Regression: `tests/customerEditModal.dom.test.tsx` renders the real dialog with a synthetic account carrying a collector, a Cr bucket, netted roll-ups and a settlement stamp; 11 of its 13 cases **failed on the old code** with exactly the captured corruption (collector → undefined, `>135` Cr → Dr, over90 116,028 → 285,906, dueOver45 → 374,650, pan → undefined, settledAt → undefined, Completed → Overdue) and all 13 pass now. Probe re-run (all writes aborted): a no-change Save of the two production accounts now produces **no PATCH at all** (nothing changed, so the sync hook has nothing to write); the follow-up dialog's urgency toggle still sends the whole row (that is R1, below) but with the collector intact.

Two further modes the same reconstruction caused, fixed by the same change: a **collected (Completed) account was reopened** by any edit-dialog Save (status re-derived from the date field), and the **owner's stored spelling was rewritten** to the roster's canonical code on every Save (the app resolves both spellings, so this was harmless but was still an unrelated write). Not changed: the pre-existing recomputation an Admin gets when they *intentionally* edit a money figure (pinned by a test; Q10 still open), and the dialog's UTC-based date field (`toISOString().split('T')[0]`), which reads a day early in IST around midnight — recorded as T29.

**C1 and R1 are different defects.** C1 was the *dialog* producing a wrong record; it is fixed. R1 is the *persistence layer* writing whole rows from a stale snapshot; it is **still open** — a correct record is still sent as a 36-column PATCH that can overwrite another tab's unrelated changes.

---

## Part 2 — `processStatuses`: VALIDATED

**Definition** `services/googleSheetService.ts:439–477`. For every row: copy; normalise `followUpDate`/`forecastDate` to `Date`; if `status === Completed` keep; else if a valid `followUpDate` → `status` = `Overdue` / `Today` / `Upcoming` against *today's* midnight; else `Pending`. It writes exactly one field, `status`, into the in-memory copy.

**Triggers** (all in the browser): sign-in load (App.tsx:455, before the sync baseline is seeded → no write); `handleSaveCustomer` :250 and `handleDeleteCustomer` :266 (whole array); **`handleUpdateOutstanding` :622–626 — every follow-up Save and every logged activity line, over the whole array**; `handleBulkSetFollowUp` :963; `handleConfirmSyncReconciliation` :987; `mergeWithExistingFollowUps` (sync, Excel, reset); `mergeCustomerMasterIntoAppData`; `getOutstandingForUser` (feeds `outstandingData`, which is not synced → no write).

**Who**: any role with `canEditFollowUp`/`canEditCustomer` (Admin, Manager, CRM, Collector), by doing their ordinary work.

**How many rows**: every row in the tab's snapshot whose date-derived status differs from the snapshot's stored status. Read-only count on 2026-09-17: 645 rows carry a date; **126 are due today and flip to Overdue at midnight**; 511 upcoming (those dated tomorrow flip to Today); 17 rows were already stale (stored ≠ derived) — evidence that stored statuses drift between mutations.

**What is written**: not just `status`. Each flipped row goes through `updateCustomers` as a **full 36-column PATCH from this tab's snapshot** (Part 1.1). So yes — it can overwrite owner, collector, contact details, `notes[]`, rank, category, forecast, urgency and the money block on rows the user never opened.

**Staleness**: the snapshot is as old as the tab. A Manager's tab left open overnight, then used for one note at 09:05, rewrites ~126 rows from yesterday's 09:00 copy.

**Amplification with simultaneous users**: each tab that makes its first mutation after the date changed rewrites the same flipped rows from *its own* snapshot; the last such tab wins for every one of those rows. The more long-lived tabs, the more likely a fresh edit on a due-today account is reverted. Because the flip set is exactly "accounts due today" — the accounts CRMs are working *that day* — the collision targets the busiest rows.

**Verdict**: genuinely unsafe. P1, CONFIRMED by code and by the captured payload shape; frequency depends on tab lifetime, which for managers is typically all day.

### 2.1 Remediation options (designed, not implemented)

| | Option A — write only changed columns | Option B — stop persisting derived status | Option C — optimistic concurrency on `updated_at` | Option D — realtime refresh |
|---|---|---|---|---|
| Behaviour | `useCollectionSync` keeps the last-synced **row object** per id (not just a signature), diffs column by column, and sends only the changed columns (`update(partial)`). A cleared field still goes as `null`. | `status` is no longer written by `processStatuses`; it is derived at read time (`getFollowUpCategory` already is the rule). Only user outcomes (`Completed`, explicit date) write `status`/`follow_up_date`. Readers of stored `status` (book Status filter, `StatusBadge`, digest tag) switch to the derived category. | `rowToOutstanding` keeps `updatedAt`; every update adds `.eq('updated_at', snapshotUpdatedAt)`; 0 rows affected ⇒ conflict: refetch the row, merge or tell the user "changed by someone else — reload". | Subscribe to `postgres_changes` on `customers`/`pdc_cheques`; merge server rows into `appData` (and into the sync baseline) as they arrive. |
| DB changes | none | none (column stays for legacy rows) | none (`updated_at` + trigger exist) | enable realtime publication on the two tables |
| Frontend changes | `useSupabaseSync.ts` (~40 lines), `saveCustomerRows`/`updateCustomers` accept partial rows; `pdc` adapter unchanged | `googleSheetService.processStatuses` (stop writing), ~6 readers of `item.status`; `FollowUpModal.handleSave` status branches | mapper, hook error handling per row, a conflict UI, retry | new hook, merge logic, baseline update |
| Migration | none | none; stale stored statuses simply stop mattering | none | none |
| Fixes R1 (unrelated columns)? | **Yes** — a tab writes only what it changed | Partly — removes the largest source of stale whole-row writes (the flips) | Detects it; does not by itself fix it | Shrinks staleness; does not fix the 800 ms window |
| Fixes processStatuses amplification? | Yes (only `status` would be sent for flipped rows — still a wasted write, but harmless) | **Yes, entirely** | Turns clobbers into conflicts that need handling | No |
| Same-column races | still last-writer-wins (acceptable; rare) | n/a | detected | shrunk |
| Risk | Low: pure client change; failure mode is a partial row that is *smaller* than today's | Low–moderate: touches several screens; semantics already "date wins" | Moderate: conflict UX; every flipped stale row would now *fail* until reload — must pair with B | Moderate: more moving parts; RLS read-all means every tab receives every row (already readable) |
| Complexity | Small | Small–moderate | Moderate | Moderate |
| Fits current architecture | Yes | Yes | Yes | Yes, but new infrastructure |
| Also needed | C1 fix: `CustomerEditModal` must spread the existing record (or the diff must be against the record, not the form) — otherwise A faithfully sends the nulls | | | |

**Smallest robust set**: **A + B** (and the C1 fix). C is a worthwhile guard afterwards; D is optional polish. All four leave the sheet-owned money rules untouched.

---

## Part 3 — SEC3 "COMPLETE FRESH START": VALIDATED

### 3.1 Trace
- **Control**: Data source tab → "Troubleshooting & Fresh Start" → red button "Reset All Data (Fresh Start)" (`App.tsx:2940–2956`). The tab renders only when `rights.canSyncSheets` (Admin **or Manager**, :1261–1262).
- **Client gate**: the same `canSyncSheets`; the handler `handleResetAllDataAndUsers(skipConfirm=false)` (:739) has no role check of its own. `skipConfirm=true` has no caller.
- **Confirmation**: one `window.confirm` (:741) with a long message. No typed confirmation, no second step, no cooling-off.
- **What it does, in order** (:751–799):
  1. `setPdcCheques([])`, profile → default, templates → default, data source → google + official URL.
  2. Fetches the transactions sheet via `/api/fetch-sheet` (server: Admin/Manager). If that fails, nothing else happens (the customer list is left as it is — but step 1 has already emptied cheques/templates/profile in memory, and the sync hooks will persist that).
  3. `mergeWithExistingFollowUps([], records)` → every sheet row becomes a **new** customer with id `customerIdFor(company)` (`cust_<key>`), no owner, no notes, no collector, no follow-up; `setAppData(fresh)`.
  4. The sync hooks then persist the diff against the tab's baseline: cheques → **DELETE every cheque one by one** (144 today); templates → upsert default + delete the rest; profile → overwrite; customers → for ids already in the book: **PATCH whole row** (money from the sheet, owner '', notes [], collector null, forecast null, urgency from thresholds); for ids not in the book: **INSERT**; for every id in the book but not in the fresh set: **DELETE, one by one**.
- **Blast radius in production today** (read-only counts): 4,027 customers, of which **672 carry legacy `out_*` ids** — those never match the fresh `cust_*` ids, so they are *deleted* and re-created under new ids; deleting them **cascades their cheques and their activity threads** (`schema.sql` FKs on delete cascade). 3,355 `cust_*` accounts: those in the sheet are overwritten (owner, notes, collector, follow-up lost; thread rows survive); those not in the sheet (~2,700 settled master-only accounts) are **deleted with their threads**. 144 cheques deleted explicitly. 606 activity entries: every one attached to a deleted customer is gone.
- **Database/API enforcement by role**: Admin — everything succeeds. Manager — cheque deletes succeed (`canManagePdc`), row overwrites succeed (`can_write()`), inserts succeed (`canAddCustomer`), **customer deletes are refused by RLS** (`customers_delete` needs Admin/Manager *and* `canDeleteCustomer`, which a Manager lacks by default). Result for a Manager: cheques gone, every synced account stripped, plus **duplicate accounts** (old `out_*` rows next to new `cust_*` rows for the same firms), and an error banner.
- **Transactional?** No. Hundreds to thousands of independent requests (8 updates in flight, deletes sequential). A network error midway leaves a mixed state; the hook then retries the *whole* batch on the next change.
- **Partial failure?** Yes, and the first failing delete aborts the remaining deletes (`for … await remove(id)` throws).
- **Audit trail?** None. No activity entry, no `alert_log`, no record of who pressed it or when.
- **Backup/export before?** None.
- **Recovery?** Only a Supabase point-in-time/backup restore, if the project's plan has one (unknown — not in the repo). The app has no undo.
- **Accidental trigger?** Plausible: it sits on a tab a Manager opens weekly to sync, below the sync controls, one click plus one OK. **Malicious/mistaken use** by a Manager account or a stolen Manager session is the only role-based exposure; RLS limits a Manager to the "duplicate + strip" outcome above, not the clean wipe.
- **Does a Manager need it?** Nothing in the repository says so. `README.md` lists "Message templates, data source, sheet sync" for Managers; the reset is not mentioned. `DEPLOYMENT.md` and `ARCHITECTURE.md` do not document the reset at all. Git history: the handler predates the role matrix (it is named `handleResetAllDataAndUsers` though it no longer touches users). **UNKNOWN** — no evidence either way.

### 3.2 Decision brief

**TECHNICAL SAFETY REQUIREMENTS** (defects regardless of who may press it):
- T1 The reset must not silently change ids: it should reuse existing ids by matching names (`mergeWithExistingFollowUps(existing, records)` with a "clear app data" step), or be re-specified. Today it deletes and re-creates 672 accounts and loses their threads.
- T2 It must not run as hundreds of independent client requests. A server-side function (service role) or a Postgres function should do it in one transaction, or it should be removed.
- T3 It must write an audit record (who, when, counts).
- T4 It must take an export/snapshot first (at minimum: download customers + cheques + activity as files; better: a DB-side backup or a copy table).
- T5 Confirmation must be more than one `confirm()`: a typed phrase and a summary of counts ("this will delete 144 cheques, 606 history entries…").
- T6 It must fail closed: the in-memory clearing of cheques/templates/profile (step 1) must not happen before the sheet fetch succeeds.

**BUSINESS PERMISSION DECISION** (not decided here — Q8):
- Who may press it: Admin only / Admin and Manager / nobody (remove the feature, keep an offline procedure).
- Whether it should exist at all now that the book is the database rather than a re-importable sheet.

Options (technical, any of which can be combined with any answer to Q8): keep as is · stronger confirmation only (T5) · Admin-only enforcement in client **and** in a server route · server-side transactional reset with backup and audit (T2–T4) · remove the feature.

---

## Part 4 — Reclassification of the other findings

| # | Finding | Classification | Reasoning (evidence) |
|---|---|---|---|
| SEC1 | Any signed-in role reads the whole book via PostgREST | **INTENTIONAL TRUST MODEL** (documented) **+ a pending PRIVACY/POLICY DECISION** | `schema.sql:227–231`: "Every signed-in user can READ the shared dataset (the app does its own per-CRM view filtering). WRITES are gated on role, enforced in the database so a modified client cannot bypass them." `ARCHITECTURE.md` §5.2 table: SELECT "any authenticated" on every table. The digest comment ("the email is the one place a leak is silent") shows scoping is valued for *workflow and courtesy*, not stated as a security boundary. But `README.md` "Who can do what" promises a CRM sees "own accounts" — a statement the business may read as isolation. The repository does **not** establish that CRMs must be technically isolated. → Q14 for the owner. Not exploitable beyond what a signed-in staff member is trusted with. |
| SEC2 | Column-level rights client-only (`customers_update` is role-only) | **DEFENSE-IN-DEPTH WEAKNESS**, a documented consequence of the whole-row write design | `ARCHITECTURE.md` §5.2: "UPDATE stays on `can_write()` — because recording a note upserts a whole row." Tightening RLS to columns is impossible until writes are partial (Part 2.1 Option A); after A, a column-guard trigger or per-column policy becomes feasible. Not exploitable by outsiders; a CRM could reassign or regrade via the API. |
| SEC4 | Auth trigger takes `role` from sign-up metadata | **DEFENSE-IN-DEPTH WEAKNESS** (latent) | Blocked today by `disable_signup = true` on the project (read via management API 2026-09-16), a dashboard switch outside the repo. Hardening the trigger (ignore metadata role unless created by the service role; default CRM) removes the dependency. |
| SEC5 | Customer data to Gemini | **PRIVACY / POLICY DECISION** | See Part 5. Technically sound (server-side key, session required). |
| SEC3 | Reset | **ACTUAL DATA-LOSS RISK (technical) + BUSINESS PERMISSION DECISION** | Part 3. |
| C1 | Edit dialog rebuilds the row | **ACTUAL DEFECT** (data corruption) — **RESOLVED 2026-09-17**, regression tests in place | Part 1.4. |
| R1 | Whole-row last-writer-wins | **ACTUAL DEFECT** (lost updates) — **OPEN**; next batch (Options A+B) | Parts 1–2. |

## Part 5 — Exactly what is sent to Gemini (SEC5 / Q9)

**When**: Reports tab → "AI Credit Report" (button shown only with `canExportData`: Admin, Manager, CRM) → the dialog → **Generate**. Nothing is sent before Generate. `POST /api/gemini-report` requires any signed-in session; the server holds the key; model `gemini-3.7-flash` (`api/_lib/report.ts:34`); without a key a rule-based text is produced locally and nothing leaves.

**What** (`components/AiReportModal.tsx:60–160` builds it; `api/_lib/report.ts:92–190` puts it in the prompt verbatim):
- Company profile **name** only (no address/GSTIN/bank).
- Scope label: "Company-Wide Portfolio" or the **CRM code**.
- Aggregates for the scope: account count, total outstanding, >45/>90/>135 totals, PDC in hand, PDC cleared total, weighted average collection days, coverage rate.
- For the **15 accounts with the most money past 90 days** in the scope: **customer company name**, **CRM code**, total due, >45 / >90 / >135 amounts, estimated ageing days, stored status, PDC-in-hand amount, and **the last line of `notes[]`** — which is a formatted activity line `"[date - staff name] Kind: free text"`, so it carries a **staff member's name** and whatever was typed (which can include contact names, phone numbers, disputes, personal remarks).
- The chosen mode's instruction text, and for "custom" mode the **user-typed prompt**.
- **Not sent**: customer phone numbers, emails, addresses, GSTIN/PAN as fields; cheque numbers/banks; anything about accounts outside the top 15; the full thread.

**Where it goes**: Google's Generative Language API under the project's `GEMINI_API_KEY`; retention is governed by Google's API terms for that key (not in the repo).

---

## Retained from Phase 0 (still to verify in Phases 11–12)

CONFIRMED
- Secrets: `.env.local` / `.deploy.local` git-ignored; `.env.example` documents names only; `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only (`vite-env.d.ts` deliberately omits them). The service role key is used only under `api/_lib`.
- `/api/fetch-sheet` requires an Admin/Manager session; `/api/live-stock` any session, prices stripped server-side by role; `/api/team` Admin only; `/api/daily-report` CRON_SECRET or Admin/Manager session; `/api/alert-status` session; `/api/health`, `/api/ai-status` open (harmless).
- RLS enabled on every table (`supabase/schema.sql` 233–238, 404–405, 471) with read/write policies per role; `has_perm()` matches `DEFAULT_ROLE_PERMISSIONS` column for column.
- Dependencies: nodemailer 9.0.6 HIGH advisory (fix available, non-breaking range), qs 6.15.3 MODERATE via express (fix available). Dev-only: `tar` critical and several `undici` under the `vercel` CLI package.
- Sign-in: Supabase email+password, `disable_signup: true`, JWT 1 h, password min 8, no captcha (management API, 2026-09-16).

NEEDS VALIDATION
- Rate limiting / brute force on sign-in beyond Supabase defaults.
- `express.json({ limit: '10mb' })` on the dev server — the Vercel functions' own body limits apply in prod.
- Duplicate-submission protection on follow-up save, cheque save, bulk actions (the 800 ms debounce coalesces, but a double-click on Save produces two `onUpdate`s — harmless if idempotent).
- Behaviour when Supabase is unreachable mid-session, when a sheet read fails mid-sync (partly answered: reconciliation never applies), when the session expires mid-edit (`authHeaders` throws "Your session has expired" only on API routes; PostgREST writes with an expired JWT fail with 401 → R2 banner).

Other reliability items: R2 (retry only on next change — **seen live in the probe**), R3 (delete by diff — the reset relies on it), R4 (ids), R5 (no backup procedure documented).

Note: the Live stock Google Sheet itself is shared "anyone with the link"; the app no longer shows the link to non-priced roles, but the sharing setting is outside the app (Q4).
