# 04 — USER TYPES

Status: Phase 2 complete (2026-09-16). Derived from `UserRole`, `DEFAULT_ROLE_PERMISSIONS`, `seesWholeBook`/`scopeTo`, the RLS policies, the `handle_new_user` trigger defaults, the screens each role is given (`App.tsx` `workItems`/`setupItems`, `renderCompanyDashboard` vs `renderUserDashboard`), the digest recipients, and the live profile count seen in earlier work (17 logins). Not personas — the roles the system actually has. Where a statement is about how people *behave* rather than what the code does, it is marked *(observed/assumed)*.

Two facts shape every role below:
- **Two dashboards exist.** Whoever `seesWholeBook()` gets the company view ("Collections overview": company cards, portfolio ageing, cheques/commitments, CRM performance for Admin/Manager, reset/sync on the Data source tab). Everyone else gets the personal view ("Today's follow-ups": my worklist cards + the bad-debt strip, my book, cheques & commitments, my accounts list).
- **Visibility and rights are per login, not per role.** A CRM can be given "View all CRMs" and then sees the whole book (and the company dashboard) without becoming a Manager; a Manager can be narrowed. The role supplies defaults only.

---

## 1. CRM (account owner) — the core user

ROLE: `CRM`. Default rights: add/edit customers, follow-ups, cheques, export; not financials, not reassign, not delete. Visibility: own accounts (owner or collector) plus any CRM codes in `assigned_crms` (defaults to their own code).

PRIMARY JOB: work today's follow-ups on their own accounts and keep the next date, the expected amount and the account's history current, so money comes in on time.

TOP 5 MOST FREQUENT ACTIONS *(observed from the screens built for them)*: (1) open Today and scan Due today / Overdue; (2) open an account's follow-up sheet and log the call outcome (no answer / promise / note) with the next date; (3) send the WhatsApp reminder; (4) search for a customer who has just rung; (5) record or clear a cheque.

MOST IMPORTANT INFORMATION: who is due today and who slipped; what was said last time; how much is owed and how old it is (ageing bar, >90d); cheques in hand; promises outstanding.

WHAT THEY SHOULD SEE FIRST: the Today worklist with counts, then the list of due/overdue accounts with the last note on each — which is what the personal dashboard does.

WHAT THEY SHOULD NOT NEED TO UNDERSTAND: Dr/Cr netting, how ageing roll-ups are computed, sync/reconciliation, roles and permissions, the difference between stored status and category, the two "expected payment" notions (§9 D4 in 03), what "Book as of" means.

TIME-SENSITIVE TASKS: due-today follow-ups; a promise that falls due today; a cheque dated today to hand to accounts; the morning email (09:00 IST) which lists all three.

HIGH-RISK ACTIONS: marking an account "collected" (closes it from the worklist); changing the payment rank (moves an account on/off the recovery list); assigning a collector; claiming an unowned account; deleting a cheque; deleting their own activity entry. None of these are undoable in the app.

