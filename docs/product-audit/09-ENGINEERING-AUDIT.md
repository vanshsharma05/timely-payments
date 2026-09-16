# 09 — ENGINEERING AUDIT

Status: Phase 8 not started. This file holds (a) the Phase 1 map of `App.tsx` written so the engineering phase can plan its extraction without re-reading, and (b) preliminary counts.

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
