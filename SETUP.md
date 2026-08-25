# Setup — from scratch

Follow this once. It takes about 10 minutes, almost all of it waiting for
pages to load. At the end you tell Claude "done" and the rest is automated.

You need: a web browser and this project folder. Nothing else to install.

---

## Step 1 — Create a Supabase account (3 min)

Supabase is the database. It stores your customers, follow-ups and PDC cheques
so everyone sees the same data.

1. Open <https://supabase.com>
2. Click **Start your project**
3. Choose **Continue with Email**
4. Email: `timelypaymentsupport@gmail.com`, pick a password
5. Open your inbox and click the confirmation link

Stop when you can see the Supabase dashboard. **Do not create a project** —
that gets created automatically for you later.

---

## Step 2 — Get your Supabase token (1 min)

1. Go to <https://supabase.com/dashboard/account/tokens>
2. Click **Generate new token**
3. Name it `timely-payment-deploy`
4. Click **Generate token**
5. **Copy it now** — it starts with `sbp_` and is shown only once

Paste it straight into a scratch note; you'll put it in a file in step 5.

---

## Step 3 — Get into Vercel (3 min)

Vercel is the hosting. It turns the app into a link your team can open.

**If you already have a Vercel account, just log into it and skip to step 4.**
It does not need to use the same email as Supabase — Vercel only ever supplies
a token, and which account issued it makes no difference.

Otherwise:

1. Open <https://vercel.com/signup>
2. Choose **Continue with Email** (not GitHub — we don't need it)
3. Email: `timelypaymentsupport@gmail.com`
4. Click the confirmation link in your inbox
5. If asked for a team/project, pick **Hobby** and skip creating a project

> **"This phone number is already linked to another account"**
> Vercel allows one account per phone number. You already have one — log into
> it rather than signing up again. Do not use a different number to create a
> second account; you do not need one.
>
> If that existing account belongs to your workplace or is shared with others,
> be aware the project will live under their organisation and anyone with
> access can see your customer data.

---

## Step 4 — Vercel token: usually skip this

Vercel has no per-project tokens — a personal token reaches your **whole
account**. If that account also hosts other work of yours, don't issue one.
Leave `VERCEL_TOKEN` blank and deploy Vercel yourself at the end; it is a
3-minute click-through, and the fiddly part (the database) is automated either
way.

Only if the account is dedicated to this project and you want the deploy
automated too:

1. Go to <https://vercel.com/account/tokens>
2. Click **Create Token**
3. Name: `timely-payment-deploy`
4. Scope: **Full Account**
5. Expiration: **7 days** (plenty — you'll revoke it sooner)
6. Click **Create** and **copy the token immediately**

---

## Step 5 — Fill in the token file (2 min)

In a terminal, from this project folder:

```bash
cp .deploy.local.example .deploy.local
```

Open `.deploy.local` in your editor and fill in these five lines:

| Line | What to put |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | the `sbp_...` token from step 2 |
| `SUPABASE_DB_PASSWORD` | **invent a new strong password** — write it down, you'll rarely need it |
| `SUPABASE_REGION` | `ap-south-1` for India, or the nearest region |
| `ADMIN_PASSWORD` | **a temporary password** for your first app login |

Leave these alone:

- `SUPABASE_PROJECT_REF` — blank, so a new project gets created
- `VERCEL_TOKEN` — blank unless you deliberately issued one in step 4
- `ADMIN_EMAIL` — already `timelypaymentsupport@gmail.com`

Save the file.

> `.deploy.local` is gitignored, so it can never be committed. Put the values
> in the **file**, not in the chat — that keeps them out of the conversation
> transcript.

---

## Step 6 — Tell Claude "done"

That's your part finished. From here it runs:

1. Create the Supabase project
2. Apply the database schema (tables, security rules, triggers)
3. Create your Admin login
4. Write `.env.local` with the API keys
5. **Start the app locally so you can confirm data actually saves**

It stops there and asks before deploying publicly.

---

## Step 7 — After the deploy: clean up

Once the site is live, do these three things:

1. **Revoke both tokens** — <https://supabase.com/dashboard/account/tokens>
   and <https://vercel.com/account/tokens>. They've done their job.
2. **Delete the token file**: `rm .deploy.local`
3. **Change your Admin password** inside the app (it sat in a plain text file)

---

## What this costs

Nothing. Supabase's free tier gives 500 MB of database, Vercel's Hobby plan
covers the hosting. No card required for either.

One caveat: Vercel's Hobby plan is licensed for **non-commercial use**. Fine
for showing a prototype to your boss. If the business adopts it as a real
tool, you'll need a Pro seat.

---

## If you get stuck

| Problem | Fix |
|---|---|
| Confirmation email never arrives | Check spam. Supabase and Vercel both send from noreply addresses. |
| "Copy token" disappeared before you copied | Delete that token and generate a new one. They're only shown once. |
| Not sure which region | `ap-south-1` (Mumbai) is right for India. Any region works; nearer is faster. |
| Supabase asks you to create an organization | Accept the default name. Claude finds the org ID automatically. |

Anything else — paste the error and Claude will work it out.
