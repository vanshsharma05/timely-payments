# 05 — USER JOURNEYS

Status: Phase 3, first pass (2026-09-17). Mapped from the code paths named in each journey; Admin-side steps were also walked read-only in the running app during the write-payload probe. CRM/Collector journeys are from code (no non-Admin login was used this session). Nothing here is redesigned. "Concurrency" refers to the confirmed write pattern in 11-SECURITY-RELIABILITY.md Parts 1–2; "KNOWN UX" cites 06-UX-AUDIT.md.

Conventions: **reads** = what the browser already holds after sign-in (the whole book is loaded once — `App.tsx:448–473`) unless a network read is named; **writes** = the debounced whole-row write-back unless a direct repository call is named.

---

## J1 · Sign in, session restore, expired session (everyone)

- ENTRY: not signed in, or a tab reopened. `LoginScreen` (`components/LoginScreen.tsx`); restore in `App.tsx:426–445`.
- GOAL: get to Today.
- STEPS: email + password → `repo.signIn` (`signInWithPassword`, then `fetchCurrentProfile`) → `handleLogin` builds the effective user (role defaults ⊕ profile overrides) → `loadAll` (6 parallel reads; customers/cheques paged by 1,000) → skeleton until `serverLoaded` → Today. A reopened tab restores the session first ("Restoring your session…") so a refresh does not bounce to the login. "Forgot password" → `resetPasswordForEmail` → recovery link handled by `PASSWORD_RECOVERY`.
- DATA READ: `profiles` (own), then everything. DATA WRITTEN: none.
- PERMISSIONS: a login with no profile row is refused with "Ask an Admin to add you."
- FAILURES: wrong password (readable error); Supabase not configured (login says so); `loadAll` failure → red banner "Could not load data", empty screens; the JWT lasts 1 h and supabase-js refreshes it while the tab is open; what a long-idle tab does on its next write is NOT VERIFIED (11 'NEEDS VALIDATION') — by code it would surface as the R2 banner, not a re-prompt.
- CONCURRENCY: none at sign-in; the snapshot taken here is the root of R1.
- FEEDBACK: spinner, banner, skeleton.
- EXIT: Today rendered for the role.
- KNOWN UX: no "last refreshed" indicator for the book afterwards (U5).

## J2 · CRM daily workflow

- ENTRY: signed in as a CRM (`renderUserDashboard`, `App.tsx:1988–2290`), on a laptop or phone.
- GOAL: clear today's follow-ups on own accounts and keep every account scheduled.
- STEPS: (1) read the four cards — Due today / Overdue / No follow-up / Scheduled — and the red Bad-debt strip if any; (2) press a card to filter the "My accounts" list in place (`handleCategoryBoxClick`); (3) per account: **Follow up** (J5), **WhatsApp** (J9), or the name (also opens the follow-up sheet); (4) search the app bar (Ctrl+K) or the book for a customer who rang (J13); (5) record cheques received (J7). On a phone the same, through the bottom tab bar and the follow-up sheet's Form/Activity segments.
- DATA READ: `outstandingData` = `scopeTo(user, appData)` re-derived by `updateViewData` when the book or user changes. DATA WRITTEN: only through J5/J7/J9.
- PERMISSIONS: `canEditFollowUp` gates the Follow up button (disabled with a tooltip otherwise); `canManagePdc` the cheque buttons.
- FAILURES: an empty list with "Nothing here" when no account carries the CRM's code (U11); write failures show the shared banner and leave the screen looking saved (R2).
- CONCURRENCY: every save is a whole-row write from this tab's snapshot; a CRM's own accounts are the most likely to be rewritten by a manager's bulk action or a stale tab's midnight flip.
- FEEDBACK: card counts change instantly; a success banner on save.
- EXIT: due list empty; every owed account has a future date or a promise.
- KNOWN UX: U2 (status wording), U6 (two "expected" fields), U7, U9.

## J3 · Collector workflow

- ENTRY: signed in as Collector; the same personal Today, scoped to accounts where they are `assigned_collector_id` (or owner, or in `assigned_crms`).
- GOAL: record what happened on the accounts handed over.
- STEPS: as J2 without: adding customers, exporting, changing owner/collector (the follow-up sheet hides those controls: `canAssignCollector = canReassignCrm || role === CRM`).
- DATA WRITTEN: follow-up saves, activity entries, cheques.
- FAILURES: an account vanishes from their list the moment the CRM removes them as collector — or when *anyone* opens that customer's edit dialog and saves (C1 nulls the collector). *(prod: 137 accounts currently have a collector distinct from the owner.)*
- CONCURRENCY: as J2; the collector and the owner both write whole rows of the same account — the archetypal R1 collision.
- EXIT: outcome recorded on each handed-over account.
- KNOWN UX: no "handed to you by X on date" context on the row.

