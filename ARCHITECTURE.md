# Timely Payment — engineering reference

Deep reference for the whole system: what it is, how it is built, the rules it
enforces, what the live data actually looks like, and what is still open.

Written against commit `a9556bd` on branch `restore-and-fix`, verified against
the live database on **29 August 2026**.

- **Live app:** https://timely-payment.vercel.app
- **Customer:** Shori Chemicals Pvt. Ltd., Ludhiana
- **Status:** in production, real money, real staff, used daily

---

## 1. What the product is

A receivables collection book. Every account that owes Shori Chemicals money,
who is chasing it, what was said on the last call, what was promised, and which
post-dated cheques are held against it — shared by the whole team, one dataset.

Three jobs it does that a spreadsheet could not:

1. **Splits the book by responsibility** so each CRM/collector opens the app and
   sees only their own work, while managers see everything.
2. **Keeps a shared, append-only record** of what happened on each account, so
   whoever rings tomorrow knows what was tried today.
3. **Tells people what to do this morning** — a worklist on screen and a 9 a.m.
   email per person.

The Google Sheet is an **import source only**. Supabase is the master record.

---

## 2. Live state (29 Aug 2026)

Read straight from production. These numbers are the reason several design
decisions below exist.

### The book

| | |
|---|---|
| Customer rows | **4,015** |
| …of which owe something | **687** |
| …of which owe nothing (Customer Master) | **3,328** |
| Total outstanding (Dr) | **₹11,20,56,112** (₹11.21 Cr) |
| Credit balances held (Cr) | ₹3,19,149 |
| Duplicate company names | 0 *(33 merged away, 29 Aug)* |

### Ageing (Dr accounts only)

| Bucket | Amount | Share |
|---|---|---|
| 1–45 days | ₹2,93,48,879 | 26% |
| 46–90 days | ₹2,03,81,588 | 18% |
| 91–135 days | ₹1,22,31,064 | 11% |
| **> 135 days** | **₹5,01,96,986** | **45%** |

Nearly half the book is over 135 days old. That single fact is what the whole
"Bad debt" rank and the agency-list export exist to act on.

### Follow-up coverage (accounts with dues)

| | Count |
|---|---|
| No follow-up planned | **607** |
| Due today | 1 |
| Overdue | 3 |
| Scheduled ahead | 76 |

**88% of the accounts that owe money have nothing planned against them.** This
is the biggest operational gap in the system today — the software works, the
habit is not there yet.

### Per-CRM book (accounts with dues)

| CRM code | Accounts | Amount |
|---|---:|---:|
| PRIKSHIT | 181 | ₹3,89,51,176 |
| VISHNU | 200 | ₹3,22,87,131 |
| POONAM | 94 | ₹1,57,42,135 |
| ANKUR | 19 | ₹82,14,109 |
| SANDEEP | 66 | ₹77,65,710 |
| KAPIL | 15 | ₹51,88,644 |
| SAVIA | 58 | ₹18,77,095 |
| RAKESH | 9 | ₹5,10,272 |
| ROHINI | 5 | ₹1,28,391 |
| GARRY | 7 | ₹35,719 |
| *(unassigned)* | 1 | ₹8,780 |

