# 19 — OPEN QUESTIONS

Questions the repository cannot answer. Each brief states what the software does today, why it matters, the options, and what to ask. None of them are answered here; none block the audit's next phases. Figures marked *(prod, 2026-09-17)* are read-only counts taken from the production database.

## Short questions (owner / operator)

| # | Question | Why it matters | Who | Status |
|---|---|---|---|---|
| Q1 | Is `bun.lock` used by anyone (any machine or CI installing with bun)? | Two lockfiles make the dependency tree ambiguous. Kept for now (D5). | Owner | open |
| Q2 | Are `scripts/tour.cjs` and `scripts/contrastfix.cjs` still used? | Removal candidates. | Owner | open |
| Q3 | Which browsers/devices must be supported? Observed: Chrome on Windows laptops (1366×768+), phones ~390 px. Safari/iOS untested here. | Support matrix and testing scope. | Owner | open |
| Q4 | Is the Live stock Google Sheet's "anyone with the link" sharing acceptable now that prices are role-gated in the app? | The price boundary sits outside the app. | Boss | open |
| Q5 | Should the customer book (the register) also hide bad-debt accounts by default, or only the worklists (current)? | Business-rule scope. | Boss | open |
| Q6 | Is there, or can there be, a staging Supabase project? All QA today signs in to production; the two P1 defects (11 Parts 1–3) cannot be tested safely without one. Spec in 12-TEST-STRATEGY.md. | Test safety; blocks the reliability fixes' verification. | Owner | open |
| Q10 | Does anyone need to edit money columns in the app (`canEditFinancials`)? Only `CustomerEditModal` offers the inputs (disabled without the right) and the sheet overwrites them on the next sync. | Simplifies the matrix; interacts with C1 (11 §1.4). | Boss | open |

---

## Q7 — Do advance (Cr) accounts count as "with dues"?

**Current implemented behaviour.** `hasOutstanding(item) = |total| > 0` (`types.ts`). An account whose balance is a *credit* (we hold their money) therefore counts as "with dues" in: the customer book's default tab and count, each CRM's "accounts with dues" and their timely score, the Receivables tile's account count, the digest's `bookCount`. At the same time `overdueAgeing()` says such an account has **nothing overdue**, so it appears in no ageing bucket, no Overdue/>90d list, and its rank is Good. *(prod: 34 Cr accounts holding ₹1.77 L in total.)*

**Why the question exists.** Two rules disagree about what a Cr account *is*: money-wise it is a liability, not a receivable; workload-wise it may still need a call (to apply the advance, to sell against it). The code chose "|total| > 0 is work" without recording why.

**Real-world effect.** 34 accounts inflate "accounts with dues" and every CRM's denominator by a little; a CRM sees them on their worklist as "No follow-up" if no date is set; the Receivables tile sums Dr only, so money is not overstated.

**Options.** (a) Keep: Cr accounts are work. (b) Exclude Cr from "with dues" everywhere (count them under a separate "In credit" tab/tile). (c) Exclude from counts and scores but keep them in the book's default list.

**Technical consequences.** (a) none. (b) one-line change in `hasOutstanding` + the digest's `bookCount`, with a new settlement filter value and a tile; every count changes slightly. (c) split `hasOutstanding` into "owes" vs "has a balance" and use the right one per screen — more surface, more chances to disagree.

**Ask the owner.** "When a customer has paid us in advance, should they appear on the CRM's list of accounts to chase and count towards the CRM's workload?" and "Should the daily email mention accounts in credit?"

---

## Q8 — Who may run "Reset All Data (Fresh Start)"?

**Current implemented behaviour.** The button is on the Data source tab, visible to **Admin and Manager**, one `OK` away. For an Admin it deletes every cheque (144 today), deletes every customer not in the sheet (~2,700 settled accounts) and every account carrying a legacy id (672) *with their activity threads*, re-creates the sheet's ~700 accounts under new ids with no owner/notes/collector/follow-up, and resets templates and the company profile. For a Manager the database refuses the customer deletes, so the result is stripped accounts plus duplicates. No audit record, no backup, no undo. Full trace: 11-SECURITY-RELIABILITY.md Part 3.

**Why the question exists.** The feature predates the shared database (it is named `handleResetAllDataAndUsers`); nothing in README/DEPLOYMENT/ARCHITECTURE describes when it should be used or by whom. The audit found technical defects in it regardless of policy (11 §3.2 T1–T6).

**Real-world effect.** One misclick by a Manager loses the team's cheque register and the history of every account; a stolen Manager session could do the same.

**Options (policy).** (a) Admin only. (b) Admin and Manager, as now. (c) Remove from the app; keep a documented offline procedure (SQL run by whoever administers Supabase). (d) Keep, but only as a server-side transactional job with backup + audit + typed confirmation (the technical fixes), under whichever roles (a)/(b).

**Technical consequences.** (a) client gate + a server route or RLS check, one afternoon; does not fix T1–T6. (b) nothing; risk stays. (c) delete ~70 lines; least risk. (d) new `/api/reset` with service role: export tables to storage, run one transaction, write `alert_log`; the id-rewrite (T1) must be fixed either way.

