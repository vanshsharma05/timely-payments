# 13 — TECH DEBT

Status: Phase 0 list (evidence-backed; first-guess priorities).

| # | Item | Evidence | Prio | Confidence |
|---|---|---|---|---|
| T1 | `App.tsx` god component | 3,302 lines; 48 state slices; three page renderers inline | P1 | HIGH |
| T2 | Browser suites had no home in the repo (now `scripts/tests/`, no runner yet) | see 12-TEST-STRATEGY.md | P1 | HIGH |
| T3 | Two lockfiles (`bun.lock`, `package-lock.json`) | both tracked; scripts use npm | P2 | HIGH |
| T4 | No lint, no `engines` | package.json | P3 | HIGH |
| T5 | `ARCHITECTURE.md` §9.1–9.2 and file map describe removed `components/work/` | `git show 7232940` | P2 | HIGH |
| T6 | Every API route duplicated between `api/*.ts` and `server.ts` | server.ts lines 55–124 | P3 | HIGH |
| T7 | Dead animation classes (`animate-in`, `slide-in-from-*`, `fade-in`) — plugin not installed | grep; `check:classes` does not flag them | P3 | HIGH |
| T8 | Reports and older dialogs use remapped stock-Tailwind colour names instead of tokens | `styles/theme.css` "Palette remap" comment: "the original 13k lines were written against stock Tailwind" | P3 | HIGH |
| T9 | Schema without migration history | single `schema.sql` with `add column if not exists` blocks | P3 | HIGH |
| T10 | 61 `any`/suppressions | grep count | P3 | MEDIUM (not yet reviewed individually) |
| T11 | `metadata.json`, `logo.svg` unreferenced at root | grep found no references | P4 | MEDIUM |

Added in Phase 1 (2026-09-16):

| # | Item | Evidence | Prio | Confidence |
|---|---|---|---|---|
| T12 | Scoping rule duplicated between `types.ts` and `api/_lib/digest.ts` (D1) | 03 §9 | P2 | HIGH |
| T13 | Follow-up status stored and derived, three implementations (D2) | 03 §9 | P2 | HIGH |
| T14 | Notes mirrored into `customers.notes[]` from the activity table (D3) | 03 §9 | P2 | HIGH |
| T15 | Two "expected payment" notions (D4) — needs a business decision before code | 03 §9 | P3 | HIGH |
| T16 | Performance score computed twice (D5); roll-up netting three times (D6) | 03 §9 | P3 | HIGH |
| T17 | Official sheet URLs hard-coded and in `app_settings` (D7) | `App.tsx` 99–101 | P3 | HIGH |
| T18 | Dead: `customers.updated_by` column never written; `canEditFinancials` gates nothing | `repository.ts`, grep | P4 | HIGH |
| T19 | `outstandingData` (derived slice) kept in state alongside `appData` | `App.tsx` | P3 | HIGH |
| T20 | Seven boolean+target dialog state pairs in `App.tsx` | 09 §A.1 | P3 | HIGH |
| T21 | Two dashboards render the same tab components twice with near-identical props | 09 §A.4 | P3 | HIGH |
| T22 | No optimistic concurrency / version column on `customers` (R1) | `schema.sql`, `useSupabaseSync.ts` | P1 | HIGH |
