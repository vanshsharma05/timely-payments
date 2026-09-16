# 18 — FILE AUDIT LEDGER

Proof of coverage. A file counts as **Reviewed** only when its logic has been read and understood at audit depth (Phase 8), not when it was touched during feature work. Phase 0 filled `Purpose` and `Lines` only.

Scope: 84 first-party files (every tracked file except the two lockfiles). Excluded as third-party/generated: `node_modules/`, `dist/`, `.vercel/`, `.smoke-shots/`, `package-lock.json`, `bun.lock` (lockfiles are reviewed as a pair under 13-TECH-DEBT.md, not line by line).

Columns: Arch = architecture · Logic · Err = error handling · Sec = security · Perf = performance · UX = UX relevance · A11y = accessibility relevance · Tests = test coverage. Each is `–` until reviewed, then `ok` / `issue` / `n/a`.

| Path | Lines | Purpose | Reviewed | Arch | Logic | Err | Sec | Perf | UX | A11y | Tests | Issues found | Changes required | Changes done | Validation |
|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `.env.example` | 25 | Documents every environment variable and which side (browser/server) reads it. | No | – | – | – | – | – | – | – | – | | | | |
| `.gitignore` | 30 | Ignores node_modules, dist, env files, smoke shots, .deploy.local, .vercel. | No | – | – | – | – | – | – | – | – | | | | |
| `ARCHITECTURE.md` | 1862 | Engineering handbook (1,862 lines): data model, security, domain rules, data flow, screens, API, email, design system. §9.1–9.2 stale. | No | – | – | – | – | – | – | – | – | | | | |
| `App.tsx` | 3302 | The whole app: hash routing, session restore, data loading/scoping, ~48 state slices, every handler, Today/Reports/book/stock page renderers. | Partial | issue | ok | ok | issue | – | issue | – | none | Handlers, state, sync wiring, rights, reset read (09 §A); page renderers not reviewed line by line; SEC3 | | | |
| `DEPLOYMENT.md` | 217 | Phase-1 deployment guide: Supabase project, tables, first login, keys, Vercel, cron. | Partial | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | "falls back to a plain sign-up" is stale — no signUp in code | | | |
| `README.md` | 113 | Run locally, roles, daily email, sign-in, checks, deploy. | No | – | – | – | – | – | – | – | – | | | | |
| `SETUP.md` | 161 | From-scratch setup for a non-technical owner (accounts, tokens, hand-off). | No | – | – | – | – | – | – | – | – | | | | |
| `api/_lib/digest.ts` | 610 | Builds the per-recipient daily digest (due/overdue/promises/cheques/bad debt) and renders HTML + text. | Partial | issue | ok | – | ok | – | n/a | n/a | none | Scoping duplicated from types.ts (D1); bad-debt line; rest read in earlier feature work | | | |
| `api/_lib/liveStock.ts` | 63 | Reads the stock sheet server-side; blanks rate/value columns unless Admin/Manager. | No | – | – | – | – | – | – | – | – | | | | |
| `api/_lib/mailer.ts` | 100 | Sends mail via Resend or SMTP; reports which provider is configured. | No | – | – | – | – | – | – | – | – | | | | |
| `api/_lib/reminders.ts` | 151 | Runs the daily reminder: recipients, digests, send, alert_log. | Partial | ok | ok | ok | ok | – | n/a | n/a | none | Run flow, settings, alert_log | | | |
| `api/_lib/report.ts` | 213 | Gemini prompt construction and call for the AI credit report. | Partial | – | – | – | issue | – | n/a | n/a | none | SEC5: names/notes to Gemini; model gemini-3.7-flash | | | |
| `api/_lib/sheet.ts` | 130 | Fetches a Google Sheet as CSV (gviz then export URL), 12s per-URL timeout. | No | – | – | – | – | – | – | – | – | | | | |
| `api/_lib/supabase.ts` | 79 | Service-role client, bearer token parsing, currentProfile(token), isBackendConfigured. | No | – | – | – | – | – | – | – | – | | | | |
| `api/_lib/team.ts` | 223 | Create/update/delete teammate logins (auth user + profile) as an Admin. | Partial | – | ok | – | ok | – | n/a | n/a | none | Admin gate and create path read | | | |
| `api/ai-status.ts` | 6 | Reports whether GEMINI_API_KEY is configured. | Full | ok | ok | ok | ok | ok | n/a | n/a | none | Unauthenticated; harmless | | | |
| `api/alert-status.ts` | 18 | Reports mail provider configuration for Alerts & reminders. | Full | ok | ok | ok | ok | ok | n/a | n/a | none |  | | | |
| `api/daily-report.ts` | 41 | Cron/Admin entry point for the daily reminder email. | No | – | – | – | – | – | – | – | – | | | | |
| `api/fetch-sheet.ts` | 44 | Google Sheet CSV proxy; Admin/Manager session required. | No | – | – | – | – | – | – | – | – | | | | |
| `api/gemini-report.ts` | 34 | AI credit report endpoint. | Partial | – | – | – | ok | – | n/a | n/a | none | Session-gated only | | | |
| `api/health.ts` | 5 | Liveness endpoint. | No | – | – | – | – | – | – | – | – | | | | |
| `api/live-stock.ts` | 25 | Stock sheet for the Live stock tab, priced by role; any session. | No | – | – | – | – | – | – | – | – | | | | |
| `api/team.ts` | 28 | Team management endpoint (POST only). | Full | ok | ok | ok | ok | ok | n/a | n/a | none |  | | | |
| `assets/shori-lockup.png` | 240 | Logo lockup (binary asset). | No | – | – | – | – | – | – | – | – | | | | |
| `assets/shori-mark.png` | 97 | Logo mark (binary asset). | No | – | – | – | – | – | – | – | – | | | | |
| `components/AiReportModal.tsx` | 573 | AI credit report dialog: options, call, markdown render. | No | – | – | – | – | – | – | – | – | | | | |
| `components/AlertsView.tsx` | 325 | Alerts & reminders settings and “send me a test”. | No | – | – | – | – | – | – | – | – | | | | |
| `components/BalanceAmount.tsx` | 74 | Balance display with Dr/Cr semantics. | No | – | – | – | – | – | – | – | – | | | | |
| `components/ChangePasswordModal.tsx` | 126 | Change own password. | No | – | – | – | – | – | – | – | – | | | | |
| `components/CompanyProfileView.tsx` | 205 | Company profile settings form. | No | – | – | – | – | – | – | – | – | | | | |
| `components/CrmPerformanceTable.tsx` | 180 | Per-CRM workload/score table (+ phone cards). | No | – | – | – | – | – | – | – | – | | | | |
| `components/CustomerActivityPanel.tsx` | 462 | The shared activity thread on an account (notes, promises, system entries). | Partial | – | ok | – | ok | – | – | – | none | Entry kinds, promise resolution (skimmed) | | | |
| `components/CustomerDashboardView.tsx` | 1729 | Customer book: filters (one counting rule), tiles, table/phone rows, bulk actions, export. | No | – | – | – | – | – | – | – | – | | | | |
| `components/CustomerEditModal.tsx` | 706 | Create/edit a customer (owner required, rank, contacts). | No | – | – | – | – | – | – | – | – | | | | |
| `components/FollowUpModal.tsx` | 1124 | Record a follow-up: outcome, next date, expected amount (>90d preset), rank, owner/collector. | Partial | – | ok | – | ok | – | issue | – | none | Save path and rights read: U7 stamps lastFollowUpOn on any Save; D3 notes mirror | | | |
| `components/LiveStockView.tsx` | 1418 | Live stock tab: folded overview, filters, list, compare mode/bar/panel, item drawer, export. | No | – | – | – | – | – | – | – | – | | | | |
| `components/LoginScreen.tsx` | 535 | Sign-in screen. | No | – | – | – | – | – | – | – | – | | | | |
| `components/NotificationBanner.tsx` | 77 | Attention banner (urgent/overdue counts). | No | – | – | – | – | – | – | – | – | | | | |
| `components/PdcChequesView.tsx` | 1135 | PDC cheque register: tiles, filters, table/phone rows, bulk status. | No | – | – | – | – | – | – | – | – | | | | |
| `components/PdcModal.tsx` | 388 | Add/edit a cheque. | No | – | – | – | – | – | – | – | – | | | | |
| `components/ReportsView.tsx` | 1331 | Reports: CRM scope, category chips (incl. Bad debt), ageing boxes, table, bulk tools, AI report, export. | No | – | – | – | – | – | – | – | – | | | | |
| `components/StatusBadge.tsx` | 26 | Follow-up status pill. | No | – | – | – | – | – | – | – | – | | | | |
| `components/SyncReconciliationModal.tsx` | 338 | Preview of a balance sync before it is applied. | Partial | – | ok | – | n/a | – | – | – | none | Confirms via mergeWithExistingFollowUps; analysis not reviewed | | | |
| `components/TemplateModal.tsx` | 146 | WhatsApp message template editor. | No | – | – | – | – | – | – | – | – | | | | |
| `components/UserModal.tsx` | 516 | Create/edit a teammate login and permissions. | No | – | – | – | – | – | – | – | – | | | | |
| `components/WhatsAppReminderModal.tsx` | 257 | Pick recipient + template, open WhatsApp link. | No | – | – | – | – | – | – | – | – | | | | |
| `components/icons/AppLogo.tsx` | 115 | Logo component. | No | – | – | – | – | – | – | – | – | | | | |
| `components/icons/Icons.tsx` | 188 | Icon set. | No | – | – | – | – | – | – | – | – | | | | |
| `components/shell/AppShell.tsx` | 745 | App bar, tabs, phone bottom bar, settings sheet, theme toggle, user menu. | No | – | – | – | – | – | – | – | – | | | | |
| `components/shell/NavIcons.tsx` | 145 | Navigation icons. | No | – | – | – | – | – | – | – | – | | | | |
| `components/ui/BadDebtStrip.tsx` | 48 | The recovery-list strip under the worklist cards. | No | – | – | – | – | – | – | – | – | | | | |
| `components/ui/PhoneAccountRow.tsx` | 139 | One account as a phone row. | No | – | – | – | – | – | – | – | – | | | | |
| `components/ui/Primitives.tsx` | 353 | Button, Badge, Card, SectionHeader, Money, AgeingBar/Legend, Stat, EmptyState, skeletons, Spinner. | No | – | – | – | – | – | – | – | – | | | | |
| `components/ui/format.ts` | 109 | INR/compact/date formatting, local ISO dates. | No | – | – | – | – | – | – | – | – | | | | |
| `components/ui/usePhone.ts` | 25 | useIsPhone() media-query hook. | No | – | – | – | – | – | – | – | – | | | | |
| `index.html` | 34 | Shell: fonts, theme stamp before first paint, viewport-fit. | No | – | – | – | – | – | – | – | – | | | | |
| `index.tsx` | 16 | React root in StrictMode. | No | – | – | – | – | – | – | – | – | | | | |
| `logo.svg` | 46 | Root SVG logo — no references found (removal candidate). | No | – | – | – | – | – | – | – | – | | | | |
| `metadata.json` | 8 | Google AI Studio manifest — no references found (removal candidate). | No | – | – | – | – | – | – | – | – | | | | |
| `package.json` | 46 | Scripts and dependencies. | No | – | – | – | – | – | – | – | – | | | | |
| `scripts/audit.cjs` | 272 | Whole-app UI/UX puppeteer audit (light/dark). | No | – | – | – | – | – | – | – | – | | | | |
| `scripts/contrast.cjs` | 67 | Contrast check over screenshots/palette. | No | – | – | – | – | – | – | – | – | | | | |
| `scripts/contrastfix.cjs` | 69 | Computes darker replacements for palette entries failing WCAG AA. | No | – | – | – | – | – | – | – | – | | | | |
| `scripts/deadclasses.cjs` | 82 | Finds Tailwind classes that produce no CSS. | No | – | – | – | – | – | – | – | – | | | | |
| `scripts/emptycontrols.cjs` | 58 | Finds controls with empty visible content. | No | – | – | – | – | – | – | – | – | | | | |
| `scripts/interact.cjs` | 181 | Functional click-through sweep. | No | – | – | – | – | – | – | – | – | | | | |
| `scripts/signin.cjs` | 56 | Shared puppeteer sign-in (creds from env or .deploy.local). | No | – | – | – | – | – | – | – | – | | | | |
| `scripts/smoke.cjs` | 80 | Screenshot smoke run. | No | – | – | – | – | – | – | – | – | | | | |
| `scripts/tour.cjs` | 76 | Screen tour (purpose to confirm). | No | – | – | – | – | – | – | – | – | | | | |
| `server.ts` | 164 | Express dev/prod server mirroring api/*.ts; Vite middleware in dev, dist/ in prod. | No | – | – | – | – | – | – | – | – | | | | |
| `services/googleSheetService.ts` | 874 | Sheet CSV parsing, header mapping, balance sync, customer master import, reconciliation, netRollUp. | Partial | ok | ok | ok | n/a | ok | n/a | n/a | none | Import/merge/settle read (M1, M2, M6, M7); master import and Excel mapping only skimmed | | | |
| `services/liveStock.ts` | 405 | Stock CSV parser, availability/critical rules, cache, 60s polling hook. | No | – | – | – | – | – | – | – | – | | | | |
| `services/messageTemplate.ts` | 139 | Template rendering for WhatsApp messages. | Partial | – | ok | – | n/a | – | – | – | none | Placeholders and roll-up copy (D6) | | | |
| `services/repository.ts` | 770 | Supabase data access: loads, writes, activity, auth headers. | Full | ok | ok | ok | ok | ok | n/a | n/a | none | Whole-row `updateCustomers` (R1); paged reads; ~20 `any` in mappers by design | | | |
| `services/supabaseClient.ts` | 38 | Anon Supabase client, isSupabaseConfigured. | No | – | – | – | – | – | – | – | – | | | | |
| `services/useSupabaseSync.ts` | 137 | useCollectionSync / useValueSync hooks. | Full | issue | ok | issue | n/a | ok | n/a | n/a | none | R1 last-writer-wins, R2 retry-on-next-change, R3 delete-by-diff | | | |
| `styles/theme.css` | 413 | Design tokens, palette remap, dark theme, motion, native control theming. | No | – | – | – | – | – | – | – | – | | | | |
| `supabase/schema.sql` | 492 | Tables, triggers, RLS policies for profiles, customers, pdc_cheques, templates, company_profile, app_settings, alert_settings, alert_log, customer_activity. | Full | issue | ok | n/a | issue | ok | n/a | n/a | none | SEC1 read-all policies; SEC2 role-only update; SEC4 trigger trusts metadata; no migrations; `updated_by` unused | | | |
| `tsconfig.json` | 20 | Strict TS, bundler resolution, includes api and scripts. | No | – | – | – | – | – | – | – | – | | | | |
| `types-assets.d.ts` | 13 | Module declarations for image imports. | No | – | – | – | – | – | – | – | – | | | | |
| `types.ts` | 867 | Domain model: roles, permissions, Outstanding, cheques, ageing/rank rules, scoping, search. | Full | ok | ok | n/a | ok | ok | n/a | n/a | none | Money rules M3–M5, M8, M9; scoping; no tests | | | |
| `vercel.json` | 15 | Build, rewrites, function duration, cron. | No | – | – | – | – | – | – | – | – | | | | |
| `vite-env.d.ts` | 15 | Vite env typing (GEMINI deliberately absent). | No | – | – | – | – | – | – | – | – | | | | |
| `vite.config.ts` | 22 | React + Tailwind plugins, manual vendor chunks. | No | – | – | – | – | – | – | – | – | | | | |

## Coverage

- Reviewed at audit depth (Full): **7 / 84**; Partial (read for a workflow, not line by line): **12 / 84** — Phase 1–2, 2026-09-16.
- `Reviewed` values: Full = read and understood at audit depth · Partial = the parts needed for a workflow · No = not yet.
- Total first-party lines (excluding binaries): see `Lines` column; 26,489 lines in total (incl. docs); the ten largest source files hold ~13,800.
