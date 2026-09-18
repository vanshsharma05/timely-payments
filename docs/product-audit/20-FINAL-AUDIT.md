# 20 — FINAL AUDIT

Status: **DONE 2026-09-18 (twenty-eighth session)** — the adversarial pass after every other phase. Production at the end of it: `dpl_C1QZzvDcF2W6aEHNbhZHkUywHKC1` = commit `8e1a69c`.

## 1. Method

Everything below was run against the live site as the Admin account with every mutating request intercepted at the network layer — aborted, answered with a played failure (401, a dropped connection, a 500 on the first read), or answered with a fake success so the app believed a save went through and did not retry. Nothing reached the database from the QA account at any point; the read-only counts at the end are the same as before the pass. Fresh Start was opened, its safeguards pushed, and never executed. Other roles cannot be signed in as, so their screens were pinned with DOM tests against fixtures (`tests/roles.dom.test.tsx`) and their rights read from the live RLS policies.

Scratchpad scripts (not in the repo): `fq-double-save.cjs`, `fq-failures.cjs`, `fq-inputs.cjs` / `fq-inputs2.cjs`, `fq-misc.cjs`, `nav-session-qa.cjs`, `session-check.cjs`, `relogin-check.cjs`; plus the standing suite (`prod-smoke.cjs`, the four workflow QA scripts, `scripts/tests/a11y-sweep.cjs`, the two probes).

## 2. What was tried, and what happened