**Ask the owner.** "Has anyone ever needed to wipe and re-import the whole book since the app moved to the database? Who did it, and why?" · "If the book had to be rebuilt tomorrow, who should be allowed to do it — the Admin only?" · "Would you accept that a reset first downloads a backup and asks you to type RESET?"

---

## Q9 — May customer names, amounts and notes be sent to Google (Gemini)?

**Current implemented behaviour.** Pressing **Generate** in the AI Credit Report (Reports tab; Admin, Manager and CRM see the button) sends to Google's Gemini API, under the company's key: the company name, the scope (whole book or one CRM code), aggregate totals, and for the **15 accounts with the most money past 90 days**: the customer's name, CRM code, amounts by bucket, stored status, PDC-in-hand amount and **the last activity line** — `"[date - staff name] Kind: free text"`, i.e. a staff member's name and whatever was typed (which can include contact names, phone numbers, disputes). Custom mode also sends the user's typed prompt. Not sent: phones, emails, addresses, GSTIN/PAN, cheque details, the full thread. Exact inventory: 11 Part 5. Without a `GEMINI_API_KEY` a rule-based report is built locally and nothing leaves.

**Why the question exists.** This is the only place customer data leaves the company's own systems (Supabase, Vercel, Google Sheets are already third parties, but Gemini is a generative service with its own data-use terms). The audit cannot decide whether Shori Chemicals accepts that.

**Real-world effect.** Debtor names and internal remarks about them are processed by Google; retention/training terms depend on the API tier. Any CRM can trigger it for their own scope; a Manager for the whole book.

**Options.** (a) Accept as is. (b) Accept but strip notes and staff names (send figures + names only). (c) Pseudonymise (send "Account 1…15" and map back in the browser). (d) Restrict the button to Admin/Manager. (e) Remove the AI report (keep the rule-based one, which needs no key).

**Technical consequences.** (a) none. (b) one line in `AiReportModal` (drop `lastNote`), weaker advice. (c) ~40 lines; advice loses named-account specificity in the prompt but the UI can restore names. (d) change one `can()` check. (e) delete the key; the fallback already exists.

**Ask the owner.** "Are you comfortable that the names of your 15 worst debtors and the last note written about each are sent to Google when someone presses Generate?" · "Should only managers be able to do that?" · "Is the note text needed, or are the figures enough?"

---

## Q11 — Should "Save" count as a follow-up when only contact details changed?

**Current implemented behaviour.** `FollowUpModal.handleSave` sets `lastFollowUpOn = now` unconditionally (`components/FollowUpModal.tsx:248`), whatever changed — a corrected phone number, a new secondary contact, the urgency flag. `lastFollowUpOn` feeds the CRM performance table and the digest's notion of attention. Logging an activity entry also stamps it (that one is a genuine contact).

**Why the question exists.** "Last follow-up" is read by managers as "last time somebody spoke to this customer"; the code treats it as "last time somebody saved this dialog".

**Real-world effect.** A CRM tidying contact details makes neglected accounts look attended; the "unattended" column under-reports. *(Effect size unknown; no field records what changed.)*

**Options.** (a) Keep. (b) Stamp only when an outcome/date/forecast changed or an activity entry was logged. (c) Split into two fields: `lastContactedOn` (activity) and `lastEditedOn`.

**Technical consequences.** (b) a condition in `handleSave` (~10 lines); historical stamps stay as they are. (c) a column, a mapper change, screen updates.

**Ask the manager who reads the CRM table.** "When you see 'last follow-up 3 days ago', do you expect that someone spoke to the customer, or just that someone opened the record?"

---

## Q12 — Is the Viewer role used or needed?

**Current implemented behaviour.** The role exists in the schema, the trigger defaults, the permission matrix (read whole book, write nothing), the README and DEPLOYMENT tables, and every screen carries "your role cannot…" states for it. *(prod: 18 profiles — 10 CRM, 4 Collector, 2 Manager, 2 Admin, **0 Viewer**.)*

**Why the question exists.** Every read-only branch in the UI, the RLS helper, the digest's role list and the docs must keep supporting a role nobody holds; the UX phase would otherwise design empty states for it.

**Real-world effect.** None today. If a director or auditor is expected to get a login later, the role is the right shape for it.

**Options.** (a) Keep, document as "for directors/auditors". (b) Remove the role (schema check constraint, matrix, screens, docs). (c) Keep but stop designing for it until someone needs it.

**Technical consequences.** (a) nothing. (b) a schema change (constraint), ~30 code sites, docs. (c) nothing now.

**Ask the owner.** "Is there anyone — the boss, an accountant, an auditor — who should be able to look at the book without changing anything? If not now, ever?"

---

## Q13 — Urgency thresholds

**Current implemented behaviour.** On every sheet import a row is flagged **Urgent** when its net "due > 45 days" (Dr) exceeds **₹10,00,000** or its ">135 days" bucket (Dr) exceeds **₹5,00,000** (`services/googleSheetService.ts:216`). The flag is cleared when an account settles, can be toggled by hand in the follow-up dialog, and drives the red "Urgent" chips, the attention banner and the digest's URGENT tag. *(prod: 35 accounts flagged; 30 would be flagged by the thresholds today; 18 flagged accounts are below both — hand-set or left over from earlier figures.)*

