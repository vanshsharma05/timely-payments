# 19 — OPEN QUESTIONS

| # | Question | Why it matters | Who answers | Status |
|---|---|---|---|---|
| Q1 | Is `bun.lock` used by anyone (any machine or CI installing with bun)? | Two lockfiles make the dependency tree ambiguous; removing one is safe only if unused. | Owner | open |
| Q2 | Are `scripts/tour.cjs` and `scripts/contrastfix.cjs` still used? | Removal candidates. | Owner | open |
| Q3 | Which browsers/devices must be supported? Observed: Chrome on Windows laptops (1366×768+), phones ~390px. Safari/iOS untested in this workspace. | Support matrix and testing scope. | Owner | open |
| Q4 | Is the Live stock Google Sheet's "anyone with the link" sharing acceptable now that prices are role-gated in the app? | The price-confidentiality boundary sits outside the app. | Boss | open (raised 2026-09-16) |
| Q5 | Should the customer book (the register) also hide bad-debt accounts by default, or only the worklists (current behaviour)? | Business-rule scope. | Boss | open |
| Q6 | Is there a staging Supabase project, or does every test run against production data? (Phase 0 finding: all QA scripts sign in to the production project; throwaway logins are created and deleted there.) | Test safety. | Owner | open |