| Area | Tried | Result |
|---|---|---|
| Sign in / out / restore | sign in; real reload; sign out; reload; sign in again; unknown hash; every `#tab` by hand; tab clicks vs history | All correct. Sign out shows the login screen at once (T65 fixed earlier today). No history entries stacked. |
| Session expiry | every save answered 401 "JWT expired" | Refused in the dialog with the reason, kept in the tab, retried, *Retry now* offered; once the server accepts, "All changes saved". Nothing tells the person to sign in again → **T66**. |
| Offline | connection dropped mid-save, then restored | "Not saved: no connection to the server"; coming back online retried on its own and saved. |
| Refresh while stale | *Refresh* pressed with an unsaved change | The local change kept, still reported unsaved. |
| Failed first load | customers read answered 500 | "Could not load data…" banner, the skeleton stays; the only way on is a page reload → **T67**. |
| Double saves | follow-up Save ×3 in a burst and Save+Save 150 ms apart; cheque status ×3; Record cheque ×3; Add customer ×3 | **One write each**, one id each. |
| Permissions (server) | every RLS policy and helper read; anon key GET on every table; anon PATCH | RLS on every table; anon reads 0 rows; anon PATCH touches nothing; Viewer cannot write; delete is Admin/Manager; team, sheets, AI and email routes 401 without a token, team is Admin-only server-side. `customers UPDATE` is any writing role on any row — the documented trust model (SEC1/Q14). The AI route checks sign-in only, the UI checks `canExportData` → **T71**. |
| Permissions (screens) | Viewer, Collector, CRM on the book, the register, the follow-up dialog | Nothing offered the server would refuse (7 tests). |
| Odd inputs | 1,500-char name, markup in a contact, `#REF!` email, 5,000-char note, `abc` phone; cheque amount −100 / 0 / 1e12, blank number; search `(`, `\`, `)(`, 500 chars, emoji; 10,000-char template with an unknown placeholder | No script executed (React escapes; no raw HTML anywhere; WhatsApp links `noopener`, digits only, URL-encoded). The browser refused the bad email; the cheque dialog refused −100, 0 and a blank number, accepted 1e12 (no ceiling). The success banner with a 1,500-char name widened the page by 13,068 px → **fixed** (wraps now); the book and Reports tables scroll to 14,000 px for such a name → **T70**. A name already in the book is accepted without a warning → **T68**. |
| Malformed sheet / upload | odd cells through the parsers; a workbook with a `Total` row, an empty-name row, `#REF!`, `1e3`, bad dates, a 400-char name, uploaded through the real Data source page as far as the review, then cancelled | No crash; garbage reads as zero. The review listed *Total ₹99,99,99,999 — New customer* and *Unknown Company ₹100 — New customer* by name, and "Settled to zero 645" for the wrong file — visible, but confirmable → **T69**. |
| Dates | 23:59:59.999 / 00:00:00.001 either side of midnight; UTC-midnight dates; invalid dates; a collected account dated 2999; cheques likewise; the dialogs' date fields for a locally-stored date | Categories right on both sides of midnight. **T37 reproduced and fixed**: the three dialogs seeded date fields with the UTC day, so 101 accounts whose follow-up was stored at local midnight opened a day early — and a follow-up saved untouched moved back a day. |
| Balances | 0, credit, 0.001, NaN, 1e12, negative | Zero is not work, a credit is on the books, NaN is nothing; production holds 0 negatives, 37 credits, no junk names, one `#REF!` email (T36). |
| Fresh Start | phrase without the backup; lowercase phrase; trailing space; correct phrase | Button disabled until the backup is downloaded and the phrase is exactly `RESET` (trimmed); backup file downloads; Esc closes; **no RPC attempted**. The function itself refuses non-Admins, a wrong phrase, and a plan that no longer matches the book. |
| Team / Templates / Alerts | empty and invalid team forms; a 10,000-char template; the daily-email toggle and test send (answered here) | Forms blocked by validation with 0 requests; the template saved and previewed (WhatsApp link 10 kB, WhatsApp itself may truncate — left); Alerts wrote `alert_settings` and called `/api/daily-report`, both answered here. |
| Accessibility / responsive | the sweep at 1366, 1024 and 390 on the final build | 21 screens and dialogs each: 0 overflow, 0 low-contrast, 0 unnamed; focus kept, Esc closes. Found by hand: the register's bank filter and the cheque dialog's bank field shared one `id`, so the dialog's label pointed behind the overlay → **fixed**. |
| Keyboard | Ctrl+K; Tab order from the top; Enter on a nav item; Enter on a row's *Follow up*; Esc | All as expected; focus returns to the row button. |
| Performance | cold load; the 4,029-row read; each tab's paint; keystrokes; the "All" filter; scrolling to 1,500 rows | 346 ms load (196 kB JS), 220 ms read, tabs 14–153 ms, 18–31 ms per keystroke, 1,500 rows in 4.7 s with no overflow. |
| Exports / import preview | the book, register and report exports; the upload review | Three files downloaded; the review is the only path to a write and Cancel writes nothing. |
| Multiple tabs | — | Not exercised live: two tabs writing the same account needs real writes (R1-B, by decision). The merge on refresh is covered by `refreshMerge` and `useCollectionSync` tests. |

## 3. Bugs found

| # | Severity | Finding | Outcome |
|---|---|---|---|
| T37 | **P2** | The follow-up, edit and cheque dialogs seeded their date fields with the UTC day; a date stored at local midnight (the bulk tool, an import — 101 accounts today) opened a day early and a follow-up saved untouched moved back a day | **Fixed** (`localIsoDate` in all three; `tests/dateSeeding.dom.test.tsx`), deployed |
| — | P3 | A very long company name widened the whole page through the success banner | **Fixed** (the banner wraps), deployed |
| — | P3 | `id="pdcBank"` on both the register's filter and the cheque dialog's input | **Fixed** (`pdcBankFilter`), deployed |
| T66 | P3 | A dead session (401 on every save) is reported like any refusal; nothing says "sign in again", and a reload loses the unsaved changes | Open — SHOULD FIX LATER |
| T67 | P3 | A failed first load leaves the skeleton with a banner and no retry | Open — SHOULD FIX LATER |
| T68 | P3 | The add-customer dialog accepts a name already in the book; the next sync treats same names as one company (the later one takes the figures, the other is settled) — production has no duplicates today | Open — SHOULD FIX LATER |
| T69 | P3 | A `Total`/footer row or a blank-name row in a sheet or workbook reaches the review as a new customer (named there, so visible); a wrong file settles the book to zero if confirmed (recoverable by re-syncing) | Open — SHOULD FIX LATER |
| T70 | P4 | No length cap on names/contacts; the book and Reports tables scroll to 14,000 px for a 1,500-char name (nothing in production is over 53) | Open — SAFE TO LEAVE |
| T71 | P4 | `/api/gemini-report` checks sign-in only; the UI offers it on `canExportData` — a signed-in Collector or Viewer could call it directly | Open — SHOULD FIX LATER (one line server-side) |
| T36 | P3 | One production account's email is `#REF!`; its edit dialog's Save is blocked by the browser until the field is cleared | Open — SHOULD FIX LATER |

Nothing P0 or P1 was found.

## 4. Remaining technical debt, classified

**MUST FIX BEFORE CLOSING THE PROJECT** — none. Everything the software needs to be safe to use is in place: rights enforced by the database, every write reviewed or confirmed, refused saves kept and retried, the reset behind three safeguards and a snapshot.

**SHOULD FIX LATER** (in the order they earn their keep):
- **R1-B / T22 / T42** — same-field last-writer-wins between two tabs (a version column and a predicate; designed in 11 §2.2; needs Q15).
- **Q14 / SEC1–SEC2** — `customers UPDATE` open to any writing role on any row: decide whether to narrow the policy to the owner/collector (documented trust model today).
- **T66** dead-session message · **T67** retry on a failed first load · **T68** duplicate-name warning · **T69** footer/blank rows and a second confirmation when a sync would settle most of the book · **T71** role check on the AI route · **T36** sheet garbage in the email field.
- **T12 / T14 / T15** duplicated scoping and mirrored notes, the two "expected payment" notions (decisions first).
- **T50 (collector filter)**, **T52**, **T48** (the follow-up dialog's own WhatsApp copy), **T44** (cheques/templates not refreshed on focus), **T46**, **T47**.
- **T3 / T4 / T5 / T9** repo hygiene: two lockfiles (Q1), no lint/engines, the stale ARCHITECTURE sections, schema without migrations.

**SAFE TO LEAVE**: T6 (dev server duplicates the routes), T7/T8 (dead animation classes, remapped palette), T10, T11, T13, T16, T17, T18, T26/T28 (the reset now snapshots and re-imports; the re-id concern is documented), T27, T29/T30, T31–T35, T38, T40, T41, T43, T45, T54, T56, T59, T60–T64, T70.

Done in earlier phases and still struck through: T1, T2 (the browser suites have a home and a runner), T19–T21, T23–T25, T34, T39, T49, T51, T53, T55, T57, T58, T65.

## 5. Verdict

The software is safe to keep using. Every screen, dialog and write path behaved under abuse; the one data bug found (T37) was reproduced, fixed, tested and deployed within the pass; the rest are quality-of-life items with clear workarounds. The production-hardening project is complete; what remains is a maintenance list, headed by R1-B and the Q14 decision.
