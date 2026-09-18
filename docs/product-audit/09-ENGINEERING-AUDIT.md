# 09 — ENGINEERING AUDIT

Status: **Phase 8 (architecture cleanup) done 2026-09-18, local — see §D.** §A is the Phase 1 map of `App.tsx` as it was (3,302 lines then, 3,107 at the start of Phase 8); §D records what was extracted and what App.tsx is now.

## A. `App.tsx` — responsibility map (3,302 lines, read in the Phase 1 pass)

### A.1 State groups (48 `useState`)

| Group | State | Notes |
|---|---|---|
| Session | `users`, `currentUser`, `isAuthenticated`, `restoringSession`, `serverLoaded` | `serverLoaded` gates the sync hooks |
| Navigation | `adminTab`, `userTab` (both seeded from `location.hash`), `userManagementTab` | two tab states for one UI; `navKey` picks by `seesWholeBook` |
| Book | `appData` (whole book), `outstandingData` (this person's slice, recomputed by `updateViewData`), `loading`, `error` | the slice is derived state kept in state |
| Today filters | `searchTerm`, `statusFilter`, `categoryFilter`, `priorityFilter`, `unattendedFilter`, `showNotificationBanner` | only the personal Today list and the Reports handoff read them |
| Dialogs | `isModalOpen`+`selectedCustomer` (follow-up), `isWhatsAppModalOpen`+`whatsAppCustomer`, `isPasswordModalOpen`, `isUserModalOpen`+`editingUser`, `isPdcModalOpen`+`editingPdcCheque`+`pdcPreselectedCustomerId`, `isTemplateModalOpen`+`editingTemplate`, `isCustomerModalOpen`+`customerToEdit` | seven open/target pairs |
| Cheques | `pdcCheques`, `pdcInitialStatusFilter`, `pdcInitialCustomerFilter` | |
| Settings | `companyProfile`, `templates`, `dataSourceMode`, `googleSheetUrl`, `customerMasterSheetUrl`, `sheetUpdatedTillDate`, `lastSyncTime` | all synced by `useValueSync` |
| Sync UI | `syncMessage`, `isSyncing`, `pendingSync`, `crmConflicts` | |

### A.2 Effects / memos (29)
Session restore; hydrate on sign-in (`loadAll`); five sync hooks; `updateViewData` on user/data change; hash ↔ tab sync (two effects); `liveSelectedCustomer`; `filteredData` (Today list); `portfolioAgeing`, `myAgeing`, `fourBoxesSummary`, `userBoxMetrics`, `cashFlowForecastMetrics`, `notificationSummary`, `crmPerformanceStats`, `todayPdcMetrics`, `rights`, `settingsValue`, `liveStock` hook.

### A.3 Handlers (46), by domain
- **Customers**: open add/edit, `handleSaveCustomer`, `handleDeleteCustomer`, `handleExportCustomerExcel`, `handleExportCrmAssignments`, `handleReassignCrm`, `handleBulkSetRank`, `handleBulkReassignCrm`, `handleBulkSetFollowUp` (Admin), `handleOpenFollowUp`/`handleCloseModal`/`handleUpdateOutstanding`.
- **Import/sync**: `parseRawDataArray` (Excel), file upload (inline in `renderCompanyDashboard`), `handleGoogleSync`, `handleCustomerMasterSync`, `handleConfirmSyncReconciliation`, `handleCancelSyncReconciliation`, `handleResetAllDataAndUsers`.
- **Cheques**: open add/edit, `handleSavePdc`, `handleDeletePdc`, `handleUpdatePdcStatus`, `handleBulkPdcStatus`, `handleBulkDeletePdc`, `handleOpenPdcForCustomer`, `handleOpenTodayPdc`.
- **Team**: `handleOpenUserModal`, `handleCloseUserModal`, `handleSaveUser`, `handleDeleteUser`.
- **Templates / profile**: open/close/save/delete template, `handleSaveCompanyProfile`.
- **Session/nav**: `handleLogin`, `handleLogout`, `handleCategoryBoxClick`, `handleClearFilters`, `handleViewPriorityItems`, `handleSendWhatsApp`, `notify`.

### A.4 Page-level renderers
`renderAdminOverviewCards` (~200 lines: company Today), `renderUserDashboard` (~300: personal Today + the routed tabs for non-whole-book users), `renderCompanyDashboard` (~700: every tab for whole-book users, including the Data source tab with the Excel upload and the reset, Team & access, Alerts, Templates), `renderCustomerListView`, `renderLiveStock`, `renderDashboard`. The two dashboards render the same tab components with near-identical props twice (Reports, PDC, customers, stock).

### A.5 Cross-cutting dependencies
- Every handler mutates `appData`/`pdcCheques` and relies on the sync hooks to persist (no handler calls the repository for customers/cheques except `deleteCustomer`/deletes via the hook's `remove`, and activity entries).
- `processStatuses` is called from six places after mutations.
- `rights` is passed down as individual booleans; screens also call `can()` themselves.
- `getToday()` (App.tsx) vs `new Date()` with `setHours(0,0,0,0)` inline in several memos.

### A.6 Obvious extraction boundaries (for Phase 8 — not to be done before tests exist)
1. **Metrics** (`portfolioAgeing`, `myAgeing`, `fourBoxesSummary`, `userBoxMetrics`, `cashFlowForecastMetrics`, `notificationSummary`, `crmPerformanceStats`, `todayPdcMetrics`) → pure functions in `services/metrics.ts`, unit-testable, and the duplicate in `ReportsView.boxMetrics` reconciled (D5).
2. **Import/sync handlers + reset** → `services/importFlow.ts` or a `useImport()` hook; they only touch `appData`, settings and messages.
3. **Cheque handlers** → `useCheques()`.
4. **Page renderers** → `pages/CompanyToday.tsx`, `pages/PersonalToday.tsx`, `pages/DataSource.tsx`, with the shared tab routing done once instead of twice.
5. **Dialog state** → one `dialog` discriminated union instead of seven booleans.
6. **Book state + sync** → a `useBook()` hook owning `appData`, `outstandingData`, the sync hooks and `processStatuses` — the natural place to later add optimistic concurrency (R1).

## B. Preliminary counts (Phase 0)
- `any` / `as any` / `@ts-ignore` / `eslint-disable`: 61 occurrences in first-party code (not yet judged; `repository.ts` mappers account for ~20 by design).
- `console.log/debug` in app code: 1.
- Route duplication: 8 API routes in both `api/*.ts` and `server.ts`.
- Dead column (LIKELY): `customers.updated_by` is never written by `outstandingToRow`.
- Dead right (CONFIRMED): `canEditFinancials` gates no screen.

## C. Customer persistence map (Option A, 2026-09-17)

Every customer write in the app takes one route; nothing bypasses it (grep for `updateCustomer*`, `upsertCustomers`, `deleteCustomer`, `from('customers')` — the only callers are the adapters below and the repository itself; activity entries are a different table).

```
handler in App.tsx                setAppData(rows)          — spreads the in-memory row, changes the intended fields
        │
useCollectionSync (services/useSupabaseSync.ts)   800 ms debounce, per row:
        │   signature = JSON.stringify(outstandingToRow(row))   compared with `synced` (last state the server accepted)
        │   baseline  = outstandingToRow(lastAcceptedRow)        kept per id, only for the customers hook (`partial`)
        ├── id never seen  ──► upsert(freshRows)  ──► repo.upsertCustomers  ──► POST /rest/v1/customers (whole rows, chunked 500)
        ├── id known       ──► changes = customerRowDiff(baseline, outstandingToRow(row))
        │                       └─ empty → accepted without a request
        │                       └─ else  → repo.updateCustomerColumns(id, changes) ──► PATCH /rest/v1/customers?id=eq.<id>  { only those columns }
        └── id gone        ──► repo.deleteCustomer(id) ──► DELETE
        on success: synced[id] = signature, baseline[id] = row       on failure: untouched → the next tick retries the difference
```

| Fact | Before | Now |
|---|---|---|
| Object the hook receives | `Outstanding[]` (`appData`) | same |
| Baseline | `Map<id, signature>` seeded at sign-in, advanced to *the whole current map* only when the *entire* batch succeeded | `Map<id, signature>` + `Map<id, CustomerRow>`, seeded from the loaded data, **advanced per row on that row's success**, untouched on that row's failure |
| What is sent for a known row | `outstandingToRow(row)` minus `id` — 36 columns | `customerRowDiff(baseline, row)` — the columns whose value differs; a cleared column as `null` |
| `undefined` / `null` | `outstandingToRow` maps every absent app value to `null`; `undefined` never reaches a row | same; so at the row level "absent from the diff" = unchanged, "present as null" = clear |
| camelCase → snake_case | `outstandingToRow` (37 columns), typed `Record<string, any>` | same mapper, now typed `CustomerRow`; `CustomerColumnChanges = Partial<Omit<CustomerRow, 'id'>>` |
| Object-valued columns (`ageing`, `ageing_types`, `additional_contacts`, `notes`) | compared as part of the whole-row signature | compared with a key-order-stable serialisation (`stable()`), so jsonb's key order never reads as a change; arrays keep their order |
| Repository return | `void` | `void` (unchanged; no updated row is read back) |
| Concurrency of writes | 8 in flight inside `updateCustomers` | 8 in flight inside the hook (`partial.concurrency`, default 8) |
| Error surfaced | "Could not save customer <company>: …" | "Could not save customers: Could not save the changes to <id>: … (and n more)" |
| Cheques / templates | whole-row upsert | unchanged (no `partial` configured) |

Invariant (documented in the hook): **the baseline is the last state this tab successfully saved, row by row.** It is seeded from the load, advanced for a row only after the server accepted that row, and never advanced by a React state change alone.

Field map for the partial write (every column `useCollectionSync` can now emit):

| App field | Column | Transform | When cleared | Owner |
|---|---|---|---|---|
| company | company | as is | never null (required) | app |
| contactPerson / contactNumber | contact_person / contact_number | `?? ''` | `''` | app |
| contactPost, email, city, state, address, gstin, pan | same, snake_case | `?? null` | `null` | app (pan unused) |
| additionalContacts | additional_contacts | array as is | `[]` | app |
| creditLimit, paymentTermsDays | credit_limit, payment_terms_days | `?? null` | `null` | app (seeded) |
| paymentRank, category | payment_rank, category | `?? null` | `null` | app |
| total, totalType | total, total_type | `?? 0`, `?? null` | — | **sheet** |
| ageing, ageingTypes | ageing, ageing_types | object; `?? {}` for types | `{}` on settlement | **sheet** |
| over90(+Type), dueOver45(+Type) | over90, over90_type, due_over45, due_over45_type | `?? null` | `null` / `'Dr'` on settlement | **sheet** |
| crmOwnerId | crm_owner_id | `?? ''` | `''` = unassigned | app |
| assignedCollectorId | assigned_collector_id | `?? null` | `null` | app |
| followUpDate, forecastDate, creationDate, lastFollowUpOn | *_date / last_follow_up_on | `toIso()` → ISO string | `null` | app |
| forecastAmount | forecast_amount | `?? null` | `null` | app |
| status | status | as is (`?? Pending`) | — | app (derived; see R1-C) |
| notes | notes | array as is | `[]` | app (mirror of the thread) |
| isUrgent, isNewCustomer | is_urgent, is_new_customer | `!!` | `false` | app (urgency seeded by import) |
| addedAt, settledAt | added_at, settled_at | `?? null` | `null` | app (settlement stamped by sync) |

## D. Phase 8 — the App.tsx cleanup (2026-09-18, twenty-fifth session; committed locally, NOT deployed)

Goal: reduce the size and responsibility of `App.tsx` without changing behaviour. Small extractions, each committed on its own, tests after each; the browser QA scripts (which sign in as Admin against the live database with every write aborted) as the App-level net, since no unit test renders App.

**Before:** 3,107 lines · 48 `useState` · 29 effects/memos · 46 handlers · six page-level render functions, two of which rendered the same tab components with near-identical props (A.4) · two tab states for one UI · this person's slice of the book recomputed into state by an effect, one tick late, with a loading flag.

**Extracted (twelve commits, `ca557a1`…`1fa40f3`):**

| Where | What | Lines |
|---|---|---|
| `services/metrics.ts` | The eight figures on Today as pure functions: `ageingTotals` (was written twice), `worklistSummary` (was written twice), `filterWorklist`, `cashFlowForecast`, `attentionCounts`, `crmPerformance`, `chequeSummary`; owns the one `CrmStat` type (the table had its own) | 412 |
| `services/excel.ts` | The upload's row parser, `readWorkbookRows`, the blank template, the customer export and the CRM-owners export; `EXPECTED_HEADERS` | +160 |
| `services/googleSheetService.ts` | `OFFICIAL_TRANSACTIONS_SHEET_URL`, `OFFICIAL_CUSTOMER_MASTER_URL` (App had them, plus an alias of the first) | — |
| `hooks/useSession.ts` | Session restore, the one `loadAll` after sign-in, login, logout, `reload` for a fresh start | 106 |
| `hooks/useTab.ts` | One tab state mirrored to the hash (was two); `useFitsOneScreen` | 81 |
| `hooks/usePersistence.ts` | The three collection syncs, the two value syncs, the folded save status, retry-all, the periodic re-read of the book. Reads "is a dialog open" through a ref App fills in after every hook has run | 193 |
| `hooks/useDataSource.tsx` | Sheet addresses and mode, Check the sheet, the balance sync and its review, the Excel upload, the one-time import, the CRM-owners export, the fresh start — with their state; `applySettings` for hydration | 427 |
| `hooks/useCustomers.tsx` | Add/edit (one dialog object), delete after the question, the follow-up dialog and its stepping through the list it was opened from, the WhatsApp reminder, reassigning, the three bulk tools | 301 |
| `hooks/useCheques.ts` | Record/edit/delete/mark one or many; the two ways Today opens the register; the cheque dialog as one object | 120 |
| `hooks/useTeam.tsx`, `hooks/useTemplates.tsx` | Each feature's dialog and actions | 96 + 59 |
| `hooks/useWorklistFilters.ts` | The shared search term, the card pressed, the banner's and unattended filters, the person/band Reports opens on, and the four actions that set several at once | 117 |
| `components/pages/CompanyToday.tsx`, `PersonalToday.tsx` | The two Today pages, taking their figures as props (byte-identical JSX, identifiers renamed to props) | 251 + 300 |
| `components/shell/ShellBanner.tsx` | The passing message or the refused save, with retry and dismiss; one `ShellMessage` type shared with the hooks | 73 |
| `types.ts` | `DEFAULT_TEMPLATE` beside `DEFAULT_COMPANY_PROFILE` | — |

**After:** `App.tsx` is **771 lines** (−75%): 9 `useState` (the book, the cheques, the templates, the profile, the message, the question, the password dialog, the stock search term, and the tab via its hook), 13 hooks/memos, one handler (`handleSaveCompanyProfile`), one `renderTab()` switch, the shell chrome (nav items, page titles, scope label, skeleton) and the dialog stack. It reads top to bottom: session → tab → the collections → the feature hooks in dependency order → rights → the shell.

**Duplicates removed:** `ageingTotals` and `worklistSummary` each written twice (whole book / my slice); the PDC tab block and the Reports/customers/stock dispatch rendered twice (company and personal dashboards); two tab states; `OFFICIAL_SHEET_URL` = `OFFICIAL_TRANSACTIONS_SHEET_URL`; `getToday()` in App beside `setHours(0,0,0,0)` inline in three memos and two components → `startOfToday()` in `ui/format.ts`; two `CrmStat` interfaces; `isModalOpen`/`isWhatsAppModalOpen` (always equal to "is there a selected customer"); the seven open/target dialog pairs → one object each.

**Dead code removed:** `getOutstandingForUser()` (a Promise around `scopeTo`; the comments that named it now name `scopeTo`), the `error` state and its branch (nothing could set it once the slice was derived), fifteen icon components nothing rendered (`Icons.tsx` ×7, `NavIcons.tsx` ×8), `chequeStateLabel`, `isInHand`, `IDLE_STATUS`, the `Xlsx` type alias.

**Two confirmed bugs fixed on the way (user-visible, so recorded):** (1) a Manager (or a Viewer) pressing "open in cheques" / "Review cheques" went nowhere — the handler set the *personal* tab state while the company view read the other one; one tab state ends it. (2) A CRM's AI credit summary was headed with the placeholder company because the personal view never passed `companyProfile` to Reports; it is passed for everyone now.

**Deliberately left alone:** `ReportsView.boxMetrics` (D5) — a broader computation over a differently scoped list; reconciling it with `worklistSummary` would touch the numbers T51 pinned. The three `formatCurrency` copies (T62): they differ in rounding and sign handling, so consolidating changes rendered text. `alert()` in `copyHeaders` and "cannot delete the last template" (T63). `PdcModal`'s `isOpen` prop (always true now; the modal's own logic reads it). R1-B. Everything the brief excluded: rules, formulas, schema, RLS, permissions.

**Validation:** `tsc` clean; **291/291** (`metrics` 13 new, `todayPages` 6 new); `npm run build` clean, main chunk 567 kB (gzip 150.6 kB, the same), no size warning; `check:classes` the two pre-existing false positives; `check:empty` clean. Against the dev server with every write aborted: the a11y sweep at 1366×768 (every screen, dialog and question: 0 overflow / 0 low-contrast / 0 unnamed, focus kept, Esc closes); the four workflow QA scripts (CRM at 1366/390, Manager/Reports, cheques, Data source at 1366) 0 findings; smoke 12/12; the payload probe (10 requests, all aborted) and the status-contract probe (4) **identical to the production records** — the same PATCHes with the same columns.
