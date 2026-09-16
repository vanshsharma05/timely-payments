# 15 — DECISIONS

| # | Date | Decision | Why | Alternatives considered |
|---|---|---|---|---|
| D1 | 2026-09-16 | Audit work continues on the existing `restore-and-fix` branch with `main` fast-forwarded after each push, because the owner has asked that every finished update be pushed live. Larger refactor batches (e.g. splitting `App.tsx`) get their own short-lived branch and are merged only after the browser suites pass. | Owner's standing instruction; one contributor, no CI — a long-lived improvement branch would only diverge. | Dedicated `audit/*` branch for everything — rejected for now. |
| D2 | 2026-09-16 | Phase 0 makes no application code changes. The two production `npm audit` findings (nodemailer, qs) are P2 with non-breaking fixes and are scheduled for the first Phase 8/12 batch rather than done blind now. | Protocol: no code changes in Phase 0 unless P0. | Fix immediately — deferred one session. |
| D3 | 2026-09-16 | `/ARCHITECTURE.md` stays the engineering handbook; `docs/product-audit/` is the audit's own record and points at it rather than duplicating it. | Avoid two competing sources of truth. | Merge the two — rejected. |
| D4 | 2026-09-16 | No code changes in Phase 1–2; the P1 findings (SEC3 reset by Manager, R1 concurrent overwrite) are recorded for the security/reliability phases, not patched now. | Both need a design decision (Q8; a version column or realtime) and tests that need staging (Q6). Neither is a live exploit today (internal staff, sign-up disabled). | Hot-fix SEC3 by hiding the reset from Managers — deferred; wants the owner's answer to Q8 first. |
| D5 | 2026-09-16 | `bun.lock` stays until the tooling cleanup phase (owner's instruction). | | |
