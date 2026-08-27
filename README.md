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

## Signing in

Email and password, held by Supabase Auth. **Forgot password** emails a link
that opens the app on a "choose a new password" screen. For that link to come
back to the live site rather than `localhost`, set the Site URL and Redirect
URLs in Supabase (see [DEPLOYMENT.md](DEPLOYMENT.md) step 8).

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
