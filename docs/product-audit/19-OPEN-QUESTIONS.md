# 19 — OPEN QUESTIONS

| # | Question | Why it matters | Who answers | Status |
|---|---|---|---|---|
| Q1 | Is `bun.lock` used by anyone (any machine or CI installing with bun)? | Two lockfiles make the dependency tree ambiguous; removing one is safe only if unused. | Owner | open |
| Q2 | Are `scripts/tour.cjs` and `scripts/contrastfix.cjs` still used? | Removal candidates. | Owner | open |
| Q3 | Which browsers/devices must be supported? Observed: Chrome on Windows laptops (1366×768+), phones ~390px. Safari/iOS untested in this workspace. | Support matrix and testing scope. | Owner | open |
| Q4 | Is the Live stock Google Sheet's "anyone with the link" sharing acceptable now that prices are role-gated in the app? | The price-confidentiality boundary sits outside the app. | Boss | open (raised 2026-09-16) |
| Q5 | Should the customer book (the register) also hide bad-debt accounts by default, or only the worklists (current behaviour)? | Business-rule scope. | Boss | open |
| Q6 | Is there a staging Supabase project, or does every test run against production data? (Phase 0 finding: all QA scripts sign in to the production project; throwaway logins are created and deleted there.) | Test safety. | Owner | open |
| Q7 | Should a `Cr` (advance) account count as "with dues" in CRM workload and the Receivables tile? Today `hasOutstanding` counts it; `overdueAgeing` says nothing is overdue. | Affects every count a Manager reads. | Boss | open |
| Q8 | Who may run "COMPLETE FRESH START"? Code: Admin or Manager, one confirm. Proposal: Admin only, typed confirmation, and a backup step first. | Data loss (SEC3). | Boss / Admin | open |
| Q9 | Is sending customer names, amounts and last notes to Google Gemini for the AI report acceptable? | Third-party data sharing (SEC5). | Boss | open |
| Q10 | Does anyone need to edit money columns in the app (`canEditFinancials`)? No screen does; the sheet is the source. Proposal: retire the right. | Simplifies the matrix. | Boss | open |
| Q11 | Should "Save" on the follow-up form count as a follow-up (`lastFollowUpOn`) when only contact details changed? | CRM table "unattended" accuracy (U7). | Manager | open |
| Q12 | Is anyone using a Viewer login? None of the 17 profiles seen earlier appeared to be one. | Whether to keep designing for the role. | Admin | open |
| Q13 | Are the urgency thresholds (₹10 L past 45 days / ₹5 L past 135 days) the business's numbers? | They flag accounts on import (M6). | Boss | open |
