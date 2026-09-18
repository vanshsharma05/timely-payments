import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { EXPECTED_HEADERS, downloadTemplate, exportCustomersExcel } from './services/excel';
import { isSupabaseConfigured } from './services/supabaseClient';
import * as repo from './services/repository';
import { SyncPassResult, SaveOutcome, outcomeFor } from './services/useSupabaseSync';
import { SaveStatus } from './components/SaveStatus';
import { searchScopeFor } from './services/search';
import { useTab, useFitsOneScreen } from './hooks/useTab';
import { usePersistence } from './hooks/usePersistence';
import { useDataSource } from './hooks/useDataSource';
import { useCheques } from './hooks/useCheques';
import { useTeam } from './hooks/useTeam';
import { useTemplates } from './hooks/useTemplates';
import { Outstanding, User, UserRole, FollowUpStatus, Template, PdcCheque, CompanyProfile, DEFAULT_COMPANY_PROFILE, DEFAULT_TEMPLATE, DEFAULT_ROLE_PERMISSIONS, getFollowUpCategory, can, permissionsOf, seesWholeBook, hasOutstanding, PAYMENT_RANK_LABELS, PaymentRank, findOwner, isBadDebt } from './types';
import { getOutstandingForUser, processStatuses, OFFICIAL_TRANSACTIONS_SHEET_URL, OFFICIAL_CUSTOMER_MASTER_URL } from './services/googleSheetService';
import { CustomerDashboardView } from './components/CustomerDashboardView';
import { CustomerEditModal } from './components/CustomerEditModal';
import CrmPerformanceTable from './components/CrmPerformanceTable';
import LoginScreen from './components/LoginScreen';
import AppShell, { NavGroup, NavItem } from './components/shell/AppShell';
import { TodayIcon, BookIcon, ChequeNavIcon, ChartIcon, StockIcon, TeamIcon, MessageIcon, PlugIcon, BellIcon } from './components/shell/NavIcons';
const LiveStockView = lazy(() => import('./components/LiveStockView'));
import { useLiveStock, LIVE_STOCK_SHEET_URL } from './services/liveStock';
import { formatCompact, formatDate, formatDateShort, formatINR, relativeDays, dateFromLocalIso, startOfToday } from './components/ui/format';
import { ageingTotals, worklistSummary, filterWorklist, cashFlowForecast, attentionCounts, crmPerformance, chequeSummary } from './services/metrics';
import { Stat, Card, SectionHeader, AgeingBar, AgeingLegend, AGE_BANDS, Badge, Button, EmptyState, LoadingList } from './components/ui/Primitives';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { BadDebtStrip } from './components/ui/BadDebtStrip';
import { CheckCircleIcon, ExclamationTriangleIcon } from './components/icons/Icons';
import FollowUpModal from './components/FollowUpModal';
import AlertsView from './components/AlertsView';
const UserModal = lazy(() => import('./components/UserModal'));
const ChangePasswordModal = lazy(() => import('./components/ChangePasswordModal'));
const TemplateModal = lazy(() => import('./components/TemplateModal'));
import NotificationBanner from './components/NotificationBanner';
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

    /** The screen the app is on; mirrored to the URL hash (hooks/useTab.ts). */
    const [tab, setTab] = useTab(isAuthenticated);

    // This state holds the"Master" data for the application
    const [appData, setAppData] = useState<Outstanding[]>([]);
    
    // This state holds the filtered data for the current view
    const [outstandingData, setOutstandingData] = useState<Outstanding[]>([]);
    
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    /** Live stock's own term: a customer searched in the book must not empty the stock list (services/search.ts). */
    const [stockSearch, setStockSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<FollowUpStatus | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<FollowUpCategoryFilter>('all');
    // What Reports opens on when a manager arrives from Today: a person (the
    // team table) and an ageing band (the portfolio card). 'ALL' / 'all' = no filter.
    const [reportCrm, setReportCrm] = useState<string>('ALL');
    const [reportAgeing, setReportAgeing] = useState<AgeingReportFilter>('all');
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState<Outstanding | null>(null);

    const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
    const [whatsAppCustomer, setWhatsAppCustomer] = useState<Outstanding | null>(null);

    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    /**
     * A question before something that cannot be undone, asked in the app.
     * The browser's confirm() could not name the record, styled "OK" as the
     * destructive answer, and looked nothing like the rest of the app.
     */
    const [ask, setAsk] = useState<{ title: string; body: React.ReactNode; confirmLabel: string; tone?: 'danger' | 'primary'; run: () => void } | null>(null);
    // PDC (Post Dated Cheques) State
    const [pdcCheques, setPdcCheques] = useState<PdcCheque[]>([]);

    // Company Profile state
    const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);


    const handleSaveCompanyProfile = (updated: CompanyProfile) => {
        setCompanyProfile(updated);
        setSyncMessage({ type: 'success', text: 'Company profile details updated successfully.' });
        setTimeout(() => setSyncMessage(null), 4000);
    };

    const [templates, setTemplates] = useState<Template[]>([DEFAULT_TEMPLATE]);
    const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error', text: string, action?: { label: string; run: () => void } } | null>(null);

    /** Banner at the top of the shell. Errors linger; confirmations do not. */
    const notify = useCallback((type: 'success' | 'error', text: string) => {
        setSyncMessage({ type, text });
        window.setTimeout(() => setSyncMessage(null), type === 'error' ? 12000 : 5000);
    }, []);
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

    // State for notifications
    const [priorityFilter, setPriorityFilter] = useState(false);
    const [unattendedFilter, setUnattendedFilter] = useState(false);
    const [showNotificationBanner, setShowNotificationBanner] = useState(true);

    // Customer Add / Edit State
    const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
    const [customerToEdit, setCustomerToEdit] = useState<Outstanding | null>(null);

    const handleOpenAddCustomer = () => {
        setCustomerToEdit(null);
        setIsCustomerModalOpen(true);
    };

    const handleOpenEditCustomer = (customer: Outstanding) => {
        setCustomerToEdit(customer);
        setIsCustomerModalOpen(true);
    };

    /**
     * The dialog waits for the server's verdict: the record goes into the
     * book at once (so the tab keeps it and retries if need be), but the
     * dialog only closes, and "saved" is only said, once the write was
     * accepted. A refusal goes back to the dialog, which stays open with
     * everything typed still in it.
     */
    const handleSaveCustomer = async (savedCustomer: Outstanding): Promise<SaveOutcome> => {
        const isExisting = appData.some(c => c.id === savedCustomer.id);
        let updated: Outstanding[];
        if (isExisting) {
            updated = appData.map(c => c.id === savedCustomer.id ? savedCustomer : c);
        } else {
            updated = [savedCustomer, ...appData];
        }
        const processed = processStatuses(updated);
        setAppData(processed);
        const outcome = outcomeFor(savedCustomer.id, await customersSync.flush());
        if (outcome.ok) {
            setIsCustomerModalOpen(false);
            setCustomerToEdit(null);
            notify('success', `Customer "${savedCustomer.company}" ${isExisting ? 'updated' : 'added'}.`);
        }
        return outcome;
    };

    const handleDeleteCustomer = (customerId: string) => {
        const target = appData.find(c => c.id === customerId);
        if (!target) return;
        const cheques = pdcCheques.filter(p => p.customerId === customerId).length;
        setAsk({
            title: 'Delete this customer?',
            confirmLabel: 'Delete customer',
            body: <>
                <p><strong className="text-label">{target.company}</strong>{target.contactPerson ? ` · ${target.contactPerson}` : ''} · balance <span className="num font-semibold text-label">{formatINR(target.total || 0)}</span>{cheques ? ` · ${cheques} cheque${cheques === 1 ? '' : 's'} in the register` : ''}.</p>
                <p className="mt-2">The account, its contacts, notes, follow-up history{cheques ? ' and its cheques' : ''} leave the book for everyone. This cannot be undone. A customer who has simply paid up should be left in place — the sheet settles them to zero.</p>
            </>,
            run: () => {
                const updated = appData.filter(c => c.id !== customerId);
                const processed = processStatuses(updated);
                setAppData(processed);
                void customersSync.flush().then(r => {
                    const failed = r.failed.find(f => f.id === customerId);
                    if (failed) notify('error', `Could not delete "${target.company}": ${failed.message}. It will be tried again.`);
                    else notify('success', `Customer "${target.company}" deleted.`);
                });
            },
        });
    };

    const handleExportCustomerExcel = (rowsToExport: Outstanding[] = appData) => exportCustomersExcel(rowsToExport, appData.length);




    // =====================================================================
    // Supabase backend
    //
    // Supabase is the master record: state is hydrated from it on sign-in and
    // every change is written back, so the whole team shares one dataset.
    // Without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY the app does not run
    // at all — LoginScreen says so rather than pretending to work.
    // =====================================================================
    const [serverLoaded, setServerLoaded] = useState(false);
    const [restoringSession, setRestoringSession] = useState(isSupabaseConfigured);

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
    dialogOpenRef.current = !!selectedCustomer || isCustomerModalOpen || !!cheques.chequeDialog || !!resetPlan || !!pendingSync;
    /** Team & access (hooks/useTeam.tsx) and message templates (hooks/useTemplates.tsx). */
    const team = useTeam({ users, setUsers, currentUser, setCurrentUser, notify, ask: setAsk });
    const { handleOpenUserModal, handleDeleteUser } = team;
    const templatesFeature = useTemplates({ templates, setTemplates, ask: setAsk });
    const { handleOpenTemplateModal, handleDeleteTemplate } = templatesFeature;



    // Update the view when Current User changes or Master Data changes
    const updateViewData = useCallback(async () => {
        if (!currentUser) return;
        setLoading(true);
        try {
            // Filter the master data based on user role
            const userViewData = await getOutstandingForUser(currentUser, appData);
            setOutstandingData(userViewData);
        } catch (err) {
            setError('Failed to process data view.');
        } finally {
            setLoading(false);
        }
    }, [currentUser, appData]);

    useEffect(() => {
        if (isAuthenticated && currentUser) updateViewData();
    }, [updateViewData, currentUser, isAuthenticated]);

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
        setOutstandingData([]);
        setTab('overview');
    };

    /**
     * The list an account was opened from, so the dialog can step to the next
     * one without closing: the book's rows in their current order when it is
     * open, otherwise the Today list's.
     */
    const bookVisibleIds = useRef<string[]>([]);
    const onBookRowsChange = useCallback((ids: string[]) => { bookVisibleIds.current = ids; }, []);
    const [followUpList, setFollowUpList] = useState<string[]>([]);
    const handleOpenFollowUp = (customer: Outstanding) => {
        const source = safeKey === 'customers' ? bookVisibleIds.current : filteredData.map(c => c.id);
        setFollowUpList(source.includes(customer.id) ? source : [customer.id]);
        setSelectedCustomer(customer);
        setIsModalOpen(true);
    };
    const followUpPosition = useMemo(() => {
        if (!selectedCustomer) return undefined;
        const index = followUpList.indexOf(selectedCustomer.id);
        return index >= 0 ? { index, total: followUpList.length } : undefined;
    }, [selectedCustomer, followUpList]);
    const handleNavigateFollowUp = useCallback((direction: -1 | 1) => {
        if (!selectedCustomer) return;
        const index = followUpList.indexOf(selectedCustomer.id);
        const next = appData.find(c => c.id === followUpList[index + direction]);
        if (next) setSelectedCustomer(next);
    }, [selectedCustomer, followUpList, appData]);

    /**
     * The follow-up dialog stays open while entries are logged against the
     * account, and each one writes back. Handing it the row out of appData
     * rather than the copy taken when it opened means the second entry builds
     * on the first instead of rebuilding from a snapshot that no longer has it.
     */
    const liveSelectedCustomer = useMemo(
        () => (selectedCustomer ? appData.find(c => c.id === selectedCustomer.id) || selectedCustomer : null),
        [selectedCustomer, appData],
    );

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedCustomer(null);
    };

    /** The follow-up dialog's save: applied at once, then the server's verdict for that one account. */
    const handleUpdateOutstanding = async (updatedCustomer: Outstanding): Promise<SaveOutcome> => {
        const processedCustomer = processStatuses([updatedCustomer])[0] || updatedCustomer;
        setAppData(current => processStatuses(current.map(item =>
            item.id === processedCustomer.id ? processedCustomer : item
        )));
        return outcomeFor(updatedCustomer.id, await customersSync.flush());
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
    
    // Reassign single customer to a CRM
    const handleReassignCrm = (customerId: string, newCrmId: string) => {
        setAppData(current => current.map(item =>
            item.id === customerId ? { ...item, crmOwnerId: newCrmId } : item
        ));
        void customersSync.flush().then(r => {
            const failed = r.failed.find(f => f.id === customerId);
            if (failed) notify('error', `The owner change could not be saved: ${failed.message}. It is kept in this tab and will be retried.`);
        });
    };

    // Bulk reassign multiple customers to a CRM
    /**
     * Grades a whole selection at once.
     *
     * The agency list is hundreds of accounts; deciding which of them are truly
     * stuck is a sit-down job done against a filtered list, not one dialog at a
     * time.
     */
    const handleBulkSetRank = (customerIds: string[], rank: PaymentRank | '') => {
        const idSet = new Set(customerIds);
        setAppData(current => current.map(item =>
            idSet.has(item.id) ? { ...item, paymentRank: rank || undefined } : item
        ));
        void customersSync.flush().then(r => reportBulk(r, customerIds, rank
            ? `Marked ${customerIds.length} account${customerIds.length === 1 ? '' : 's'} as ${PAYMENT_RANK_LABELS[rank]}.`
            : `Cleared the rank on ${customerIds.length} account${customerIds.length === 1 ? '' : 's'}; they go back to being worked out from ageing.`));
    };

    const handleBulkReassignCrm = (customerIds: string[], newCrmId: string) => {
        const idSet = new Set(customerIds);
        setAppData(current => current.map(item =>
            idSet.has(item.id) ? { ...item, crmOwnerId: newCrmId } : item
        ));
        const targetCrmUser = users.find(u => u.id === newCrmId || u.name === newCrmId);
        const targetName = targetCrmUser ? targetCrmUser.name : (newCrmId || 'Unassigned');
        void customersSync.flush().then(r => reportBulk(r, customerIds, `Reassigned ${customerIds.length} customer${customerIds.length === 1 ? '' : 's'} to ${targetName}.`));
    };

    /**
     * Puts one follow-up date on a whole selection — an Admin's tool for the
     * overdue list.
     *
     * A follow-up that has gone past its date is supposed to be rescheduled by
     * the CRM who owns it. When it is not, the account sits in "Overdue" and
     * nobody is prompted to ring. Ticking those rows and setting today brings
     * them back into the day's worklist in one go, instead of opening each
     * account to move a date the owner should have moved.
     *
     * Two things are deliberate. Each account gets a system entry in its
     * activity — who moved the date, from what, and that the owner had left it
     * — so the reschedule is on the record beside the owner's name rather than
     * silently in a column. And `lastFollowUpOn` is left alone: an Admin
     * moving a date is not a follow-up, and pretending it was would hide the
     * very gap this exists to show.
     */
    const handleBulkSetFollowUp = async (customerIds: string[], isoDate: string) => {
        if (!currentUser || currentUser.role !== UserRole.Admin) return;
        const nextDate = dateFromLocalIso(isoDate);
        if (!nextDate) {
            notify('error', 'Pick a follow-up date first.');
            return;
        }
        if (nextDate.getTime() < startOfToday().getTime()) {
            notify('error', 'A follow-up date in the past would be overdue the moment it is set.');
            return;
        }

        const idSet = new Set(customerIds);
        const nextLabel = formatDate(nextDate);
        const changed: Outstanding[] = [];
        const entries: repo.NewActivity[] = [];
        let overdueMoved = 0;

        const updated = appData.map(item => {
            if (!idSet.has(item.id)) return item;

            const prev = item.followUpDate ? new Date(item.followUpDate) : undefined;
            const hadDate = !!prev && !isNaN(prev.getTime());
            const prevMidnight = hadDate ? new Date(prev!).setHours(0, 0, 0, 0) : NaN;
            const wasCompleted = item.status === FollowUpStatus.Completed;
            // Already on that date: nothing to move, nothing to record.
            if (hadDate && !wasCompleted && prevMidnight === nextDate.getTime()) return item;

            const owner = findOwner(users, item.crmOwnerId)?.name || (item.crmOwnerId || '').trim();
            const wasOverdue = getFollowUpCategory(item, startOfToday()) === 'overdue';
            let body: string;
            if (wasCompleted) {
                // "Payment collected" closes an account with the day it was
                // collected as its date, so that date is not a follow-up.
                body = `Follow-up reopened for ${nextLabel} in a bulk update; it had been closed as collected`
                    + (hadDate ? ` on ${formatDate(prev)}.` : '.');
            } else if (hadDate) {
                body = `Follow-up date moved from ${formatDate(prev)} to ${nextLabel} in a bulk update.`;
                if (wasOverdue) {
                    overdueMoved++;
                    const days = Math.max(1, Math.round((startOfToday().getTime() - prevMidnight) / 86_400_000));
                    body += owner
                        ? ` It was ${days} day${days === 1 ? '' : 's'} overdue and ${owner} had not rescheduled it.`
                        : ` It was ${days} day${days === 1 ? '' : 's'} overdue with no CRM assigned to reschedule it.`;
                }
            } else {
                body = `Follow-up date set to ${nextLabel} in a bulk update.`
                    + (owner ? ` No follow-up had been planned by ${owner}.` : ' No follow-up had been planned, and no CRM was assigned.');
            }
            entries.push({ customerId: item.id, kind: 'system', body });

            // Where the follow-up stands is read from the date; the only status
            // written here is the reopening of an account closed as collected,
            // the same way the follow-up form does it.
            const next: Outstanding = { ...item, followUpDate: nextDate, ...(wasCompleted ? { status: FollowUpStatus.Pending } : {}) };
            changed.push(next);
            return next;
        });

        if (!changed.length) {
            notify('success', `Every selected account already has its follow-up on ${nextLabel}.`);
            return;
        }

        setAppData(processStatuses(updated));

        const unchanged = customerIds.length - changed.length;
        reportBulk(await customersSync.flush(), changed.map(c => c.id),
            `Follow-up set to ${nextLabel} on ${changed.length} account${changed.length === 1 ? '' : 's'}`
            + (unchanged ? ` (${unchanged} already had it)` : '')
            + `. Each one's activity records the move`
            + (overdueMoved ? `, and for the ${overdueMoved} that were overdue, that the owner had not rescheduled it.` : '.'),
        );

        // The date is saved regardless; the record is written best-effort and
        // any failure is said out loud rather than swallowed.
        try {
            await repo.addActivities(entries, currentUser);
        } catch (e: any) {
            notify('error', `The dates are saved, but the activity note could not be written: ${e?.message || e}`);
        }
    };

    // WhatsApp Reminder Handler (opens recipient & template selector with 'Other number' option)
    const handleSendWhatsApp = (customer: Outstanding) => {
        setWhatsAppCustomer(customer);
        setIsWhatsAppModalOpen(true);
    };

    const filteredData = useMemo(
        () => filterWorklist(outstandingData, { searchTerm, statusFilter, categoryFilter, priorityFilter, unattendedFilter }, users, startOfToday()),
        [outstandingData, searchTerm, statusFilter, categoryFilter, priorityFilter, unattendedFilter, users],
    );

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

    // Shared dashboard view for Admin
    const renderAdminOverviewCards = () => (
        /* Whoever reads the whole book without running the team gets the same
           one-screen treatment as everybody else; the cards scroll inside the
           page rather than the page scrolling under them. */
        <div className={`flex flex-col gap-7 ${!rights.runsTheTeam && fitsOneScreen ? 'lg:h-full lg:min-h-0 lg:gap-5 lg:overflow-y-auto lg:pr-1.5' : ''}`}>
            {showNotificationBanner && (notificationSummary.urgentCount > 0 || notificationSummary.overdueCount > 0) && (
                <NotificationBanner
                    urgentCount={notificationSummary.urgentCount}
                    overdueCount={notificationSummary.overdueCount}
                    onView={handleViewPriorityItems}
                    onDismiss={() => setShowNotificationBanner(false)}
                />
            )}

            {/* ---------- worklist ---------- */}
            <section>
                <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3.5">
                    <div>
                        <h2 className="text-[19px] font-extrabold text-label tracking-[-0.025em]">Worklist</h2>
                        <p className="text-[13.5px] text-label-3 mt-1">The whole company's follow-ups. Press a card to see those accounts in Reports.</p>
                    </div>
                    {(categoryFilter !== 'all' || statusFilter || priorityFilter || unattendedFilter || reportCrm !== 'ALL' || reportAgeing !== 'all') && (
                        <Button size="sm" variant="ghost" onClick={handleClearFilters}>Clear filters</Button>
                    )}
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                    <Stat
                        label="Overdue"
                        tone="dang"
                        active={categoryFilter === 'overdue'}
                        onClick={() => openReport({ category: 'overdue' })}
                        value={fourBoxesSummary.overdueCount}
                        sub={<><span className="num font-semibold text-label-2">{formatCompact(fourBoxesSummary.overdueAmount)}</span> past the promised date</>}
                    />
                    <Stat
                        label="Due today"
                        tone="brand"
                        active={categoryFilter === 'today'}
                        onClick={() => openReport({ category: 'today' })}
                        value={fourBoxesSummary.todayCount}
                        sub={<><span className="num font-semibold text-label-2">{formatCompact(fourBoxesSummary.todayAmount)}</span> to chase today</>}
                    />
                    <Stat
                        label="No follow-up"
                        tone="warn"
                        active={categoryFilter === 'no_follow_up'}
                        onClick={() => openReport({ category: 'no_follow_up' })}
                        value={fourBoxesSummary.noFollowUpCount}
                        sub={<><span className="num font-semibold text-label-2">{formatCompact(fourBoxesSummary.noFollowUpAmount)}</span> with nothing planned</>}
                    />
                    <Stat
                        label="Upcoming"
                        tone="pos"
                        active={categoryFilter === 'future'}
                        onClick={() => openReport({ category: 'future' })}
                        value={fourBoxesSummary.futureCount}
                        sub={<><span className="num font-semibold text-label-2">{formatCompact(fourBoxesSummary.futureAmount)}</span> promised for a later date</>}
                    />
                </div>
                <BadDebtStrip
                    className="mt-3.5"
                    count={fourBoxesSummary.badDebtCount}
                    amount={fourBoxesSummary.badDebtAmount}
                    active={categoryFilter === 'bad_debt'}
                    onClick={() => openReport({ category: 'bad_debt' })}
                />
            </section>

            {/* ---------- team: who is on top of their book, and who is not ---------- */}
            {rights.runsTheTeam && (
                <CrmPerformanceTable
                    stats={crmPerformanceStats}
                    onSelectCrm={(crmId, category) => openReport({ crm: crmId.toUpperCase(), category: category ?? 'all' })}
                />
            )}

            {/* ---------- portfolio ageing ---------- */}
            <Card className="p-6">
                <SectionHeader
                    title="Portfolio ageing"
                    subtitle="How much of the book is still healthy, and how much has gone cold. Press a band to see its accounts in Reports."
                    actions={<AgeingLegend />}
                />

                <div className="flex flex-wrap items-end gap-x-12 gap-y-5 mt-7 max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-5 max-md:[&>*:first-child]:col-span-2">
                    <div>
                        <p className="label">Outstanding</p>
                        <p className="num text-[40px] font-semibold text-label leading-none mt-2.5 tracking-[-0.04em]">
                            {formatCompact(portfolioAgeing.total)}
                        </p>
                        <p className="text-[13px] text-label-3 mt-2.5">{formatINR(portfolioAgeing.total)}</p>
                    </div>
                    <button type="button" className="text-left rounded-[12px] -m-2 p-2 hover:bg-hover transition-colors" onClick={() => openReport({ ageing: 'dueOver45' })} title="Accounts with money more than 45 days overdue — open in Reports">
                        <p className="label">Past 45 days</p>
                        <p className="num text-[26px] font-semibold leading-none mt-2.5 tracking-[-0.03em]" style={{ color: 'var(--age-2-ink)' }}>
                            {formatCompact(portfolioAgeing.over45)}
                        </p>
                        <p className="text-[13px] text-label-3 mt-2.5">{portfolioAgeing.pct45}% of the book</p>
                    </button>
                    <button type="button" className="text-left rounded-[12px] -m-2 p-2 hover:bg-hover transition-colors" onClick={() => openReport({ ageing: 'over90' })} title="Accounts with money more than 90 days overdue — open in Reports">
                        <p className="label">Past 90 days</p>
                        <p className="num text-[26px] font-semibold leading-none mt-2.5 tracking-[-0.03em]" style={{ color: 'var(--age-3-ink)' }}>
                            {formatCompact(portfolioAgeing.over90)}
                        </p>
                        <p className="text-[13px] text-label-3 mt-2.5">{portfolioAgeing.pct90}% of the book</p>
                    </button>
                </div>

                <AgeingBar parts={portfolioAgeing} height={12} className="mt-7" />

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
                    {AGE_BANDS.map(band => {
                        const amount = portfolioAgeing[band.key];
                        const pct = portfolioAgeing.total > 0 ? Math.round((amount / portfolioAgeing.total) * 100) : 0;
                        const reportBand = ({ a1: '1-45', a2: '46-90', a3: '91-135', a4: 'over135' } as const)[band.key];
                        return (
                            <button key={band.key} type="button" onClick={() => openReport({ ageing: reportBand })} title={`Accounts with money ${band.label} overdue — open in Reports`} className="bg-card-2 rounded-[14px] px-4 py-3.5 text-left hover:bg-hover transition-colors">
                                <span className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: band.varName }} aria-hidden="true" />
                                    <span className="text-[13px] font-medium text-label-2">{band.label}</span>
                                </span>
                                <p className="num text-[19px] font-semibold text-label mt-2">{formatCompact(amount)}</p>
                                <p className="text-[12.5px] text-label-3 mt-1">{pct}% of book</p>
                            </button>
                        );
                    })}
                </div>
            </Card>

            {/* ---------- cheques + commitments ---------- */}
            <div className="grid lg:grid-cols-2 gap-3.5">
                <Card className="p-6 flex flex-col">
                    <SectionHeader
                        title="Cheques to present today"
                        subtitle="Post-dated cheques whose date has arrived."
                    />
                    <div className="flex items-end gap-10 mt-7 max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-5 max-md:[&>*:first-child]:col-span-2">
                        <div>
                            <p className="label">Due today</p>
                            <p className="num text-[32px] font-semibold text-label leading-none mt-2.5 tracking-[-0.03em]">
                                {todayPdcMetrics.todayCount}
                            </p>
                        </div>
                        <div>
                            <p className="label">Value</p>
                            <p className="num text-[22px] font-semibold text-label leading-none mt-2.5 tracking-[-0.02em]">
                                {formatCompact(todayPdcMetrics.todayAmount)}
                            </p>
                        </div>
                        <div>
                            <p className="label">Held in hand</p>
                            <p className="num text-[22px] font-semibold leading-none mt-2.5 tracking-[-0.02em]" style={{ color: 'var(--age-1-ink)' }}>
                                {formatCompact(todayPdcMetrics.activeAmount)}
                            </p>
                            <p className="text-[12.5px] text-label-3 mt-2">{todayPdcMetrics.activeCount} cheques</p>
                        </div>
                    </div>
                    <div className="flex gap-2.5 mt-auto pt-7 max-md:[&>button]:flex-1 max-md:[&>button]:h-11">
                        <Button size="sm" variant="primary" onClick={handleOpenTodayPdc} disabled={todayPdcMetrics.todayCount === 0}>
                            {todayPdcMetrics.todayCount > 0 ? 'Review cheques' : 'Nothing due today'}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => handleOpenAddPdc()}>Record a cheque</Button>
                    </div>
                </Card>

                <Card className="p-6 flex flex-col">
                    <SectionHeader
                        title="Committed collections"
                        subtitle="What customers have promised, and by when."
                    />
                    <div className="flex items-end gap-10 mt-7 max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-5 max-md:[&>*:first-child]:col-span-2">
                        <div>
                            <p className="label">Today</p>
                            <p className="num text-[32px] font-semibold leading-none mt-2.5 tracking-[-0.03em]" style={{ color: 'var(--age-1-ink)' }}>
                                {formatCompact(cashFlowForecastMetrics.todayForecast)}
                            </p>
                            <p className="text-[12.5px] text-label-3 mt-2">{cashFlowForecastMetrics.todayCount} commitments</p>
                        </div>
                        <div>
                            <p className="label">Next 7 days</p>
                            <p className="num text-[22px] font-semibold text-label leading-none mt-2.5 tracking-[-0.02em]">
                                {formatCompact(cashFlowForecastMetrics.weekForecast)}
                            </p>
                            <p className="text-[12.5px] text-label-3 mt-2">{cashFlowForecastMetrics.weekCount} commitments</p>
                        </div>
                        <div>
                            <p className="label">All open</p>
                            <p className="num text-[22px] font-semibold text-label leading-none mt-2.5 tracking-[-0.02em]">
                                {formatCompact(cashFlowForecastMetrics.totalForecast)}
                            </p>
                            <p className="text-[12.5px] text-label-3 mt-2">{cashFlowForecastMetrics.totalCount} accounts</p>
                        </div>
                    </div>
                    {cashFlowForecastMetrics.totalCount === 0 && (
                        <p className="text-[13px] text-label-3 mt-auto pt-7 leading-relaxed">
                            No commitments recorded yet. They appear here once a CRM logs an expected
                            amount and date on a follow-up.
                        </p>
                    )}
                </Card>
            </div>

        </div>
    );

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

    const renderUserDashboard = () => {
        // Use lifted state
        const activeTab = tab;

        return (
            <>
                {activeTab === 'overview' && (
                    /* One screen, no page scroll: the summary above stays put and the
                       account list below takes whatever height is left. Only from lg —
                       a phone scrolls, because none of this fits a phone. */
                    <div className={`flex flex-col gap-7 ${fitsOneScreen ? 'lg:h-full lg:min-h-0 lg:gap-5' : ''}`}>
                        {showNotificationBanner && (notificationSummary.urgentCount > 0 || notificationSummary.overdueCount > 0) && (
                            <NotificationBanner
                                urgentCount={notificationSummary.urgentCount}
                                overdueCount={notificationSummary.overdueCount}
                                onView={handleViewPriorityItems}
                                onDismiss={() => setShowNotificationBanner(false)}
                            />
                        )}

                        {/* ---------- my worklist ---------- */}
                        <section>
                            <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3.5 lg:mb-2.5">
                                <div>
                                    <h2 className="text-[19px] font-extrabold text-label tracking-[-0.025em]">My worklist</h2>
                                    <p className="text-[13.5px] text-label-3 mt-1">Tap a card to filter the accounts below.</p>
                                </div>
                                {(categoryFilter !== 'all' || statusFilter || priorityFilter || unattendedFilter) && (
                                    <Button size="sm" variant="ghost" onClick={handleClearFilters}>Clear filters</Button>
                                )}
                            </div>

                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                                <Stat
                                    label="Due today"
                                    tone="brand"
                                    active={categoryFilter === 'today'}
                                    onClick={() => handleCategoryBoxClick('today')}
                                    value={userBoxMetrics.todayCount}
                                    sub={<><span className="num font-semibold text-label-2">{formatCompact(userBoxMetrics.todayAmount)}</span> to chase</>}
                                />
                                <Stat
                                    label="Overdue"
                                    tone="dang"
                                    active={categoryFilter === 'overdue'}
                                    onClick={() => handleCategoryBoxClick('overdue')}
                                    value={userBoxMetrics.overdueCount}
                                    sub={<><span className="num font-semibold text-label-2">{formatCompact(userBoxMetrics.overdueAmount)}</span> past promised date</>}
                                />
                                <Stat
                                    label="No follow-up"
                                    tone="warn"
                                    active={categoryFilter === 'no_follow_up'}
                                    onClick={() => handleCategoryBoxClick('no_follow_up')}
                                    value={userBoxMetrics.noFollowUpCount}
                                    sub={<><span className="num font-semibold text-label-2">{formatCompact(userBoxMetrics.noFollowUpAmount)}</span> unattended</>}
                                />
                                <Stat
                                    label="Scheduled"
                                    tone="pos"
                                    active={categoryFilter === 'future'}
                                    onClick={() => handleCategoryBoxClick('future')}
                                    value={userBoxMetrics.futureCount}
                                    sub={<><span className="num font-semibold text-label-2">{formatCompact(userBoxMetrics.futureAmount)}</span> committed</>}
                                />
                            </div>
                            <BadDebtStrip
                                className="mt-3.5 lg:mt-2.5"
                                count={userBoxMetrics.badDebtCount}
                                amount={userBoxMetrics.badDebtAmount}
                                active={categoryFilter === 'bad_debt'}
                                onClick={() => handleCategoryBoxClick('bad_debt')}
                            />
                        </section>

                        {/* ---------- my book, and the accounts beside it ----------
                            Stacked, this ran to about a screen and a half and the
                            account list was the part pushed off the bottom — which is
                            the part the day is actually worked from. On a desktop the
                            summary takes the left column and the list takes the right,
                            full height, so nothing needs scrolling to be seen. */}
                        <div className={`flex flex-col gap-7 lg:grid lg:grid-cols-12 lg:gap-4 ${fitsOneScreen ? 'lg:flex-1 lg:min-h-0' : ''}`}>
                        {/* Scrolls only if the screen is too short to hold both cards —
                            on anything normal there is no scrollbar here at all, and
                            nothing is ever cut off on a short one. */}
                        <div className={`flex flex-col gap-3.5 lg:col-span-5 lg:gap-4 ${fitsOneScreen ? 'lg:min-h-0 lg:overflow-y-auto lg:pr-1' : ''}`}>
                            <Card className="p-6 lg:p-5 flex flex-col">
                                <SectionHeader
                                    title="My book"
                                    subtitle={<span className="lg:hidden">Everything assigned to you, by age.</span>}
                                    actions={<AgeingLegend />}
                                />
                                <div className="flex flex-wrap items-end gap-x-10 gap-y-5 mt-7 lg:mt-4 max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-5 max-md:[&>*:first-child]:col-span-2">
                                    <div>
                                        <p className="label">Outstanding</p>
                                        <p className="num text-[34px] lg:text-[27px] font-semibold text-label leading-none mt-2.5 lg:mt-1.5 tracking-[-0.04em]">
                                            {formatCompact(myAgeing.total)}
                                        </p>
                                        <p className="text-[13px] text-label-3 mt-2.5 lg:mt-1">{userBoxMetrics.totalCount} accounts</p>
                                    </div>
                                    <div>
                                        <p className="label">Past 45 days</p>
                                        <p className="num text-[22px] font-semibold leading-none mt-2.5 lg:mt-1.5 tracking-[-0.03em]" style={{ color: 'var(--age-2-ink)' }}>
                                            {formatCompact(myAgeing.over45)}
                                        </p>
                                        <p className="text-[13px] text-label-3 mt-2.5 lg:mt-1">{myAgeing.pct45}% of your book</p>
                                    </div>
                                    <div>
                                        <p className="label">Past 90 days</p>
                                        <p className="num text-[22px] font-semibold leading-none mt-2.5 lg:mt-1.5 tracking-[-0.03em]" style={{ color: 'var(--age-3-ink)' }}>
                                            {formatCompact(myAgeing.over90)}
                                        </p>
                                        <p className="text-[13px] text-label-3 mt-2.5 lg:mt-1">{myAgeing.pct90}% of your book</p>
                                    </div>
                                </div>
                                <div className="mt-auto pt-7 lg:pt-4">
                                    <AgeingBar parts={myAgeing} height={12} />
                                </div>
                            </Card>

                            <Card className="p-6 lg:p-5 flex flex-col">
                                <SectionHeader
                                    title="Cheques and commitments"
                                    subtitle={<span className="lg:hidden">Cheques to present, and what customers promised you.</span>}
                                />
                                <div className="flex items-end gap-10 mt-7 lg:mt-4 flex-wrap max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-5 max-md:[&>*:first-child]:col-span-2">
                                    <div>
                                        <p className="label">Cheques today</p>
                                        <p className="num text-[32px] lg:text-[27px] font-semibold text-label leading-none mt-2.5 lg:mt-1.5 tracking-[-0.03em]">
                                            {todayPdcMetrics.todayCount}
                                        </p>
                                        <p className="text-[12.5px] text-label-3 mt-2 lg:mt-1">{formatCompact(todayPdcMetrics.todayAmount)}</p>
                                    </div>
                                    <div>
                                        <p className="label">Held in hand</p>
                                        <p className="num text-[22px] font-semibold leading-none mt-2.5 lg:mt-1.5 tracking-[-0.02em]" style={{ color: 'var(--age-1-ink)' }}>
                                            {formatCompact(todayPdcMetrics.activeAmount)}
                                        </p>
                                        <p className="text-[12.5px] text-label-3 mt-2 lg:mt-1">{todayPdcMetrics.activeCount} cheques</p>
                                    </div>
                                    <div>
                                        <p className="label">Promised today</p>
                                        <p className="num text-[22px] font-semibold text-label leading-none mt-2.5 lg:mt-1.5 tracking-[-0.02em]">
                                            {formatCompact(cashFlowForecastMetrics.todayForecast)}
                                        </p>
                                        <p className="text-[12.5px] text-label-3 mt-2 lg:mt-1">{cashFlowForecastMetrics.todayCount} commitments</p>
                                    </div>
                                </div>
                                <div className="flex gap-2.5 mt-auto pt-7 lg:pt-4 max-md:[&>button]:flex-1 max-md:[&>button]:h-11">
                                    <Button size="sm" variant="primary" onClick={handleOpenTodayPdc} disabled={todayPdcMetrics.todayCount === 0}>
                                        {todayPdcMetrics.todayCount > 0 ? 'Review cheques' : 'Nothing due today'}
                                    </Button>
                                    {rights.canManagePdc && (
                                        <Button size="sm" variant="secondary" onClick={() => handleOpenAddPdc()}>Record a cheque</Button>
                                    )}
                                </div>
                            </Card>
                        </div>

                        {/* ---------- the accounts themselves ---------- */}
                        <Card className={`p-6 lg:col-span-7 ${fitsOneScreen ? 'lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden' : ''}`}>
                            <SectionHeader
                                title={
                                    categoryFilter === 'today' ? 'Due today'
                                        : categoryFilter === 'overdue' ? 'Past their promised date'
                                        : categoryFilter === 'no_follow_up' ? 'No follow-up planned'
                                        : categoryFilter === 'future' ? 'Scheduled'
                                        : categoryFilter === 'bad_debt' ? 'Bad debt — the recovery list'
                                        : 'My accounts'
                                }
                                subtitle={`${filteredData.length} account${filteredData.length === 1 ? '' : 's'}${searchTerm ? ' matching your search' : ''}`}
                                actions={
                                    <Button size="sm" variant="quiet" onClick={() => setTab('customers')}>
                                        Open full list
                                    </Button>
                                }
                            />

                            {filteredData.length === 0 ? (
                                <EmptyState
                                    title="Nothing here"
                                    hint="No account matches the current filter."
                                    action={<Button size="sm" variant="secondary" onClick={handleClearFilters}>Show all my accounts</Button>}
                                />
                            ) : (
                                <div className={`mt-6 flex flex-col gap-2.5 ${fitsOneScreen ? 'lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1.5' : ''}`}>
                                    {filteredData.slice(0, 40).map(customer => {
                                        const cat = getFollowUpCategory(customer, startOfToday());
                                        const due = relativeDays(customer.followUpDate);
                                        return (
                                            <div
                                                key={customer.id}
                                                className="rounded-[14px] bg-card-2 px-4 py-3.5 flex flex-col md:flex-row md:items-center gap-3 md:gap-5"
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <button
                                                            onClick={() => handleOpenFollowUp(customer)}
                                                            className="text-[15px] font-bold text-label hover:text-accent text-left truncate max-w-[380px]"
                                                        >
                                                            {customer.company}
                                                        </button>
                                                        {isBadDebt(customer) && <Badge tone="dang">Bad debt</Badge>}
                                                        {customer.isUrgent && <Badge tone="dang">Urgent</Badge>}
                                                        {cat === 'overdue' && <Badge tone="dang">{due?.text || 'Overdue'}</Badge>}
                                                        {cat === 'today' && <Badge tone="brand">Due today</Badge>}
                                                        {cat === 'future' && <Badge tone="pos">{due?.text || 'Scheduled'}</Badge>}
                                                        {cat === 'no_follow_up' && <Badge tone="warn">No follow-up</Badge>}
                                                    </div>
                                                    <p className="text-[13px] text-label-3 mt-1.5 truncate">
                                                        {customer.contactPerson || 'No contact'}
                                                        {customer.contactNumber ? ` · ${customer.contactNumber}` : ''}
                                                        {customer.notes?.length ? ` · ${customer.notes[customer.notes.length - 1]}` : ''}
                                                    </p>
                                                </div>

                                                <div className="flex items-center gap-4 md:gap-5 flex-none max-md:justify-between">
                                                    <div className="text-right max-md:text-left">
                                                        <p className="num text-[16px] font-semibold text-label">
                                                            {formatCompact(customer.total)}
                                                        </p>
                                                        <p className="text-[12px] text-label-3 mt-0.5">
                                                            {customer.followUpDate ? formatDateShort(customer.followUpDate) : 'not scheduled'}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Button size="sm" variant="quiet" onClick={() => handleSendWhatsApp(customer)}>
                                                            WhatsApp
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="primary"
                                                            onClick={() => handleOpenFollowUp(customer)}
                                                            disabled={!rights.canEditFollowUp}
                                                            title={rights.canEditFollowUp ? 'Log a follow-up' : 'Your role cannot record follow-ups'}
                                                        >
                                                            Follow up
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {filteredData.length > 40 && (
                                        <button
                                            onClick={() => setTab('customers')}
                                            className="text-[13.5px] font-semibold text-accent hover:underline self-start mt-1"
                                        >
                                            {filteredData.length - 40} more in the full list
                                        </button>
                                    )}
                                </div>
                            )}
                        </Card>
                        </div>
                    </div>
                )}

                {activeTab === 'pdc' && (
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

                {activeTab === 'reports' && (
                    <ReportsView
                        data={appData}
                        users={users}
                        currentUser={currentUser!}
                        initialCrmFilter={currentUser?.role === UserRole.CRM ? currentUser.id : reportCrm}
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
                )}

                {activeTab === 'customers' && renderCustomerListView()}

                {activeTab === 'stock' && renderLiveStock()}
            </>
        );
    };



    const renderCompanyDashboard = () => {
        // Use lifted state
        const activeTab = tab;

        return (
             <>
                {activeTab === 'overview' && renderAdminOverviewCards()}
                
                {activeTab === 'customers' && renderCustomerListView()}

                {activeTab === 'pdc' && (
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

                {activeTab === 'stock' && renderLiveStock()}

                {/* The setup pages bring their own cards; only the reports keep the
                    frame, which steps out of the way on a phone where they bring theirs. */}
                {activeTab === 'users' && rights.isAdmin && (
                    <TeamView
                        users={users}
                        onAdd={() => handleOpenUserModal(null)}
                        onEdit={handleOpenUserModal}
                        onRemove={handleDeleteUser}
                        companyProfile={companyProfile}
                        onSaveCompanyProfile={handleSaveCompanyProfile}
                    />
                )}
                {activeTab === 'alerts' && rights.canSyncSheets && (
                    <AlertsView canEdit={rights.canSyncSheets} />
                )}
                {activeTab === 'reports' && (
                    <div className="bg-card rounded-lg shadow-md p-6 max-md:p-0 max-md:bg-transparent max-md:shadow-none">
                        <ReportsView
                            data={appData}
                            users={users}
                            currentUser={currentUser!}
                            companyProfile={companyProfile}
                            initialCrmFilter={reportCrm}
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
                )}
                {activeTab === 'templates' && rights.canSyncSheets && (
                    <TemplatesView
                        templates={templates}
                        onAdd={() => handleOpenTemplateModal(null)}
                        onEdit={handleOpenTemplateModal}
                        onRemove={handleDeleteTemplate}
                    />
                )}
                {activeTab === 'source' && rights.canSyncSheets && (
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
    }

    /**
     * Which dashboard someone sees follows from what they can see, not from
     * their job title: anyone who reads the whole book gets the company view
     * (Admin, Manager, Viewer), anyone who owns a slice of it gets the personal
     * one (CRM, Collector). Switching on the role name is what left Manager and
     * Viewer staring at an "invalid role" page.
     */
    const renderDashboard = () => {
        if (!currentUser) return null;
        return rights.seesWholeBook ? renderCompanyDashboard() : renderUserDashboard();
    };

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
            ) : error ? (
                <div className="bg-dang-bg border border-dang text-dang rounded-xl px-5 py-4">
                    <p className="text-[15px] font-bold">Something went wrong</p>
                    <p className="text-[14px] mt-1 opacity-90">{error}</p>
                </div>
            ) : (
                /* The tab views arrive as their own chunks the first time they
                   are opened; until then the same list placeholder the book uses. */
                <Suspense fallback={<Card className="overflow-hidden"><LoadingList label="Loading" rows={6} /></Card>}>
                    {renderDashboard()}
                </Suspense>
            )}
        </AppShell>
        <Suspense fallback={null}>

            {isModalOpen && liveSelectedCustomer && (
                <FollowUpModal
                    customer={liveSelectedCustomer}
                    onClose={handleCloseModal}
                    onUpdate={handleUpdateOutstanding}
                    currentUser={currentUser}
                    users={users}
                    templates={templates}
                    pdcCheques={pdcCheques}
                    onAddPdc={handleOpenAddPdc}
                    onUpdatePdcStatus={handleUpdatePdcStatus}
                    onEditCustomer={handleOpenEditCustomer}
                    position={followUpPosition}
                    onNavigate={handleNavigateFollowUp}
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
            {isWhatsAppModalOpen && whatsAppCustomer && (
                <WhatsAppReminderModal
                    customer={whatsAppCustomer}
                    templates={templates}
                    currentUser={currentUser}
                    onClose={() => {
                        setIsWhatsAppModalOpen(false);
                        setWhatsAppCustomer(null);
                    }}
                />
            )}
        </Suspense>
            {isCustomerModalOpen && (
                <CustomerEditModal
                    customerToEdit={customerToEdit}
                    onClose={() => {
                        setIsCustomerModalOpen(false);
                        setCustomerToEdit(null);
                    }}
                    onSave={handleSaveCustomer}
                    currentUser={currentUser}
                    users={users}
                />
            )}
        </>
    );
};

export default App;