COMMON ERRORS *(from the code's own guards and comments)*: setting a past follow-up date; logging a promise without a date; forgetting the next date (account drops to "No follow-up"); saving without a note (Save alone still stamps `lastFollowUpOn`); working from a stale tab and overwriting a colleague's change (R1).

LIKELY CONFUSION: "Pending" vs "No follow-up" vs "Upcoming"; the Status dropdown in the book vs the Today cards; an account that vanished because a sync settled it; bad-debt accounts missing from Overdue (now explained by the strip); why a Cr account shows "with dues".

SUCCESS CONDITION: every owned account with dues has a future follow-up date or a promise, and the day's due list is empty by evening.

DESKTOP/MOBILE NEEDS: both. On the phone: the bottom tab bar, folded filters, the follow-up sheet with Form/Activity segments, tap-to-call numbers, WhatsApp. On the laptop: the one-screen Today layout with the list in the right column.

POWER-USER REQUIREMENTS: keyboard search (Ctrl+K), quick outcome chips, ">90d Due" preset for the expected amount, compare on Live stock while on a call.

NEW-USER REQUIREMENTS: an Admin must create the login with the exact CRM code that appears on their accounts; until accounts carry their code they see an empty book. No in-app onboarding exists.

PERMISSIONS: see 03 §8.2. Note that a CRM's RLS rights are broader than their screen: they can read the whole book and update any column of any account via the API.

DEPENDENCIES ON OTHER USERS: Admin/Manager to sync balances (they cannot); Admin to create their login and to assign accounts they do not own; Manager to reassign; accounts team to keep the sheet current.

## 2. Collector (field/phone collector) 

ROLE: `Collector`. Defaults: edit customer contacts, follow-ups, cheques; cannot add customers, export, reassign, or see other portfolios. Visibility: accounts where they are the `assigned_collector_id` or owner, plus `assigned_crms` if set.

PRIMARY JOB: chase the specific accounts handed to them by a CRM/Manager — visits, calls, cheque pick-ups — and record what happened.

TOP 5 ACTIONS: open Today; log a visit/payment/promise; record a cheque received; send a WhatsApp reminder; call a contact from the phone row.

MOST IMPORTANT INFORMATION: which handed-over accounts are due, the amount and age, the address/contact, cheques in hand.

WHAT THEY SHOULD SEE FIRST: the same personal Today as a CRM, limited to handed-over accounts.

SHOULD NOT NEED TO UNDERSTAND: everything a CRM should not, plus ownership rules (they cannot change them).

TIME-SENSITIVE: same as CRM; physical cheque dates.

HIGH-RISK ACTIONS: marking collected; deleting a cheque (they have `canManagePdc`); editing a contact number wrongly.

COMMON ERRORS / CONFUSION: an account disappearing when the CRM removes them as collector; the CRM performance table counts them on a row of their own ("+n" double count with the owner).

SUCCESS: every handed-over account has an outcome recorded.

DEVICE: predominantly phone *(assumed — the role implies field work)*.

PERMISSIONS: as above; `canExportData` false by default.

DEPENDENCIES: CRM/Manager to hand accounts over; cannot self-claim.

## 3. Manager

ROLE: `Manager`. Defaults: everything an Admin has except deleting customers and managing logins; sees the whole book; gets the company dashboard; may sync sheets and run the reset; edits templates, alert settings, app settings.

PRIMARY JOB: keep the book moving — see where money is stuck, who is not following up, rebalance portfolios, decide who is a defaulter, run the sync after the accounts team updates the sheet, and brief the boss.

TOP 5 ACTIONS: read the company dashboard and the CRM table; open Reports on Overdue / >90d / Bad debt; bulk-set rank or reassign a selection; run the balance sync and confirm the reconciliation; export the agency list.

MOST IMPORTANT INFORMATION: due/overdue counts and money, per-CRM unattended counts, portfolio ageing, defaulters, cheques past their date, "book as of" vs today.

WHAT THEY SHOULD SEE FIRST: the four company cards, the bad-debt strip, the attention banner, portfolio ageing.

SHOULD NOT NEED TO UNDERSTAND: the merge algorithm, RLS, why two scores differ (D5), the write-back mechanics.

TIME-SENSITIVE: syncing when the sheet updates (the "Book as of" date drives everyone's figures); the morning email includes a per-CRM table for them.

HIGH-RISK ACTIONS: **"COMPLETE FRESH START"** (SEC3 — deletes every cheque, clears every owner and note; one confirm); confirming a reconciliation that settles accounts (money to nil); bulk reassign/rank on a wrong selection; export of the book; editing alert recipients (who gets the email).

COMMON ERRORS: confirming a sync whose sheet was the wrong tab/URL; bulk actions on "Select all" of an unintended filter; reassigning to a display name instead of a code (the app resolves it, but the CRM table used to split).

LIKELY CONFUSION: Reports vs the customer book (two filter systems for the same rows); "Timely score" on the CRM table vs on Reports; counts that include Cr accounts.

SUCCESS: every account with dues has an owner and a planned follow-up; overdue count trending down; defaulters on the agency list.

DEVICE: laptop mostly; phone for the dashboard *(assumed)*.

POWER-USER: bulk tools, select-all within a filter, Ctrl+K, export.

PERMISSIONS: see matrix. Notably can run the reset (client-gated) and cannot delete customers (RLS) — so a reset by a Manager half-succeeds (SEC3).

DEPENDENCIES: Admin for logins and the bulk follow-up date; accounts team for the sheet.

## 4. Admin (the owner / the boss's operator)

ROLE: `Admin`. Unconditional: every right, every row, every tab (Team & access is Admin-only), plus the Admin-only bulk follow-up date tool.

PRIMARY JOB: run the system — logins and rights, data source, company profile, reminders — and step in on the book when needed (bulk date moves for overdue accounts nobody rescheduled).

TOP 5 ACTIONS: everything a Manager does; create/edit/remove logins; bulk-set follow-up dates; send a test reminder; change the company profile.

MOST IMPORTANT INFORMATION: the same as a Manager, plus whether the deployment is healthy (mail provider, cron, service key present — the Alerts screen says so).

HIGH-RISK ACTIONS: everything a Manager has, plus deleting customers (cascades cheques and thread), deleting logins, changing someone's role/visibility (which changes what they can see and what the email sends them), the reset.

COMMON ERRORS: creating a login with a CRM code that does not match the sheet (accounts then never attach); granting "View all" without meaning to; deleting a customer to "clean up" and losing its history.

SUCCESS: the team can sign in and sees exactly their book; the email goes out; the sync runs cleanly.

DEVICE: laptop.

PERMISSIONS: unconditional in code, RLS and API.

DEPENDENCIES: Supabase/Vercel dashboards (outside the app) for anything the app does not expose (backups, sign-up switch, secrets).

## 5. Viewer (read-only management / audit)

ROLE: `Viewer`. Defaults: `canViewAllCrms` true, nothing else. Sees the whole book and the company dashboard, cannot record anything; the CRM performance table is hidden (`runsTheTeam` false).

PRIMARY JOB: look — a director, an accountant, an auditor *(assumed; no Viewer login exists in the 17 seen earlier, LIKELY unused)*.

WHAT THEY SHOULD SEE FIRST: the company dashboard and reports.

HIGH-RISK ACTIONS: none in the UI. Via RLS they cannot write (`can_write()` false) — the one role whose screen and API rights agree.

CONFUSION: buttons that exist but are disabled ("Your role cannot record follow-ups"); export hidden.

## 6. Roles that exist outside the app but shape it

- **The accounts team** maintains the transactions Google Sheet and the stores sheet. They never log in. Their column names and Dr/Cr conventions are contracts the parser depends on (`parseGoogleSheetCsv` header matching, `parseAmountAndType`).
- **The boss** (company owner) sets policy — bad-debt handling, who sees prices, what the dashboard shows — and reads the daily email; in practice relays requests through the app's owner (the Admin).
- **The recovery agency** receives the exported defaulter list (the reason `canExportBook` is management-only).

## 7. Cross-role dependencies (summary)

```
accounts team ──sheet──▶ Admin/Manager ──sync──▶ book ──scope──▶ CRM ──hand over──▶ Collector
                                   │                                  ▲
                                   └── logins, rights, reassign, bulk dates ┘
boss ◀── daily email / reports ◀── everyone's follow-ups, promises, cheques
```