Plus a lowercase shadow of most of those — see [§13.2](#132-crm-code-case-drift).

### Collectors

| Collector | Accounts handed over |
|---|---:|
| ATUL_BERRY | 19 |
| MUNSHI_RAM | 7 |
| *(none)* | 661 |

### PDC cheques (67 total)

| Status | Count | Amount |
|---|---:|---:|
| Pending (in hand) | 63 | ₹40,22,075 |
| Hold | 3 | ₹4,70,799 |
| Cleared | 1 | ₹30,066 |

By date: **5 due today**, **1 past its date and still Pending**
(RANKESHWAR COLLECTION LLP, ₹31,926, dated 28 Aug), **57 future-dated**.

The three on Hold are the three that were found past their date on 28 Aug
(ANSH FABRICS ₹3,80,799, CHAHAL EMBROIDERY ₹50,000, SHAH KNIT FAB ₹40,000) —
somebody has since parked them deliberately, which is the correct use of Hold.

**65 of 67 cheques were entered by Rawat.** One by kapil, one by Sandeep.

### Team (17 profiles)

| Role | People |
|---|---|
| Admin | `Admin`, `ANKUR` |
| Manager | `RAWAT` |
| CRM | GARRY, KAPIL, POONAM, PRIKSHIT, RAKESH, ROHINI, SANDEEP, SAVIA, SUNNY, VANSH_SHARMA, VISHNU |
| Collector | AMRIT, ATUL_BERRY, MUNSHI_RAM |

`ATUL_BERRY` and `MUNSHI_RAM` are Collectors with `data_visibility = All` —
they see the whole book, not just what is assigned to them.

### Activity log

30 entries, all created 29 Aug — 26 notes, 2 "no answer", 2 system. Real usage,
mostly by `Admin` and `ANKUR`. Sample entries: *"as discuss with Atul, will give
30000 on monday"*, *"assign to atul to visit"*, *"we will follow in 14Sept for
payment"*.

Only 28 customers have anything in the legacy `notes` array.

### Alerts

`daily_email` is **ON**, all four roles selected, `skip_when_empty` on.
The cron fires at 03:30 UTC daily and **every run fails**:

```
2026-08-29 04:16  daily_email  9 recipients  0 delivered  9 failed
                  provider: none
                  "No email provider configured. Set RESEND_API_KEY or SMTP_URL"
```

This is launch step 1 and it is still open. See [§13.1](#131-the-daily-email-cannot-send).

### Data source

```
data_source_mode        google
sheet_updated_till_date 28-Aug-2026
last_sync_time          2026-08-29T08:19:24Z
```

---

## 3. Architecture

```
                      ┌──────────────────────────────┐
   Google Sheets ────▶│  /api/fetch-sheet  (proxy)   │
   (import source)    └──────────────┬───────────────┘
                                     │ CSV
                                     ▼
   Browser  ──────────────▶  React 18 + Vite SPA
      │                          │        │
      │  anon key + RLS          │        │  Bearer session token
      ▼                          ▼        ▼
   ┌────────────────┐   ┌──────────────────────────┐
   │   Supabase     │◀──│  /api/team               │ service_role
   │  Postgres+Auth │   │  /api/daily-report       │ service_role
   │      RLS       │   │  /api/gemini-report      │ GEMINI_API_KEY
   └────────────────┘   │  /api/alert-status       │
            ▲           │  /api/ai-status /health  │
            │           └──────────────────────────┘
            │                        ▲
            └── Vercel Cron 03:30 UTC (CRON_SECRET) ┘
```

**Stack**

| Layer | Choice |
|---|---|
| UI | React 18, TypeScript strict, Vite 5 |
| Styling | Tailwind v4 (`@tailwindcss/vite`) over CSS custom properties |
| Data | Supabase — Postgres, Auth, Row Level Security |
| Server | Vercel serverless functions in `api/` |
| Local dev | `server.ts` — Express 5 mirroring every route, Vite in middleware mode |
| Spreadsheets | SheetJS (`xlsx`) pinned to the CDN tarball 0.20.3 |
| AI | `@google/genai`, model `gemini-3.7-flash`, optional |
| Mail | Resend HTTP API *or* SMTP via nodemailer |
| QA | puppeteer-core scripts against real Chrome |

**The mirroring rule.** Every route exists twice: once as a Vercel function in
`api/*.ts`, once as an Express handler in `server.ts`. Both call the *same*
module in `api/_lib/`. Adding a route means adding it in both places and never
re-implementing the logic. This is why `api/_lib/` exists at all.

### Bundle splitting

`vite.config.ts` forces three vendor chunks so app edits do not invalidate them:
`react`, `sheets` (xlsx), `markdown` (react-markdown). Warning limit 700 kB.

---

## 4. Data model

Defined in [supabase/schema.sql](supabase/schema.sql). Eight tables, all with
RLS on.

### 4.1 `profiles`

One row per auth user. **`id` is the Supabase Auth UUID; `legacy_id` is the CRM
code that appears on customer rows** (`ANKUR`, `PRIKSHIT`, `ATUL_BERRY`). The
whole ownership model hangs on `legacy_id`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | FK → `auth.users(id)` ON DELETE CASCADE |
| `legacy_id` | text UNIQUE NOT NULL | the CRM code |
| `name`, `email` | text | |
| `role` | text | `Admin` / `Manager` / `CRM` / `Collector` / `Viewer` |
| `data_visibility` | text | `All` / `AssignedOnly` |
| `permissions` | jsonb | overrides on top of the role default |
| `assigned_crms` | text[] | extra CRM codes this person may read |

**In the app, `User.id` is the `legacy_id`, not the UUID.** The auth UUID rides
along as `User.authId`. `repo.rowToUser()` does that mapping. Getting this
backwards breaks every ownership comparison in the codebase.

### 4.2 `customers`

One row per account. `id` is text, not a uuid.

Groups of columns:

- **Identity** — `id`, `company`
- **Contact** — `contact_person`, `contact_number`, `contact_post`,
  `additional_contacts` (jsonb array), `email`
- **Master data** — `city`, `state`, `address`, `gstin`, `pan`,
  `credit_limit`, `payment_terms_days`
- **Grade** — `payment_rank` ∈ `Good` / `Late` / `Bad`, nullable
- **Kind of business** — `category`, nullable and unconstrained on purpose
  (§7.8): the master holds spellings the app's list has not met yet, and losing
  one on import is worse than storing it
- **Money** — `total`, `total_type` (`Dr`/`Cr`), `ageing` jsonb
  (`1-45`, `46-90`, `91-135`, `>135`), `ageing_types` jsonb,
  `over90` + `over90_type`, `due_over45` + `due_over45_type`
- **Ownership** — `crm_owner_id` (text, matched to `profiles.legacy_id`),
  `assigned_collector_id`
- **Work** — `follow_up_date`, `forecast_amount`, `forecast_date`, `status`,
  `notes` jsonb array, `is_urgent`, `is_new_customer`, `added_at`,
  `creation_date`, `last_follow_up_on`

Indexes: `upper(crm_owner_id)`, `upper(assigned_collector_id)`,
`follow_up_date`.

**Two id formats live in production side by side:**

| Format | Count | Origin |
|---|---:|---|
| `cust_<slug>` | 3,376 | `customerIdFor()`, deterministic from company name |
| `out_<row>_<NAME>` | 672 | legacy, carried the sheet's row number |

Legacy ids survive because `mergeWithExistingFollowUps()` deliberately keeps the
id a matched customer already has. Changing an id would delete the row and
insert a copy — taking its PDC cheques with it, since those cascade.

### 4.3 `pdc_cheques`

`id` text, `customer_id` → `customers(id)` **ON DELETE CASCADE**.
Fields: `customer_name`, `cheque_number`, `bank_name`, `cheque_date`, `amount`,
`status`, `received_date`, `cleared_date`, `remarks`, `crm_owner_id`,
`added_by`.

`status` check allows `Pending | DueToday | Cleared | Hold | Bounced`.
**`DueToday` is legacy and must never be written again** — see
[§7.5](#75-when-a-cheque-is-due). The constraint still accepts it so old rows
stay valid.

### 4.4 `customer_activity` — the shared thread

Append-only by design. **There is no UPDATE policy at all.**

| Column | Notes |
|---|---|
| `id` | uuid, `gen_random_uuid()` |
| `customer_id` | → `customers(id)` cascade |
| `author_id` | → `profiles(id)` ON DELETE SET NULL |
| `author_name` | kept alongside the id so a departed colleague's entries still say who wrote them |
| `kind` | `note` `no_answer` `declined` `promise` `payment` `visit` `dispute` `system` |
| `body` | free text |
| `promised_amount`, `promised_on` | set when `kind = 'promise'` |
| `resolves_id` | → `customer_activity(id)`, points at the promise this entry settles |
| `created_at` | **database default `now()`** — never the browser's clock, so a laptop with the wrong date cannot file yesterday's call |

Partial indexes on `promised_on WHERE kind='promise'` and on
`resolves_id WHERE resolves_id IS NOT NULL`.

A promise is never edited. It is **answered** by inserting a new row whose
`resolves_id` points back at it. Answered by a `payment` → kept. Answered by
anything else → broken.

### 4.5 Singletons

`company_profile` and `app_settings` are pinned to `id = 1` by a check
constraint, so there can only ever be one row.

`app_settings`: `data_source_mode`, `google_sheet_url`,
`customer_master_sheet_url`, `sheet_updated_till_date`, `last_sync_time`.

### 4.6 `alert_settings` + `alert_log`

`alert_settings` (id=1): `daily_email`, `recipient_roles[]`, `skip_when_empty`,
`extra_recipients[]`.

`alert_log` is what makes the Alerts screen honest — it records every run
including the ones that sent nothing and why. **Only the server writes it**
(service role); there is a read policy and no write policy.

### 4.7 `templates`

`id`, `name`, `content`. Admin/Manager write only.

### 4.8 Triggers

- `touch_updated_at()` on all six original tables.
- `handle_new_user()` on `auth.users` insert — creates the profile, derives a
  unique `legacy_id`, and **makes the very first account Admin** so you can
  never be locked out.

---

## 5. Security model

### 5.1 Roles and default rights

`DEFAULT_ROLE_PERMISSIONS` in [types.ts](types.ts) is the source of truth in
the app; `has_perm()` in the schema mirrors it in the database.

| Right | Admin | Manager | CRM | Collector | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| `canViewAllCrms` | ● | ● | – | – | ● |
| `canAddCustomer` | ● | ● | ● | – | – |
| `canEditCustomer` | ● | ● | ● | ● | – |
| `canEditFinancials` | ● | ● | – | – | – |
| `canDeleteCustomer` | ● | – | – | – | – |
| `canEditFollowUp` | ● | ● | ● | ● | – |
| `canReassignCrm` | ● | ● | – | – | – |
| `canManagePdc` | ● | ● | ● | ● | – |
| `canExportData` | ● | ● | ● | – | – |

Plus two rules not in the matrix:

- `can()` short-circuits: **an Admin is never restricted by the matrix**,
  whatever it happens to contain.
- `canSyncSheets` (importing a sheet, editing templates, changing the data
  source, alerts) is Admin *or* Manager only, computed in `App.tsx`'s `rights`
  memo. It matches the `templates` / `app_settings` / `alert_settings` policies.
- `runsTheTeam` (the Team Performance table; whether Today is held to one
  screen) is Admin *or* Manager, in the same memo. Deliberately narrower than
  `seesWholeBook()` — a Viewer reads every account without managing anybody.
- `canExportBook()` (types.ts) narrows `canExportData` the same way: **taking
  the customer book or a report out as a spreadsheet needs Admin or Manager as
  well as the permission.** An export is a copy of the book — names, contacts,
  balances — that leaves the app and its audit trail behind, so the checkbox
  alone does not grant it and an Admin can still withdraw it from a Manager.
  `canExportData` on its own continues to govern the cheque register's export.

### 5.2 Row Level Security

Three `SECURITY DEFINER` helpers avoid recursive RLS on `profiles`:
`current_role()`, `can_write()`, `is_admin()`, plus `has_perm(text)`.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | any authenticated | admin | admin | admin |
| `customers` | any authenticated | `can_write() AND has_perm('canAddCustomer')` | `can_write()` | Admin/Manager `AND has_perm('canDeleteCustomer')` |
| `pdc_cheques` | any authenticated | `can_write() AND has_perm('canManagePdc')` (FOR ALL) | ↑ | ↑ |
| `customer_activity` | signed in | `has_perm('canEditFollowUp') AND author_id = auth.uid()` | **none** | own row, or admin |
| `templates` | any authenticated | Admin/Manager | ↑ | ↑ |
| `company_profile` | any authenticated | admin | ↑ | ↑ |
| `app_settings` | any authenticated | Admin/Manager | ↑ | ↑ |
| `alert_settings` | any authenticated | Admin/Manager | ↑ | ↑ |
| `alert_log` | any authenticated | **none** (server writes with service role) | – | – |

**There is deliberately no self-update policy on `profiles`.** RLS policies are
permissive — a rule letting you edit your own row would also let you set your
own role to `Admin` straight from the browser with the anon key. Profiles are
changed only by an Admin, through `/api/team`, on the server.

**Insert and update on `customers` are split on purpose.** The change-detecting
sync updates existing rows and only inserts genuinely new ones, so `INSERT` can
demand `canAddCustomer` while `UPDATE` stays on `can_write()` — because
recording a note upserts a whole row.

### 5.3 Secrets

| Variable | Where | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | browser | safe; RLS decides reach |
| `VITE_SUPABASE_ANON_KEY` | browser | safe; RLS decides reach |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | bypasses RLS entirely |
| `GEMINI_API_KEY` | server only | optional |
| `RESEND_API_KEY` / `SMTP_URL` + `ALERT_FROM` | server only | one is required to send mail |
| `CRON_SECRET` | server only | proves a `/api/daily-report` call came from Vercel |

**Hard rules, enforced by convention and reviewed on every change:**

- The service role key must **never** carry a `VITE_` prefix.
- It must **never** be referenced from anything under `components/` or
  `services/` — those ship to every visitor.
- `.deploy.local` holds live deploy tokens and is gitignored. Secrets go in
  files, never into chat or command output.

Currently present in `.env.local`: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
`VERCEL_OIDC_TOKEN`. **`SMTP_URL` and `ALERT_FROM` are absent** — that is why
the digest fails.

### 5.4 Other hardening

- `/api/fetch-sheet` allow-lists `docs.google.com` and
  `spreadsheets.google.com` only. Without that host check it is an open proxy
  anyone could point at an internal address.
- `/api/daily-report` accepts either the cron secret or an Admin/Manager
  session token. Left open it would let anyone mail the whole team.
- `/api/gemini-report` requires a signed-in caller — the endpoint spends real
  money per call and the URL is public.
- The sign-in screen **never lists the staff roster**. Printing every
  colleague's name, role and CRM code on a page anyone can open hands a stranger
  the org chart. `scripts/smoke.cjs` asserts this.
- `readableAuthError()` makes a wrong password indistinguishable from an unknown
  address — that difference is how an attacker enumerates who works here.
- **Stock prices are for Admin and Manager.** `/api/live-stock`
  (`api/_lib/liveStock.ts`) empties the rate and value columns before the sheet
  leaves the server for anyone else, so a CRM's copy never carried a price —
  hiding two columns in the browser would have left them one Network tab away.
  `/api/fetch-sheet` is Admin/Manager-only for the same reason: an open proxy
  would have handed anyone the priced sheet. The links to the sheet itself are
  shown only to those two roles; the sheet is shared "anyone with the link",
  which is the boss's boundary to move if it matters. The browser cache of
  the last read is keyed by whether it carried prices, so a Manager's read
  never flashes up for a CRM on the same laptop.

---

## 6. Ownership and scoping — the rule everything depends on

This is the single most load-bearing piece of domain logic in the app, and it
is implemented in **four** places that must agree.

### The rule

> An account reaches you if **you own it as CRM**, **or** you are the
> **collector** working it, **or** its CRM code is in your `assigned_crms`.
> Anyone who reads the whole book (Admin, `data_visibility = All`, or
> `canViewAllCrms`) sees everything.

`seesWholeBook()` reads **what the Team & access form was set to**; the role only
supplies the default it started from. Manager and Viewer used to be named in the
function itself, so switching one of them to "Assigned customers only" and
clearing "View all CRMs" saved the change and then did nothing — they still read
every account. Their role defaults still say `canViewAllCrms: true`, so anyone
who has not touched those controls is unaffected. Admin remains unconditional,
exactly as `can()` treats it.

Responsibility runs two ways and **either one is enough**. Scoping on only one
of them is how an account assigned to somebody disappears from their screen —
the CRM hands it over and it vanishes for a colleague whose role happens not to
be `Collector`, or the other way round.

### `ownerKey()` — one CRM code, written one way

```ts
export const ownerKey = (v?: string | null) => (v || '').trim().toUpperCase();
```

The sheet, the user list and anything typed by hand disagree about case and
stray spaces. `"ANKUR"`, `"Ankur"` and `"ankur "` are the same person. Every
ownership comparison goes through `ownerKey()` so they land in one bucket
instead of three.

### Where the rule lives

| Location | Function | Used by |
|---|---|---|
| [types.ts](types.ts) | `isResponsibleFor()`, `seesWholeBook()` | shared helper |
| [services/googleSheetService.ts](services/googleSheetService.ts) | `getOutstandingForUser()` | the main `outstandingData` view |
| [api/_lib/digest.ts](api/_lib/digest.ts) | `scopeFor()` | the daily email |
| `CustomerDashboardView` / `ReportsView` / `PdcChequesView` | inline `userAllowedData` memos | each view's own second filter |

⚠️ The three view-level memos are **not** identical to
`getOutstandingForUser()`. They branch on `role === Collector` and check
`assigned_collector_id` *instead of* CRM ownership, rather than in addition to
it. See [§13.3](#133-scoping-is-implemented-four-times).

### What the access checkboxes actually reach

Every right in the matrix is read through `can()` — which lets an Admin through
unconditionally and falls back to the role's default for a key a profile does not
carry — and `has_perm()` mirrors the same table in the database. Reading
`user.permissions?.someRight` directly is the bug pattern: it treats a profile
carrying a partial matrix as though every key it omits were denied.

`api/_lib/digest.ts` keeps its own copy of `seesWholeBook()` — it cannot import
browser code — and that copy has to be changed in step. It was not, once: the
browser honoured a Manager restricted to "Assigned customers only" while the
daily email still sent them every account in the company. The email is the worst
place for a leak of this kind, because nobody sees anyone else's inbox and the
mismatch is silent. Three copies of the same table now: `DEFAULT_ROLE_PERMISSIONS`
(types.ts), `has_perm()` (schema.sql), `ROLE_READS_WHOLE_BOOK` (digest.ts).

Two rights are enforced in the **UI only**. `customers_update` is granted on
`can_write()` alone, because the change sync writes a whole row for something as
ordinary as a note, and RLS cannot say "this column but not that one". So
`canEditFinancials` and `canReassignCrm` are honoured by every screen but are not
a wall at the database. Anyone who can write anything can, in principle, write
those columns through PostgREST directly.

### With dues / Settled / All

Roughly four customers in five owe nothing. `SettlementFilter` (types.ts) is the
one definition of which half a screen is showing, and the customer book and
Reports each carry the same three-way control, **defaulting to `withDues`**.

It is not a cosmetic filter. Before it, "No follow-up set" on Reports read
**3,835** — of which some three thousand had nothing to follow up because they
had already paid. The true figure is **525**. The exports inherit it, because
both export whatever the screen is showing.

Nothing is hidden and nothing is lost. `clearedFinancials()` zeroes money and
only money: notes, the activity thread, the follow-up date, cheques, contacts,
category and owner all stay on the record, so a customer who settles keeps every
word of the conversation that got them there. `stampSettlement()` records
`settledAt` on the transition to zero and clears it if a balance returns, and the
settled tab sorts newest-settled first — three thousand rows in alphabetical
order would bury the account that cleared this morning, which is the one anybody
is actually looking for.

### `hasOutstanding()` — what counts as work

```ts
export const hasOutstanding = (item) => Math.abs(Number(item.total) || 0) > 0;
```

The Customer Master sheet carries the whole customer list, including 3,361
accounts that owe nothing. They are real customers and belong in search and in
their ledger, **but counting them as things to chase overstates every CRM's
workload**. Before this gate, Ankur's dashboard said 3,378 accounts; the truth
is 19.

Also applied in `filteredData`, the list those boxes open. It was not, so
"Due today: 3" could open onto four rows with one at zero — the box and its own
drill-down disagreeing. Two exceptions: an account **collected today** belongs in
that list precisely because it now owes nothing, and a **search** must find a
customer whether they owe anything or not.

Applied in: `fourBoxesSummary`, `userBoxMetrics`, `crmPerformanceStats`, the
shell's `scopeLabel`, and `digest.bookCount`.

---

## 7. Domain rules

### 7.1 Dr and Cr

`Dr` = they owe us. `Cr` = we are holding their money (advance / excess).

`parseAmountAndType()` detects credit from any of: the string containing `CR`,
parentheses `(1,234)`, a leading minus, or a negative number. Amounts are always
stored as **absolute values** with the type in a sibling column.

Everything that sums the book excludes `Cr`:

```ts
if (item.totalType === 'Cr') return;   // portfolioAgeing, myAgeing
totalType === 'Cr' ? 0 : (total || 0)  // totalBook, digest.owes()
```

Money sitting with us is not a receivable and must not inflate the outstanding
figure.

### 7.2 Ageing buckets

Four buckets: `1-45`, `46-90`, `91-135`, `>135`. Two derived roll-ups the sheet
supplies directly when it has them, netted from the buckets otherwise
(`netRollUp()`):

- `over90` = `91-135` + `>135`
- `dueOver45` = `46-90` + `over90`

Each bucket carries its own `Dr`/`Cr` type in `ageingTypes`, and so do the
roll-ups (`over90Type`, `dueOver45Type`). **Every amount is stored absolute;
the type is the sign.**

**`overdueAgeing(item)` is the only way to ask what an account has overdue.**
Reading a bucket without its type made a credit note older than 135 days into
"money 135 days overdue", and put 26 of the book's 34 credit accounts — money
*we* hold — into the >90d filter, where they showed as thirty-one "Good"
customers with dues past 90 days. The helper returns nothing overdue for an
account in credit, signs each bucket (debit up, credit down) so a window nets
the way the sheet nets its own roll-ups (₹2,00,967 owed from 91–135 days with
an ₹84,939 credit older than that is ₹1,16,028 past 90, and the sheet says
so), honours the sheet's typed roll-ups where present, and never returns a
negative. The rank, both filters, the tiles, the row bars, the exports, the
phone rows and the AI report all read it. After it, the book adds up: current
89 + past-45 520 + 34 in credit = 643 accounts with dues.

### 7.3 Follow-up category

`getFollowUpCategory(item, today)` → `completed | today | future | overdue |
no_follow_up`.

**The date wins over the stored status.** If `followUpDate` parses, the category
comes from comparing it to today at midnight. Only when there is no usable date
does it fall back to `item.status`. `processStatuses()` then rewrites `status`
to match, and is run after every mutation and every import.

This is the same principle as the PDC fix in §7.5: a stored label goes stale, a
date does not.

### 7.4 Payment rank

Three grades, because the business uses three:

| Rank | Meaning |
|---|---|
| `Good` | nothing overdue |
| `Late` | something is past its date — however far past |
| `Bad` | **a defaulter.** This is the list that goes to the recovery agency |

`getCustomerPaymentRank()`, in order:

1. A rank set by hand wins. This is the **only** way an account becomes `Bad`.
2. `Cr` or `total <= 0` → `Good` (owes nothing).
3. Any `over90` or `dueOver45` → `Late`.
4. Otherwise `Good`.

**`Bad` is declared, never calculated.** It used to be worked out from ageing —
anything past 135 days, or more than 35% of the balance past 90 — which made
**416 of 696** owing accounts defaulters, ₹8.62 Cr of a ₹11.2 Cr book. A recovery
list of four hundred names is not a recovery list, and most of those customers
were still paying.

Ageing cannot answer the question it was being asked. Money sitting past 135 days
may be a dispute, a retention, or an invoice nobody chased; whether a customer
has *stopped paying* is a judgement about the customer. So it comes from the
defaulters the business names — set on the account, or applied to a selection
with the bulk rank tool, which is what that tool is for.

How old the money is has not gone anywhere: the four ageing buckets say it
precisely, on every row, in every report and in the exports.

**A defaulter is not routine work** (`isBadDebt()`). The boss's rule: a
bad-debt account must not sit in the follow-up list, because the people
working the day's follow-ups scrolled past the same defaulters every morning
and the list they were meant to work suffered for it. So a `Bad` account is
left out of Due today / Overdue / No follow-up / Scheduled everywhere those
are counted or listed — the worklist cards and the list under them on Today,
the badge on the Today tab, the attention banner, the four follow-up chips
on Reports, the per-CRM table (where it is noted as "+n bad debt" and does
not move the timely score) and the morning email — and carried on **one list
of its own, the recovery list**: a red strip under the worklist cards on
Today ("Bad debt · 57 accounts · ₹1.75 Cr · kept out of the worklist above")
that opens it, and a `Bad debt (n)` chip beside the follow-up chips on
Reports. Nothing is hidden: the customer book still lists every account, a
search finds a defaulter like anyone else, "All" on Reports is still all, and
the money stays in every total and every ageing figure — only the *work*
moved. The attention banner counts the way the cards do (accounts that owe,
by date, no defaulters); it used to read the stored status and say "8
overdue" above a card that said 2.

### 7.5 When a cheque is due

**"Due today" is not a status. It is what the calendar says.**

The `PdcModal` form once offered `Due Today (Present in Bank)` as a selectable
status. Rawat picked it — reasonably, he was entering a cheque that was due. It
was stored and never expired, so a cheque dated 25 Aug was still announcing
itself as due on 29 Aug, and the day's total kept adding it in. Today's tile read
₹12,05,437 against a true ₹7,74,638.

Second fault: a past-dated `Pending` cheque fell into the final `else` and was
counted as "Upcoming", so nothing ever prompted anyone to bank it. ₹4.7 lakh sat
in a drawer unflagged.

**The fix, in three parts:**

1. `PdcModal` no longer offers `DueToday`. Options are now
   `Pending — waiting for its date | On Hold | Cleared | Bounced / Returned`.
2. `PdcChequesView` derives an `effectiveStatus` from the date every render:

   ```ts
   const inHand = c.status === Pending || c.status === DueToday;
   if (inHand) effectiveStatus = isSameDay(cDate, today) ? DueToday : Pending;
   ```

3. The metrics loop gained an explicit past-date branch and a
   **"Date passed, not banked"** tile:

   ```
   Cleared → cleared
   Hold    → hold
   Bounced → bounced
   else if isToday(cDate)  → today
   else if cDate < today   → overdue      ← new
   else                    → pending (upcoming)
   ```

`chequesOverdue` was added to the daily email as "Cheques past their date, still
in hand".

**The instruction given to Rawat:** enter the cheque with its real cheque date
and leave the status as *Pending — waiting for its date*. Never mark it due. Use
Cleared / Hold / Bounced only after the bank has acted.

### 7.6 Promise states

```ts
promiseState(entry, resolvedBy, today) →
  resolvedBy?.kind === 'payment'  → 'kept'
  resolvedBy (anything else)      → 'broken'
  no promisedOn                   → 'open'
  promisedOn <  today             → 'overdue'
  promisedOn == today             → 'due'
  promisedOn >  today             → 'open'
```

Overdue is the day after the date they gave — which is the moment somebody
should be ringing.

### 7.7 Urgency

Set on import: `dueOver45 > ₹10,00,000` (Dr) **or** `>135 > ₹5,00,000` (Dr).
Editable by hand in the follow-up dialog.

### 7.8 Customer category

What kind of business the customer is. Seeded from the Customer Master's
`CATEGORY` column, edited in the app afterwards — customer data, so it follows
the rule in §8.2 and the app owns it.

The column carries two things at once. **Builder, Dealer, Dealer Offset,
Retailer** are the customer classes the business talks about; the rest name the
trade the account is in, and Screen Printing alone is 3,480 of 4,083 rows.
`CUSTOMER_CATEGORIES` (types.ts) lists both, the four classes first, and it is
what the dropdown offers.

It is a suggestion list, not a constraint. `normaliseCategory()` folds the
spellings the master actually holds into one each — `OFFSET` / `offset` /
`Offset` are one category, `SCREEN PRINTOR` is Screen Printing, `ONLY DTF` is
DTF, `DETAILER` is Retailer — and anything it does not recognise is kept word
for word, title-cased. Twenty-eight raw spellings in the sheet become
twenty-four categories, and nothing is dropped: a category nobody has told us
about is still the truth about that customer.

`isSheetBlank()` runs first, so `#N/A` and `0` do not become categories.

---

## 8. Data flow

### 8.1 Import — Google Sheet → app

Two sheets, two shapes.

**Transactions sheet** (`parseGoogleSheetCsv`) — positional column map with
header-name override:

| Idx | Field |
|---|---|
| 0 | company |
| 1 | total |
| 2–5 | ageing 1-45 / 46-90 / 91-135 / >135 |
| 6 | over90 |
| 7 | dueOver45 |
| 8 | CRM |
| 9 | mobile |
| 10 | email |
| **11** | **"updated till" date** — read from the *header row* |

Column L (index 11) carries the date the figures run to. It is validated against
a date regex before being displayed as "Book as of", because taking cell L1 on
faith once put a column heading up there.

**Customer Master sheet** (`parseCustomerMasterSheetCsv`) — fuzzy header
matching for company, contact, designation, mobile, alt phone, email, city,
state, address, GSTIN, CRM, credit limit, payment terms, notes. Imports with
`total = 0` and `isNewCustomer = true`.

Both go through `/api/fetch-sheet`, which tries a ladder of candidate CSV URL
shapes (gviz, `/export?format=csv`, `/pub?output=csv`, published-to-web variants)
and detects Google's HTML login page as a failure rather than data.

### 8.2 Where each thing lives

> **The sheet carries the outstanding amounts. The software carries the
> customers.**

That one line settles every merge question below, and it is a decision from the
business, not an implementation detail. Ownership of the customer record — who
they are, who to ring, what their terms are, who chases them — sits in the app.
The Google Sheet is the ledger of what is owed and is read for nothing else.

| | Lives in | Written by |
|---|---|---|
| Balances, ageing, roll-ups | the outstanding sheet | the accounts team, in the sheet |
| Customer name, contacts, address, GSTIN, credit terms | the app | whoever works the account |
| — the name included: `financialsFromSheet()` does **not** carry `company`, so a spelling corrected here is not overwritten on the next sync. Matching does not depend on it (normalised key, or the id, both survive a rename). | | |
| Category (Builder / Dealer / Retailer / trade) | the app | seeded once from the master's `CATEGORY` column, edited on the account after that — see §7.8 |
| CRM owner | the app | assigned when the customer is created, changed in the customer list |
| Follow-ups, notes, cheques, activity | the app | the collections team |

`financialsFromSheet()` names the only columns an import is the authority on:

```
company, total, totalType, ageing, ageingTypes,
over90, over90Type, dueOver45, dueOver45Type
```

Everything else survives an import untouched.

### 8.3 The balance sync

**Every "sync" control in the app is this one, and only this one.** Three of
them exist — the app bar, the customer book, and Data source — and all three
call `handleGoogleSync()`, which reads the outstanding sheet and nothing else.
The customer import has exactly one entry point, the button beside its own URL
in Data source. Two sheets and a button labelled "Sync from Google Sheets" was
a fair invitation to assume otherwise, so all three now read **Sync balances**
and say in their tooltip what is left alone.

`mergeWithExistingFollowUps()` enforces four rules against a shared database:

1. **A matched customer keeps the id it already has.** Old ids carried the
   sheet's row number, so re-ordering the sheet gave one customer a new id —
   against a database that means deleting the row and inserting a copy, taking
   its cheques with it.
2. **It changes money and nothing else.** A matched account keeps its contacts,
   its owner and its history. The sheet's contact columns used to fill blanks;
   they no longer do, because those fields are maintained in the app.
3. **A customer the sheet no longer lists is kept, and settled to nil.**
   `settleUnlisted()` zeroes the balance, every bucket, both roll-ups and
   `isUrgent`. The record stays — dropping it would delete the row and its
   history on the next sync. The sheet is the *whole* of what is owed, so
   falling off it means paid.
4. **A name the app has never seen is added, with no owner.** Its money is
   counted immediately — money must never go missing because a record does not
   exist yet — but the sheet does not get to say whose account it is. Those land
   in the unassigned queue.

`asNewCustomer()` builds those rows, and the empty-book branch runs through it
too — otherwise the very first import into a fresh book took its owners from the
sheet and the rule was true in every case but one. The reset and the Excel upload
go through the same function for the same reason.

It deliberately does **not** set `isNewCustomer`. That flag does not mean
"recently arrived"; it means "created here rather than read from a sheet", and it
drives the customer list's *Created / Sheet Synced* filter. Setting it on
sheet-created accounts would file them all under "Created" and hide them from
"Sheet Synced". What marks them as needing attention is having no owner.

### 8.4 Ownership, and the queue

Ownership is set when a customer is created (`CustomerEditModal` will not save
without an answer; it used to default to whoever was first in the CRM list,
which is how thousands of accounts ended up on one name without anyone deciding
it) and changed from the customer list. No import overwrites it.

**A lookup can fail, and a failure is not a name.** The outstanding sheet has no
CRM of its own — its column is a lookup into the customer master — so a customer
absent from that master returns `#N/A`, and a broken formula `#REF!`. Read at
face value those become CRM codes: accounts filed under an owner called "#N/A",
counted on the CRM performance table as though it were a colleague, and reachable
by nobody. `crmFromSheet()` reads them — and hand-written stand-ins like "NA",
"-", "NIL" — as blank; `isSheetBlank()` keeps a row whose *name* is `#N/A` out of
the book entirely. The app's own stored value goes through the same check, so a
`#N/A` written by an older import clears itself.

Anything with no owner surfaces as an amber banner at the top of the customer
list, with its count and the money involved, one click from the Unassigned
filter. A queue nobody can see is a queue nobody works.

### 8.5 Reconciliation — a preview, not a decision

When `appData` is non-empty, a balance sync opens `SyncReconciliationModal`
first. It used to ask which CRM should win, the sheet's or the app's; that
question no longer exists, so it is now a plain preview of what the import will
do — figures updated, new customers arriving unassigned, accounts settled to
zero and the total being written off.

It recomputes nothing. Confirming calls `mergeWithExistingFollowUps()`, the same
function the sync runs when there is nothing to review, so what is shown and
what is written cannot drift apart.

### 8.6 The customer import — seeding, not syncing

`mergeCustomerMasterIntoAppData()` exists to load customers in bulk into an
empty book. It is a one-time step behind a confirmation, not a scheduled sync,
and **every field reads app-first**: it fills what is missing and overwrites
nothing, so running it twice cannot undo a correction somebody typed. It used to
work the other way round — the sheet overwrote contacts, addresses, limits and
terms on every run — which is why a phone number fixed during a call came back
wrong the next morning.

Where its CRM column disagrees with the app's, the app wins and the disagreement
is returned in `crmConflicts[]`, listed in Settings beside a **Download CRM owner
list** export. That export is pasted into the *master*, because the outstanding
sheet's CRM column is looked up from it.

The old "One-Click Dual Sync" is gone. There is one sync — balances — and it is
what both the header button and the customer list button run.

### 8.6.1 "Last synced" means balances

`lastSyncTime` is stamped only where balances actually land: on confirming the
review, or on an import into an empty book. It used to be set the moment a sheet
was fetched — so cancelling the review still left the book looking freshly
priced — and again by the customer import, which brings no balances at all.

### 8.7 Write-back — the change-detecting sync

There is no Save button. `services/useSupabaseSync.ts` provides two hooks:

**`useCollectionSync<T>`** watches an array and diffs it against the last synced
snapshot.

- Keeps `Map<id, signature>` of what the server has.
- **First pass after load seeds the baseline without writing**, so reading data
  back does not immediately write it all again.
- 800 ms debounce, then diff: changed rows, ids never seen (`created`), and ids
  that vanished (`removed`).
- On error the baseline is left untouched, so the next edit retries.

`App.tsx` mutates `appData` from ~20 handlers. Adding a write call to each one
would inevitably miss some; one effect covers every mutation path.

**`useValueSync<T>`** does the same for a single JSON value (company profile,
app settings).

The customer adapter splits the write deliberately:

```ts
const fresh  = rows.filter(r =>  created.has(r.id));  // upsert — needs canAddCustomer
const edited = rows.filter(r => !created.has(r.id));  // update — needs can_write only
```

`repo.updateCustomers()` still writes one row per request — PostgREST has no
multi-row update — but **eight at a time, and it no longer stops at the first
failure**. The assumption that "an edit touches a handful of rows at most" was
wrong: a sync re-prices every matched account, so a few hundred sequential
round-trips ran for minutes with the book half-written, and one rejected row
abandoned every account after it in the list. Both look, from the outside,
exactly like customer data that has stopped syncing. Every row is now attempted
and the error is raised afterwards, which still tells the hook to retry the
batch — an update is idempotent, so re-running it is safe.

### 8.8 Paging

PostgREST answers a plain `select` with **at most 1,000 rows, silently** — which
had the app showing the first 1,000 of 4,048 customers as if that were the whole
book. `fetchAllRows()` pages by `id` (unique, so no row is skipped or repeated
between pages) until a short page arrives. `digest.ts` has its own copy of the
same loop.

### 8.9 Activity log flow

1. `CustomerActivityPanel` posts through `repo.addActivity()`, which stamps
   `author_id` from the live session and lets the database set `created_at`.
2. `onLogged` fires `handleActivityLogged` in `FollowUpModal`, which mirrors one
   formatted line into `customer.notes` — because search, the Excel export, the
   AI report and the "last note" column all read `notes`.
3. The panel re-reads every 20 s, and on `focus` and `visibilitychange` —
   guarded by `savingRef` so an in-flight post is not clobbered by a reply that
   does not contain it yet.

**The data-loss bug this caused, and the fix.** `FollowUpModal` was handed the
`selectedCustomer` snapshot taken when the dialog opened. The second logged
entry rebuilt `notes` from that stale snapshot and erased the first. Fixed in
`App.tsx`:

```tsx
const liveSelectedCustomer = useMemo(
    () => (selectedCustomer ? appData.find(c => c.id === selectedCustomer.id) || selectedCustomer : null),
    [selectedCustomer, appData],
);
```

---

## 9. Screens

Navigation is built in `App.tsx` from `workItems` + `setupItems` and rendered by
`AppShell`. A tab not in this person's navigation **will not render either**,
whatever the tab state holds (`allowedKeys` / `safeKey`).

Which dashboard you get follows from **what you can see**, not your job title:
`rights.seesWholeBook ? renderCompanyDashboard() : renderUserDashboard()`.
Switching on the role name is what once left Manager and Viewer staring at an
"invalid role" page.

### Work tabs (everyone)

| Key | Label | Badge |
|---|---|---|
| `overview` | Today | `todayCount + overdueCount`, red if any overdue |
| `customers` | Customers / My customers | – |
| `pdc` | PDC cheques | cheques due today, amber |
| `reports` | Reports / My performance | – |
| `stock` | Live stock | – |

### Setup tabs

| Key | Who |
|---|---|
| `users` — Team & access | Admin only |
| `alerts` — Alerts & reminders | Admin + Manager |
| `templates` — Message templates | Admin + Manager |
| `source` — Data source | Admin + Manager |

### Two things on Today that follow the role, not the visibility rule

`rights.runsTheTeam` — Admin or Manager — is deliberately narrower than
`seesWholeBook()`. A Viewer, and any CRM granted "view all", read every account
without managing anybody.

| | Admin + Manager | Everyone else |
|---|---|---|
| **Team Performance & Portfolio Allocation** | shown | hidden — how a colleague is doing is a management view |
| **Today's page** | scrolls | held to one screen where there is room for it |

One screen is a layout, not a squeeze — so it applies only when the window can
hold it: `lg` and up, **and** at least `MIN_HEIGHT_FOR_ONE_SCREEN` (900px) of
viewport. Above the list sit the app bar, the title, the worklist cards and
sometimes the attention banner, about 510px of them. On a 1366x768 laptop the
viewport is roughly 640px, and forcing the layout there left the account list
two pixels tall: "Due today: 2 accounts" and not one row under it, on a page
that could not scroll to reveal them. Below the threshold the page scrolls as it
always did.

The one-screen layout is not a smaller version of the same page. The summary
takes a left rail and the account list takes the right, full height, scrolling
inside its own panel — stacked, the list was the part pushed off the bottom, and
the list is what the day is worked from. Below `lg` the page scrolls normally:
none of this fits a phone, and pinning the body there would hide content rather
than reveal it.

### 9.1 Today — the workspace

The landing screen is the **queue**, not a summary of it. `Workspace` composes
two panes:

```
┌─ Worklist ──────────────┬─ AccountPanel ───────────────────────┐
│ [Due today 0] [Overdue 3]│  ANSH FABRICS       [Bad debt] [Edit]│
│ [Promised 69] [Cheques 6]│  Prikshit · Ludhiana · 60 day terms  │
│ [No plan 607] [All 687]  │  ₹3.80 L  past45 ₹2.1L  past90 ₹1.2L │
│ ─────────────────────────│  ▓▓▓▓▒▒▒░ ageing                     │
│ FIRST LOOK…    ₹61,405   ├──────────────────┬───────────────────┤
│  Bad debt yesterday      │ WHAT HAPPENS NEXT│ ACCOUNT ACTIVITY  │
│ INDO TRADERS   ₹22,920   │  outcome chips   │  Ankur · 2 hr ago │
│  Bad debt yesterday      │  next date       │  Rang, no answer  │
│ KNITKARI…      ₹22,716   │  expect / grade  │                   │
│  Bad debt Urgent         │  owner/collector │  [chips][compose] │
│                          │ WHO TO CALL      │  [Log it]         │
│                          │ CHEQUES HELD     │                   │
└──────────────────────────┴──────────────────┴───────────────────┘
```

**`components/work/Worklist.tsx`** — six queues, built once by `buildQueues()`
so the count on a chip and the rows behind it can never disagree:

| Queue | Contents |
|---|---|
| Due today | follow-up date is today |
| Overdue | follow-up date has passed, oldest first |
| Promised | a forecast amount is set, largest first |
| Cheques | a cheque against the account is due or past its date |
| No plan | owes money, nothing scheduled |
| Everything | every account with a balance |

Each row shows the company, the amount, the grade, the follow-up in words
("yesterday", "in 2 days") and **the last thing anybody recorded** — the fact
that decides what you say when they pick up.

`Workspace` **opens on the first queue that has work in it**. "Due today" is the
right place to start on a day when something is due and an empty screen on a day
when nothing is, which with 607 unplanned accounts is most days.

### 9.2 The account panel

`components/work/AccountPanel.tsx` — everything the old follow-up dialog did,
without being a dialog:

- **Identity** — name, owner, collector, city, terms, grade, urgent flag, Edit
- **Money** — outstanding, past 45, past 90, follow-up in words, ageing bar
- **What happens next** — outcome (`follow up again` / `payment collected` /
  `no follow-up`), next date, expected amount and date, payment grade, CRM
  owner, collector, urgent toggle, Save. The expected-amount presets are
  **Full Due · >90d Due · 50% Due · ₹1 Lakh · ₹5 Lakh**: the >90d one is the
  91-135 and >135 buckets together, offered only when it is Dr and above
  zero, because a call about an overdue account is usually a call about that
  figure and it used to have to be retyped from the summary above.
- **Who to call** — primary and additional contacts, each with call and WhatsApp;
  add and remove people; the full template picker opens `WhatsAppReminderModal`
- **Cheques held** — every cheque with its derived state, and Cleared / Bounced
  in place
- **Account activity** — `CustomerActivityPanel`, always visible beside the form

Two rules carried over intact:

- `mayClaimForSelf` — a CRM may put their own name on an account and may pick up
  one nobody owns; moving a colleague's account to a third person stays with a
  Manager.
- Changing the grade writes a `system` activity entry naming who changed it and
  from what.

The owner dropdown is built from the CRMs **plus whoever owns the account now**,
because an account owned by an Admin showed "Unassigned" beside a header naming
them.

### 9.3 Reaching an account from anywhere

`handleOpenFollowUp` is navigation now, not a dialog. The customer book, the
reports table and the cheque register all call it; it sets `focusAccountId`,
switches to Today, and the workspace opens that account — widening the queue to
Everything if the account is not in the current one, so it appears in the list
beside the panel.

### 9.4 Customer book (`CustomerDashboardView`)

The whole book as a table: filters for rank, CRM, status, ageing bracket,
balance type and origin; bulk CRM reassign, bulk grading and (Admin) the bulk
follow-up date from [§9.6](#96-reports--the-management-read); export of the
rows **currently on screen**, which is what makes the recovery-agency defaulter
list possible. Rows open in the workspace.

The ageing chips under "More filters" are **Current (≤45d) · >45d · >90d ·
>135d** — three nested severities and the complement of the first. They
replaced "1-45d", which meant "has any money in the 1–45 bucket": 311 accounts,
181 of them also past 90 days, sitting beside ">45d" as if they were the
customers who are up to date. The rank chips beside them count within whatever
ageing chip is pressed, so "Good (6)" under >90d is six accounts somebody
graded Good by hand despite old money — a judgement, kept visible.

### 9.5 PDC cheques (`PdcChequesView`)

Tiles: Due today · **Date passed, not banked** · Upcoming · On hold · Cleared ·
Bounced. Filters for search, customer, CRM, bank, status and date range. Excel
export of the filtered set. All states come from `chequeState()`.

### 9.6 Reports — the management read

Where the aggregates live now: portfolio ageing, cheques to present, committed
collections, the team performance table, then the report itself — CRM selector,
instant-report cards (>90 days, >135 days), category and ageing filters, Excel
export with the full breakdown, and the AI report.

They used to be the landing screen, which meant a CRM opening the app at nine in
the morning met a wall of aggregates before a single customer name.

**The selection bar** (ticked rows, on this table and on the customer book)
carries the same tools in the same order: set rank, reassign, and — for an
Admin only — **Follow-up on \[date\] · Set follow-up**, then Export.

#### Bulk follow-up date — `handleBulkSetFollowUp()` in App.tsx

An overdue follow-up is supposed to be rescheduled by the CRM who owns it.
When it is not, the account sits in "Overdue" and nobody is prompted to ring
— on 14 Sep 2026 there were 17 such accounts. This tool ticks those rows and
puts them on one date, today by default, so the day's worklist picks them up
without an Admin opening seventeen dialogs to move a date somebody else
should have moved.

Three rules, all deliberate:

- **Admin only** (`rights.isAdmin`, the prop is not passed otherwise). Moving
  a colleague's follow-up is a management act, not a CRM tool.
- **Every account it touches gets a `system` activity entry** written by
  `repo.addActivities()` (one multi-row insert, not one request per account),
  under the Admin's own name: *"Follow-up date moved from 09 Sept to 14 Sept
  in a bulk update. It was 5 days overdue and Garry had not rescheduled it."*
  An account with no date reads *"No follow-up had been planned by …"*; one
  closed as collected reads *"reopened"*. The reschedule is on the record
  beside the owner's name instead of silently in a column, which is the
  "record of follow-ups not updated by the CRM" the business asked for.
- **`lastFollowUpOn` is not touched.** An Admin moving a date is not a
  follow-up, and stamping it would hide the very gap this exists to show.

An account already on the chosen date is skipped and not written about; a
past date is refused (`min` on the input, and again in the handler). The
view confirms before anything moves. The date and the notes are the two
tests in the round-trip script; nothing else changes on the row.

### 9.7 Alerts & reminders (`AlertsView`)

Switch, recipient roles, skip-when-empty, extra addresses, **Send me a test
now**, and the last runs from `alert_log` — what was actually delivered, not what
was scheduled. Channels are stated honestly: email is Ready or Off; SMS and
WhatsApp say *Not connected*.

### 9.8 Team & access

Add/edit/remove teammates. Creates the Supabase Auth login **and** the profile in
one go, via `/api/team`. The CRM code is fixed once created — it is what links a
customer row to its owner.

### 9.9 Data source

Format help, expected headers, template download, the two sheet URLs, individual
and combined sync, and a **factory reset** that clears cheques, templates and
profile and re-imports the sheet — but never touches logins.

### 9.10 Live stock (`LiveStockView`) — a window onto the stores sheet

The fifth work tab, for every role. It shows the **Live stock** page of the
stores spreadsheet — 1,415 items, ₹2.50 Cr at the time of writing — and
nothing of it is stored here: stock is the stores team's record, kept in the
sheet, and the app reads it. `services/liveStock.ts` holds the sheet URL, the
parser and the hook; nothing was added to the database or the API.

**How it stays live.** `useLiveStock(enabled)` reads the page through the
existing `/api/fetch-sheet` proxy (the `gviz` CSV, about a second) when the
tab opens, then every 60 s while the tab is open **and visible**, and again
the moment the window regains focus. A phone in a pocket pulls nothing. A
failed read keeps the last good figures on screen with the failure said out
loud; the last CSV is also kept in `localStorage`, so the page opens on
figures marked "last read" and replaces them within a second.

**Reading the sheet.** Columns are found by header, not position
(`Prod_Category`, `Item_Code`, `Actual_Quantity`…), so the stores team can
add or move one. The sheet's second row is their own legend and carries no
item code; rows without a code are skipped. The coded columns decode as:

| Column | Values | Read as |
|---|---|---|
| `Stock_Status` | `FM` / `OD` / `D` | **Stocked** — every FM row carries min/max levels and no other row does; **On demand** — no levels, bought against orders; **Dead stock** — no levels, no movement, nothing received in months |
| `Short Stk Status` + `Short Stock Date` | `S` + date | below its minimum since that date — exactly the rows where quantity < min |
| `Items_Movements` | FAST / SLOW / REVIEW | as written |
| `Ageing` | days | days since `Last Recv. Dt`, as the sheet computes it |
| `Color` | R / M / Y / G | a product attribute (the ink colour), shown as a dot — **not** a health flag |
| `Amount` | ₹ | quantity × rate, the item's stock value |
| `Photo` | a Drive share link | shown in the item drawer through Drive's thumbnail endpoint, with **no referrer** — with one, Drive answers with a page the browser refuses to show as an image |

**The page.** It answers the question a call is about — is it there, how
much, is it running low — which is the search and the list. The figures above
them are an **Overview that opens on request**: a one-line bar (the three
availability counts and the health score, so the closed bar still says how
the shelf is doing) that one click opens and one click closes, for every
role, and that is **closed on every visit** — the boss's call, the dashboard
is not an everyday need. Nothing of it is rendered while closed. Because the
critical-items button lives inside it, a **Critical (n)** chip sits in the
filter row so that list stays one click away with the overview folded.
Inside: five tiles of the whole sheet,
each a filter: total items · in stock · low stock · out of stock · health
score. `availabilityOf()` puts every item in exactly one of the three
(nothing there, or a negative quantity → **out**; there but under its minimum →
**low**; otherwise **in**), so the three counts add up to the sheet and the
bars under them read as one picture of the shelf. Health is the in-stock
share, in a word: Healthy from 85%, Fair from 70%, Needs attention below.
Beside the value by brand sits **Quick insights** — brands, sub-categories,
total quantity (all units together, as asked for), average per item, low-or-
out share with what it would cost to reach the minimums, and **critical
items**: out of stock *where it matters* (`isCritical()` — a stocked item or a
fast mover at zero; dead stock at zero is not a problem, and the plain
out-of-stock count is already a tile). Then search, brand and sub-category,
availability chips, status and movement selects, sort; a sortable table (rows
on a phone, per [§12](#phone-layout)) windowed at 60; and a drawer per item —
photo, chips, stock / value / rate, the quantity against its min and max with
how much is short and what that costs, and **Open in sheet**, which deep-links
to the row (`range=A<serial+2>`, since the sheet's S. No runs from row 3). The
app-bar search applies here too, and the title's subtitle and placeholder are
the sheet's, not the book's. Export needs `canExportData`.

**Several products at once.** Every row leads with a tick box (a checkbox
column on the table, a tick beside the phone row), and the ticks are kept as
item ids in `sessionStorage` — so they survive a change of search or filter,
which is the whole point: find one, tick it, find the next. A tray at the
foot of the screen (above the phone tab bar) names the ticked items with a ×
each, and **Compare** opens a panel with one column per item and the same
facts in the same rows — availability, stock (the largest in green), levels,
short by, rate and value (priced roles only), status, movement, last
received, average sales, transactions, MOQ, GST, colour, sheet row — first
column and header row sticky, so a phone scrolls sideways through them. Up to
`COMPARE_MAX` (8); past that the unticked boxes are disabled and say so. An
item's name in the panel opens its drawer; "Export these" exports the
compared items rather than the view. A row press still opens the drawer; the
tick box stops the click from reaching the row.

**Rate and value show only to Admin and Manager** (`showPrices` — the role,
and the read having carried prices). For everyone else the page has no rupee
on it: the value tiles and columns are gone, the brand card ranks by item
count, the sort offers no value or rate, the drawer shows quantity and unit
with how much is short but not what it costs, the export leaves the two
columns out, and the sheet links are absent. The server had already emptied
the figures (§5.4), so this decides what the page offers, never what it hides.

The first version led with value, dead stock, movement and days-since-receipt;
that is a buyer's view, and it was asked to be the stores' view instead. The
figures are all still in the drawer and the export.

### 9.11 Sign-in (`LoginScreen`)

Four screens, one journey: `email → password → in`, `email → reset link sent`,
and `recovery link → choose a new password`.

> Supabase's built-in mailer sends **2 emails an hour for the whole project**.
> Point Supabase at your own SMTP under **Authentication → Emails → SMTP
> Settings**.

---

## 10. API surface

| Route | Method | Auth | Does |
|---|---|---|---|
| `/api/health` | GET | none | liveness |
| `/api/ai-status` | GET | none | is `GEMINI_API_KEY` set |
| `/api/alert-status` | GET | session | which mail provider the server has |
| `/api/fetch-sheet` | GET/POST | **Admin/Manager** session | proxy a Google Sheet CSV (host allow-list) — the balance sync and the customer import |
| `/api/live-stock` | GET | session | the stores sheet for the Live stock tab; **rate and value emptied server-side unless Admin/Manager** |
| `/api/team` | POST | **Admin** session | create / update / delete a teammate |
| `/api/daily-report` | GET/POST | `CRON_SECRET` **or** Admin/Manager session | run the reminder |
| `/api/gemini-report` | POST | session | AI collection report |

### `/api/team` details

Verifies the bearer token resolves to an **Admin** profile before touching
anything. Returns `501 service_key_missing` when the deployment has no service
role key, so the client can say so plainly instead of failing obscurely.

- **create** — checks the CRM code is free, creates the auth user with
  `email_confirm: true` (an Admin set the password, so skip the confirmation
  mail), then upserts the profile. **If the profile fails, the auth user is
  deleted** — never leave a login behind that has no profile to sign in with.
- **update** — profile columns and credentials are updated separately, because
  they live in different places.
- **delete** — refuses to delete yourself, and refuses to delete the last Admin.
  `profiles.id` cascades from `auth.users`, so one delete clears both.

### `/api/gemini-report`

Five modes: `credit_reduction`, `overdue_recovery`, `crm_performance`,
`cash_forecast`, `custom`. **Without a Gemini key it returns a full rule-based
report rather than an error**, so the feature works on a deployment that has not
bought AI credits.

---

## 11. The daily reminder email

`vercel.json` → `{ "path": "/api/daily-report", "schedule": "30 3 * * *" }` =
03:30 UTC = **9:00 a.m. IST**.

`runDailyReminders()` in [api/_lib/reminders.ts](api/_lib/reminders.ts):

1. Service client; refuse without one.
2. Read `alert_settings`. If off and not a test, log "switched off" and stop.
3. Load recipients; filter by role, or to one address for a test.
4. `buildDigests()`.
5. Skip anyone with `taskCount === 0` when `skip_when_empty` (never for a test).
6. Send; count delivered/failed.
7. Extra addresses get the company-wide view.
8. **Write the outcome to `alert_log` either way.**

### What a digest contains

Per recipient, scoped by `scopeFor()`:

| Section | Source |
|---|---|
| Due today | `follow_up_date` = today |
| Past their promised date | `follow_up_date` < today |
| They said they would pay today | open promises with `promised_on` = today |
| Promised, and the day passed | open promises with `promised_on` < today |
| Cheques to present today | in-hand cheques dated today |
| **Cheques past their date, still in hand** | in-hand cheques dated before today |
| Money promised for today | `forecast_amount` with `forecast_date` = today |
| Accounts with no follow-up planned | count + value |
| By CRM | whole-book readers only |

`taskCount` is the sum of the six actionable sections and drives both the
headline and the skip rule.

**The subject line is built from the same numbers as the body.** Counting only
follow-up dates meant an email listing three promises to chase announced itself
as "0 due today, 0 overdue".

Rows carry a `BAD DEBT` / `LATE PAY` tag from `payment_rank`, and `URGENT` from
`is_urgent`.

**Declared defaulters are not in the email** (§7.4): `open` leaves out
`payment_rank = 'Bad'`, so they appear in none of the sections and in no
CRM's row. The intro says how many there are and what they owe ("57 of them
(₹1.75 Cr) are bad debt, on the recovery list in the app and not below"),
and the plain-text version carries the same line.

`bookCount` filters to accounts with dues — otherwise the email told people they
were carrying thousands of accounts.

---

## 12. Design system

`styles/theme.css`. Stated intent: **Apple's structure, Google's affordances.**

> Colour has exactly two jobs: **accent = "you can touch this"**, and **the
> ageing ramp = "this is how old the money is"**. Those are the only two colour
> languages in the product.

### Tokens

Everything is a CSS custom property on `:root`, redefined in three places so the
theme cannot fight itself:

1. `:root` — light
2. `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`
3. `[data-theme="dark"]`

`index.html` stamps `data-theme` **before first paint** from
`localStorage.timely_theme`, so there is no flash of the wrong theme.

**Brand:** navy `#183C6C` (from the Shori logo), yellow `#FCF000` as a fill only,
always with navy on top. In dark mode the accent lifts to `#7FA8E0` and
`--on-accent` inverts to `#0B1A2E`.

**Ageing ramp:** `--age-1` green → `--age-2` amber → `--age-3` orange →
`--age-4` red, each with a `-bg` fill and an `-ink` text-safe tone. Dark mode
gets its own ramp, not a filter.

### The palette remap

The original code was written against stock Tailwind colours across thousands of
lines. Rather than rewrite every class, `@theme inline` remaps the stock scales:

```
gray / slate / zinc              → neutral ramp
green / blue / indigo / purple   → accent navy   (these were the actions)
emerald / teal                   → current (green)
amber / yellow / orange          → watch
red / rose                       → risk / critical
```

So `text-blue-600` in an old component paints Shori navy, and `#24518F` in dark
mode where white text still clears contrast on it.

### Notable rules

- The universal `border-color` reset lives **inside `@layer base`**. Unlayered
  CSS outranks everything Tailwind emits, so an unlayered universal
  border-colour silently overrode every `border-{colour}` utility in the app.
- `.num` uses tabular figures in the UI face. A monospace here reads as a
  developer tool, not a finance app.
- `:focus-visible` is a 2 px accent halo with 2 px offset.
- `@media (prefers-reduced-motion: reduce)` kills animation globally.

### Phone layout

Most of the team opens the app on a phone. The laptop layout is the reference
and is **not** the phone layout squeezed: below `md` (768px) the app is
re-laid out, and every phone rule is written so the laptop cannot see it.

**The two mechanisms, and the line they share.**

- Styling: `max-md:` variants only — `max-md:hidden`, `max-md:flex-1`,
  `max-md:[&>button]:h-11`. They compile to `@media not all and
  (min-width: 48rem)`, so nothing at `md` or above changes by construction.
  Never restyle a base class to get a phone look; the base is the laptop.
- Rendering: `useIsPhone()` (`components/ui/usePhone.ts`) answers
  `(max-width: 767px)` — the same line — for the places a phone needs a
  *different tree*, not a differently styled one: a row list instead of a
  table, a segmented sheet instead of two columns. On a laptop the hook is
  false and the original branch renders unchanged.

**What the phone gets.**

| Piece | Laptop | Phone |
|---|---|---|
| Navigation | pill row under the app bar | fixed bottom tab bar (`AppShell`), Setup as a sheet from its own tab |
| App bar | search, Sync, theme, avatar | search and avatar; Sync and theme live in the avatar menu |
| Customer book, Reports | tables | `PhoneAccountRow` — name, grade, state, contact, balance, ageing bar; the row opens the account, WhatsApp is the one button |
| PDC register | table | a card per cheque with Clear / Hold / Bounce sized for a thumb |
| Team table, team performance | tables | a card per person |
| Summary tiles | grids | a sideways strip that snaps tile by tile |
| Filter selects | always shown | folded behind one **Filters** button; search stays out |
| Dialogs | centred cards | full-screen sheets; the follow-up sheet has **Follow-up / Activity** segments because the record under the form left the form 180px to scroll in |
| Long lists | all rows | windowed, with **Show more** — the reports page was 160,000px tall on a phone |
| Fields | as styled | 16px on a phone (`theme.css`), because iOS zooms into anything smaller and never zooms back |

`index.html` declares `viewport-fit=cover`, and the tab bar and sheet footers
pad by `env(safe-area-inset-bottom)` so the home indicator does not sit on a
button.

**Proving the laptop is untouched.** `scripts/`-style screenshot runs at
1440x900 and 1366x768, before and after, pixel-diffed: every screen was
identical apart from animation frames (`animate-pulse` badges, the sync
dot) — and one thing worth knowing: Puppeteer's *full-page* capture mode
renders the app-bar placeholder a few pixels wider on some pages, while a
viewport capture of the same page is identical. Diff viewport captures, or
expect that one.

### Money formatting

`components/ui/format.ts` — the people using this think in lakhs and crores, and
the tables are dense:

- `groupIndian(4029276)` → `"40,29,276"`
- `formatINR()` → `"₹40,29,276"` — used wherever a number is acted on
- `formatCompact()` → `"₹40.3 L"`, `"₹1.13 Cr"` — the default in tables, with
  the exact figure always in a tooltip
- `relativeDays()` → `"today"` / `"in 3 days"` / `"4 days ago"`

`digest.ts` carries its own copies because it cannot import browser code.

### Message templates

`services/messageTemplate.ts`, shared by the WhatsApp dialog and the follow-up
screen (which used to carry a copy each and had drifted apart). Three rules
beyond substitution:

1. **Placeholders are replaced literally**, with `split`/`join`. The old code
   compiled `"{{totalDue}}"` into a regular expression, where braces are
   quantifier syntax — a template written a little differently silently matched
   nothing.
2. **A currency symbol in front of an amount placeholder is dropped.** Amounts
   format with their own symbol, so `"Total Due: ₹{{totalDue}}"` was reaching
   customers as `"₹₹1,25,000"`. Fixed at render time, because templates are
   hand-edited and stored in the database.
3. **A breakdown line whose figures are all nil is dropped** — but `{{totalDue}}`
   is always kept, since a reminder with no total leaves the customer guessing
   what it is about.

The fields are `{{companyName}}`, `{{contactPerson}}`, `{{contactNumber}}`,
`{{totalDue}}`, the four buckets `{{ageing1_45}} {{ageing46_90}}
{{ageing91_135}} {{ageingOver135}}`, and two roll-ups:

| Placeholder | Is |
|---|---|
| `{{totalOver90}}` | 91-135 **plus** >135 — the "Total >90d Overdue" figure |
| `{{dueOver45}}` | 46-90 plus 91-135 plus >135 |

A roll-up takes the sheet's own column (`over90`, `dueOver45`) when it has one
and adds the buckets when it does not, and counts as a credit only if *every*
bucket feeding it is — otherwise one small advance would flip the whole line to
"Cr (Excess)". `{{totalOver90}}` is the figure the escalation templates are
written around; without it a follow-up template had to print 91-135 and >135 as
separate lines and leave the customer to add them up. The chips in the template
editor insert at the caret, so nobody has to retype the braces — a misspelt
placeholder sends its own literal text to the customer.

---

## 13. Known issues and open work

### 13.1 The daily email cannot send — **OPEN, high**

`daily_email` is ON, the cron runs on time, and every run fails with
`provider: none`. Nine people got nothing on 29 Aug and the log has recorded it
honestly each time.

**Fix:** a Gmail app password → `SMTP_URL` and `ALERT_FROM` in `.env.local`,
pushed to Vercel with `vercel env add`, then redeploy and press *Send me a test
now*:

```
smtps://user@domain:APP_PASSWORD@smtp.gmail.com:465
```

### 13.2 Duplicate clients — **FIXED**

The imports matched company names on the trimmed lowercase string, so
"HARIOM TRADERS", "HARI OM TRADERS" and "HARI OM TRADERS," were three customers.
`companyKey()` now drops punctuation and spacing before anything is compared,
`customerIdFor()` derives the id from the same key, and the reconciliation
modal uses it too.

Thirty-three shadow accounts were merged away in the database on 29 Aug. Every
one carried ₹0, no cheques and no activity; contact details were folded into the
row that carried the money before the shadow was removed. Book unchanged at
₹11,20,56,112 across 687 accounts with dues.

### 13.3 The Customer Master parser lost two columns — **FIXED**

The column matcher was an if/else chain in which a generic word won.

| Header | What happened | Cost |
|---|---|---|
| `SALESPERSON name` | contains "person" → taken for the contact, slot full, dropped | every imported account had **no owner**; 3,262 settled on one name |
| `Customer Emails Id` | contains "customer" → taken for the company name, dropped | `sales email` matched instead: **3,991 of 3,992** customer emails were Shori staff addresses |
| `Ranking` | no rule matched | 406 grades ignored, including 33 explicit **Bad-Debts** |

`mapMasterColumns()` now runs most-specific first, claims each header once, and
falls to a natural second slot for a duplicate header. Against the live sheet it
recovers the owner on all 4,068 rows and stops inventing emails. Only an
unambiguous bad debt is carried from Ranking — "Inactive" and "Dead" say whether
we still sell to someone, not how they pay.

⚠️ **The database still holds the wrong values.** The next Customer Master sync
applies the correct owner and clears the invented emails, and it will reassign
roughly 3,300 accounts in one go — worth doing deliberately rather than by
accident.

### 13.4 CRM code case drift — **CODE FIXED, DATA OPEN**

Eight codes exist in two spellings (`KAPIL`/`kapil`, `VISHNU`/`Vishnu`, …),
together holding 32 accounts and ₹16,66,100. `ownerKey()` means scoping, the
digest and the performance table are all correct; what breaks is anything that
groups on the raw string — the CRM filter lists one person twice.

Imports now settle the code with `ownerKey()` on the way in, so it cannot be
reintroduced. **The one-off `UPDATE` over the existing rows has not been run**
— it was blocked mid-session and needs re-running:

```sql
update customers c set crm_owner_id = p.legacy_id
from profiles p
where upper(trim(p.legacy_id)) = upper(trim(c.crm_owner_id))
  and c.crm_owner_id <> p.legacy_id;
-- and the same for assigned_collector_id and pdc_cheques.crm_owner_id
```

### 13.5 Scoping written five times — **FIXED**

`getOutstandingForUser()` and `digest.scopeFor()` had the union rule; the three
view-level copies branched on the role, so a Collector never saw an account they
owned as CRM and a CRM never saw one handed to them as collector. There is now
one `scopeTo()` in [types.ts](types.ts), used by all four client call sites.

### 13.6 The cheque badge counted the whole company — **FIXED**

`todayPdcMetrics` narrowed only for a CRM, so a scoped Collector saw a badge
counting everyone's cheques beside a register showing only theirs. It uses
`scopeTo()` and `chequeState()` now, and also reports overdue.

### 13.7 One account nobody can see — **OPEN, needs a decision**

`out_519_A.B_ENTERPRISES` — **A.B ENTERPRISES (DERA BASSI), ₹8,780** — has an
empty `crm_owner_id`, so only whole-book readers see it. Who owns it is a
business call, not a code fix.

### 13.8 GSTIN is always empty — **NOT A BUG**

The Customer Master sheet has no GSTIN column. The field is parsed, stored,
exported and searched correctly; there is simply no source data.

### 13.9 `DueToday` in the type and the constraint — **contained**

Kept in the enum and the schema check so a historical row still parses; nothing
writes it, and `PDC_STATUS_CHOICES` is what the form offers. Zero rows hold it.

### 13.10 Residual accessibility finding — **OPEN, minor**

One 262×19 `<input>` that `scripts/audit.cjs` reaches in the Add-customer dialog
but a direct probe cannot reproduce. Both themes otherwise sweep clean.

### 13.11 Ageing sums and the total disagree by ₹69,535

`portfolioAgeing` sums the four buckets (₹11.20 Cr); the header sums `total`
(₹11.21 Cr). The two columns disagree in the source sheet for a handful of rows.
The sheet is the authority, so this is reported rather than reconciled.

### 13.12 Remaining launch steps

| # | Step | Blocked on |
|---|---|---|
| 1 | Gmail SMTP app password → `SMTP_URL` + `ALERT_FROM` → Vercel → redeploy → test send | credentials |
| 2 | Supabase custom SMTP (lifts the 2-emails-per-hour cap) | same credentials |
| 3 | Password-reset round trip end to end | step 2 |
| 4 | Create the Manager and Viewer accounts | — |
| 5 | Confirm the real 9 a.m. cron delivers | step 1 |
| 6 | Optional `GEMINI_API_KEY`, **then revoke `.deploy.local` tokens last** | — |

⚠️ Step 6's revocation is deliberately last: revoking ends the ability to deploy
or run migrations.

---

## 14. Building, testing, deploying

```bash
npm run dev          # tsx server.ts → http://localhost:3000 (Vite middleware)
npm run typecheck    # tsc --noEmit          ← currently CLEAN
npm run build        # typecheck + vite build + esbuild the server
npm run build:web    # what Vercel runs
npm run smoke        # sign in, screenshot every screen
npm run audit        # accessibility + contrast sweep (light)
npm run audit:dark   # same, dark
node scripts/interact.cjs   # click things, assert they did something
npm run check:classes       # dead Tailwind classes
npm run check:empty         # controls with no accessible name
```

`tsconfig.json` is strict, plus `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`.

**The browser scripts need a real account.** They read `ADMIN_EMAIL` /
`ADMIN_PASSWORD` from `.deploy.local`, or `TIMELY_EMAIL` / `TIMELY_PASSWORD`
from the environment — never from source. They drive real Chrome at
`C:\Program Files\Google\Chrome\Application\chrome.exe`.

`scripts/audit.cjs` is worth knowing about: Tailwind v4 mixes colours in oklab,
so `getComputedStyle` hands back `oklab(...)` strings whose numbers are not RGB
channels. The script paints each colour to a 1×1 canvas over the real backdrop
and reads the pixel back — the only reading that is correct for every colour
space, alpha included. Hit-target threshold is `min(w, h) < 28`.

### Deploy

```bash
npx vercel deploy --prod --yes
```

Uses the CLI's existing session. (`VERCEL_TOKEN` in `.deploy.local` is empty;
passing `--token ""` fails with "Not authorized".)

**Before any deploy that touches data:** snapshot the database, run read-only
`SELECT` audits, and compare row counts before and after. Any probe row written
during testing gets deleted.

---

## 15. File map

```
App.tsx                     2,820 lines. All state, all handlers, both dashboards,
                            every derived metric. The centre of gravity.
types.ts                      601. Types, roles, permissions, and the domain
                            helpers: ownerKey, hasOutstanding, isResponsibleFor,
                            getFollowUpCategory, getCustomerPaymentRank,
                            promiseState.
index.tsx / index.html      Mount + pre-paint theme stamp.
styles/theme.css              389. The whole design system.

services/
  supabaseClient.ts         Browser client. requireSupabase() throws rather than
                            silently no-opping.
  repository.ts               734. Every read and write. Row↔model mappers,
                            paging, team API calls, activity log.
  googleSheetService.ts       795. CSV parsing, merge rules, getOutstandingForUser.
  useSupabaseSync.ts          137. The two change-detecting sync hooks.
  messageTemplate.ts          139. Template rendering.
  liveStock.ts                300. The stores sheet: URL, header-driven parser,
                            the coded columns decoded, useLiveStock() polling.

api/
  _lib/supabase.ts          serviceClient / userClient / currentProfile / bearerToken
  _lib/team.ts                223. Team administration.
  _lib/digest.ts              569. Digest building + HTML/text rendering.
  _lib/reminders.ts           151. The run, and the log.
  _lib/report.ts              213. AI report + rule-based fallback.
  _lib/mailer.ts              100. Resend / SMTP / honest "none".
  _lib/sheet.ts               119. Google CSV URL ladder + host allow-list.
  *.ts                      Thin Vercel handlers over the above.
server.ts                     143. Express mirror of every route.

components/
  shell/AppShell.tsx          529. App bar, search, theme toggle, pill tabs,
                            settings menu, large title, sync freshness.
  shell/NavIcons.tsx        Nav glyphs.
  ui/Primitives.tsx           320. Button, Badge, Card, SectionHeader, Money,
                            AgeingBar, AgeingLegend, Stat, EmptyState, Spinner.
  ui/format.ts                110. Indian money and date formatting, and the
                            local-day helpers date inputs need.
  ui/usePhone.ts               25. useIsPhone(): the (max-width: 767px) line,
                            for a component that renders a different tree
                            on a phone.
  ui/BadDebtStrip.tsx         50. The recovery list, one press from the
                            worklist it is kept out of (§7.4).
  ui/PhoneAccountRow.tsx      150. One account as a phone row — used by the
                            customer book and the reports below md.
  LiveStockView.tsx           1380. The Live stock tab: a folded overview
                            (tiles, breakdowns), filters, table / phone
                            rows with tick boxes, the compare tray and
                            panel, item drawer, export.

  work/Workspace.tsx          Master-detail: the queue and the account together.
  work/Worklist.tsx           The six queues, their counts and their rows.
  work/AccountPanel.tsx       One account: money, form, contacts, cheques, thread.
  CustomerDashboardView.tsx 1,342. The customer book.
  ReportsView.tsx           1,015. Reports and instant-report cards.
  PdcChequesView.tsx          920. Cheque register.
  CustomerEditModal.tsx       677. Add / edit a customer.
  SyncReconciliationModal.tsx 338. Preview an import before applying it.
  AiReportModal.tsx           575. AI report UI.
  LoginScreen.tsx             535. Sign in / forgot / recovery.
  UserModal.tsx               512. Team & access form.
  CustomerActivityPanel.tsx   462. The shared thread.
  PdcModal.tsx                389. Add / edit a cheque.
  AlertsView.tsx              325. Reminder settings + run history.
  WhatsAppReminderModal.tsx   257.
  ChangePasswordModal.tsx     126. Own password, every role.
  CrmPerformanceTable.tsx     115.
  CompanyProfileView.tsx      205.
  TemplateModal.tsx           145.
  NotificationBanner.tsx       74.
  BalanceAmount.tsx            74. Dr/Cr rendering.
  StatusBadge.tsx              25.
  icons/                    Icons.tsx, AppLogo.tsx

scripts/                    audit · interact · smoke · signin · contrast ·
                            contrastfix · deadclasses · emptycontrols · tour

supabase/schema.sql           479. Tables, RLS, helpers, triggers.
vercel.json                 Build, SPA rewrite, cron.
README.md / SETUP.md / DEPLOYMENT.md
```

---

## 16. Conventions worth keeping

1. **A date beats a stored status.** Both real calculation bugs found in this
   codebase were a label going stale while the calendar moved on. Derive
   due/overdue at render time.
2. **Say what actually happened.** `alert_log` records failed sends. The mailer
   returns `provider: 'none'` instead of pretending. `requireSupabase()` throws.
   The app never reports success it did not achieve.
3. **Normalise ownership through `ownerKey()`.** Never compare raw CRM strings.
4. **The sheet owns money; the app owns everything else.** `financialsFromSheet()`
   is the whole contract. An import never deletes a customer.
5. **Hide what the database would refuse.** Every button is gated on the same
   right the RLS policy checks, so the UI and the server can never disagree.
6. **Comments say *why*, not *what*.** Nearly every non-obvious block in this
   codebase carries the bug that caused it. Keep that up — it is why the history
   is legible.
7. **Server-side and client-side routes are mirrors, never re-implementations.**
   Shared logic goes in `api/_lib/`.
8. **Read-only audits before writes on production.** Snapshot, count, act,
   re-count.
