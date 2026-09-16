# 03 — PRODUCT MODEL

Status: NOT STARTED — Phase 1. To be built from `types.ts`, `supabase/schema.sql`, `App.tsx` handlers and `ARCHITECTURE.md` §4–§8.

Structure to fill:
- Core problem and jobs-to-be-done
- Entities (profiles, customers/Outstanding, pdc_cheques, customer_activity, templates, company_profile, app_settings, alert_settings, alert_log) and relationships
- Permissions matrix (roles × actions) — confirmed from code
- Business rules (Dr/Cr, ageing buckets, follow-up category, payment rank incl. "Bad is declared", bad debt out of the worklist, cheque states, promise states, urgency)
- Workflows, entry/exit points, integrations
- Destructive / irreversible actions (deletes, bulk rank, bulk reassign, bulk follow-up date, sync write-back)
- Failure states

Rule: separate CONFIRMED (read in code) from ASSUMED (inferred) from PROPOSED (our idea).
