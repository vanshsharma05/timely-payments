# 14 — REMOVAL CANDIDATES

Status: Phase 0 candidates only. Nothing removed. Each needs the reference search listed before removal (imports, dynamic imports, strings, config, routes, tests, build scripts, docs).

| Candidate | Evidence so far | References searched | Risk | Plan | Validation | Status |
|---|---|---|---|---|---|---|
| `metadata.json` (root) | Google AI Studio manifest; no reference in ts/tsx/html/json/md | grep across repo (excl. node_modules) — none | none | delete | build + smoke | candidate |
| `logo.svg` (root) | no reference; the PNG logos in `assets/` are the ones imported | grep — none in source; still check Vercel project settings | low | delete | build + smoke | candidate |
| `bun.lock` | npm is the package manager used by every script and doc | package.json, README, DEPLOYMENT | low | delete, add `engines` | `npm ci` clean install + build | candidate (Q1) |
| `animate-in slide-in-from-right-4 fade-in duration-150` (LiveStockView drawer), `animate-in slide-in-from-bottom-4 fade-in` (AppShell sheet) | classes from `tailwindcss-animate`, which is not installed → no effect | grep in components | none | replace with `animate-reveal` or drop | visual check light/dark | candidate |
| `scripts/tour.cjs`, `scripts/contrastfix.cjs` | purpose/last use unknown; no npm script | package.json | low | confirm with owner or keep | — | needs evidence (Q2) |
