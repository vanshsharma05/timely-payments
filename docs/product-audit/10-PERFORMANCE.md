# 10 — PERFORMANCE

Status: NOT STARTED — Phase 10.

MEASURED (build output, 2026-09-16):
- Main chunk 724.6 kB minified / 177.8 kB gzip (over the 700 kB warning limit).
- `sheets` chunk (xlsx) 492 kB / 160.7 kB gzip — loaded for everyone; exports are Admin/Manager-only and the import is Admin-only. Candidate for a dynamic import.
- `markdown` chunk 125.8 kB / 38.9 kB gzip — used only by the AI report dialog. Candidate for a dynamic import.
- CSS 153 kB / 22 kB gzip.

LIKELY (from code shape, unmeasured): the whole book (~4,000 rows) is held in `App.tsx` state and filtered with `useMemo` on every keystroke of search; lists are windowed (book 60 / phone 50, stock 60) so DOM size is bounded. Sheet reads go through a server proxy with a 12 s per-URL timeout; Google was observed answering in up to 27 s on 2026-09-16.
