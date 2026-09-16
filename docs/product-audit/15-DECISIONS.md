# 15 — DECISIONS

| # | Date | Decision | Why | Alternatives considered |
|---|---|---|---|---|
| D1 | 2026-09-16 | Audit work continues on the existing `restore-and-fix` branch with `main` fast-forwarded after each push, because the owner has asked that every finished update be pushed live. Larger refactor batches (e.g. splitting `App.tsx`) get their own short-lived branch and are merged only after the browser suites pass. | Owner's standing instruction; one contributor, no CI — a long-lived improvement branch would only diverge. | Dedicated `audit/*` branch for everything — rejected for now. |
| D2 | 2026-09-16 | Phase 0 makes no application code changes. The two production `npm audit` findings (nodemailer, qs) are P2 with non-breaking fixes and are scheduled for the first Phase 8/12 batch rather than done blind now. | Protocol: no code changes in Phase 0 unless P0. | Fix immediately — deferred one session. |
| D3 | 2026-09-16 | `/ARCHITECTURE.md` stays the engineering handbook; `docs/product-audit/` is the audit's own record and points at it rather than duplicating it. | Avoid two competing sources of truth. | Merge the two — rejected. |
