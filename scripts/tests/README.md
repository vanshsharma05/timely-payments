# Browser suites

Puppeteer suites written alongside recent feature work, kept here so they are under version control. They were copied in verbatim during Phase 0 of the product audit (see `docs/product-audit/12-TEST-STRATEGY.md`); a single runner and any tidy-up come in Phase 13.

How they run today

```
npm run dev                      # the app on http://localhost:3000, signed in to the real Supabase project
node scripts/tests/<suite>.cjs <output-dir-for-screenshots>
```

- Sign-in comes from `scripts/signin.cjs`: `TIMELY_EMAIL` / `TIMELY_PASSWORD` in the environment, else `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.deploy.local`.
- Chrome is expected at `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- Every suite asserts internal consistency (counts add up, filters agree with each other) rather than remembered figures, so they survive the book and the stock sheet changing daily.
- `price-ui-test.cjs` runs an Admin leg with `ADMIN_ONLY=1`; the CRM leg needs a CRM login in `TIMELY_EMAIL` / `TIMELY_PASSWORD`.
- `crm-test.cjs` is the one suite that writes: it creates a throwaway CRM login through `/api/team` as the Admin and deletes it before exiting (and checks it is gone).

| Suite | Covers | Checks |
|---|---|---|
| `stock-test.cjs` | Live stock tab: tiles add up, tile filters, critical button, brand bar, sort, drawer, export | 45 |
| `overview-test.cjs` | Live stock overview fold (closed on arrival, one click open/close, Critical chip), laptop + phone | 38 |
| `compare-test.cjs` | Compare mode: ticks survive search/filter/reload, bar, panel, cap of 8, Done | 54 |
| `price-ui-test.cjs` | Rate/value present for Admin, absent for a CRM | 12 / 24 |
| `crm-test.cjs` | A CRM's Today and compare panel (no prices) via a throwaway login | 9 |
| `baddebt-test.cjs` | Defaulters out of the worklists, on the recovery list; badge and chips agree | 15 |
| `book-filters-test.cjs` | Customer book: every filter's counts follow one rule; column and order follow the ageing chip; Reset | 25 |
| `chips-test.cjs` | Rank/ageing chip counts and lists (hard-codes the counts seen on 2026-09-16 — the one suite that will need its figures refreshed) | 20 |
| `phone-test.cjs` | Phone layout: bottom tab bar, folded filters, rows, drawers | 38 |

## Probes (read-only by construction)

`write-payload-probe.cjs` and `status-contract-probe.cjs` capture what the browser *would* send and abort every mutating request (`/rest/v1/*` non-GET, mutating `/api/*`) at the network layer, so they can run against production. They default to `http://localhost:3000`; `PROBE_BASE=https://timely-payment.vercel.app` points them at the deployed site. Expected results are recorded in `docs/product-audit/11-SECURITY-RELIABILITY.md` and `16-CHANGELOG.md`.
