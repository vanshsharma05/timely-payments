import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { EXPECTED_HEADERS, downloadTemplate } from './services/excel';
import { isSupabaseConfigured } from './services/supabaseClient';
import * as repo from './services/repository';
import { SyncPassResult } from './services/useSupabaseSync';
import { SaveStatus } from './components/SaveStatus';
import { searchScopeFor } from './services/search';
import { useTab, useFitsOneScreen } from './hooks/useTab';
import { usePersistence } from './hooks/usePersistence';
import { useDataSource } from './hooks/useDataSource';
import { useCheques } from './hooks/useCheques';
import { useTeam } from './hooks/useTeam';
import { useTemplates } from './hooks/useTemplates';
import { useCustomers } from './hooks/useCustomers';
import { Outstanding, User, UserRole, FollowUpStatus, Template, PdcCheque, CompanyProfile, DEFAULT_COMPANY_PROFILE, DEFAULT_TEMPLATE, DEFAULT_ROLE_PERMISSIONS, can, permissionsOf, seesWholeBook, scopeTo, hasOutstanding } from './types';
import { processStatuses, OFFICIAL_TRANSACTIONS_SHEET_URL, OFFICIAL_CUSTOMER_MASTER_URL } from './services/googleSheetService';
import { CustomerDashboardView } from './components/CustomerDashboardView';
import { CustomerEditModal } from './components/CustomerEditModal';
import LoginScreen from './components/LoginScreen';
import AppShell, { NavGroup, NavItem } from './components/shell/AppShell';
import { TodayIcon, BookIcon, ChequeNavIcon, ChartIcon, StockIcon, TeamIcon, MessageIcon, PlugIcon, BellIcon } from './components/shell/NavIcons';
const LiveStockView = lazy(() => import('./components/LiveStockView'));
import { useLiveStock, LIVE_STOCK_SHEET_URL } from './services/liveStock';
import { formatCompact, startOfToday } from './components/ui/format';
import { ageingTotals, worklistSummary, filterWorklist, cashFlowForecast, attentionCounts, crmPerformance, chequeSummary } from './services/metrics';
import { Card, LoadingList } from './components/ui/Primitives';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { CheckCircleIcon, ExclamationTriangleIcon } from './components/icons/Icons';
import FollowUpModal from './components/FollowUpModal';
import AlertsView from './components/AlertsView';
const UserModal = lazy(() => import('./components/UserModal'));
const ChangePasswordModal = lazy(() => import('./components/ChangePasswordModal'));
const TemplateModal = lazy(() => import('./components/TemplateModal'));
import { CompanyToday } from './components/pages/CompanyToday';
import { PersonalToday } from './components/pages/PersonalToday';
import type { FollowUpCategoryFilter, AgeingReportFilter } from './components/ReportsView';
const ReportsView = lazy(() => import('./components/ReportsView'));
const SyncReconciliationModal = lazy(() => import('./components/SyncReconciliationModal'));
const ResetConfirmModal = lazy(() => import('./components/ResetConfirmModal'));
const DataSourceView = lazy(() => import('./components/DataSourceView'));
const PdcChequesView = lazy(() => import('./components/PdcChequesView'));
import PdcModal from './components/PdcModal';
import { TeamView } from './components/TeamView';
import { TemplatesView } from './components/TemplatesView';
import WhatsAppReminderModal from './components/WhatsAppReminderModal';

/**
 * Supabase is the master record and the only one: state is loaded from it on
 * sign-in and written back as it changes. Nothing about the book is cached in
 * the browser, so a stale tab can never overwrite the team's work.
 */

