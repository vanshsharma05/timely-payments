# Timely Payment

Receivables collection book for **Shori Chemicals Pvt. Ltd.** — every
outstanding account, the follow-ups against it, and the post-dated cheques held
against it, shared by the whole team.

- React + Vite front end, Supabase (Postgres + Auth) behind it
- Server routes under `api/` run on Vercel; `server.ts` serves the same routes
  locally so what you test is what ships
- The Google Sheet is an **import source**; Supabase is the master record

---

## Run it locally

**Prerequisites:** Node.js 20+, and a Supabase project (see [SETUP.md](SETUP.md)).

```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000
```

| Variable | Where it runs | What it is |
|---|---|---|
| `VITE_SUPABASE_URL` | browser | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | browser | anon key — Row Level Security decides what it can reach |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | lets `/api/team` create teammate logins. Never prefix it with `VITE_` |
| `GEMINI_API_KEY` | server only | optional; without it the AI report falls back to a rule-based one |

Without the two `VITE_` values the app shows a "not configured" screen rather
than pretending to work.

## Who can do what

Roles come from the profile in Supabase. The app hides what a role may not do,
and the database refuses it as well — the two are kept in step deliberately.

| | Admin | Manager | CRM | Collector | Viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| See the whole book | ● | ● | own accounts | own accounts | ● |
| Record follow-ups and notes | ● | ● | ● | ● | – |
| Add a customer | ● | ● | ● | – | – |
| Edit balances and ageing | ● | ● | – | – | – |
| Delete a customer | ● | – | – | – | – |
| Cheques (add, clear, hold, bounce) | ● | ● | ● | ● | – |
| Reassign the CRM owner | ● | ● | – | – | – |
| Export / AI report | ● | ● | ● | – | – |
| Message templates, data source, sheet sync | ● | ● | – | – | – |
| Team & access | ● | – | – | – | – |

Everyone, including Viewers, can change their own password from the account
menu. Only an Admin can change somebody else's, in **Team & access**.

## Daily reminder email

Every morning at 9:00 India time, each person gets one email listing only what
they have to chase: follow-ups due today, promises already past their date,
cheques ready to present, money promised for today, and how much is sitting
with no follow-up planned. Whoever reads the whole book also gets a line per
CRM. Somebody with nothing to chase is skipped.

An Admin turns it on and picks who receives it under **Settings → Alerts &
reminders**, and can send themselves a test at any time. That screen also shows
the last few runs — what was actually delivered, not what was scheduled.

Delivery needs one provider on the deployment:

| Variable | What it is |
|---|---|
| `RESEND_API_KEY` | a key from resend.com, with your sending domain verified there |
| `SMTP_URL` | any SMTP server, e.g. `smtps://you@company.com:APP_PASSWORD@smtp.gmail.com:465` |
| `ALERT_FROM` | the From address; must belong to that domain or account |
| `CRON_SECRET` | proves a request to `/api/daily-report` came from Vercel's scheduler |

Without one, the reminder still runs on schedule and records that it could not
send. The time is set by the schedule in [vercel.json](vercel.json).

## Signing in

Email and password, held by Supabase Auth. **Forgot password** emails a link
that opens the app on a "choose a new password" screen. For that link to come
back to the live site rather than `localhost`, set the Site URL and Redirect
URLs in Supabase (see [DEPLOYMENT.md](DEPLOYMENT.md) step 8).

> **Supabase's own mailer sends only 2 emails an hour, for the whole project.**
> That is enough to test with and not enough for a team: the third person
> asking for a reset link that hour gets nothing. Point Supabase at your own
> SMTP server — **Authentication → Emails → SMTP Settings** — using the same
> account as `SMTP_URL` below, and the limit lifts. Until then an Admin can
> always set somebody's password directly in Team & access.

Self sign-up is disabled: accounts exist only because an Admin created them.

## Checks

```bash
npm run typecheck     # tsc, no emit
npm run build         # typecheck + vite build + bundle the server
npm run smoke         # signs in and screenshots the main screens
npm run audit         # accessibility and contrast sweep
node scripts/interact.cjs   # clicks things and checks they did something
```

The browser-driven scripts need a real account: they read `ADMIN_EMAIL` and
`ADMIN_PASSWORD` from `.deploy.local`, or `TIMELY_EMAIL` / `TIMELY_PASSWORD`
from the environment.

## Deploying

[DEPLOYMENT.md](DEPLOYMENT.md) covers the Supabase project, the schema in
[supabase/schema.sql](supabase/schema.sql), the environment variables and the
Vercel deploy.