## J4 · Manager / company-book workflow

- ENTRY: signed in as Manager (or any whole-book profile): `renderCompanyDashboard` (`App.tsx:2291–2984`).
- GOAL: see where money is stuck and who is not following up; keep the book synced; grade and reassign.
- STEPS: (1) Collections overview: attention banner → "Show them" jumps to Reports filtered to urgent/overdue; four cards → each **navigates to Reports** with that category (`setAdminTab('reports')`); Bad-debt strip → Reports on the recovery list; portfolio ageing; cheques & commitments; CRM performance table (Admin/Manager only). (2) Reports: CRM scope, With dues/Settled/All, category chips (Today/No Date/Overdue/Future/Completed/Bad debt, >90d, >135d), ageing bucket bar, search; select rows → bulk rank / bulk reassign / (Admin) bulk follow-up date / export; AI report (J11). (3) Customer book (J13) for the register view and the same bulk tools. (4) Data source (J6). (5) Alerts, Templates, Company profile.
- DATA READ: whole book. DATA WRITTEN: bulk actions (whole-row × N), reassignments, sync confirm.
- PERMISSIONS: `runsTheTeam` (CRM table), `canSyncSheets` (Data source), `canReassignCrm`, `canEditCustomer` (bulk rank), `isAdmin` (bulk date), `canExportBook`.
- FAILURES: bulk action on the wrong selection (no undo; a `system` note only for the bulk date); a sync confirmed from a stale tab (R1 across ~700 rows).
- CONCURRENCY: highest exposure in the product — long-lived tabs and many-row writes (11 §1.2).
- FEEDBACK: banners with counts; Reports counts update immediately.
- EXIT: every owed account has an owner and a plan; the agency list exported.
- KNOWN UX: U1 (two filter systems), U3 (cards navigate away), U13 (no list on company Today), U12 (Reports' older look).

## J5 · Record a follow-up (CRM, Collector, Manager, Admin)

- ENTRY: **Follow Up** on any row/card → `handleOpenFollowUp` → `FollowUpModal` with `liveSelectedCustomer` (the row from `appData`, so a second entry builds on the first).
- GOAL: record the outcome and the next date.
- STEPS: the sheet shows money (ageing, >90d), contacts (editable), cheques held (can mark cleared), the activity thread (J5a), then the form: outcome (**Collected** / **Follow up on date** / **No follow-up**), next date, expected amount (with the ">90d Due" preset) and date, urgent, payment rank, category, collector, owner (rights permitting) → **Save Follow-up & Contacts**.
- DATA READ: the row; `fetchActivity` (last 200 entries) on open; cheques for the customer. DATA WRITTEN: one whole-row write (`handleUpdateOutstanding` → `processStatuses` over the whole book → sync); `system` activity rows for a rank/category change (direct insert, best effort).
- PERMISSIONS: `canEditFollowUp` (form), `canEditCustomer` (rank/category), `canReassignCrm` / `mayClaimForSelf` (owner), `canAssignCollector`.
- FAILURES: past date allowed here (only the bulk tool refuses it — it becomes Overdue at once); Save with nothing changed still stamps `lastFollowUpOn` (U7); write failure → banner, screen already shows the change (R2).
- CONCURRENCY: R1; plus the whole-book `processStatuses` on every Save (11 Part 2).
- FEEDBACK: dialog closes; no per-save toast (the banner appears only on failure).
- EXIT: row updated; card counts move.
- KNOWN UX: U6, U7, U19 (contacts editable in two dialogs with different semantics).

### J5a · Log activity / a promise

- ENTRY: inside the follow-up sheet (Activity segment on phone) — `CustomerActivityPanel`.
- STEPS: pick a kind (note, no answer, declined, promise, payment, visit, dispute); for a promise, amount + date; optional "resolves" an open promise → **Log it** → `repo.addActivity` (direct INSERT, DB clock) → `handleActivityLogged` appends a formatted line to `notes[]` and stamps `lastFollowUpOn` (whole-row write).
- FAILURES: empty entry refused; promise without a date refused; INSERT refused by RLS for a Viewer (button hidden anyway).
- CONCURRENCY: the INSERT is safe; the mirror line is not (two people logging on one account: the second whole-row write drops the first's line from `notes[]`, though both thread rows survive) — 11 §1.2.
- EXIT: entry in the thread; the line visible on the Today row as "last note".
- KNOWN UX: U8 (mirror drift), U6.

## J6 · Balance sync and reconciliation (Admin, Manager)

- ENTRY: Data source tab → **Sync from Google Sheet** (or Excel upload) — `handleGoogleSync` (`App.tsx:1015–1074`).
- GOAL: bring every balance and ageing figure up to the sheet's "book as of" date.
- STEPS: fetch through `/api/fetch-sheet` (server: Admin/Manager; 12 s per URL shape) → parse → if the book is non-empty, **SyncReconciliationModal**: what changes, what settles (accounts missing from the sheet, with their money), what is new (arrives unassigned) → **Confirm** → `mergeWithExistingFollowUps` → `processStatuses` → `setAppData` → write-back (~700 whole-row updates at 8 in flight, inserts chunked by 500) → `lastSyncTime`, "book as of" saved to settings.
- DATA READ: the sheet; the snapshot. DATA WRITTEN: money block + `settled_at` + status on every matched row; new rows; settings.
- PERMISSIONS: `canSyncSheets` (client) + `/api/fetch-sheet` (server). The write-back itself is `customers_update` (any writer).
- FAILURES: Google slow/unreachable (error banner, nothing written); empty sheet (refused); confirm cancelled (nothing written, not even the timestamp — deliberate); partial write failure → banner, baseline not advanced, retried on the next change (R2).
- CONCURRENCY: **the largest R1 exposure**: every matched row is rewritten from the syncing tab's snapshot; any follow-up saved by a CRM since that tab loaded is reverted on those rows.
- FEEDBACK: the reconciliation summary; a success banner with counts; "Book as of" under the title.
- EXIT: figures current; new accounts in the Unassigned queue.
- KNOWN UX: U14 (sync, import and reset on one tab).

## J7 · Cheques / PDC (CRM, Collector, Manager, Admin)

- ENTRY: PDC cheques tab, "Record a cheque" on Today, or the follow-up sheet's cheque list.
- GOAL: record a cheque received; present it on its date; mark cleared / hold / bounced.
- STEPS: **Record**: customer (required), 6-digit number (required, format not enforced), bank (list or Other), cheque date, amount > 0, received date, remarks → `handleSavePdc` (id `pdc_<now>`). **Register**: tiles (Due today · Date passed, not banked · Upcoming · On hold · Cleared · Bounced) each a filter; row status select or bulk status; bulk delete; export (`canExportData`). State always from the date (`chequeState`).
- DATA WRITTEN: `upsertPdcCheque` (whole cheque row) / `deletePdcCheque` via the cheque sync hook.
- PERMISSIONS: `canManagePdc` (client + RLS).
- FAILURES: two tabs saving in the same millisecond collide on the id (R4, theoretical); deleting a customer deletes its cheques silently (cascade).
- CONCURRENCY: per-cheque last-writer-wins only.
- FEEDBACK: banner on bulk actions; none on single save.
- EXIT: cheque in the right tile; money in hand on Today.

## J8 · Ownership and collector handoff

- ENTRY: the book's row owner dropdown (`handleReassignCrm`), the follow-up sheet's owner/collector selects, the edit dialog's owner select, or bulk reassign on the book/Reports.
- GOAL: put the right person on the account.
- STEPS: choose a CRM code (the app resolves display-name spellings via `findOwner`); the account moves between personal dashboards on the next reload of the other person's tab.
- DATA WRITTEN: `crm_owner_id` / `assigned_collector_id` — inside a whole-row write.
- PERMISSIONS: `canReassignCrm` (Admin, Manager); a CRM may claim an unowned account or their own (`mayClaimForSelf`); Collectors never.
- FAILURES: the target's tab does not learn about the handoff until it reloads; **any later edit-dialog Save by anyone nulls the collector** (C1); a reassign from a stale tab reverts the account's other fields (R1).
- CONCURRENCY: two-writer accounts (owner + collector) are the canonical R1 case.
- FEEDBACK: success banner for bulk; none for the row dropdown.
- EXIT: the account on the right dashboards.
- KNOWN UX: no notification to the person who received the account; no record in the thread (only rank/category/bulk-date changes write `system` entries).

## J9 · WhatsApp reminder

- ENTRY: WhatsApp button on a row/card → `WhatsAppReminderModal`.
- STEPS: pick recipient (primary, an additional contact, or another number), pick a template, preview the rendered text (money placeholders with Dr/Cr, nil lines dropped) → **Send** opens `https://wa.me/<number>?text=…` in a new tab.
- DATA WRITTEN: **none** — no activity entry, no `lastFollowUpOn`.
- FAILURES: a contact number that is not dialable; no templates (default exists).
- EXIT: WhatsApp open with the text; the app has no record it happened.
- KNOWN UX: U21 (new) — sending leaves no trace in the thread.

## J10 · Reporting (Manager, Admin; CRM sees "My performance")

- ENTRY: Reports tab (`ReportsView`).
- STEPS: choose CRM scope → settlement tab → category chip → optional ageing bucket → search → table (sortable? no — fixed order) or phone rows → row actions (Follow up, WhatsApp, cheques) → select → bulk tools → **Excel** (`canExportBook`) → **AI Credit Report** (J11).
- DATA READ: `scopeTo(user, data)` then filters; every count from one memo (`boxMetrics`).
- DATA WRITTEN: only via bulk tools.
- FAILURES: none specific; export of a large filter is a big file.
- KNOWN UX: U1, U12; the "Timely Follow-up Score" here and the CRM table's "Timely Score" are different formulas (D5).

## J11 · AI credit report

- ENTRY: Reports → **AI Credit Report** (Admin, Manager, CRM with `canExportData`).
- STEPS: pick a mode (credit reduction / overdue recovery / CRM performance / cash forecast / custom) → **Generate** → `POST /api/gemini-report` with the summary and the 15 worst accounts (11 Part 5) → markdown rendered; copy/print.
- DATA WRITTEN: none. DATA SENT OUT: see 11 Part 5 / Q9.
- FAILURES: no key → local rule-based report; API error → message.
- EXIT: a report on screen; nothing stored.

## J12 · Daily email (server; Admin/Manager configure)

- ENTRY: Vercel cron 09:00 IST → `/api/daily-report`; or Alerts tab → **Send me a test**.
- STEPS: settings (on/off, roles, skip-when-empty, extra recipients) → recipients with an email → per person: scope (server copy of `scopeTo`), sections: due today, past promised date, promises due/broken, cheques today/past date, promised today, no-follow-up count, bad-debt line, per-CRM table (whole-book readers) → send via Resend/SMTP → `alert_log` row (also for "switched off" and "nobody matched").
- DATA READ: all tables with the service role. DATA WRITTEN: `alert_log`.
- PERMISSIONS: CRON_SECRET or Admin/Manager session; settings write Admin/Manager (RLS).
- FAILURES: no provider configured → the log says so; a recipient without an email is skipped; a scoping bug would leak accounts into the wrong inbox (the code comment records that it once did — D1).
- CONCURRENCY: none (server).
- FEEDBACK: the Alerts screen shows the last runs from `alert_log` and which provider is configured.
- KNOWN UX: the email lists the same customer under two headings when both a forecast and a promise are due (U6).

## J13 · Find a customer

- ENTRY: app-bar search (Ctrl+K, applies to the current tab's list) or the book's search box.
- STEPS: type → `matchesSearch` (whole query anywhere, or every word starting a word) across company, contacts, phone, email, GSTIN, city, state, address, category, additional contacts → row → Follow up / edit / WhatsApp.
- DATA READ: in memory. DATA WRITTEN: none.
- FAILURES: a settled customer is on the Settled tab (the empty state says so and offers the switch); a customer under a different spelling (punctuation is ignored in `companyKey` matching for imports, but search is literal on the stored name).
- EXIT: the account open.

## J14 · Recovery / defaulter workflow (Manager, Admin)

- ENTRY: Today's Bad-debt strip or Reports' "Bad debt (n)" chip; the book's "Bad debt" rank chip.
- STEPS: review the list (defaulters are out of every routine worklist) → export the selection for the agency (`canExportBook`) → grade more accounts with bulk rank (writes a `system` line per account? — no: only the single-account rank change writes one; the bulk tool writes a banner only) → un-grade when they pay.
- DATA WRITTEN: `payment_rank` (whole-row).
- FAILURES: bulk rank from a stale tab reverts other fields on those rows (R1).
- KNOWN UX: bulk grading leaves no per-account record (unlike the single change and the bulk date); the book still lists defaulters (Q5).

## J15 · Admin: team & access

- ENTRY: Team & access (Admin only).
- STEPS: **Add user**: name, CRM code (must match the sheet's code exactly — nothing checks that it does), email, password, role, visibility, rights overrides, assigned CRMs → `/api/team` create (auth user + profile). Edit: same (password optional). Delete: login + profile.
- DATA WRITTEN: `auth.users`, `profiles` (service role).
- FAILURES: the dialog accepts a 6-character password, the repository requires 8, the server requires 6, Supabase requires 8 — the user sees a different message depending on where it fails (U20, new); a CRM code that matches no account gives the new person an empty book with no warning (U11/U15).
- EXIT: the teammate can sign in.

## J16 · Admin/Manager: "Reset All Data (Fresh Start)"

Mapped in full in 11-SECURITY-RELIABILITY.md Part 3. Entry: Data source tab; one `confirm()`; blast radius: every cheque, every legacy-id account and its thread, every settled master-only account; no audit, no backup, no undo. Not walked in the running app.
