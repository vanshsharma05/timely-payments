# Deploying Timely Payment — phase 1

Goal: a live URL your team can sign into, where anything they record is saved
and shared. Supabase holds the data, Vercel serves the app.

Budget about 30 minutes. Everything below needs **your** accounts — sign up for
both with `timelypaymentsupport@gmail.com` so they stay together.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com> → sign in with `timelypaymentsupport@gmail.com`.
2. **New project.**
   - Name: `timely-payment`
   - Region: pick the one nearest your office (e.g. `Mumbai (ap-south-1)` for India).
   - Set a strong database password and save it somewhere safe.
3. Wait for provisioning (~2 minutes).

## 2. Create the tables

1. In the project, open **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql).
3. Press **Run**.

You should see `Success. No rows returned`. This creates the tables, the Row
Level Security policies, and a trigger that gives every new account a profile.

## 3. Create your first login

The first account created automatically becomes **Admin**, so make it yours.

1. **Authentication → Users → Add user → Create new user.**
2. Email `timelypaymentsupport@gmail.com`, pick a password.
3. Tick **Auto Confirm User** (otherwise you must click a confirmation email).
4. Click **Create user**.

Verify it worked: **Table Editor → profiles** should show one row with
`role = Admin`.

### Adding your team later

Repeat step 3 for each teammate, then set their role and CRM code in
**SQL Editor**. `legacy_id` must match the CRM name exactly as it appears in
your accounts sheet, because that is what links a customer row to its owner:

```sql
update public.profiles
   set name          = 'Ankur',
       legacy_id     = 'ANKUR',
       role          = 'CRM',
       data_visibility = 'AssignedOnly',
       assigned_crms = array['ANKUR']
 where email = 'ankur@yourcompany.com';
```

Roles: `Admin`, `Manager`, `CRM`, `Collector`, `Viewer`.

## 4. Copy your API keys

**Project Settings → API**, copy:

| Field | Goes into |
|---|---|
| Project URL | `VITE_SUPABASE_URL` |
| `anon` `public` key | `VITE_SUPABASE_ANON_KEY` |

Both are safe in the browser — Row Level Security decides what they can reach.
**Never** copy the `service_role` key into this project.

## 5. Run it locally first

```bash
cp .env.example .env.local     # then paste your two values in
npm install
npm run dev                    # http://localhost:3000
```

Sign in with the account from step 3. Add a customer, refresh the page — if it
is still there, the backend is working. Fix any problem here before deploying.

## 6. Push to GitHub

`.gitignore` already excludes `.env*`, so your keys stay out of the repo.

```bash
git init
git add .
git commit -m "Timely Payment — phase 1 with Supabase backend"
git branch -M main
git remote add origin https://github.com/<you>/timely-payment.git
git push -u origin main
```

## 7. Deploy to Vercel

1. <https://vercel.com> → sign in **with GitHub**.
2. **Add New → Project** → import `timely-payment`.
3. Vercel reads [`vercel.json`](vercel.json), so framework/build/output are
   already correct. Do not change them.
4. Expand **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your anon key |
   | `GEMINI_API_KEY` | *optional* — only for the AI report |

   `VITE_`-prefixed values are baked in at build time, so **after changing
   either one you must redeploy**, not just restart.
5. **Deploy.** You get a URL like `timely-payment.vercel.app`.

## 8. Point Supabase at the live URL

**Authentication → URL Configuration**:

- **Site URL**: your Vercel URL
- **Redirect URLs**: add your Vercel URL

Without this, "Forgot password" emails link back to `localhost`.

---

## Loading your real data

Sign in as Admin → **Data Source** tab → paste your Google Sheet URL → **Sync**.
The sheet must be shared as *Anyone with the link can view*, or published via
*File → Share → Publish to web*.

Supabase is the master record from that point on. Re-syncing updates balances
and ageing from the sheet; follow-up notes, dates, forecasts and PDC cheques
recorded in the app are kept.

## How saving works

You do not press save. Any change you make is written to Supabase about a
second later, and only the rows that actually changed are sent. If a write
fails you get a red banner at the top of the dashboard — the change stays on
screen and retries on your next edit.

## Cost

Both free tiers comfortably cover a prototype: Supabase gives 500 MB of
database and 50,000 monthly active users; Vercel's Hobby plan covers the
hosting. Note Vercel's Hobby plan is for non-commercial use — if this becomes a
production tool for the business, you need a Pro seat.

---

## Troubleshooting

**"Supabase is not configured"** — env vars missing or misspelled. They must
start with `VITE_`. Redeploy after adding them.

**Sign-in works but the dashboard is empty** — expected on a new project. Import
from the Data Source tab.

**"Signed in, but no profile exists for this account"** — the user was created
before `schema.sql` ran, so the trigger did not fire. Add the profile by hand:

```sql
insert into public.profiles (id, legacy_id, name, email, role, data_visibility)
select id, upper(split_part(email,'@',1)), split_part(email,'@',1), email, 'Admin', 'All'
  from auth.users where email = 'timelypaymentsupport@gmail.com';
```

**A CRM sees no customers** — their `legacy_id` / `assigned_crms` do not match
the CRM code in the sheet. Compare:

```sql
select distinct crm_owner_id from public.customers order by 1;
select legacy_id, assigned_crms from public.profiles;
```

**Sheet import fails with a login page error** — the sheet is not publicly
readable. Change sharing to *Anyone with the link can view*.
