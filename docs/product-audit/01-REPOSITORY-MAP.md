# 01 — REPOSITORY MAP

Phase 0 reconnaissance, 2026-09-16, commit `de60fc7` on branch `restore-and-fix` (`main` is kept fast-forwarded to it). 48 commits, one author. Everything below was read from the files named; nothing is inferred from names alone unless marked *(not yet read in full)*.

## What the software is

A receivables follow-up tool for one company (Shori Chemicals). It imports customer balances and ageing from Google Sheets, lets a team of CRMs and collectors record follow-ups, promises, notes and post-dated cheques against each account, gives managers reports and a daily reminder email, and shows the stores' live stock sheet as a read-only tab. Single-page app, single tenant, ~4,000 customer accounts, ~17 logins.

## Stack (confirmed from config files)

| Concern | What | Where |
|---|---|---|
| Language | TypeScript 5.2, `strict`, `noUnusedLocals/Parameters` | `tsconfig.json` (includes `./**/*.ts(x)` — api and scripts too) |
| UI | React 18.2, new JSX transform, `React.StrictMode` | `index.tsx`, `App.tsx`, `components/` |
| Styling | Tailwind v4 via `@tailwindcss/vite`, `@tailwindcss/typography`; design tokens as CSS variables in `styles/theme.css`; `data-theme` light/dark stamped before first paint in `index.html` | `styles/theme.css`, `index.html` |
| Build | Vite 5 (`build:web`), plus esbuild bundle of `server.ts` → `dist/server.cjs` (`build`) | `vite.config.ts`, `package.json` |
| Routing | No router library. Tab key kept in `location.hash` (`TAB_KEYS` in `App.tsx`); Vercel rewrites everything except `/api/*` to `index.html` | `App.tsx:55-75`, `vercel.json` |
| State | React state/hooks in `App.tsx` (~48 `useState`) + `services/useSupabaseSync.ts` (collection/value sync hooks). No store library. | |
| Data | Supabase (Postgres + Auth + RLS). Browser uses anon key via `services/supabaseClient.ts`; server uses service role via `api/_lib/supabase.ts` | `supabase/schema.sql` |
| Data layer | `services/repository.ts` (39 exports: loads, writes, auth headers) | |
| Imports | Google Sheets CSV (gviz/export URLs) through a server proxy `api/fetch-sheet.ts`; parsing/mapping in `services/googleSheetService.ts`; live stock in `services/liveStock.ts` + `api/_lib/liveStock.ts` | |
| Server | Dev: Express 5 in `server.ts` (mirrors every route, serves Vite middleware or `dist/`). Prod: Vercel serverless functions in `api/*.ts` (`maxDuration` 30s) sharing `api/_lib/*` | `server.ts`, `api/` |
| Email | Nodemailer (SMTP URL) or Resend API; daily digest built in `api/_lib/digest.ts`, scheduled by Vercel cron (`30 3 * * *` UTC = 09:00 IST) hitting `/api/daily-report` with `CRON_SECRET` | `api/_lib/mailer.ts`, `reminders.ts`, `vercel.json` |
| AI | Google Gemini (`@google/genai`) for the "AI Credit Report" — server-side only (`GEMINI_API_KEY` never in the bundle) | `api/gemini-report.ts`, `api/_lib/report.ts`, `components/AiReportModal.tsx` |
| Excel | SheetJS `xlsx` 0.20.3 (from cdn.sheetjs.com tarball) for exports and the customer import | |
| Messaging | WhatsApp deep links with templated text (`services/messageTemplate.ts`) — no WhatsApp API | |
| Hosting | Vercel (`vercel.json`); deploys are manual via `npx vercel deploy --prod` | |
| Package manager | npm (`package-lock.json`) — but a `bun.lock` is also committed | |
| Tests | none (see below) | |
| Lint | none | |
| Analytics / logging / monitoring | none found in Phase 0 (`console.*` in app code: 1) | |
| Feature flags | none | |
| Env vars | `.env.example` documents: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `SMTP_URL`, `ALERT_FROM`, `CRON_SECRET`, `GEMINI_API_KEY`. Local secrets in `.env.local` and `.deploy.local` (git-ignored). | |

## Directory responsibilities

```
/                      App.tsx (3,302 lines — the whole app shell + data + handlers), index.tsx, index.html,
                       types.ts (867 — domain model, roles, permissions, ageing/rank rules), server.ts (dev server)
api/                   Vercel functions: health, ai-status, alert-status, daily-report, fetch-sheet, gemini-report,
                       live-stock, team. Each is a thin handler over api/_lib.
api/_lib/              Server-only modules (must not import browser code): supabase (service client, bearer
                       token, currentProfile), sheet (Google CSV fetch, 12s per-URL timeout), liveStock (price
                       stripping by role), team (create/update/delete logins), digest (daily email content),
                       reminders (who gets what), mailer (Resend/SMTP), report (Gemini prompt + call).
components/            One file per screen or dialog (30 files). Largest: CustomerDashboardView 1,729,
                       LiveStockView 1,418, ReportsView 1,331, PdcChequesView 1,135, FollowUpModal 1,124.
components/shell/      AppShell (app bar, tabs, phone tab bar, settings sheet, theme), NavIcons.
components/ui/         Primitives (Button, Badge, Card, Stat, AgeingBar, EmptyState…), format helpers,
                       PhoneAccountRow, BadDebtStrip, usePhone hook.
components/icons/      AppLogo, Icons.
services/              Browser-side data + domain services: repository (Supabase reads/writes), supabaseClient,
                       useSupabaseSync (hooks), googleSheetService (import/sync/reconcile), liveStock (parser,
                       polling hook, cache), messageTemplate.
styles/theme.css       The design system: tokens, palette remap of stock Tailwind names, dark theme, utilities.
supabase/schema.sql    Tables, triggers, RLS policies (idempotent `create if not exists`; no migration history).
scripts/               Puppeteer QA (smoke, audit, interact, tour, contrast, contrastfix), sign-in helper,
                       static checks (deadclasses, emptycontrols). All .cjs.
assets/                Two PNG logos. `logo.svg` and `metadata.json` at root appear unreferenced.
docs/product-audit/    This audit (new).
ARCHITECTURE.md        1,862-line engineering handbook written alongside the code. Detailed and mostly
                       current; §9.1–9.2 and the file map still describe a removed components/work/ Workspace.
README.md, SETUP.md, DEPLOYMENT.md   Run/setup/deploy guides (headings read; bodies not yet audited).
```

