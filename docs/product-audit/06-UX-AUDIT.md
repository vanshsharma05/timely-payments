# 06 — UX AUDIT

Status: NOT STARTED — Phase 4. Findings from recent feature work that are already known (not yet audited systematically):
- Reports and the customer book use two visual dialects: Reports keeps older stock-Tailwind gray/blue/emerald classes remapped through `styles/theme.css`; the book and newer screens use the token classes. Consistency pass candidate (Phase 18).
- Filters are duplicated across the book and Reports with different option sets (book: rank/category/CRM/status/ageing/balance/source; Reports: CRM/category chips/ageing bucket/settlement).
