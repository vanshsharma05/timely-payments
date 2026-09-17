# 06 — UX AUDIT

Status: **Phase 4 started 2026-09-17 with the CRM daily-workflow batch (below)**; the rest of the screens not yet redesigned. Findings collected while building the product model (Phase 1–2) and validated during the journey pass (Phase 3, 2026-09-17). Each is classified: **CONFIRMED BY CODE** · **CONFIRMED BY RUNNING UI** · **HYPOTHESIS** · **BUSINESS-DEPENDENT**. Nothing has been redesigned; prioritisation is preliminary until Phase 4 walks every screen.

| # | Finding | Evidence | Classification | Who | Prelim prio |
|---|---|---|---|---|---|
| U1 | **Two filter systems for one list.** The book: rank/category/CRM/status/ageing/balance/source; Reports: CRM/settlement/category chips/ageing bucket/search — same rows, different names for the same concepts, different bulk bars. | `CustomerDashboardView.tsx` filters vs `ReportsView.tsx:700–800` chips | CONFIRMED BY CODE (existence); its cost to users is a HYPOTHESIS | Manager, Admin | P2 |
| U2 | **"Status" means two things.** The book's Status dropdown and `StatusBadge` read the *stored* `item.status`; the Today cards and Reports chips read the date-derived category. | `CustomerDashboardView` status filter (`item.status !== statusFilter`), `StatusBadge`; *(prod: 17 rows whose stored status disagrees with their date today)* | CONFIRMED BY CODE + data | everyone | P2 |
| U3 | **Company Today cards navigate away** (to Reports with the filter), personal Today cards filter in place. | `renderAdminOverviewCards` (`setAdminTab('reports')`) vs `renderUserDashboard` | CONFIRMED BY CODE; observed in earlier browser suites (`baddebt-test.cjs`) | Manager/Admin | P2 |
| U4 | **Destructive actions guarded only by `window.confirm`**: delete customer (cascades cheques + thread), the reset, bulk follow-up date, master import. No undo, no summary of what will be lost. | `handleDeleteCustomer`, `handleResetAllDataAndUsers`, `ReportsView` bulk bar | CONFIRMED BY CODE | Admin/Manager | P1 |
| U5 | ~~**Stale data with no signal.**~~ **Largely resolved 2026-09-17 (reliability batch):** the book is re-read when the person returns to the tab (≥ 60 s since the last read), every 5 min while open, on reconnect, and on a Refresh button; the header says "Book refreshed 2 min ago"; unsaved local rows and open dialogs are never overwritten. A conflicting *same-field* save still silently wins (R1-B). | 11 Parts 1–2 | CONFIRMED BY CODE + captured payloads | everyone | P1 |
| U6 | **Two "expected payment" fields** (forecast on the row vs promise entries) counted under different headings on Today and in the email. | 03 §9 D4 | CONFIRMED BY CODE | CRM, Manager | P2 |
| U7 | **Save stamps a follow-up even when nothing about the follow-up changed.** | `FollowUpModal.tsx:248` | CONFIRMED BY CODE; whether it should is BUSINESS-DEPENDENT (Q11) | Manager | P3 |
| U8 | **`notes[]` and the activity thread drift**: deleting an entry leaves its mirrored line, which is what the Today row, Reports "Last note", the email and the AI report show. | `FollowUpModal.handleActivityLogged`; `CustomerActivityPanel` never touches `notes` | CONFIRMED BY CODE | everyone | P2 |
| U9 | **Legacy vocabulary**: "Pending" (= no date), "Customer Ledger", "Sheet Synced", "Dr (Due)/Cr (Advance)", "Instant Report of >90d", "Timely Follow-up Score" vs "Timely Score". | strings in the book/Reports | CONFIRMED BY CODE | new users | P3 |
| U10 | **Eight dialogs, no shared Dialog primitive**; the stock drawer and compare panel use yet another chrome. | `components/*Modal.tsx`; `Primitives.tsx` has no Modal | CONFIRMED BY CODE | everyone | P3 |
| U11 | **No guidance for a new CRM whose code matches nothing**: zeros and "Nothing here". | `renderUserDashboard` empty state; seen with the throwaway CRM login (12) | CONFIRMED BY RUNNING UI (earlier session, documented) | new users, Admin | P2 |
| U12 | **Reports keeps stock-Tailwind colour classes** remapped through the theme — a different visual dialect. | `ReportsView.tsx`; `styles/theme.css` "Palette remap" | CONFIRMED BY CODE | Manager | P2 |
| U13 | **Company Today never shows an account list**; every card is a jump. | `renderAdminOverviewCards` (`App.tsx:1750–1948`) | CONFIRMED BY CODE | Manager on phone | P3 |
| U14 | **Data source tab mixes sync (routine), master import (one-time) and reset (catastrophic)** on one screen; the reset is one click + OK below the sync controls. | `App.tsx:2940–2956` | CONFIRMED BY CODE | Admin/Manager | P2 |
| U15 | **The CRM code join key is invisible**; a wrong code gives an empty book with no warning; nothing validates it against the accounts on file. | `UserModal.tsx`, `findOwner`, `DEPLOYMENT.md` | CONFIRMED BY CODE | Admin | P2 |
| U16 | **Cr (advance) accounts show as "with dues".** | `hasOutstanding`; *(prod: 34 accounts, ₹1.77 L)* | CONFIRMED BY CODE; BUSINESS-DEPENDENT (Q7) | Manager | P3 |
| U17 | **The edit dialog's disabled money fields are still rewritten on Save** — recomputed roll-ups and flattened Dr/Cr types — and the collector is dropped. The user sees greyed-out fields and a plain "Save". | 11 §1.4 (captured PATCH bodies) | CONFIRMED BY RUNNING UI | anyone editing a customer | **P1** (C1) |
| U18 | **A failed save looks saved.** The banner says "Could not save customers", but the row on screen keeps the change and it is retried only on the next unrelated change. | `useSupabaseSync.ts:84–91`; seen in the probe (a later save re-sent the earlier row) | CONFIRMED BY RUNNING UI | everyone | P2 |
| U19 | **Contacts are editable in two dialogs with different semantics**: the follow-up sheet (spreads the row) and the edit dialog (rebuilds it, C1). | `FollowUpModal.handleSave` vs `CustomerEditModal.handleSave` | CONFIRMED BY CODE | CRM, Manager | P2 |
| U20 | **Four different password minimums**: dialog 6, server 6, repository 8, Supabase 8 — the message depends on where it fails. | `UserModal.tsx:126–131`, `api/_lib/team.ts:76–81`, `repository.ts:432–440`, auth config | CONFIRMED BY CODE + config | Admin | P3 |
| U21 | **Sending a WhatsApp reminder leaves no trace** — no activity entry, no "last contact". | `WhatsAppReminderModal.tsx` writes nothing | CONFIRMED BY CODE; whether it should is a HYPOTHESIS about the team's expectations | CRM, Manager | P3 |
| U22 | **Bulk grading writes no per-account record**, unlike a single rank change (which writes a `system` line) and the bulk date tool. | `handleBulkSetRank` (`App.tsx:853–866`) | CONFIRMED BY CODE | Manager | P3 |
| U24 | **A plain Save on a collected account reopens it.** The follow-up dialog opens with outcome *follow-up* and the collection date pre-filled, so fixing a phone number on a collected account (Save without touching the outcome) turns it back into an open follow-up dated the day it was collected — Overdue by tomorrow. Pinned in `tests/statusContract.dom.test.tsx` E; not changed. | `FollowUpModal.tsx` (`outcome` default, `handleSave` `case 'follow_up'`) | CONFIRMED BY CODE | CRM, Collector | P2 |
| U23 | **A handoff is silent**: the collector/new owner is not told, and nothing in the thread says who handed the account over or when. | J8 in 05 | CONFIRMED BY CODE | Collector, CRM | P3 |