**Why the question exists.** The two numbers are in code with no source; nobody has confirmed they are the business's definition of urgent, and a re-import re-applies them only to matched accounts' money block — the flag itself is app-owned and not recomputed on sync, so hand-set and stale flags persist.

**Real-world effect.** The banner count and the "Urgent" chips are a mix of a rule and human judgement; nobody can tell which is which.

**Options.** (a) Confirm the thresholds and keep. (b) Change the numbers. (c) Make them a setting on the Data source tab. (d) Drop the automatic flag; keep Urgent as a purely human mark. (e) Recompute the automatic part on every sync so stale flags clear.

**Technical consequences.** (a)/(b) trivial. (c) two `app_settings` columns and a form. (d) delete a line; existing flags stay until cleared by hand. (e) a merge rule change; must not clear hand-set flags (needs a "why urgent" field or two flags).

**Ask the owner.** "What makes an account urgent for you — an amount, an age, a customer, a judgement call?" · "Are ₹10 lakh past 45 days and ₹5 lakh past 135 days the right lines?" · "When the sheet changes, should the flag follow the numbers, or stay until someone clears it?"

---

## Q14 — Must CRMs be technically isolated from each other's accounts? (new; from SEC1)

**Current implemented behaviour.** The database lets every signed-in login read every customer, cheque, activity entry and profile; the app shows each CRM/Collector only their own slice. The schema documents this as a deliberate "shared dataset" with writes as the enforced boundary (`supabase/schema.sql:229–231`, `ARCHITECTURE.md` §5.2). The README tells users a CRM sees "own accounts". A CRM with the browser's developer tools (or the anon key, which is in the page) can pull the whole book.

**Why the question exists.** The right fix depends entirely on intent: a trusted internal tool needs nothing beyond offboarding discipline; a tool where CRMs must not see colleagues' customers needs per-row read policies and a change to how the app loads data (today it loads the whole book and filters in the browser).

**Real-world effect.** A departing or disgruntled CRM can export the entire customer list with balances and everyone's notes. Colleagues can look at each other's accounts without it showing.

**Options.** (a) Accept as a trusted internal tool; document it; rely on offboarding (delete logins promptly). (b) Enforce read scoping in RLS (`customers_read` restricted to owner/collector/assigned CRMs unless the profile sees the whole book); the app then loads only what the policy returns. (c) (b) plus scoped cheques/activity and hiding staff emails from non-admins.

**Technical consequences.** (a) none. (b) new RLS policies mirroring `scopeTo` (the rule already exists in SQL-able form), Manager/Admin unaffected; company-wide metrics for non-whole-book users disappear (they are already hidden); the digest is unaffected (service role). Risk: a policy bug hides an account from the person who must work it — needs staging (Q6). (c) as (b) plus `profiles` column masking (a view).

**Ask the owner.** "If a CRM opened the app's data directly and saw the whole book, would that be a breach, or just how a small team works?" · "When someone leaves, is deleting their login the same day a reliable routine?"

## Q15 — Same-field conflicts: which fields deserve a warning, and who may overwrite? (new; from R1-B, 11 §2.2)

**Current implemented behaviour.** After Options A and B a save carries only the columns it changed, so two people editing different things on one account no longer overwrite each other. If two people change the *same* field from stale tabs, the later save silently wins (11 §2.2, scenarios S1–S7). Three weeks of activity show one customer-day with two authors out of 561; a tab is never refreshed after sign-in.

**Why the question exists.** Detecting the race is cheap (a predicate on the columns being written); what to *do* about it is policy: which fields are worth interrupting someone for, whether "use mine anyway" is allowed and for whom, and whether the app should record who last changed an account (`updated_by` exists, nothing sets it).

**Real-world effect.** A CRM and their collector plan different dates for the same customer; the one who saved first loses the plan and finds out only when the customer is called twice or not at all. Collected/reopened can flip the same way.

**Options.** (a) Warn on follow-up date, collected/reopened, owner, collector, forecast, money, rank/category; contacts, urgency and "last follow-up" stay last-writer-wins; notes merge automatically. (b) Warn only on date, collected/reopened, owner and collector. (c) No warning; a focus refetch so tabs go stale for minutes rather than a day.

**Technical consequences.** (a)/(b) `updateCustomerColumns` gains a predicate per changed column (~30 lines), the hook surfaces a conflict (~15 lines), one of the three conflict experiences in 11 §2.2 (toast ≈ 40 lines; card ≈ 150; in-dialog check ≈ 250). (c) ≈ 60 lines following the live-stock refresh pattern. Recording *who* needs `updated_by` to be set on every write (client-side `auth.uid()` or a trigger — a configuration change).

**Ask the owner.** "When two of your people change the same thing on one customer, should the second one be stopped and shown both values — and may they override, or only a Manager?"