const App = () => {
    const [users, setUsers] = useState<User[]>([]);

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    /** The collections have been read from the server since sign-in; nothing syncs before that. */
    const [serverLoaded, setServerLoaded] = useState(false);
    const [restoringSession, setRestoringSession] = useState(isSupabaseConfigured);

    /** The screen the app is on; mirrored to the URL hash (hooks/useTab.ts). */
    const [tab, setTab] = useTab(isAuthenticated);

    /** The whole book. Every change lands here and the persistence hook carries it to the server. */
    const [appData, setAppData] = useState<Outstanding[]>([]);
    /**
     * This person's slice of the book — the whole of it for whoever reads
     * the whole book, their own accounts for everyone else. Derived, not
     * kept: it used to be recomputed into state by an effect, one tick after
     * every change, with a loading flag that blinked the skeleton each time.
     */
    const outstandingData = useMemo(() => (currentUser ? processStatuses(scopeTo(currentUser, appData)) : []), [currentUser, appData]);
    /** The book is on its way from the server. */
    const [loading, setLoading] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState('');
    /** Live stock's own term: a customer searched in the book must not empty the stock list (services/search.ts). */
    const [stockSearch, setStockSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<FollowUpStatus | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<FollowUpCategoryFilter>('all');
    // What Reports opens on when a manager arrives from Today: a person (the
    // team table) and an ageing band (the portfolio card). 'ALL' / 'all' = no filter.
    const [reportCrm, setReportCrm] = useState<string>('ALL');
    const [reportAgeing, setReportAgeing] = useState<AgeingReportFilter>('all');


    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    /**
     * A question before something that cannot be undone, asked in the app.
     * The browser's confirm() could not name the record, styled "OK" as the
     * destructive answer, and looked nothing like the rest of the app.
     */
    const [ask, setAsk] = useState<{ title: string; body: React.ReactNode; confirmLabel: string; tone?: 'danger' | 'primary'; run: () => void } | null>(null);
    const [pdcCheques, setPdcCheques] = useState<PdcCheque[]>([]);

    const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);
    const [templates, setTemplates] = useState<Template[]>([DEFAULT_TEMPLATE]);
    const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error', text: string, action?: { label: string; run: () => void } } | null>(null);

    /** Banner at the top of the shell. Errors linger; confirmations do not. */
    const notify = useCallback((type: 'success' | 'error', text: string) => {
        setSyncMessage({ type, text });
        window.setTimeout(() => setSyncMessage(null), type === 'error' ? 12000 : 5000);
    }, []);
    const handleSaveCompanyProfile = (updated: CompanyProfile) => {
        setCompanyProfile(updated);
        setSyncMessage({ type: 'success', text: 'Company profile details updated successfully.' });
        setTimeout(() => setSyncMessage(null), 4000);
    };
    /** Where the balances come from, and everything that reads or resets them (hooks/useDataSource.tsx). */
    const source = useDataSource({
        appData, setAppData, pdcCheques, templates, companyProfile,
        isAdmin: currentUser?.role === UserRole.Admin,
        setSyncMessage, ask: setAsk,
        onReset: () => setServerLoaded(false),
    });
    const {
        dataSourceMode, googleSheetUrl, customerMasterSheetUrl, sheetUpdatedTillDate, lastSyncTime,
        isSyncing, pendingSync, resetPlan,
        handleGoogleSync, handleCustomerMasterSync,
    } = source;

    /** The Today list's filters: the attention banner's, the unattended shortcut's, and whether the banner shows. */
    const [priorityFilter, setPriorityFilter] = useState(false);
    const [unattendedFilter, setUnattendedFilter] = useState(false);
    const [showNotificationBanner, setShowNotificationBanner] = useState(true);

    // =====================================================================
    // Supabase backend
    //
    // Supabase is the master record: state is hydrated from it on sign-in and
    // every change is written back, so the whole team shares one dataset.
    // Without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY the app does not run
    // at all — LoginScreen says so rather than pretending to work.
    // =====================================================================
    // Restore an existing session on load so a refresh does not bounce you out.
    useEffect(() => {
        if (!isSupabaseConfigured) return;
        let cancelled = false;
        (async () => {
            try {
                const profile = await repo.fetchCurrentProfile();
                if (!cancelled && profile) {
                    setCurrentUser(profile);
                    setIsAuthenticated(true);
                }
            } catch {
                /* not signed in */
            } finally {
                if (!cancelled) setRestoringSession(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Hydrate every collection once, straight after sign-in.
    useEffect(() => {
        if (!isSupabaseConfigured || !isAuthenticated || serverLoaded) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const all = await repo.loadAll();
                if (cancelled) return;
                setAppData(processStatuses(all.customers));
                setPdcCheques(all.pdcCheques);
                if (all.users.length) setUsers(all.users);
                if (all.templates.length) setTemplates(all.templates);
                if (all.companyProfile) setCompanyProfile(all.companyProfile);
                source.applySettings(all.settings);
                setServerLoaded(true);
            } catch (e: any) {
                if (!cancelled) setSyncMessage({ type: 'error', text: `Could not load data: ${e?.message || e}` });
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAuthenticated, serverLoaded]);

    const syncEnabled = isSupabaseConfigured && isAuthenticated && serverLoaded;

    /** A form is open: the book must not be refreshed under it mid-edit. Filled in below, once every dialog's state exists. */
    const dialogOpenRef = useRef(false);
    const {
        customersSync, chequesSync, syncStatuses, saveStatus, retryAllSaves, refreshBook, refreshedAt, refreshing,
    } = usePersistence({
        enabled: syncEnabled, appData, setAppData, pdcCheques, templates, companyProfile, dialogOpenRef,
        settings: { dataSourceMode, googleSheetUrl, customerMasterSheetUrl, sheetUpdatedTillDate, lastSyncTime },
    });

    /** "Saved N of M" or the reason, after a bulk change has been given to the server. */
    const reportBulk = (r: SyncPassResult, ids: string[], done: string) => {
        const failed = r.failed.filter(f => ids.includes(f.id));
        if (!failed.length) notify('success', done);
        else notify('error', `${done} — but ${failed.length} of ${ids.length} could not be saved (${failed[0].message}). They are kept in this tab and will be retried.`);
    };

    /** The cheque register's actions and dialog (hooks/useCheques.ts). */
    const cheques = useCheques({ pdcCheques, setPdcCheques, chequesSync, notify, reportBulk, setTab });
    const {
        handleOpenAddPdc, handleOpenEditPdc, handleSavePdc, handleDeletePdc, handleUpdatePdcStatus,
        handleBulkPdcStatus, handleBulkDeletePdc, handleOpenPdcForCustomer, handleOpenTodayPdc,
        pdcInitialStatusFilter, pdcInitialCustomerFilter,
    } = cheques;
    /** Team & access (hooks/useTeam.tsx) and message templates (hooks/useTemplates.tsx). */
    const team = useTeam({ users, setUsers, currentUser, setCurrentUser, notify, ask: setAsk });
    const { handleOpenUserModal, handleDeleteUser } = team;
    const templatesFeature = useTemplates({ templates, setTemplates, ask: setAsk });
    const { handleOpenTemplateModal, handleDeleteTemplate } = templatesFeature;

    const filteredData = useMemo(
        () => filterWorklist(outstandingData, { searchTerm, statusFilter, categoryFilter, priorityFilter, unattendedFilter }, users, startOfToday()),
        [outstandingData, searchTerm, statusFilter, categoryFilter, priorityFilter, unattendedFilter, users],
    );
    /** Everything done to a customer: dialogs, saves, the bulk tools (hooks/useCustomers.tsx). */
    const customers = useCustomers({
        appData, setAppData, pdcCheques, users, currentUser, customersSync, notify, reportBulk, ask: setAsk,
        tab, todayList: filteredData,
    });
    const {
        handleOpenAddCustomer, handleOpenEditCustomer, handleDeleteCustomer, handleExportCustomerExcel,
        selectedCustomer, liveSelectedCustomer, onBookRowsChange, handleOpenFollowUp, handleSendWhatsApp,
        handleReassignCrm, handleBulkSetRank, handleBulkReassignCrm, handleBulkSetFollowUp,
    } = customers;
    dialogOpenRef.current = !!selectedCustomer || !!customers.customerDialog || !!cheques.chequeDialog || !!resetPlan || !!pendingSync;


    /**
     * Filters belong to the person looking, not to the data.
     *
     * These used to be cleared in the same effect that recomputes the view —
     * and that effect depends on `appData`, so *every save* reset them. Log a
     * follow-up from "Due today" and the filter silently fell back to "My
     * accounts": the list you were working stopped showing today's follow-ups
     * and showed all 87 instead, which reads as the follow-ups disappearing.
     * The same happened after grading an account, reassigning one, or a sync
     * landing while you worked.
     *
     * Keyed on who is signed in, so it still clears on sign-in and on a switch
     * of account, and never because a row was written.
     */
    useEffect(() => {
        if (!isAuthenticated || !currentUser) return;
        setShowNotificationBanner(true);
        setPriorityFilter(false);
        setUnattendedFilter(false);
        setStatusFilter(null);
        setCategoryFilter('all');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.id, isAuthenticated]);

    const handleLogin = (user: User) => {
        const fullUser: User = {
            ...user,
            permissions: {
                ...(DEFAULT_ROLE_PERMISSIONS[user.role] || DEFAULT_ROLE_PERMISSIONS[UserRole.CRM]),
                ...(user.permissions || {})
            },
            assignedCrms: user.assignedCrms || (user.role === UserRole.CRM ? [user.id] : undefined)
        };
        setCurrentUser(fullUser);
        setIsAuthenticated(true);
    };

    const handleLogout = async () => {
        try { await repo.signOut(); } catch { /* local sign-out is enough */ }
        setServerLoaded(false);
        setIsAuthenticated(false);
        setCurrentUser(null);
        setTab('overview');
    };

    const handleCategoryBoxClick = (category: FollowUpCategoryFilter) => {
        setPriorityFilter(false);
        setUnattendedFilter(false);
        setStatusFilter(null);
        setCategoryFilter(current => current === category ? 'all' : category);
    };

    const handleClearFilters = () => {
        setStatusFilter(null);
        setCategoryFilter('all');
        setPriorityFilter(false);
        setUnattendedFilter(false);
        setReportCrm('ALL');
        setReportAgeing('all');
        setSearchTerm('');
    };

    /**
     * From a number on Today to the accounts behind it. Reports opens on the
     * same person, the same follow-up state and the same ageing band the number
     * was counting — nothing else carried over, so a stale filter from an
     * earlier visit cannot hide part of the list.
     */
    const openReport = (opts: { crm?: string; category?: FollowUpCategoryFilter; ageing?: AgeingReportFilter }) => {
        setPriorityFilter(false);
        setUnattendedFilter(false);
        setStatusFilter(null);
        setReportCrm(opts.crm ?? 'ALL');
        setCategoryFilter(opts.category ?? 'all');
        setReportAgeing(opts.ageing ?? 'all');
        setTab('reports');
    };

    /**
     * "Show them" on the attention banner.
     *
     * It used to set priorityFilter, which only the personal dashboard's list
     * reads. On the company dashboard nothing rendered that list, so the banner
     * vanished and nothing else happened. Whoever sees the whole book is taken
     * to the report, filtered to the same accounts the banner counted.
     */
    const handleViewPriorityItems = () => {
        setStatusFilter(null);
        setUnattendedFilter(false);
        setShowNotificationBanner(false);

        if (seesWholeBook(currentUser)) {
            openReport({ category: 'urgent' });
        } else {
            setCategoryFilter('all');
            setPriorityFilter(true);
        }
    };

    /** Whole-book ageing; see ageingTotals(). */
    const portfolioAgeing = useMemo(() => ageingTotals(appData), [appData]);

    /**
     * What the signed-in person may do, in one place.
     *
     * The permission matrix on the profile is the authority; an Admin is never
     * restricted by it, and a Viewer never writes. Row Level Security enforces
     * the same rules in the database — this is what stops the UI offering
     * buttons the server would refuse.
     */
    const rights = useMemo(() => ({
        isAdmin: currentUser?.role === UserRole.Admin,
        isManager: currentUser?.role === UserRole.Manager,
        isViewer: currentUser?.role === UserRole.Viewer,
        canAddCustomer: can(currentUser, 'canAddCustomer'),
        canEditCustomer: can(currentUser, 'canEditCustomer'),
        canDeleteCustomer: can(currentUser, 'canDeleteCustomer'),
        canEditFollowUp: can(currentUser, 'canEditFollowUp'),
        canManagePdc: can(currentUser, 'canManagePdc'),
        canReassignCrm: can(currentUser, 'canReassignCrm'),
        canExportData: can(currentUser, 'canExportData'),
        /** Importing a sheet rewrites the shared book, so it stays with the seniors. */
        canSyncSheets:
            currentUser?.role === UserRole.Admin || currentUser?.role === UserRole.Manager,
        /**
         * Whether this person runs the team rather than working a book.
         *
         * Not the same as seeing the whole book: a Viewer, and any CRM given
         * "view all", read every account without managing anybody. How each
         * colleague is performing is a management view, so it stays with the
         * two roles that are accountable for it.
         */
        runsTheTeam:
            currentUser?.role === UserRole.Admin || currentUser?.role === UserRole.Manager,
        seesWholeBook: seesWholeBook(currentUser),
        permissions: permissionsOf(currentUser),
    }), [currentUser]);

    const fitsOneScreen = useFitsOneScreen();

    /**
     * The stores sheet, read live while the Live stock tab is open. Nothing of
     * it is stored here: stock is the stores team's record, kept in the sheet,
     * and this is a window onto it — see services/liveStock.ts.
     */
    const liveStock = useLiveStock(isAuthenticated && tab === 'stock', rights.runsTheTeam);
    /** Rate and value on the stock page: Admin and Manager, and only when the read actually carried them. */
    const showStockPrices = rights.runsTheTeam && liveStock.priced;


    /** Same shape as portfolioAgeing, but only what this person is chasing. */
    const myAgeing = useMemo(() => ageingTotals(outstandingData), [outstandingData]);

    /** The company's worklist boxes (Today for whoever reads the whole book). */
    const fourBoxesSummary = useMemo(() => worklistSummary(appData, startOfToday()), [appData]);

    /** The same boxes over this person's slice of the book. */
    const userBoxMetrics = useMemo(() => worklistSummary(outstandingData, startOfToday()), [outstandingData]);


    const cashFlowForecastMetrics = useMemo(() => cashFlowForecast(outstandingData, startOfToday()), [outstandingData]);

    const notificationSummary = useMemo(() => attentionCounts(outstandingData, startOfToday()), [outstandingData]);


    /** Per-CRM collection workload; see crmPerformance(). */
    const crmPerformanceStats = useMemo(() => crmPerformance(outstandingData, users, startOfToday()), [outstandingData, users]);

    /** Cheques this person is responsible for, and where they stand today; see chequeSummary(). */
    const todayPdcMetrics = useMemo(() => chequeSummary(pdcCheques, currentUser, appData, new Date()), [pdcCheques, currentUser, appData]);

    const renderCustomerListView = () => (
        <CustomerDashboardView
            data={appData}
            globalSearch={searchTerm}
            onGlobalSearch={setSearchTerm}
            currentUser={currentUser}
            users={users}
            onAddCustomer={handleOpenAddCustomer}
            onEditCustomer={handleOpenEditCustomer}
            onDeleteCustomer={handleDeleteCustomer}
            onVisibleRowsChange={onBookRowsChange}
            onFollowUp={handleOpenFollowUp}
            onWhatsApp={handleSendWhatsApp}
            onOpenPdcForCustomer={handleOpenPdcForCustomer}
            onReassignCrm={handleReassignCrm}
            onBulkReassignCrm={handleBulkReassignCrm}
            onBulkSetRank={rights.canEditCustomer ? handleBulkSetRank : undefined}
            onBulkSetFollowUp={rights.isAdmin ? handleBulkSetFollowUp : undefined}
            pdcCheques={pdcCheques}
            onSyncSheet={rights.canSyncSheets ? () => handleGoogleSync() : undefined}
            isSyncing={isSyncing}
            lastUpdatedTill={sheetUpdatedTillDate}
            onExportExcel={handleExportCustomerExcel}
        />
    );

    // Unified User Dashboard for CRM and Collector
    const renderLiveStock = () => (
        <LiveStockView
            items={liveStock.items}
            fetchedAt={liveStock.fetchedAt}
            loading={liveStock.loading}
            error={liveStock.error}
            fromCache={liveStock.fromCache}
            onRefresh={liveStock.refresh}
            currentUser={currentUser}
            showPrices={showStockPrices}
            globalSearch={stockSearch}
        />
    );

    // Don't flash the login screen while an existing session is being restored.
    if (restoringSession) {
        return (
            <div className="min-h-screen bg-bg grid place-items-center">
                <div className="flex items-center gap-3 text-label-2">
                    <span className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    <span className="text-[14px] font-semibold">Restoring your session…</span>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <LoginScreen onLogin={handleLogin} />
        );
    }

    if (!currentUser) return null;


    const wholeBook = rights.seesWholeBook;
    const boxes = wholeBook ? fourBoxesSummary : userBoxMetrics;

    // Needs-attention count drives the badge on"Today" - overdue first,
    // because that is what actually costs the company money.
    const attentionCount = boxes.todayCount + boxes.overdueCount;

    const workItems: NavItem[] = [
        { key: 'overview', label: 'Today', icon: <TodayIcon />, badge: attentionCount, badgeTone: boxes.overdueCount > 0 ? 'dang' : 'neutral' },
        { key: 'customers', label: wholeBook ? 'Customers' : 'My customers', icon: <BookIcon /> },
        { key: 'pdc', label: 'PDC cheques', icon: <ChequeNavIcon />, badge: todayPdcMetrics.todayCount, badgeTone: 'warn' },
        { key: 'reports', label: wholeBook ? 'Reports' : 'My performance', icon: <ChartIcon /> },
        // Everyone: a CRM on a call needs to know what is on the shelf as much
        // as a manager does. Read-only for all, so no right gates it.
        { key: 'stock', label: 'Live stock', icon: <StockIcon /> },
    ];

    // Setup is per role: only an Admin manages logins, and only Admin and
    // Manager may write templates or change the data source — which is exactly
    // what the templates and app_settings policies allow in the database.
    const setupItems: NavItem[] = [
        ...(rights.isAdmin ? [{ key: 'users', label: 'Team & access', icon: <TeamIcon /> }] : []),
        ...(rights.canSyncSheets
            ? [
                  { key: 'alerts', label: 'Alerts & reminders', icon: <BellIcon /> },
                  { key: 'templates', label: 'Message templates', icon: <MessageIcon /> },
                  { key: 'source', label: 'Data source', icon: <PlugIcon /> },
              ]
            : []),
    ];

    const navGroups: NavGroup[] = setupItems.length
        ? [{ items: workItems }, { heading: 'Setup', items: setupItems }]
        : [{ items: workItems }];

    // A tab that is not in this person's navigation must not render either,
    // whatever the tab state happens to be holding.
    const allowedKeys = new Set([...workItems, ...setupItems].map(i => i.key));
    const safeKey = allowedKeys.has(tab) ? tab : 'overview';

    const PAGE_TITLE: Record<string, string> = {
        overview: wholeBook ? 'Collections overview' : 'Today\u2019s follow-ups',
        customers: wholeBook ? 'Customer book' : 'My customers',
        pdc: 'Post-dated cheques',
        reports: wholeBook ? 'Reports' : 'My performance',
        stock: 'Live stock',
        users: 'Team & access',
        alerts: 'Alerts & reminders',
        templates: 'Message templates',
        source: 'Data source',
    };

    /**
     * Count what there is to collect, not how many customers exist.
     *
     * The Customer Master sheet brings in the whole customer list; most of them
     * owe nothing today. Counting all of them made the dashboard claim
     * thousands of accounts against a figure earned by a few hundred.
     */
    const scopeRows = wholeBook ? appData : outstandingData;
    const withDues = scopeRows.filter(hasOutstanding).length;
    const noDues = scopeRows.length - withDues;

    const scopeLabel = `${withDues.toLocaleString('en-IN')} ${
        wholeBook ? 'accounts with dues company-wide' : 'accounts with dues assigned to you'
    }${noDues > 0 ? ` · ${noDues.toLocaleString('en-IN')} settled` : ''}`;

    const totalBook = (wholeBook ? appData : outstandingData)
        .reduce((s, r) => s + (r.totalType === 'Cr' ? 0 : (r.total || 0)), 0);

    /**
     * The screen for the tab. Today is the one screen that differs by who is
     * looking: anyone who reads the whole book gets the company view (Admin,
     * Manager, Viewer), anyone who owns a slice of it gets the personal one
     * (CRM, Collector) — decided by what they can see, not their job title,
     * which is what once left Manager and Viewer on an "invalid role" page.
     * Every other tab is the same component for everyone; the setup tabs
     * render only for the roles whose navigation offers them.
     */
    const renderTab = () => {
        if (!currentUser) return null;
        const filtersActive = categoryFilter !== 'all' || !!statusFilter || priorityFilter || unattendedFilter;
        return (
            <>
                {safeKey === 'overview' && (wholeBook ? (
                    <CompanyToday
                        fourBoxesSummary={fourBoxesSummary}
                        portfolioAgeing={portfolioAgeing}
                        todayPdcMetrics={todayPdcMetrics}
                        cashFlowForecastMetrics={cashFlowForecastMetrics}
                        crmPerformanceStats={crmPerformanceStats}
                        notificationSummary={notificationSummary}
                        runsTheTeam={rights.runsTheTeam}
                        scrollInside={!rights.runsTheTeam && fitsOneScreen}
                        showNotificationBanner={showNotificationBanner}
                        onViewPriority={handleViewPriorityItems}
                        onDismissBanner={() => setShowNotificationBanner(false)}
                        categoryFilter={categoryFilter}
                        filtersActive={filtersActive || reportCrm !== 'ALL' || reportAgeing !== 'all'}
                        onClearFilters={handleClearFilters}
                        openReport={openReport}
                        onOpenTodayPdc={handleOpenTodayPdc}
                        onAddPdc={() => handleOpenAddPdc()}
                    />
                ) : (
                    <PersonalToday
                        userBoxMetrics={userBoxMetrics}
                        myAgeing={myAgeing}
                        todayPdcMetrics={todayPdcMetrics}
                        cashFlowForecastMetrics={cashFlowForecastMetrics}
                        notificationSummary={notificationSummary}
                        filteredData={filteredData}
                        searchTerm={searchTerm}
                        fitsOneScreen={fitsOneScreen}
                        showNotificationBanner={showNotificationBanner}
                        onViewPriority={handleViewPriorityItems}
                        onDismissBanner={() => setShowNotificationBanner(false)}
                        categoryFilter={categoryFilter}
                        filtersActive={filtersActive}
                        onCategory={handleCategoryBoxClick}
                        onClearFilters={handleClearFilters}
                        onOpenFullList={() => setTab('customers')}
                        onFollowUp={handleOpenFollowUp}
                        onWhatsApp={handleSendWhatsApp}
                        onOpenTodayPdc={handleOpenTodayPdc}
                        onAddPdc={() => handleOpenAddPdc()}
                        canManagePdc={rights.canManagePdc}
                        canEditFollowUp={rights.canEditFollowUp}
                    />
                ))}

                {safeKey === 'customers' && renderCustomerListView()}

                {safeKey === 'pdc' && (
                    <Card className="p-6 max-md:p-0 max-md:bg-transparent max-md:shadow-none">
                        <PdcChequesView
                            pdcCheques={pdcCheques}
                            customers={appData}
                            users={users}
                            currentUser={currentUser!}
                            onAddPdc={() => handleOpenAddPdc()}
                            onEditPdc={handleOpenEditPdc}
                            onDeletePdc={handleDeletePdc}
                            onUpdatePdcStatus={handleUpdatePdcStatus}
                            onBulkPdcStatus={rights.canManagePdc ? handleBulkPdcStatus : undefined}
                            onBulkDeletePdc={rights.canManagePdc ? handleBulkDeletePdc : undefined}
                            onOpenCustomerFollowUp={handleOpenFollowUp}
                            initialCustomerFilter={pdcInitialCustomerFilter || undefined}
                            initialStatusFilter={pdcInitialStatusFilter || undefined}
                            loading={!serverLoaded}
                            unsaved={syncStatuses.cheques?.failed ?? []}
                        />
                    </Card>
                )}

                {safeKey === 'stock' && renderLiveStock()}

                {/* The setup pages bring their own cards; only the reports keep the
                    frame, which steps out of the way on a phone where they bring theirs. */}
                {safeKey === 'users' && rights.isAdmin && (
                    <TeamView
                        users={users}
                        onAdd={() => handleOpenUserModal(null)}
                        onEdit={handleOpenUserModal}
                        onRemove={handleDeleteUser}
                        companyProfile={companyProfile}
                        onSaveCompanyProfile={handleSaveCompanyProfile}
                    />
                )}
                {safeKey === 'alerts' && rights.canSyncSheets && (
                    <AlertsView canEdit={rights.canSyncSheets} />
                )}
                {/* Reports keep the frame for whoever reads the whole book; it steps out of the way on a phone, and the personal view brings its own. */}
                {safeKey === 'reports' && (wholeBook ? (
                    <div className="bg-card rounded-lg shadow-md p-6 max-md:p-0 max-md:bg-transparent max-md:shadow-none">
                        <ReportsView
                            data={appData}
                            users={users}
                            currentUser={currentUser!}
                            companyProfile={companyProfile}
                            initialCrmFilter={!wholeBook && currentUser?.role === UserRole.CRM ? currentUser.id : reportCrm}
                            initialCategoryFilter={categoryFilter}
                            initialAgeingFilter={reportAgeing}
                            globalSearch={searchTerm}
                            onGlobalSearch={setSearchTerm}
                            onFollowUp={handleOpenFollowUp}
                            onWhatsApp={handleSendWhatsApp}
                            onBulkSetRank={rights.canEditCustomer ? handleBulkSetRank : undefined}
                            onBulkReassignCrm={rights.canReassignCrm ? handleBulkReassignCrm : undefined}
                            onBulkSetFollowUp={rights.isAdmin ? handleBulkSetFollowUp : undefined}
                            pdcCheques={pdcCheques}
                            onOpenPdcForCustomer={handleOpenPdcForCustomer}
                        />
                    </div>
                ) : (
                    <ReportsView
                        data={appData}
                        users={users}
                        currentUser={currentUser!}
                        companyProfile={companyProfile}
                        initialCrmFilter={!wholeBook && currentUser?.role === UserRole.CRM ? currentUser.id : reportCrm}
                        initialCategoryFilter={categoryFilter}
                        initialAgeingFilter={reportAgeing}
                        globalSearch={searchTerm}
                        onGlobalSearch={setSearchTerm}
                        onFollowUp={handleOpenFollowUp}
                        onWhatsApp={handleSendWhatsApp}
                        onBulkSetRank={rights.canEditCustomer ? handleBulkSetRank : undefined}
                        onBulkReassignCrm={rights.canReassignCrm ? handleBulkReassignCrm : undefined}
                        onBulkSetFollowUp={rights.isAdmin ? handleBulkSetFollowUp : undefined}
                        pdcCheques={pdcCheques}
                        onOpenPdcForCustomer={handleOpenPdcForCustomer}
                    />
                ))}
                {safeKey === 'templates' && rights.canSyncSheets && (
                    <TemplatesView
                        templates={templates}
                        onAdd={() => handleOpenTemplateModal(null)}
                        onEdit={handleOpenTemplateModal}
                        onRemove={handleDeleteTemplate}
                    />
                )}
                {safeKey === 'source' && rights.canSyncSheets && (
                    <DataSourceView
                        isAdmin={rights.isAdmin}
                        dataSourceMode={dataSourceMode}
                        onDataSourceMode={source.setDataSourceMode}
                        googleSheetUrl={googleSheetUrl}
                        onGoogleSheetUrl={source.setGoogleSheetUrl}
                        officialSheetUrl={OFFICIAL_TRANSACTIONS_SHEET_URL}
                        customerMasterSheetUrl={customerMasterSheetUrl}
                        onCustomerMasterSheetUrl={source.setCustomerMasterSheetUrl}
                        officialMasterUrl={OFFICIAL_CUSTOMER_MASTER_URL}
                        liveStockSheetUrl={LIVE_STOCK_SHEET_URL}
                        lastSyncTime={lastSyncTime}
                        sheetUpdatedTillDate={sheetUpdatedTillDate}
                        accountsWithDues={appData.filter(hasOutstanding).length}
                        isSyncing={isSyncing}
                        sheetCheck={source.sheetCheck}
                        onSync={() => handleGoogleSync()}
                        onCheckSheet={source.handleCheckSheet}
                        onReviewCheck={source.handleReviewCheck}
                        onFileChange={source.handleFileChange}
                        expectedHeaders={EXPECTED_HEADERS}
                        onDownloadTemplate={downloadTemplate}
                        onCopyHeaders={source.copyHeaders}
                        onImportCustomers={() => handleCustomerMasterSync(undefined, { confirmed: true })}
                        crmConflicts={source.crmConflicts}
                        onExportCrmAssignments={source.handleExportCrmAssignments}
                        onFreshStart={source.handleResetAllDataAndUsers}
                    />
                )}
            </>
        );
    };

    /**
     * Hold the placeholder until the book has actually arrived.
     *
     * updateViewData() sets loading true and false again as soon as it has
     * scoped whatever appData holds — which, on the first pass after sign-in, is
     * nothing. The dashboard therefore painted "0 accounts with dues · ₹0
     * outstanding" over a book worth eleven crore before the real figures
     * replaced them a moment later.
     */
    const showSkeleton = loading || (isSupabaseConfigured && isAuthenticated && !serverLoaded);

    /**
     * A refused save is not a passing message: it stays in the banner, with
     * the reason and a way to try again, until the server accepts it. A
     * transient message (a sync result, a bulk action's outcome) takes the
     * banner over while it lasts.
     */
    const refusedBanner = saveStatus.failed.length && !syncMessage ? {
        type: 'error' as const,
        text: `${saveStatus.failed.length} change${saveStatus.failed.length === 1 ? '' : 's'} could not be saved: ${saveStatus.failed[0].message}. `
            + `${saveStatus.failed.length === 1 ? 'It is' : 'They are'} kept in this tab`
            + (saveStatus.retryAt ? ` and will be tried again in ${Math.max(1, Math.round((saveStatus.retryAt - Date.now()) / 1000))}s.` : ' and will be tried again.'),
        action: { label: saveStatus.saving ? 'Retrying…' : 'Retry now', run: retryAllSaves },
        dismissable: false,
    } : null;
    const bannerMessage = syncMessage ? { ...syncMessage, dismissable: true } : refusedBanner;
    const shellBanner = bannerMessage ? (
        <div className="px-3 sm:px-5 lg:px-7 pt-4">
            <div
                role={bannerMessage.type === 'error' ? 'alert' : 'status'}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                    bannerMessage.type === 'success'
                        ? 'bg-pos-bg border-pos text-pos'
                        : 'bg-dang-bg border-dang text-dang'
                }`}
            >
                <span className="mt-0.5 flex-none">
                    {bannerMessage.type === 'success'
                        ? <CheckCircleIcon className="w-[18px] h-[18px]" />
                        : <ExclamationTriangleIcon className="w-[18px] h-[18px]" />}
                </span>
                <p className="text-[14px] font-medium flex-1 leading-snug">{bannerMessage.text}</p>
                {bannerMessage.action && (
                    <button
                        onClick={bannerMessage.action.run}
                        disabled={saveStatus.saving && bannerMessage === refusedBanner}
                        className="text-[13px] font-bold underline underline-offset-2 whitespace-nowrap flex-none disabled:opacity-60"
                    >
                        {bannerMessage.action.label}
                    </button>
                )}
                {bannerMessage.dismissable && (
                    <button
                        onClick={() => setSyncMessage(null)}
                        className="opacity-55 hover:opacity-100 flex-none leading-none text-lg"
                        aria-label="Dismiss"
                    >
                        &times;
                    </button>
                )}
            </div>
        </div>
    ) : null;

    return (
        <>
        <AppShell
            currentUser={currentUser}
            groups={navGroups}
            activeKey={safeKey}
            // Today is a glance, not a document: for everyone working a book it
            // is held to one screen, and the account list scrolls inside its own
            // panel. Managers and Admins keep a scrolling page — they have the
            // team table under it, which is a read rather than a glance.
            fitViewport={safeKey === 'overview' && !rights.runsTheTeam && fitsOneScreen}
            onNavigate={setTab}
            onLogout={handleLogout}
            onChangePassword={() => setIsPasswordModalOpen(true)}
            title={PAGE_TITLE[safeKey] || 'Timely Payment'}
            subtitle={
                // The stock page is about the stores sheet, not the book: its
                // own figures, and none of the book's dates under them.
                safeKey === 'stock' ? (
                    liveStock.items.length ? (
                        <span className="inline-flex items-center gap-2 flex-wrap">
                            <span>{liveStock.items.length.toLocaleString('en-IN')} items</span>
                            {showStockPrices && (
                                <>
                                    <span className="text-label-3">&middot;</span>
                                    <span className="num font-semibold text-label-2">{formatCompact(liveStock.items.reduce((a, i) => a + i.value, 0))}</span>
                                    <span>in stock</span>
                                </>
                            )}
                            <span className="text-label-3">&middot;</span>
                            <span className={liveStock.error ? 'text-warn font-semibold' : 'text-pos font-semibold'}>
                                {liveStock.error ? 'sheet unreachable' : liveStock.fromCache ? 'last read' : 'live from the stores sheet'}
                            </span>
                        </span>
                    ) : (
                        <span className="text-label-3">Reading the stores sheet…</span>
                    )
                ) :
                // Counting an empty book while it is still loading states a
                // figure that is not merely unknown but wrong.
                showSkeleton ? (
                    <span className="text-label-3">Loading the book…</span>
                ) : (
                <span className="inline-flex items-center gap-2 flex-wrap">
                    <span>{scopeLabel}</span>
                    <span className="text-label-3">&middot;</span>
                    <span className="num font-semibold text-label-2">{formatCompact(totalBook)}</span>
                    <span>outstanding</span>
                </span>
                )
            }
            searchTerm={searchScopeFor(safeKey) === 'stock' ? stockSearch : searchTerm}
            onSearch={searchScopeFor(safeKey) === 'stock' ? setStockSearch : setSearchTerm}
            searchPlaceholder={safeKey === 'stock' ? 'Search stock by item, brand, category' : undefined}
            searchPlaceholderShort={safeKey === 'stock' ? 'Search stock' : undefined}
            onSync={rights.canSyncSheets ? () => handleGoogleSync() : undefined}
            isSyncing={isSyncing}
            readOnly={rights.isViewer}
            dataAsOf={safeKey === 'stock' ? undefined : sheetUpdatedTillDate}
            lastSyncTime={safeKey === 'stock' ? undefined : lastSyncTime}
            banner={shellBanner}
            saveStatus={syncEnabled ? (
                <SaveStatus status={saveStatus} refreshedAt={refreshedAt} refreshing={refreshing} onRetry={retryAllSaves} onRefresh={() => { void refreshBook(); }} />
            ) : undefined}
        >
            {showSkeleton ? (
                // The shape of what is coming, rather than a spinner over an
                // empty page: four thousand accounts take a moment to arrive and
                // the page should not jump when they do.
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                        {[0, 1, 2, 3].map(i => (
                            <div key={i} className="bg-card rounded-[16px] shadow-e1 px-5 py-4" aria-hidden="true">
                                <div className="h-2.5 w-24 rounded bg-card-3" />
                                <div className="h-7 w-16 rounded bg-card-3 mt-3" />
                                <div className="h-2.5 w-28 rounded bg-card-2 mt-3" />
                            </div>
                        ))}
                    </div>
                    <Card className="overflow-hidden">
                        <LoadingList label="Loading the collections book" rows={9} />
                    </Card>
                </div>
            ) : (
                /* The tab views arrive as their own chunks the first time they
                   are opened; until then the same list placeholder the book uses. */
                <Suspense fallback={<Card className="overflow-hidden"><LoadingList label="Loading" rows={6} /></Card>}>
                    {renderTab()}
                </Suspense>
            )}
        </AppShell>
        <Suspense fallback={null}>

            {liveSelectedCustomer && (
                <FollowUpModal
                    customer={liveSelectedCustomer}
                    onClose={customers.handleCloseModal}
                    onUpdate={customers.handleUpdateOutstanding}
                    currentUser={currentUser}
                    users={users}
                    templates={templates}
                    pdcCheques={pdcCheques}
                    onAddPdc={handleOpenAddPdc}
                    onUpdatePdcStatus={handleUpdatePdcStatus}
                    onEditCustomer={handleOpenEditCustomer}
                    position={customers.followUpPosition}
                    onNavigate={customers.handleNavigateFollowUp}
                />
            )}
            <ConfirmDialog
                open={!!ask}
                title={ask?.title || ''}
                confirmLabel={ask?.confirmLabel || 'Confirm'}
                tone={ask?.tone}
                onCancel={() => setAsk(null)}
                onConfirm={() => { const a = ask; setAsk(null); a?.run(); }}
            >
                {ask?.body}
            </ConfirmDialog>
            {isPasswordModalOpen && (
                <ChangePasswordModal
                    onClose={() => setIsPasswordModalOpen(false)}
                    onDone={() => {
                        setIsPasswordModalOpen(false);
                        notify('success', 'Your password has been changed.');
                    }}
                />
            )}
            {team.userDialog && (
                <UserModal
                    userToEdit={team.userDialog.user}
                    onClose={team.handleCloseUserModal}
                    onSave={team.handleSaveUser}
                />
            )}
            {templatesFeature.templateDialog && (
                <TemplateModal
                    templateToEdit={templatesFeature.templateDialog.template}
                    onClose={templatesFeature.handleCloseTemplateModal}
                    onSave={templatesFeature.handleSaveTemplate}
                />
            )}
            {cheques.chequeDialog && (
                <PdcModal
                    isOpen
                    onClose={cheques.closeChequeDialog}
                    onSave={handleSavePdc}
                    customers={appData}
                    currentUser={currentUser!}
                    chequeToEdit={cheques.chequeDialog.cheque}
                    preselectedCustomerId={cheques.chequeDialog.customerId}
                    existingCheques={pdcCheques}
                    users={users}
                />
            )}
            {resetPlan && (
                <ResetConfirmModal
                    plan={resetPlan}
                    onDownloadBackup={source.handleDownloadResetBackup}
                    onConfirm={source.handleConfirmReset}
                    onCancel={() => source.setResetPlan(null)}
                />
            )}
            {pendingSync && (
                <SyncReconciliationModal
                    existingRecords={appData}
                    incomingRecords={pendingSync.records}
                    updatedTillDate={pendingSync.updatedTillDate}
                    sourceName={pendingSync.sourceName}
                    onConfirm={source.handleConfirmSyncReconciliation}
                    onCancel={source.handleCancelSyncReconciliation}
                />
            )}
            {customers.whatsAppCustomer && (
                <WhatsAppReminderModal
                    customer={customers.whatsAppCustomer}
                    templates={templates}
                    currentUser={currentUser}
                    onClose={customers.closeWhatsApp}
                />
            )}
        </Suspense>
            {customers.customerDialog && (
                <CustomerEditModal
                    customerToEdit={customers.customerDialog.customer}
                    onClose={customers.closeCustomerDialog}
                    onSave={customers.handleSaveCustomer}
                    currentUser={currentUser}
                    users={users}
                />
            )}
        </>
    );
};

export default App;