Dropped / rewritten this session: none dropped. U4 and U5 were widened from "hypothesis" to confirmed by the probe; U7 and U16 marked business-dependent.


## Phase 4, batch 1 — the CRM daily workflow (2026-09-17, committed locally, not deployed)

Scope: customer book · finding an account · who needs attention · opening an account · logging a follow-up · promise/payment · WhatsApp · moving to the next account. Nothing else touched; no business rule, permission, schema or backend change; the existing primitives (`Primitives.tsx` tokens, `Badge`, `Button`, `EmptyState`) reused.

**What was confusing, found by looking at the live UI at 1366×768 and reading the code:**

| # | Problem | Where |
|---|---|---|
| W1 | The follow-up dialog was one long scroll with the thing a call ends with — the outcome and the next date — a screen and a half down, under the contacts directory, a full WhatsApp recipient picker (a second copy of the WhatsApp dialog), the cheque list and a hint box explaining where notes go. Rank, category, owner and collector (rare changes) sat at the bottom beside the Urgent tick. | `FollowUpModal.tsx` |
| W2 | The dialog header said only the owner and the (often garbage, `#REF!`) email — not where the follow-up stands, when it was last worked, or what is expected. | `FollowUpModal.tsx` header |
| W3 | Working a list meant close → find → open for every account; nothing stepped to the next one. | `App.tsx` |
| W4 | Only the follow-up dialog had no Esc; none of the four workflow dialogs closed on Esc. | dialogs |
| W5 | The book's toolbar repeated the subtitle ("642 of 4027 Accounts", "Till: 13-Sep") and the app bar ("Sync balances"); seven money tiles sat above the list for everyone, a manager's glance in a CRM's way. | `CustomerDashboardView.tsx` toolbar |
| W6 | Rows were ~100–120 px, set by a contact line that wrapped differently on every row and a 2×2 grid of ageing figures; ~4.7 rows fitted a laptop screen. | book rows |
| W7 | The follow-up column said "Upcoming · 18 Sept 26"; a person wants "tomorrow", "in 4d", "3d overdue". | book rows |
| W8 | A red delete button on every row, next to Follow Up; "Customer Ledger" wording; "Follow Up" reachable only at the far right of the row. | book rows |
| W9 | The empty state offered no way back from a dead-end filter combination. | book |