## Request / data flow (from `server.ts`, `App.tsx`, `services/`)

1. Browser signs in with Supabase Auth (anon key). `App.tsx` loads profiles, customers, cheques, templates, settings through `services/repository.ts`, scopes them by role (`scopeTo`, `seesWholeBook`) and keeps them in state; `useSupabaseSync` keeps collections in sync.
2. Balances come from the transactions Google Sheet: browser → `POST /api/fetch-sheet` (Admin/Manager session required) → server fetches CSV → browser parses and reconciles (`googleSheetService.ts`, `SyncReconciliationModal`) → writes back changed rows via the repository.
3. Live stock: browser → `GET /api/live-stock` (any session) → server fetches the stock sheet and blanks price columns unless Admin/Manager → browser parses, caches in localStorage, polls every 60s while visible.
4. Team logins: `POST /api/team` (Admin) → service-role client creates auth user + profile.
5. Daily email: Vercel cron → `POST /api/daily-report` (CRON_SECRET or Admin/Manager session) → `api/_lib/reminders.ts` → digest per recipient → mailer.
6. AI report: `POST /api/gemini-report` → Gemini with a prompt built server-side.

## Architectural observations (Phase 0 — not yet acted on)

- **One giant component.** `App.tsx` is the router, the store, every handler and three page renderers (`renderAdminOverviewCards`, `renderUserDashboard` ~300 lines, `renderCompanyDashboard`). Real risk for regressions; candidate for careful extraction later, not a rewrite.
- **Two servers, one route table.** Every API route exists twice: `api/<route>.ts` (Vercel) and `server.ts` (Express dev). Shared logic lives in `api/_lib`, so drift risk is limited to the thin handlers — but it is a duplication to keep an eye on (e.g. auth gating must match).
- **Schema without migrations.** `supabase/schema.sql` is a single idempotent script with `alter table … add column if not exists` blocks. Works for one deployment; there is no migration history or rollback path.
- **Sheets as the system of record for money.** Balances and ageing are imported, never edited in-app; the app owns follow-ups, cheques, ranks, ownership, notes. This split is deliberate (ARCHITECTURE.md §8) and must be preserved.
- **Two lockfiles.** `bun.lock` and `package-lock.json` both committed; scripts use npm.
- **No tests in the repo.** Working browser suites exist only in a scratchpad outside version control.
- **Documentation drift.** ARCHITECTURE.md is unusually good but §9.1–9.2 are stale (removed Workspace).
- **Leftovers.** `metadata.json` (Google AI Studio manifest), `logo.svg` (unreferenced), `.smoke-shots/` output dir. `scripts/contrastfix.cjs` and `tour.cjs` purposes to confirm.
- **Suppressions.** 61 occurrences of `any` / `as any` / `@ts-ignore` / `eslint-disable` in first-party code (count only).

## Platform assumptions (observed)

- Browser app used on laptops (1366×768 and up) and phones (390px class; phone layout via `max-md:` and `useIsPhone`). Tablet not specifically designed for.
- India-centric: `en-IN` number formatting, ₹ compact (L/Cr), IST cron time, WhatsApp as the messaging channel.
- Single company, single Supabase project, single Vercel project. No multi-tenancy.

## Proposed inspection order (by module, dependency-first)

1. Domain & data model: `types.ts`, `supabase/schema.sql`, `services/repository.ts`, `services/supabaseClient.ts`, `services/useSupabaseSync.ts`.
2. Server: `api/_lib/*`, `api/*.ts`, `server.ts`, `vercel.json`, env handling.
3. Imports: `services/googleSheetService.ts`, `SyncReconciliationModal.tsx`, `services/liveStock.ts`.
4. App shell & state: `App.tsx` (in sections), `components/shell/*`, `index.html`, `styles/theme.css`, `components/ui/*`.
5. Screens: CustomerDashboardView, FollowUpModal, CustomerActivityPanel, CustomerEditModal, ReportsView, CrmPerformanceTable, PdcChequesView, PdcModal, LiveStockView, AlertsView, AiReportModal, WhatsAppReminderModal, TemplateModal, UserModal, CompanyProfileView, LoginScreen, ChangePasswordModal, NotificationBanner, StatusBadge, BalanceAmount, icons.
6. Email & AI: `api/_lib/digest.ts`, `reminders.ts`, `mailer.ts`, `report.ts`.
7. Scripts, docs, config: `scripts/*`, README/SETUP/DEPLOYMENT/ARCHITECTURE, `package.json`, lockfiles, `.gitignore`.
