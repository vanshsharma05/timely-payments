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