**What changed:**

- **Follow-up dialog** — header now: derived status badge · "Next 18 Sept · ₹1,00,000 expected" · "Last follow-up 16 days ago" · owner · Edit details, and, when opened from a list, "‹ 3 / 61 ›". Left column order: balance summary → **This follow-up** (What next? *Follow up again / Payment collected / No follow-up needed* · next date · amount expected · presets · Urgent) → folded **Contacts** (summary: "2 people · Ramesh · 98…") → folded **WhatsApp reminder** ("to Ramesh · 98…") → folded **Cheques** ("none in hand", with "+ Add cheque" reachable without opening) → folded **Account settings** ("Late pay · Screen Printing · Vishnu · Munshi Ram"). The hint box and the green "Cash flow forecast" banner are gone; the footer says **Save follow-up**. Esc closes; Alt+←/→ steps through the list. New primitive `components/ui/Disclosure.tsx`.
- **Next account** — `handleOpenFollowUp` remembers the list the account came from (the book's rows in their current order via `onVisibleRowsChange`, or the Today list); the dialog steps through it without closing.
- **Esc everywhere** — `components/ui/useEscape.ts` in the edit, cheque and WhatsApp dialogs (not while a save is in flight).
- **Book toolbar** — the chips and the second Sync button are gone; a "Book overview" toggle folds the seven tiles (open by default for Manager/Admin, folded for CRM/Collector, remembered per device) and shows "₹6.7 L receivable · 642 accounts" while folded.
- **Book rows** — the name opens the account; two fixed lines under it (rank · category · terms, then city · person · phone; designation in the tooltip); ageing figures on one compact line with full rupees on hover; follow-up column says *Tomorrow · 18 Sept*, *in 4d · 21 Sept*, *3d overdue · 16 Sept*, *No date*; delete appears only on hover/focus (same permission); "Follow up". Rows are ~92 px and uniform; every column fits a 1366 px laptop without the sticky Actions column clipping the owner. "Customer Ledger (N accounts)" → "N accounts".
- **Empty state** — "Clear search and filters".

**Not changed, needing the owner's opinion:** the dialog's default outcome is still *Follow up again* with the current date pre-filled, so a plain Save on a collected account reopens it (U24); two search boxes (app bar Ctrl+K and the book's own) still coexist; the WhatsApp dialog and the dialog's WhatsApp section are still two copies; sending a WhatsApp still leaves no trace (U21).
