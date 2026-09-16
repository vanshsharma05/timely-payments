# 16 — CHANGELOG (audit)

Changes made under this audit, newest first. Feature work before the audit is in `git log`.

| Date | Batch | Files | Change | Validation |
|---|---|---|---|---|
| 2026-09-16 | Phase 1–2 | `docs/product-audit/03, 04, 06, 09, 11, 12, 13, 15, 18, 19, 00` | Product model, permission matrix, user types, App.tsx map, preliminary UX/security/reliability findings, test-safety classification. No application code changed. One read-only call to the Supabase management API to confirm `disable_signup`. | docs only |
| 2026-09-16 | Phase 0 | `docs/product-audit/*`, `scripts/tests/*` | Created the audit system, repository map, baseline, ledger; copied the nine browser suites into the repo verbatim. No application code changed. | typecheck / build / checks re-run for the baseline (recorded in 00-MASTER-STATUS.md) |
