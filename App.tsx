
import { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { isSupabaseConfigured } from './services/supabaseClient';
import * as repo from './services/repository';
import { useCollectionSync, useValueSync } from './services/useSupabaseSync';
import { Outstanding, User, UserRole, FollowUpStatus, Template, DataVisibility, PdcCheque, PdcStatus, BalanceType, CompanyProfile, TeamMemberDraft, DEFAULT_COMPANY_PROFILE, DEFAULT_ROLE_PERMISSIONS, getFollowUpCategory, can, permissionsOf, seesWholeBook, ownerKey, scopeTo, isResponsibleFor, hasOutstanding, chequeState, CHEQUE_ACTIVE, getCustomerPaymentRank, PAYMENT_RANK_LABELS, PaymentRank } from './types';
import {
    getOutstandingForUser,
    processStatuses,
    mergeWithExistingFollowUps,
    fetchGoogleSheetData,
    parseAmountAndType,
    fetchCustomerMasterSheetData,
    mergeCustomerMasterIntoAppData,
    summariseUnlisted,
    countNewNames
} from './services/googleSheetService';
import { CustomerDashboardView } from './components/CustomerDashboardView';
import { CustomerEditModal } from './components/CustomerEditModal';
import CrmPerformanceTable from './components/CrmPerformanceTable';
import LoginScreen from './components/LoginScreen';
import AppShell, { NavGroup, NavItem } from './components/shell/AppShell';
import { TodayIcon, BookIcon, ChequeNavIcon, ChartIcon, TeamIcon, MessageIcon, PlugIcon, BellIcon } from './components/shell/NavIcons';
import { formatCompact, formatDateShort, formatINR, relativeDays } from './components/ui/format';
import { Stat, Card, SectionHeader, AgeingBar, AgeingLegend, AGE_BANDS, Badge, Button, EmptyState, LoadingList } from './components/ui/Primitives';
import { CheckCircleIcon, UsersIcon, EditIcon, TrashIcon, UserPlusIcon, ClipboardListIcon, UploadIcon, ExclamationTriangleIcon, DownloadIcon, SyncIcon, BuildingOfficeIcon } from './components/icons/Icons';
import FollowUpModal from './components/FollowUpModal';
import AlertsView from './components/AlertsView';
import UserModal from './components/UserModal';
import ChangePasswordModal from './components/ChangePasswordModal';
import TemplateModal from './components/TemplateModal';
import NotificationBanner from './components/NotificationBanner';
import ReportsView, { FollowUpCategoryFilter } from './components/ReportsView';
import SyncReconciliationModal from './components/SyncReconciliationModal';
import PdcChequesView from './components/PdcChequesView';
import PdcModal from './components/PdcModal';
import { CompanyProfileView } from './components/CompanyProfileView';
import WhatsAppReminderModal from './components/WhatsAppReminderModal';


// Helper to get today's date at midnight
const getToday = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
};

const OFFICIAL_TRANSACTIONS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1DoBq1UVK53Z_029eIGUQzZ6g3sN2ytVVFCF0tFoYu_4/edit?usp=sharing';
const OFFICIAL_CUSTOMER_MASTER_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRJrKqb_XsMoNYlAzO8NYkhbmZC7Z5RID9W9YFAuh6wzi8gnTIPCXj2LMllgpm78MDmOo7D6zdF0bOc/pubhtml?gid=895778621&single=true';
const OFFICIAL_SHEET_URL = OFFICIAL_TRANSACTIONS_SHEET_URL;

const EXPECTED_HEADERS = ["ID","Company","Contact Person","Contact Number","Total Due","Ageing 1-45","Ageing 46-90","Ageing 91-135","Ageing >135","CRM Owner Name","Assigned Collector Name","Follow-up Date","Notes","Is Urgent","Creation Date"
];


const DEFAULT_TEMPLATE: Template = {
    id: 'template_default',
    name: 'Standard Reminder',
    content: `Hello {{contactPerson}},

This is a friendly reminder from Timely Payment regarding your outstanding balance for {{companyName}}.

Total Due: {{totalDue}}

Ageing Details:
- 1-45 days: {{ageing1_45}}
- 46-90 days: {{ageing46_90}}
- 91-135 days: {{ageing91_135}}
- >135 days: {{ageingOver135}}

Total overdue beyond 90 days: {{totalOver90}}

Please let us know when we can expect the payment.

Thank you!`
};

/**
 * Supabase is the master record and the only one: state is loaded from it on
 * sign-in and written back as it changes. Nothing about the book is cached in
 * the browser, so a stale tab can never overwrite the team's work.
 */

const App = () => {
    const [users, setUsers] = useState<User[]>([]);

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    // Dashboard Tab States (Lifted up to prevent reset on re-renders)
    const [adminTab, setAdminTab] = useState('overview');
    const [userTab, setUserTab] = useState('overview');

    // This state holds the"Master" data for the application
    const [appData, setAppData] = useState<Outstanding[]>([]);
    
    // This state holds the filtered data for the current view
    const [outstandingData, setOutstandingData] = useState<Outstanding[]>([]);
    
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<FollowUpStatus | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<FollowUpCategoryFilter>('all');
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState<Outstanding | null>(null);

    const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
    const [whatsAppCustomer, setWhatsAppCustomer] = useState<Outstanding | null>(null);

    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);

    // PDC (Post Dated Cheques) State
    const [pdcCheques, setPdcCheques] = useState<PdcCheque[]>([]);

    const [isPdcModalOpen, setIsPdcModalOpen] = useState(false);
    const [editingPdcCheque, setEditingPdcCheque] = useState<PdcCheque | null>(null);
    const [pdcPreselectedCustomerId, setPdcPreselectedCustomerId] = useState<string | undefined>(undefined);
    const [pdcInitialStatusFilter, setPdcInitialStatusFilter] = useState<string | null>(null);
    const [pdcInitialCustomerFilter, setPdcInitialCustomerFilter] = useState<string | null>(null);

    // Company Profile state
    const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);

    const [userManagementTab, setUserManagementTab] = useState<'users' | 'company'>('users');

    const handleSaveCompanyProfile = (updated: CompanyProfile) => {
        setCompanyProfile(updated);
        setSyncMessage({ type: 'success', text: 'Company profile details updated successfully.' });
        setTimeout(() => setSyncMessage(null), 4000);
    };

    const [templates, setTemplates] = useState<Template[]>([DEFAULT_TEMPLATE]);
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
    
    const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    /** Banner at the top of the shell. Errors linger; confirmations do not. */
    const notify = useCallback((type: 'success' | 'error', text: string) => {
        setSyncMessage({ type, text });
        window.setTimeout(() => setSyncMessage(null), type === 'error' ? 12000 : 5000);
    }, []);
    const [isSyncing, setIsSyncing] = useState(false);
    const [sheetUpdatedTillDate, setSheetUpdatedTillDate] = useState<string>('');
    const [lastSyncTime, setLastSyncTime] = useState<string>('');

    // Pending sync data waiting for Admin reconciliation
    const [pendingSync, setPendingSync] = useState<{
        records: Outstanding[];
        updatedTillDate?: string;
        sourceName: string;
    } | null>(null);

    /**
     * Accounts where the CRM set here and the CRM in the master sheet disagree.
     *
     * The app's answer wins — reassigning an account has to survive the next
     * import — so the disagreement is recorded rather than resolved, and shown
     * in Settings with the export that puts it right in the sheet.
     */
    const [crmConflicts, setCrmConflicts] = useState<{ company: string; appCrm: string; sheetCrm: string }[]>([]);

    // State for notifications
    const [priorityFilter, setPriorityFilter] = useState(false);
    const [unattendedFilter, setUnattendedFilter] = useState(false);
    const [showNotificationBanner, setShowNotificationBanner] = useState(true);

    // Data Source State - default to Google Sheet
    const [dataSourceMode, setDataSourceMode] = useState<'excel' | 'google'>('google');
    const [googleSheetUrl, setGoogleSheetUrl] = useState(OFFICIAL_SHEET_URL);
    const [customerMasterSheetUrl, setCustomerMasterSheetUrl] = useState(OFFICIAL_CUSTOMER_MASTER_URL);

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

    const handleSaveCustomer = (savedCustomer: Outstanding) => {
        const isExisting = appData.some(c => c.id === savedCustomer.id);
        let updated: Outstanding[];
        if (isExisting) {
            updated = appData.map(c => c.id === savedCustomer.id ? savedCustomer : c);
        } else {
            updated = [savedCustomer, ...appData];
        }
        const processed = processStatuses(updated);
        setAppData(processed);
        setIsCustomerModalOpen(false);
        setCustomerToEdit(null);
        setSyncMessage({
            type: 'success',
            text: `Customer"${savedCustomer.company}" ${isExisting ? 'updated' : 'added'} successfully!`
        });
        setTimeout(() => setSyncMessage(null), 4000);
    };

    const handleDeleteCustomer = (customerId: string) => {
        const target = appData.find(c => c.id === customerId);
        if (!target) return;
        if (window.confirm(`Are you sure you want to delete customer"${target.company}"?`)) {
            const updated = appData.filter(c => c.id !== customerId);
            const processed = processStatuses(updated);
            setAppData(processed);
            setSyncMessage({
                type: 'success',
                text: `Customer"${target.company}" deleted successfully.`
            });
            setTimeout(() => setSyncMessage(null), 4000);
        }
    };

    /**
     * Exports the accounts currently on screen, not the whole book.
     *
     * Filtering to the bad debts and pressing Export handed you all four
     * thousand customers, which made the one job this is for — giving the
     * recovery agency a defaulter list — impossible.
     */
    const handleExportCustomerExcel = (rowsToExport: Outstanding[] = appData) => {
        if (XLSX) {
            const headers = ["ID","Company","Contact Person","Designation","Contact Number","Email","City","State","GSTIN","Category","Payment Rank","Total Outstanding","Type","1-45 Days","46-90 Days","91-135 Days",">135 Days","Due >45 Days","Over 90 Days","CRM Owner","Status","Follow-up Date","Last Note"
            ];
            const rows = rowsToExport.map(c => [
                c.id,
                c.company,
                c.contactPerson,
                c.contactPost || '',
                c.contactNumber,
                c.email || '',
                c.city || '',
                c.state || '',
                c.gstin || '',
                c.category || '',
                PAYMENT_RANK_LABELS[getCustomerPaymentRank(c)],
                c.total,
                c.totalType || 'Dr',
                c.ageing['1-45'],
                c.ageing['46-90'],
                c.ageing['91-135'],
                c.ageing['>135'],
                c.dueOver45 || 0,
                c.over90 || 0,
                c.crmOwnerId,
                c.status,
                c.followUpDate ? new Date(c.followUpDate).toISOString().split('T')[0] : '',
                (c.notes && c.notes.length > 0) ? c.notes[c.notes.length - 1] : ''
            ]);
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws,"Customers");
            const scope = rowsToExport.length === appData.length ? 'All' : `${rowsToExport.length}_selected`;
            XLSX.writeFile(wb, `Customers_${scope}_${new Date().toISOString().split('T')[0]}.xlsx`);
        } else {
            alert("Export functionality ready. Please try again.");
        }
    };

    /**
     * The CRM column as the app holds it, in a form that can be pasted back
     * into the sheet.
     *
     * Ownership is decided here — a handover typed into the app is not undone
     * by the next import — but the sheet is read by people who never open the
     * app, and there is no way to write to it from here. This is the bridge:
     * one row per account, the owner the app is working to, and the owner the
     * sheet last supplied where the two disagree.
     *
     * It is pasted into the **Customer Master**. The outstanding sheet does not
     * hold a CRM of its own — its column looks the name up from the master — so
     * the master is the one place a correction has to land.
     */
    const handleExportCrmAssignments = () => {
        if (!XLSX) {
            alert('Export functionality ready. Please try again.');
            return;
        }
        const sheetSays = new Map(crmConflicts.map(c => [c.company, c.sheetCrm]));
        const headers = ['Company', 'CRM Owner (app)', 'CRM Owner (master sheet)', 'Differs', 'Total Outstanding'];
        const rows = [...appData]
            .sort((a, b) => a.company.localeCompare(b.company))
            .map(c => {
                const fromSheet = sheetSays.get(c.company) || '';
                return [
                    c.company,
                    c.crmOwnerId || '',
                    fromSheet,
                    fromSheet ? 'YES' : '',
                    c.total || 0,
                ];
            });
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'CRM Owners');
        XLSX.writeFile(wb, `CRM_Owners_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const parseRawDataArray = useCallback((values: any[][]): Outstanding[] => {
        return values.map((row, index) => {
            try {
                const totalParsed = parseAmountAndType(row[4]);
                const a1Parsed = parseAmountAndType(row[5]);
                const a2Parsed = parseAmountAndType(row[6]);
                const a3Parsed = parseAmountAndType(row[7]);
                const a4Parsed = parseAmountAndType(row[8]);
                const over90Amount = a3Parsed.amount + a4Parsed.amount;
                const dueOver45Amount = a2Parsed.amount + over90Amount;

                const outstanding: Outstanding = {
                    id: row[0] || `row_${index + 1}`,
                    company: row[1] || 'Unknown Company',
                    contactPerson: row[2] || '',
                    contactNumber: row[3] ? String(row[3]) : '',
                    total: totalParsed.amount,
                    totalType: totalParsed.type,
                    ageing: {
                        '1-45': a1Parsed.amount,
                        '46-90': a2Parsed.amount,
                        '91-135': a3Parsed.amount,
                        '>135': a4Parsed.amount,
                    },
                    ageingTypes: {
                        '1-45': a1Parsed.type,
                        '46-90': a2Parsed.type,
                        '91-135': a3Parsed.type,
                        '>135': a4Parsed.type,
                    },
                    over90: over90Amount,
                    over90Type: (a3Parsed.type === 'Cr' && a4Parsed.type === 'Cr' ? 'Cr' : 'Dr') as BalanceType,
                    dueOver45: dueOver45Amount,
                    dueOver45Type: 'Dr' as BalanceType,
                    // Trimming to ensure names match even with trailing spaces
                    crmOwnerId: row[9] ? String(row[9]).trim() : '',
                    assignedCollectorId: row[10] ? String(row[10]).trim() : undefined,
                    followUpDate: row[11] ? new Date(row[11]) : undefined,
                    notes: row[12] ? String(row[12]).split(',').map(s => s.trim()) : [],
                    isUrgent: String(row[13]).toUpperCase() === 'TRUE',
                    creationDate: row[14] ? new Date(row[14]) : new Date(),
                    status: FollowUpStatus.Pending, 
                    lastFollowUpOn: undefined
                };
                return outstanding;
            } catch (e) {
                console.error(`Error parsing row ${index + 2}:`, row, e);
                return null;
            }
        }).filter((item): item is Outstanding => item !== null);
    }, []);



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
                if (all.settings.dataSourceMode) setDataSourceMode(all.settings.dataSourceMode);
                if (all.settings.googleSheetUrl) setGoogleSheetUrl(all.settings.googleSheetUrl);
                if (all.settings.customerMasterSheetUrl) setCustomerMasterSheetUrl(all.settings.customerMasterSheetUrl);
                if (all.settings.sheetUpdatedTillDate) setSheetUpdatedTillDate(all.settings.sheetUpdatedTillDate);
                if (all.settings.lastSyncTime) setLastSyncTime(all.settings.lastSyncTime);
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
    const reportSyncError = useCallback((text: string) => setSyncMessage({ type: 'error', text }), []);

    // Stable adapters. These tables are small, so a sequential loop is fine.
    /**
     * Edits go out as updates and genuinely new accounts as an upsert, so the
     * database can ask for the "add customer" right only when one is being
     * added. An id we have not seen may still exist server-side (someone else
     * created it since this tab loaded), which is why that path upserts.
     */
    const saveCustomerRows = useCallback(async (rows: Outstanding[], created: Set<string>) => {
        const fresh = rows.filter(r => created.has(r.id));
        const edited = rows.filter(r => !created.has(r.id));
        if (edited.length) await repo.updateCustomers(edited);
        if (fresh.length) await repo.upsertCustomers(fresh);
    }, []);

    const upsertPdcRows = useCallback(async (rows: PdcCheque[]) => {
        for (const r of rows) await repo.upsertPdcCheque(r);
    }, []);
    const upsertTemplateRows = useCallback(async (rows: Template[]) => {
        for (const r of rows) await repo.upsertTemplate(r);
    }, []);
    const customerSignature = useCallback((c: Outstanding) => JSON.stringify(repo.outstandingToRow(c)), []);
    const jsonSignature = useCallback((r: unknown) => JSON.stringify(r), []);

    useCollectionSync({
        rows: appData, enabled: syncEnabled, label: 'customers',
        toSignature: customerSignature,
        upsert: saveCustomerRows, remove: repo.deleteCustomer,
        onError: reportSyncError,
    });
    useCollectionSync({
        rows: pdcCheques, enabled: syncEnabled, label: 'PDC cheques',
        toSignature: jsonSignature,
        upsert: upsertPdcRows, remove: repo.deletePdcCheque,
        onError: reportSyncError,
    });
    useCollectionSync({
        rows: templates, enabled: syncEnabled, label: 'templates',
        toSignature: jsonSignature,
        upsert: upsertTemplateRows, remove: repo.deleteTemplate,
        onError: reportSyncError,
    });
    useValueSync({
        value: companyProfile, enabled: syncEnabled, label: 'company profile',
        save: repo.saveCompanyProfile, onError: reportSyncError,
    });

    const settingsValue = useMemo(
        () => ({ dataSourceMode, googleSheetUrl, customerMasterSheetUrl, sheetUpdatedTillDate, lastSyncTime }),
        [dataSourceMode, googleSheetUrl, customerMasterSheetUrl, sheetUpdatedTillDate, lastSyncTime]
    );
    useValueSync({
        value: settingsValue, enabled: syncEnabled, label: 'settings',
        save: repo.saveAppSettings, onError: reportSyncError,
    });

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
        if (isAuthenticated && currentUser) {
            updateViewData();
            // Reset notification banner and filters on data refresh/user switch
            setShowNotificationBanner(true);
            setPriorityFilter(false);
            setUnattendedFilter(false);
            setStatusFilter(null);
            setCategoryFilter('all');
        }
    }, [updateViewData, currentUser, isAuthenticated]);

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
        setAdminTab('overview');
        setUserTab('overview');
    };

    const handleOpenFollowUp = (customer: Outstanding) => {
        setSelectedCustomer(customer);
        setIsModalOpen(true);
    };

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

    const handleUpdateOutstanding = (updatedCustomer: Outstanding) => {
        // Automatically ensure status reflects the updated followUpDate and forecast
        const processedCustomer = processStatuses([updatedCustomer])[0] || updatedCustomer;
        const updatedList = appData.map(item =>
            item.id === processedCustomer.id ? processedCustomer : item
        );
        const fullyProcessed = processStatuses(updatedList);
        setAppData(fullyProcessed);
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
        setSearchTerm('');
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
            setPriorityFilter(false);
            setCategoryFilter('urgent');
            setAdminTab('reports');
        } else {
            setCategoryFilter('all');
            setPriorityFilter(true);
        }
    };
    
    const handleOpenUserModal = (user: User | null) => {
        setEditingUser(user);
        setIsUserModalOpen(true);
    };

    const handleCloseUserModal = () => {
        setEditingUser(null);
        setIsUserModalOpen(false);
    };

    /**
     * Creates or updates a teammate's real Supabase login and profile, then
     * re-reads the roster so the table shows what the server actually holds.
     * Errors are rethrown for UserModal to display: the modal stays open, and a
     * failed save is never mistaken for a saved one.
     */
    const handleSaveUser = async (draft: TeamMemberDraft) => {
        const isNewUser = !editingUser;
        const legacyId = (draft.id || draft.name).trim();

        const input: repo.TeamMemberInput = {
            id: legacyId,
            name: draft.name,
            email: draft.email,
            password: draft.password,
            role: draft.role,
            dataVisibility: draft.dataVisibility,
            permissions: draft.permissions,
            assignedCrms:
                draft.assignedCrms || (draft.role === UserRole.CRM ? [legacyId] : []),
        };

        if (isNewUser) {
            await repo.createTeamMember(input);
        } else {
            await repo.updateTeamMember(input);
        }

        const roster = await repo.fetchUsers();
        setUsers(roster);
        // Keep our own rights fresh if an Admin just edited their own row.
        const me = roster.find(u => u.id === currentUser?.id);
        if (me) setCurrentUser(me);

        notify(
            'success',
            isNewUser
                ? `${input.name} can now sign in with ${input.email}.`
                : `${input.name}'s role and rights are saved.`
        );
        handleCloseUserModal();
    };

    const handleDeleteUser = async (userId: string) => {
        if (!window.confirm(`Remove ${userId}? Their login stops working immediately.`)) return;
        try {
            await repo.deleteTeamMember(userId);
            setUsers(await repo.fetchUsers());
            notify('success', `${userId} no longer has access.`);
        } catch (e: any) {
            notify('error', e?.message || 'Could not remove the user.');
        }
    };

    /**
     * Factory reset. With a backend this rewrites the shared dataset for
     * everyone — customers, cheques, templates and the company profile — but
     * deliberately leaves logins alone: those are real accounts, and they are
     * removed one at a time in Team & access.
     */
    const handleResetAllDataAndUsers = async (skipConfirm = false) => {
        if (!skipConfirm) {
            const confirmed = window.confirm(
                "COMPLETE FRESH START\n\nThis rewrites the shared dataset for the whole team:\n1. Clear all follow-up notes, tags, forecast amounts and custom contacts\n2. Delete every Post-Dated Cheque (PDC)\n3. Re-import a clean dataset from the live Google Sheet\n4. Restore the default message template and company profile\n\nEvery account comes back with NO CRM against it, because the outstanding sheet does not decide ownership. Run the one-time customer import afterwards, or assign owners from the customer list.\n\nTeam logins are NOT touched — remove those in Team & access.\n\nClick OK to proceed."
            );
            if (!confirmed) return;
        }

        setIsSyncing(true);
        setSyncMessage({ type: 'success', text: 'Resetting system and fetching clean fresh data...' });

        try {
            // Each of these is picked up by the sync effects, which write the
            // reset through to Supabase for the whole team.
            setPdcCheques([]);
            setCompanyProfile(DEFAULT_COMPANY_PROFILE);
            setTemplates([DEFAULT_TEMPLATE]);
            setDataSourceMode('google');
            setGoogleSheetUrl(OFFICIAL_SHEET_URL);

            // Fetch clean data from Google Sheet without merging old overrides
            try {
                const parsed = await fetchGoogleSheetData(OFFICIAL_SHEET_URL);
                if (parsed.records && parsed.records.length > 0) {
                    // Through the merge, not around it: a reset re-imports the
                    // sheet, and the sheet does not get to decide ownership just
                    // because the book happens to be empty at that moment. Every
                    // account comes back unassigned, and the customer import is
                    // what puts the owners back.
                    const freshProcessed = mergeWithExistingFollowUps([], parsed.records);
                    setAppData(freshProcessed);
                    if (parsed.updatedTillDate) {
                        setSheetUpdatedTillDate(parsed.updatedTillDate);
                    }
                } else {
                    throw new Error('The sheet returned no rows.');
                }
            } catch (fetchErr: any) {
                // Leave the real dataset alone and say why the reset stopped.
                throw new Error(
                    `Could not re-import the sheet, so the customer list was left as it is: ${fetchErr?.message || fetchErr}`
                );
            }

            setLastSyncTime(new Date().toISOString());

            setSyncMessage({
                type: 'success',
                text: 'Dataset reset and re-imported. Every account is unassigned — run the customer import, or set owners from the customer list. Team logins were left untouched.',
            });
            setTimeout(() => setSyncMessage(null), 6000);
        } catch (err: any) {
            console.error("Failed to reset:", err);
            setSyncMessage({
                type: 'error',
                text: err?.message || 'Reset encountered an error. Please try again.',
            });
        } finally {
            setIsSyncing(false);
        }
    };

    // Template Modal Handlers
    const handleOpenTemplateModal = (template: Template | null) => {
        setEditingTemplate(template);
        setIsTemplateModalOpen(true);
    };

    const handleCloseTemplateModal = () => {
        setEditingTemplate(null);
        setIsTemplateModalOpen(false);
    };

    const handleSaveTemplate = (templateToSave: Omit<Template, 'id'> & { id?: string }) => {
        setTemplates(currentTemplates => {
            if (templateToSave.id) {
                return currentTemplates.map(t => t.id === templateToSave.id ? { ...t, name: templateToSave.name, content: templateToSave.content } : t);
            } else {
                const newTemplate: Template = {
                    ...templateToSave,
                    id: `template_${Date.now()}`,
                };
                return [...currentTemplates, newTemplate];
            }
        });
        handleCloseTemplateModal();
    };

    const handleDeleteTemplate = (templateId: string) => {
        if (templates.length <= 1) {
            alert("You cannot delete the last template.");
            return;
        }
        if (window.confirm('Are you sure you want to delete this template?')) {
            setTemplates(currentTemplates => currentTemplates.filter(t => t.id !== templateId));
        }
    };

    // Reassign single customer to a CRM
    const handleReassignCrm = (customerId: string, newCrmId: string) => {
        const updated = appData.map(item =>
            item.id === customerId ? { ...item, crmOwnerId: newCrmId } : item
        );
        setAppData(updated);
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
        setSyncMessage({
            type: 'success',
            text: rank
                ? `Marked ${customerIds.length} account${customerIds.length === 1 ? '' : 's'} as ${PAYMENT_RANK_LABELS[rank]}.`
                : `Cleared the rank on ${customerIds.length} account${customerIds.length === 1 ? '' : 's'}; they go back to being worked out from ageing.`,
        });
        setTimeout(() => setSyncMessage(null), 4000);
    };

    const handleBulkReassignCrm = (customerIds: string[], newCrmId: string) => {
        const idSet = new Set(customerIds);
        const updated = appData.map(item =>
            idSet.has(item.id) ? { ...item, crmOwnerId: newCrmId } : item
        );
        setAppData(updated);
        const targetCrmUser = users.find(u => u.id === newCrmId || u.name === newCrmId);
        const targetName = targetCrmUser ? targetCrmUser.name : (newCrmId || 'Unassigned');
        setSyncMessage({
            type: 'success',
            text: `Successfully reassigned ${customerIds.length} customer(s) to ${targetName}.`
        });
        setTimeout(() => setSyncMessage(null), 4000);
    };

    // Sync Reconciliation Handlers
    const handleConfirmSyncReconciliation = (reconciledRecords: Outstanding[]) => {
        const settled = pendingSync ? summariseUnlisted(appData, pendingSync.records) : { count: 0, amount: 0 };
        const added = pendingSync ? countNewNames(appData, pendingSync.records) : 0;
        const processed = processStatuses(reconciledRecords);
        setAppData(processed);
        const nowIso = new Date().toISOString();
        setLastSyncTime(nowIso);
        if (pendingSync?.updatedTillDate) {
            setSheetUpdatedTillDate(pendingSync.updatedTillDate);
        }
        setSyncMessage({
            type: 'success',
            text:
                `Balances updated for ${reconciledRecords.length} accounts.` +
                (added
                    ? ` ${added} new customer${added === 1 ? '' : 's'} came in from the sheet and need a CRM — they are under "Unassigned" in the customer list.`
                    : '') +
                (settled.count
                    ? ` ${settled.count} account${settled.count === 1 ? '' : 's'} the sheet no longer lists were settled to zero (${formatCompact(settled.amount)}).`
                    : '') +
                (pendingSync?.updatedTillDate ? ` Sheet updated till: ${pendingSync.updatedTillDate}` : '')
        });
        setPendingSync(null);
        setTimeout(() => setSyncMessage(null), 7000);
    };

    const handleCancelSyncReconciliation = () => {
        setPendingSync(null);
    };

    // Google Sheet Sync Logic (Transactions)
    const handleGoogleSync = async (overrideUrl?: string) => {
        const urlToUse = (typeof overrideUrl === 'string' && overrideUrl.trim()) 
            ? overrideUrl.trim() 
            : (googleSheetUrl || OFFICIAL_TRANSACTIONS_SHEET_URL).trim();

        if (overrideUrl && typeof overrideUrl === 'string') {
            setGoogleSheetUrl(overrideUrl);
        }
        
        setIsSyncing(true);
        setSyncMessage(null);

        try {
            const { records, updatedTillDate } = await fetchGoogleSheetData(urlToUse);
            
            if (records.length === 0) {
                 throw new Error("No customer records found in the provided Google Sheet.");
            }

            if (appData.length > 0) {
                // Nothing is written and nothing is stamped until the review is
                // confirmed. Recording the sync time here marked the book as
                // freshly synced even when the review was cancelled.
                setPendingSync({
                    records,
                    updatedTillDate,
                    sourceName: 'Transactions Google Sheet'
                });
            } else {
                if (updatedTillDate) {
                    setSheetUpdatedTillDate(updatedTillDate);
                }
                // Already runs processStatuses() on the way out.
                setAppData(mergeWithExistingFollowUps(appData, records));
                setLastSyncTime(new Date().toISOString());
                setSyncMessage({
                    type: 'success',
                    text:
                        `Loaded ${records.length} accounts from the outstanding sheet. ` +
                        `None of them have a CRM yet — run the one-time customer import, or assign owners from the customer list.` +
                        (updatedTillDate ? ` Sheet updated till: ${updatedTillDate}` : ''),
                });
            }

        } catch (err) {
            const msg = err instanceof Error ? err.message :"Unknown error during sync";
            setSyncMessage({ type: 'error', text: msg });
        } finally {
            setIsSyncing(false);
        }
    };

    /**
     * The one-time customer import.
     *
     * The customer database lives in the app — new customers are added here and
     * their details maintained here — so this is a seeding step, not something
     * to run daily. It fills in what is missing and overwrites nothing, but it
     * is still a few thousand rows landing on the book at once, so it asks
     * first.
     */
    const handleCustomerMasterSync = async (overrideUrl?: string) => {
        const urlToUse = (typeof overrideUrl === 'string' && overrideUrl.trim())
            ? overrideUrl.trim()
            : (customerMasterSheetUrl || OFFICIAL_CUSTOMER_MASTER_URL).trim();

        if (overrideUrl && typeof overrideUrl === 'string') {
            setCustomerMasterSheetUrl(overrideUrl);
        }

        if (appData.length > 0) {
            const proceed = window.confirm(
                'ONE-TIME CUSTOMER IMPORT\n\n' +
                'The customer list is maintained in the software, not in this sheet. ' +
                'This is for loading customers in bulk — normally you add a customer here instead.\n\n' +
                'It fills in details that are missing and overwrites nothing: names, phone numbers, ' +
                'addresses, credit terms, categories and CRM owners already recorded here are left exactly as they are.\n\n' +
                'Run it now to bring in the CATEGORY column (Builder, Dealer, Dealer Offset, Retailer and the trades) ' +
                'for customers that do not have one yet.\n\n' +
                'Continue?'
            );
            if (!proceed) return;
        }

        setIsSyncing(true);
        setSyncMessage(null);

        try {
            const { records } = await fetchCustomerMasterSheetData(urlToUse);
            if (records.length === 0) {
                throw new Error("No customer records found in the Customer Master Google Sheet.");
            }

            const { updatedData, enrichedCount, newAccountsCount, categorisedCount, crmConflicts } = mergeCustomerMasterIntoAppData(appData, records);
            setAppData(updatedData);
            setCrmConflicts(crmConflicts);

            // Deliberately does not touch lastSyncTime: that is "balances last
            // refreshed from the sheet", and this import brings no balances.
            // Stamping it here made the book look freshly priced when it was not.

            setSyncMessage({
                type: 'success',
                text:
                    `Customer import done: ${newAccountsCount} new customer${newAccountsCount === 1 ? '' : 's'} added, ` +
                    `${enrichedCount} already on file were left as they are (blanks filled in only).` +
                    (categorisedCount ? ` ${categorisedCount} got a category from the sheet.` : '') +
                    (crmConflicts.length
                        ? ` ${crmConflicts.length} kept the CRM set here rather than the one in the sheet.`
                        : '')
            });
            setTimeout(() => setSyncMessage(null), 6000);
        } catch (err) {
            const msg = err instanceof Error ? err.message :"Unknown error during customer master sync";
            setSyncMessage({ type: 'error', text: msg });
        } finally {
            setIsSyncing(false);
        }
    };

    // WhatsApp Reminder Handler (opens recipient & template selector with 'Other number' option)
    const handleSendWhatsApp = (customer: Outstanding) => {
        setWhatsAppCustomer(customer);
        setIsWhatsAppModalOpen(true);
    };

    const filteredData = useMemo(() => {
        const today = getToday();
        const searching = Boolean(searchTerm.trim());
        return outstandingData.filter(item => {
            const itemCategory = getFollowUpCategory(item, today);

            /**
             * Nothing owed is nothing to chase.
             *
             * The four boxes above already count it that way, so the list they
             * open has to agree — otherwise "Due today: 3" opens onto four rows,
             * one of them at zero, and the two numbers argue with each other.
             * Now that an account dropped from the outstanding sheet is settled
             * rather than left standing, this is the list those settled accounts
             * would otherwise pile up in.
             *
             * Two exceptions: an account collected today belongs in "collected"
             * precisely because it now owes nothing, and a search is a search —
             * looking a customer up by name must find them, paid or not.
             */
            if (!hasOutstanding(item) && itemCategory !== 'completed' && !searching) return false;

            if (priorityFilter) {
                return (item.isUrgent && item.status !== FollowUpStatus.Completed) || item.status === FollowUpStatus.Overdue;
            }

            if (unattendedFilter) {
                // Unattended: Overdue OR No Follow-up
                return itemCategory === 'overdue' || itemCategory === 'no_follow_up';
            }

            // Category Filter from 4 Main Clickable Boxes
            if (categoryFilter !== 'all') {
                if (itemCategory !== categoryFilter) return false;
            }

            if (!statusFilter) return true;
            
            if (statusFilter === FollowUpStatus.Completed) {
                if (!item.followUpDate) return false;
                const collectedDate = new Date(item.followUpDate);
                collectedDate.setHours(0,0,0,0);
                return item.status === FollowUpStatus.Completed && collectedDate.getTime() === today.getTime();
            }
            
            return item.status === statusFilter;
        }).filter(item => {
            if (!searchTerm.trim()) return true;
            const searchTokens = searchTerm.trim().toLowerCase().split(/\s+/).filter(Boolean);
            const userObj = users.find(u => u.id === item.crmOwnerId || u.name === item.crmOwnerId);
            const crmDisplayName = userObj ? userObj.name.toLowerCase() : '';
            const collectorObj = users.find(u => u.id === item.assignedCollectorId || u.name === item.assignedCollectorId);
            const collectorDisplayName = collectorObj ? collectorObj.name.toLowerCase() : '';

            const company = String(item.company || '').toLowerCase();
            const contactPerson = String(item.contactPerson || '').toLowerCase();
            const contactPhone = String(item.contactNumber || '').toLowerCase();
            const email = String(item.email || '').toLowerCase();
            const crmOwnerId = String(item.crmOwnerId || '').toLowerCase();
            const assignedCollectorId = String(item.assignedCollectorId || '').toLowerCase();
            const id = String(item.id || '').toLowerCase();
            const total = String(item.total || '');
            const notes = (item.notes || []).join(' ').toLowerCase();

            const combinedSearchable = `${company} ${contactPerson} ${contactPhone} ${email} ${crmOwnerId} ${crmDisplayName} ${assignedCollectorId} ${collectorDisplayName} ${id} ${total} ${notes}`;
            return searchTokens.every(tok => combinedSearchable.includes(tok));
        });
    }, [outstandingData, searchTerm, statusFilter, categoryFilter, priorityFilter, unattendedFilter, users]);

    // 4 Main Boxes Summary (For Admin Company-Wide View)

    // Whole-book ageing. Credit balances are excluded: money sitting with us is
    // not a receivable and must not inflate the outstanding figure.
    const portfolioAgeing = useMemo(() => {
        let a1 = 0, a2 = 0, a3 = 0, a4 = 0;
        appData.forEach(item => {
            if (item.totalType === 'Cr') return;
            const t = item.ageingTypes || {};
            if (t['1-45'] !== 'Cr') a1 += Math.abs(item.ageing?.['1-45'] || 0);
            if (t['46-90'] !== 'Cr') a2 += Math.abs(item.ageing?.['46-90'] || 0);
            if (t['91-135'] !== 'Cr') a3 += Math.abs(item.ageing?.['91-135'] || 0);
            if (t['>135'] !== 'Cr') a4 += Math.abs(item.ageing?.['>135'] || 0);
        });
        const total = a1 + a2 + a3 + a4;
        const over45 = a2 + a3 + a4;
        const over90 = a3 + a4;
        return {
            a1, a2, a3, a4, total, over45, over90,
            pct45: total > 0 ? Math.round((over45 / total) * 100) : 0,
            pct90: total > 0 ? Math.round((over90 / total) * 100) : 0,
        };
    }, [appData]);

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
        seesWholeBook: seesWholeBook(currentUser),
        permissions: permissionsOf(currentUser),
    }), [currentUser]);

    /** Same shape as portfolioAgeing, but only what this person is chasing. */
    const myAgeing = useMemo(() => {
        let a1 = 0, a2 = 0, a3 = 0, a4 = 0;
        outstandingData.forEach(item => {
            if (item.totalType === 'Cr') return;
            const t = item.ageingTypes || {};
            if (t['1-45'] !== 'Cr') a1 += Math.abs(item.ageing?.['1-45'] || 0);
            if (t['46-90'] !== 'Cr') a2 += Math.abs(item.ageing?.['46-90'] || 0);
            if (t['91-135'] !== 'Cr') a3 += Math.abs(item.ageing?.['91-135'] || 0);
            if (t['>135'] !== 'Cr') a4 += Math.abs(item.ageing?.['>135'] || 0);
        });
        const total = a1 + a2 + a3 + a4;
        const over45 = a2 + a3 + a4;
        const over90 = a3 + a4;
        return {
            a1, a2, a3, a4, total, over45, over90,
            pct45: total > 0 ? Math.round((over45 / total) * 100) : 0,
            pct90: total > 0 ? Math.round((over90 / total) * 100) : 0,
        };
    }, [outstandingData]);

    const fourBoxesSummary = useMemo(() => {
        const today = getToday();
        let todayCount = 0;
        let todayAmount = 0;
        let noFollowUpCount = 0;
        let noFollowUpAmount = 0;
        let overdueCount = 0;
        let overdueAmount = 0;
        let futureCount = 0;
        let futureAmount = 0;

        appData.forEach(item => {
            // Customers who owe nothing are not work. Left in, the whole
            // Customer Master lands in "No follow-up" and swamps the box.
            if (!hasOutstanding(item)) return;

            const cat = getFollowUpCategory(item, today);
            if (cat === 'completed') return;

            if (cat === 'today') {
                todayCount++;
                todayAmount += item.total || 0;
            } else if (cat === 'overdue') {
                overdueCount++;
                overdueAmount += item.total || 0;
            } else if (cat === 'future') {
                futureCount++;
                futureAmount += item.total || 0;
            } else if (cat === 'no_follow_up') {
                noFollowUpCount++;
                noFollowUpAmount += item.total || 0;
            }
        });

        return {
            todayCount, todayAmount,
            noFollowUpCount, noFollowUpAmount,
            overdueCount, overdueAmount,
            futureCount, futureAmount
        };
    }, [appData]);

    // 4 Main Boxes Metrics for Current User (CRM View)
    const userBoxMetrics = useMemo(() => {
        const today = getToday();
        let todayCount = 0;
        let todayAmount = 0;
        let overdueCount = 0;
        let overdueAmount = 0;
        let noFollowUpCount = 0;
        let noFollowUpAmount = 0;
        let futureCount = 0;
        let futureAmount = 0;
        let totalCount = 0;
        let totalAmount = 0;

        outstandingData.forEach(item => {
            if (!hasOutstanding(item)) return;

            totalCount++;
            totalAmount += item.total || 0;
            const cat = getFollowUpCategory(item, today);
            if (cat === 'completed') return;

            if (cat === 'today') {
                todayCount++;
                todayAmount += item.total || 0;
            } else if (cat === 'overdue') {
                overdueCount++;
                overdueAmount += item.total || 0;
            } else if (cat === 'future') {
                futureCount++;
                futureAmount += item.total || 0;
            } else if (cat === 'no_follow_up') {
                noFollowUpCount++;
                noFollowUpAmount += item.total || 0;
            }
        });

        return {
            todayCount, todayAmount,
            overdueCount, overdueAmount,
            noFollowUpCount, noFollowUpAmount,
            futureCount, futureAmount,
            totalCount, totalAmount
        };
    }, [outstandingData]);


    // Cash Flow Collection Forecast Metrics (Requirement 2)
    const cashFlowForecastMetrics = useMemo(() => {
        const today = getToday();
        const next7Days = new Date(today);
        next7Days.setDate(next7Days.getDate() + 7);

        let todayForecast = 0;
        let todayCount = 0;
        let weekForecast = 0;
        let weekCount = 0;
        let totalForecast = 0;
        let totalCount = 0;

        const committedCustomers: { customer: Outstanding; amount: number; dateText: string }[] = [];

        outstandingData.forEach(item => {
            if (item.status === FollowUpStatus.Completed) return;
            if (item.forecastAmount && item.forecastAmount > 0) {
                const fDate = item.forecastDate ? new Date(item.forecastDate) : (item.followUpDate ? new Date(item.followUpDate) : new Date());
                fDate.setHours(0,0,0,0);
                totalForecast += item.forecastAmount;
                totalCount++;

                committedCustomers.push({
                    customer: item,
                    amount: item.forecastAmount,
                    dateText: fDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
                });

                if (fDate.getTime() === today.getTime()) {
                    todayForecast += item.forecastAmount;
                    todayCount++;
                } else if (fDate.getTime() > today.getTime() && fDate.getTime() <= next7Days.getTime()) {
                    weekForecast += item.forecastAmount;
                    weekCount++;
                }
            }
        });

        return {
            todayForecast,
            todayCount,
            weekForecast,
            weekCount,
            totalForecast,
            totalCount,
            committedCustomers: committedCustomers.sort((a, b) => b.amount - a.amount),
        };
    }, [outstandingData]);
    
    const notificationSummary = useMemo(() => {
        const urgentCount = outstandingData.filter(item => item.isUrgent && item.status !== FollowUpStatus.Completed).length;
        const overdueCount = outstandingData.filter(item => item.status === FollowUpStatus.Overdue).length;
        return { urgentCount, overdueCount };
    }, [outstandingData]);


    /**
     * Per-CRM collection workload.
     *
     * Two things this has to get right, both of which it used to get wrong.
     *
     * The bucket key is normalised. The sheet writes a CRM code however the
     * person typing it felt that day, and the user list has its own spelling;
     * keying the map on the raw string split one person across "ANKUR",
     * "Ankur " and "ankur", so a freshly assigned account landed in a bucket
     * nobody was looking at and every total was short.
     *
     * And only accounts that actually owe money are counted. Syncing the
     * Customer Master brings in the full customer list, most of whom owe
     * nothing; counting them made each CRM look responsible for thousands of
     * accounts there was nothing to chase on.
     */
    const crmPerformanceStats = useMemo(() => {
        const today = getToday();
        type Stat = {
            crmId: string; crmName: string; totalAssigned: number; followUpDone: number;
            todayFollowUp: number; overdue: number; unattended: number; timelyCount: number;
            noDues: number;
        };
        const statsMap = new Map<string, Stat>();

        const blank = (crmId: string, crmName: string): Stat => ({
            crmId, crmName,
            totalAssigned: 0, followUpDone: 0, todayFollowUp: 0,
            overdue: 0, unattended: 0, timelyCount: 0, noDues: 0,
        });

        // Seed the people we know about, so a CRM with an empty book still
        // appears rather than silently dropping off the table.
        users.filter(u => u.role === UserRole.CRM || u.role === UserRole.Collector).forEach(u => {
            const k = ownerKey(u.id);
            if (k) statsMap.set(k, blank(u.id, u.name));
        });

        statsMap.set('UNASSIGNED', blank('Unassigned', 'No CRM Assigned'));

        /**
         * The one bucket this owner belongs in.
         *
         * Keyed by the person's CRM code whenever the value names somebody on
         * the roster, so an account saved as "Vansh Sharma" and one saved as
         * VANSH_SHARMA count towards the same row. Keying on the raw spelling
         * gave that person two rows with their book split between them — and,
         * since both rows carried the same `crmId`, two React children with the
         * same key.
         */
        const bucketFor = (raw: string | undefined, key: string) => {
            const known = users.find(u => ownerKey(u.id) === key || ownerKey(u.name) === key);
            const bucketKey = known ? ownerKey(known.id) : key;
            if (!statsMap.has(bucketKey)) {
                const label = (raw || '').trim();
                statsMap.set(bucketKey, blank(known?.id || label, known?.name || label));
            }
            return statsMap.get(bucketKey)!;
        };

        outstandingData.forEach(item => {
            const ownerK = ownerKey(item.crmOwnerId) || 'UNASSIGNED';
            const collectorK = ownerKey(item.assignedCollectorId);

            // An account with a collector on it is work for two people: the CRM
            // who owns it and the collector chasing it. Bucketing on ownership
            // alone left every Collector sitting at zero no matter how much had
            // been handed to them, which is exactly what a manager checks here.
            const buckets = [bucketFor(item.crmOwnerId, ownerK)];
            if (collectorK && collectorK !== ownerK) {
                // Two spellings of one person resolve to one bucket, so compare
                // the buckets rather than the raw keys — otherwise the account
                // would be counted twice in the same row.
                const collectorBucket = bucketFor(item.assignedCollectorId, collectorK);
                if (collectorBucket !== buckets[0]) buckets.push(collectorBucket);
            }

            const cat = getFollowUpCategory(item, today);

            for (const stat of buckets) {
                // On the books but owing nothing — real customers, nothing to chase.
                if (!hasOutstanding(item)) {
                    stat.noDues++;
                    continue;
                }

                stat.totalAssigned++;

                if (cat === 'completed') {
                    stat.followUpDone++;
                    stat.timelyCount++;
                } else if (cat === 'today') {
                    stat.todayFollowUp++;
                    stat.timelyCount++;
                } else if (cat === 'future') {
                    stat.timelyCount++;
                } else if (cat === 'overdue') {
                    stat.overdue++;
                    stat.unattended++;
                } else if (cat === 'no_follow_up') {
                    stat.unattended++;
                }
            }
        });

        return Array.from(statsMap.values()).map(stat => ({
            ...stat,
            score: stat.totalAssigned > 0 ? Math.round((stat.timelyCount / stat.totalAssigned) * 100) : 0
        }));

    }, [outstandingData, users]);



    // PDC Cheque Handlers & Calculations
    /**
     * Cheques this person is responsible for, and where they stand today.
     *
     * This narrowed the list only for a CRM, so a scoped Collector was shown a
     * badge counting the whole company's cheques while the register itself
     * showed only theirs. It now uses the same scoping rule as everything else,
     * and the same date-derived state as the register.
     */
    const todayPdcMetrics = useMemo(() => {
        const today = new Date();
        const mine = new Set(scopeTo(currentUser, appData).map(a => a.id));
        const visible = seesWholeBook(currentUser)
            ? pdcCheques
            : pdcCheques.filter(p => mine.has(p.customerId) || isResponsibleFor(currentUser!, { crmOwnerId: p.crmOwnerId || '' }));

        let todayCount = 0, todayAmount = 0, overdueCount = 0, overdueAmount = 0;
        let activeCount = 0, activeAmount = 0;

        for (const cheque of visible) {
            const state = chequeState(cheque, today);
            if (!CHEQUE_ACTIVE.includes(state)) continue;
            activeCount++;
            activeAmount += cheque.amount;
            if (state === 'due') { todayCount++; todayAmount += cheque.amount; }
            if (state === 'overdue') { overdueCount++; overdueAmount += cheque.amount; }
        }

        return { todayCount, todayAmount, overdueCount, overdueAmount, activeCount, activeAmount };
    }, [pdcCheques, currentUser, appData]);

    const handleOpenAddPdc = (customerId?: string) => {
        setEditingPdcCheque(null);
        setPdcPreselectedCustomerId(customerId);
        setIsPdcModalOpen(true);
    };

    const handleOpenEditPdc = (cheque: PdcCheque) => {
        setEditingPdcCheque(cheque);
        setPdcPreselectedCustomerId(cheque.customerId);
        setIsPdcModalOpen(true);
    };

    const handleSavePdc = (chequeData: Omit<PdcCheque, 'id'> & { id?: string }) => {
        if (chequeData.id) {
            setPdcCheques(prev => prev.map(p => p.id === chequeData.id ? { ...(chequeData as PdcCheque) } : p));
        } else {
            const newCheque: PdcCheque = {
                ...(chequeData as Omit<PdcCheque, 'id'>),
                id: `pdc_${Date.now()}`
            };
            setPdcCheques(prev => [newCheque, ...prev]);
        }
        setIsPdcModalOpen(false);
    };

    const handleDeletePdc = (chequeId: string) => {
        setPdcCheques(prev => prev.filter(p => p.id !== chequeId));
    };

    const handleUpdatePdcStatus = (chequeId: string, newStatus: PdcStatus) => {
        setPdcCheques(prev => prev.map(p => {
            if (p.id === chequeId) {
                return {
                    ...p,
                    status: newStatus,
                    clearedDate: newStatus === PdcStatus.Cleared ? new Date() : p.clearedDate
                };
            }
            return p;
        }));
    };

    const handleOpenPdcForCustomer = (customerId: string) => {
        if (currentUser?.role === UserRole.Admin) {
            setAdminTab('pdc');
        } else {
            setUserTab('pdc');
        }
        setPdcInitialCustomerFilter(customerId);
        setPdcInitialStatusFilter('all');
    };

    const handleOpenTodayPdc = () => {
        if (currentUser?.role === UserRole.Admin) {
            setAdminTab('pdc');
        } else {
            setUserTab('pdc');
        }
        setPdcInitialStatusFilter('today');
        setPdcInitialCustomerFilter('all');
    };

    // Shared dashboard view for Admin
    const renderAdminOverviewCards = () => (
        <div className="flex flex-col gap-7">
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
                        <p className="text-[13.5px] text-label-3 mt-1">Tap a card to open it in the customer book.</p>
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
                        onClick={() => { handleCategoryBoxClick('today'); setAdminTab('reports'); }}
                        value={fourBoxesSummary.todayCount}
                        sub={<><span className="num font-semibold text-label-2">{formatCompact(fourBoxesSummary.todayAmount)}</span> to chase</>}
                    />
                    <Stat
                        label="Overdue"
                        tone="dang"
                        active={categoryFilter === 'overdue'}
                        onClick={() => { handleCategoryBoxClick('overdue'); setAdminTab('reports'); }}
                        value={fourBoxesSummary.overdueCount}
                        sub={<><span className="num font-semibold text-label-2">{formatCompact(fourBoxesSummary.overdueAmount)}</span> past promised date</>}
                    />
                    <Stat
                        label="No follow-up"
                        tone="warn"
                        active={categoryFilter === 'no_follow_up'}
                        onClick={() => { handleCategoryBoxClick('no_follow_up'); setAdminTab('reports'); }}
                        value={fourBoxesSummary.noFollowUpCount}
                        sub={<><span className="num font-semibold text-label-2">{formatCompact(fourBoxesSummary.noFollowUpAmount)}</span> unattended</>}
                    />
                    <Stat
                        label="Scheduled"
                        tone="pos"
                        active={categoryFilter === 'future'}
                        onClick={() => { handleCategoryBoxClick('future'); setAdminTab('reports'); }}
                        value={fourBoxesSummary.futureCount}
                        sub={<><span className="num font-semibold text-label-2">{formatCompact(fourBoxesSummary.futureAmount)}</span> committed</>}
                    />
                </div>
            </section>

            {/* ---------- portfolio ageing ---------- */}
            <Card className="p-6">
                <SectionHeader
                    title="Portfolio ageing"
                    subtitle="How much of the book is still healthy, and how much has gone cold."
                    actions={<AgeingLegend />}
                />

                <div className="flex flex-wrap items-end gap-x-12 gap-y-5 mt-7">
                    <div>
                        <p className="label">Outstanding</p>
                        <p className="num text-[40px] font-semibold text-label leading-none mt-2.5 tracking-[-0.04em]">
                            {formatCompact(portfolioAgeing.total)}
                        </p>
                        <p className="text-[13px] text-label-3 mt-2.5">{formatINR(portfolioAgeing.total)}</p>
                    </div>
                    <div>
                        <p className="label">Past 45 days</p>
                        <p className="num text-[26px] font-semibold leading-none mt-2.5 tracking-[-0.03em]" style={{ color: 'var(--age-2-ink)' }}>
                            {formatCompact(portfolioAgeing.over45)}
                        </p>
                        <p className="text-[13px] text-label-3 mt-2.5">{portfolioAgeing.pct45}% of the book</p>
                    </div>
                    <div>
                        <p className="label">Past 90 days</p>
                        <p className="num text-[26px] font-semibold leading-none mt-2.5 tracking-[-0.03em]" style={{ color: 'var(--age-3-ink)' }}>
                            {formatCompact(portfolioAgeing.over90)}
                        </p>
                        <p className="text-[13px] text-label-3 mt-2.5">{portfolioAgeing.pct90}% of the book</p>
                    </div>
                </div>

                <AgeingBar parts={portfolioAgeing} height={12} className="mt-7" />

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
                    {AGE_BANDS.map(band => {
                        const amount = portfolioAgeing[band.key];
                        const pct = portfolioAgeing.total > 0 ? Math.round((amount / portfolioAgeing.total) * 100) : 0;
                        return (
                            <div key={band.key} className="bg-card-2 rounded-[14px] px-4 py-3.5">
                                <span className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: band.varName }} aria-hidden="true" />
                                    <span className="text-[13px] font-medium text-label-2">{band.label}</span>
                                </span>
                                <p className="num text-[19px] font-semibold text-label mt-2">{formatCompact(amount)}</p>
                                <p className="text-[12.5px] text-label-3 mt-1">{pct}% of book</p>
                            </div>
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
                    <div className="flex items-end gap-10 mt-7">
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
                    <div className="flex gap-2.5 mt-auto pt-7">
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
                    <div className="flex items-end gap-10 mt-7">
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

            {/* ---------- team ---------- */}
            <CrmPerformanceTable stats={crmPerformanceStats} />
        </div>
    );

    const renderCustomerListView = () => (
        <CustomerDashboardView
            data={appData}
            globalSearch={searchTerm}
            currentUser={currentUser}
            users={users}
            onAddCustomer={handleOpenAddCustomer}
            onEditCustomer={handleOpenEditCustomer}
            onDeleteCustomer={handleDeleteCustomer}
            onFollowUp={handleOpenFollowUp}
            onWhatsApp={handleSendWhatsApp}
            onOpenPdcForCustomer={handleOpenPdcForCustomer}
            onReassignCrm={handleReassignCrm}
            onBulkReassignCrm={handleBulkReassignCrm}
            onBulkSetRank={rights.canEditCustomer ? handleBulkSetRank : undefined}
            pdcCheques={pdcCheques}
            onSyncSheet={rights.canSyncSheets ? () => handleGoogleSync() : undefined}
            isSyncing={isSyncing}
            lastUpdatedTill={sheetUpdatedTillDate}
            onExportExcel={handleExportCustomerExcel}
        />
    );

    // Unified User Dashboard for CRM and Collector
    const renderUserDashboard = () => {
        // Use lifted state
        const activeTab = userTab;

        return (
            <>
                {activeTab === 'overview' && (
                    <div className="flex flex-col gap-7">
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
                            <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3.5">
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
                        </section>

                        {/* ---------- my book ---------- */}
                        <div className="grid lg:grid-cols-2 gap-3.5">
                            <Card className="p-6 flex flex-col">
                                <SectionHeader
                                    title="My book"
                                    subtitle="Everything assigned to you, by age."
                                    actions={<AgeingLegend />}
                                />
                                <div className="flex flex-wrap items-end gap-x-10 gap-y-5 mt-7">
                                    <div>
                                        <p className="label">Outstanding</p>
                                        <p className="num text-[34px] font-semibold text-label leading-none mt-2.5 tracking-[-0.04em]">
                                            {formatCompact(myAgeing.total)}
                                        </p>
                                        <p className="text-[13px] text-label-3 mt-2.5">{userBoxMetrics.totalCount} accounts</p>
                                    </div>
                                    <div>
                                        <p className="label">Past 45 days</p>
                                        <p className="num text-[22px] font-semibold leading-none mt-2.5 tracking-[-0.03em]" style={{ color: 'var(--age-2-ink)' }}>
                                            {formatCompact(myAgeing.over45)}
                                        </p>
                                        <p className="text-[13px] text-label-3 mt-2.5">{myAgeing.pct45}% of your book</p>
                                    </div>
                                    <div>
                                        <p className="label">Past 90 days</p>
                                        <p className="num text-[22px] font-semibold leading-none mt-2.5 tracking-[-0.03em]" style={{ color: 'var(--age-3-ink)' }}>
                                            {formatCompact(myAgeing.over90)}
                                        </p>
                                        <p className="text-[13px] text-label-3 mt-2.5">{myAgeing.pct90}% of your book</p>
                                    </div>
                                </div>
                                <div className="mt-auto pt-7">
                                    <AgeingBar parts={myAgeing} height={12} />
                                </div>
                            </Card>

                            <Card className="p-6 flex flex-col">
                                <SectionHeader
                                    title="Cheques and commitments"
                                    subtitle="Cheques to present, and what customers promised you."
                                />
                                <div className="flex items-end gap-10 mt-7 flex-wrap">
                                    <div>
                                        <p className="label">Cheques today</p>
                                        <p className="num text-[32px] font-semibold text-label leading-none mt-2.5 tracking-[-0.03em]">
                                            {todayPdcMetrics.todayCount}
                                        </p>
                                        <p className="text-[12.5px] text-label-3 mt-2">{formatCompact(todayPdcMetrics.todayAmount)}</p>
                                    </div>
                                    <div>
                                        <p className="label">Held in hand</p>
                                        <p className="num text-[22px] font-semibold leading-none mt-2.5 tracking-[-0.02em]" style={{ color: 'var(--age-1-ink)' }}>
                                            {formatCompact(todayPdcMetrics.activeAmount)}
                                        </p>
                                        <p className="text-[12.5px] text-label-3 mt-2">{todayPdcMetrics.activeCount} cheques</p>
                                    </div>
                                    <div>
                                        <p className="label">Promised today</p>
                                        <p className="num text-[22px] font-semibold text-label leading-none mt-2.5 tracking-[-0.02em]">
                                            {formatCompact(cashFlowForecastMetrics.todayForecast)}
                                        </p>
                                        <p className="text-[12.5px] text-label-3 mt-2">{cashFlowForecastMetrics.todayCount} commitments</p>
                                    </div>
                                </div>
                                <div className="flex gap-2.5 mt-auto pt-7">
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
                        <Card className="p-6">
                            <SectionHeader
                                title={
                                    categoryFilter === 'today' ? 'Due today'
                                        : categoryFilter === 'overdue' ? 'Past their promised date'
                                        : categoryFilter === 'no_follow_up' ? 'No follow-up planned'
                                        : categoryFilter === 'future' ? 'Scheduled'
                                        : 'My accounts'
                                }
                                subtitle={`${filteredData.length} account${filteredData.length === 1 ? '' : 's'}${searchTerm ? ' matching your search' : ''}`}
                                actions={
                                    <Button size="sm" variant="quiet" onClick={() => setActiveKey('customers')}>
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
                                <div className="mt-6 flex flex-col gap-2.5">
                                    {filteredData.slice(0, 40).map(customer => {
                                        const cat = getFollowUpCategory(customer, getToday());
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

                                                <div className="flex items-center gap-4 md:gap-5 flex-none">
                                                    <div className="text-right">
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
                                            onClick={() => setActiveKey('customers')}
                                            className="text-[13.5px] font-semibold text-accent hover:underline self-start mt-1"
                                        >
                                            {filteredData.length - 40} more in the full list
                                        </button>
                                    )}
                                </div>
                            )}
                        </Card>
                    </div>
                )}

                {activeTab === 'pdc' && (
                    <Card className="p-6">
                        <PdcChequesView
                            pdcCheques={pdcCheques}
                            customers={appData}
                            users={users}
                            currentUser={currentUser!}
                            onAddPdc={() => handleOpenAddPdc()}
                            onEditPdc={handleOpenEditPdc}
                            onDeletePdc={handleDeletePdc}
                            onUpdatePdcStatus={handleUpdatePdcStatus}
                            initialCustomerFilter={pdcInitialCustomerFilter || undefined}
                            initialStatusFilter={pdcInitialStatusFilter || undefined}
                        />
                    </Card>
                )}

                {activeTab === 'reports' && (
                    <ReportsView
                        data={appData}
                        users={users}
                        currentUser={currentUser!}
                        initialCrmFilter={currentUser?.role === UserRole.CRM ? currentUser.id : 'ALL'}
                        initialCategoryFilter={categoryFilter}
                        onFollowUp={handleOpenFollowUp}
                        onWhatsApp={handleSendWhatsApp}
                        pdcCheques={pdcCheques}
                        onOpenPdcForCustomer={handleOpenPdcForCustomer}
                    />
                )}

                {activeTab === 'customers' && renderCustomerListView()}
            </>
        );
    };



    const renderCompanyDashboard = () => {
        // Use lifted state
        const activeTab = adminTab;

        const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;

            setIsSyncing(true);
            setSyncMessage(null);

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = e.target?.result;
                    const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const json: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval:"" });
                    
                    if (json.length < 1) {
                         throw new Error("Excel sheet is empty or invalid.");
                    }
                    
                    // Slice(1) to skip header row, assuming file has one.
                    const parsedData = parseRawDataArray(json.slice(1));
                    if (appData.length > 0) {
                        // Stamped on confirm, not here — a cancelled review must
                        // not leave the book looking freshly synced.
                        setPendingSync({
                            records: parsedData,
                            sourceName: file.name || 'Excel File'
                        });
                    } else {
                        setLastSyncTime(new Date().toISOString());
                        // Same path as every other import, so an upload into an
                        // empty book obeys the same rules as one into a full one.
                        const processedData = mergeWithExistingFollowUps([], parsedData);
                        setAppData(processedData);
                        setSyncMessage({
                            type: 'success',
                            text: `Loaded ${parsedData.length} records. They have no CRM against them yet — assign owners from the customer list.`,
                        });
                    }
                } catch (err) {
                     const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred during file processing.';
                     setSyncMessage({ type: 'error', text: `File load failed: ${errorMessage}` });
                } finally {
                     setIsSyncing(false);
                     setTimeout(() => setSyncMessage(null), 5000);
                     // Reset file input
                     event.target.value = '';
                }
            };
            reader.onerror = () => {
                 setSyncMessage({ type: 'error', text: `Failed to read file.` });
                 setIsSyncing(false);
            };
            reader.readAsBinaryString(file);
        };
        
        const copyHeaders = () => {
            navigator.clipboard.writeText(EXPECTED_HEADERS.join('\t'));
            alert("Column headers copied to clipboard! Paste them into the first row of your Excel or Google Sheet.");
        };

        const downloadTemplate = () => {
            if (XLSX) {
                const ws = XLSX.utils.aoa_to_sheet([EXPECTED_HEADERS]);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws,"Sheet1");
                XLSX.writeFile(wb,"TimelyPayment_Template.xlsx");
            } else {
                alert("Export functionality not ready yet. Please try again in a moment.");
            }
        };


        return (
             <>
                {activeTab === 'overview' && renderAdminOverviewCards()}
                
                {activeTab === 'customers' && renderCustomerListView()}

                {activeTab === 'pdc' && (
                    <Card className="p-6">
                        <PdcChequesView
                            pdcCheques={pdcCheques}
                            customers={appData}
                            users={users}
                            currentUser={currentUser!}
                            onAddPdc={() => handleOpenAddPdc()}
                            onEditPdc={handleOpenEditPdc}
                            onDeletePdc={handleDeletePdc}
                            onUpdatePdcStatus={handleUpdatePdcStatus}
                            initialCustomerFilter={pdcInitialCustomerFilter || undefined}
                            initialStatusFilter={pdcInitialStatusFilter || undefined}
                        />
                    </Card>
                )}

                {activeTab !== 'overview' && activeTab !== 'customers' && activeTab !== 'pdc' && (
                    <div className="bg-card rounded-lg shadow-md p-6">
                        {activeTab === 'users' && rights.isAdmin && (
                            <div className="space-y-6">
                                {/* Sub-navigation tabs inside User Management */}
                                <div className="flex flex-wrap items-center gap-2 border-b border-separator pb-3">
                                    <button
                                        onClick={() => setUserManagementTab('users')}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
 userManagementTab === 'users'
 ? 'bg-accent text-on-accent shadow-e1'
 : 'bg-card-3 text-label-2 hover:bg-hover'
 }`}
                                    >
                                        <UsersIcon className="w-4 h-4" />
                                        <span>User Accounts ({users.length})</span>
                                    </button>
                                    <button
                                        onClick={() => setUserManagementTab('company')}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
 userManagementTab === 'company'
 ? 'bg-accent text-on-accent shadow-e1'
 : 'bg-card-3 text-label-2 hover:bg-hover'
 }`}
                                    >
                                        <BuildingOfficeIcon className="w-4 h-4" />
                                        <span>Company Profile & Organization</span>
                                    </button>
                                </div>

                                {userManagementTab === 'users' ? (
                                    <div>
                                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                                            <div>
                                                <h2 className="text-xl font-bold text-label">System Users & Access Roles</h2>
                                                <p className="text-xs text-label-3 mt-0.5">Manage executive admin, CRM account owners, and collection staff.</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleOpenUserModal(null)}
                                                    className="flex items-center px-3.5 py-2 text-sm font-semibold rounded-lg bg-accent text-on-accent hover:bg-accent-press shadow-xs"
                                                >
                                                    <UserPlusIcon className="w-4 h-4 -ml-1 mr-2" />
                                                    <span>Add User</span>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="overflow-x-auto rounded-xl border border-separator">
                                            <table className="min-w-full divide-y divide-separator text-left text-xs sm:text-sm">
                                                <thead className="bg-card-2">
                                                    <tr>
                                                        <th className="px-4 py-3 font-semibold text-label-3 uppercase tracking-wider">User & ID</th>
                                                        <th className="px-4 py-3 font-semibold text-label-3 uppercase tracking-wider">Role</th>
                                                        <th className="px-4 py-3 font-semibold text-label-3 uppercase tracking-wider">Assigned CRMs / Scope</th>
                                                        <th className="px-4 py-3 font-semibold text-label-3 uppercase tracking-wider">Granted Permissions</th>
                                                        <th className="px-4 py-3 text-right font-semibold text-label-3 uppercase tracking-wider">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-card divide-y divide-separator">
                                                    {users.map(user => {
                                                        const p = user.permissions;
                                                        return (
                                                            <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                                                                <td className="px-4 py-3 whitespace-nowrap">
                                                                    <div className="font-bold text-label">{user.name}</div>
                                                                    <div className="text-xs text-label-3 font-mono">ID: {user.id}</div>
                                                                    {user.email && (
                                                                        <div className="text-xs text-label-3">{user.email}</div>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-3 whitespace-nowrap">
                                                                    <span className={`inline-flex px-2.5 py-1 text-xs font-bold rounded-lg ${
 user.role === UserRole.Admin ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800' :
 user.role === UserRole.Manager ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800' :
 user.role === UserRole.CRM ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800' :
 user.role === UserRole.Collector ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800' :
 'bg-card-3 text-label-2 border border-separator'
 }`}>
                                                                        {user.role}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    {user.role === UserRole.Admin || user.dataVisibility === DataVisibility.All ? (
                                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[12.5px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                                                            All Accounts
                                                                        </span>
                                                                    ) : (
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {(user.assignedCrms && user.assignedCrms.length > 0 ? user.assignedCrms : [user.id]).map(c => (
                                                                                <span key={c} className="inline-flex items-center px-2 py-0.5 rounded text-[12.5px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                                                                    {c}
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    <div className="flex flex-wrap gap-1 text-[11.5px]">
                                                                        {user.role === UserRole.Admin ? (
                                                                            <span className="font-bold text-purple-600 dark:text-purple-400">Full System Control (All Rights)</span>
                                                                        ) : (
                                                                            <>
                                                                                {p?.canAddCustomer && <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800">+ Add Customer</span>}
                                                                                {p?.canEditCustomer && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-semibold border border-blue-200 dark:border-blue-800">Edit Info</span>}
                                                                                {p?.canEditFinancials && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 font-semibold border border-amber-200 dark:border-amber-800">Edit Financials</span>}
                                                                                {p?.canManagePdc && <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-semibold border border-indigo-200 dark:border-indigo-800">Manage PDC</span>}
                                                                                {p?.canReassignCrm && <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300 font-semibold border border-purple-200 dark:border-purple-800">Reassign CRM</span>}
                                                                                {p?.canDeleteCustomer && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 font-semibold border border-red-200 dark:border-red-800">Delete</span>}
                                                                                {p?.canExportData && <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300 font-semibold border border-teal-200 dark:border-teal-800">Export</span>}
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                                                                    <div className="flex justify-end items-center space-x-2">
                                                                        <button 
                                                                            onClick={() => handleOpenUserModal(user)} 
                                                                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900 border border-green-200 dark:border-green-800 transition-colors" 
                                                                            title="Edit user rights and role"
                                                                        >
                                                                            <EditIcon className="w-3.5 h-3.5" />
                                                                            <span>Edit Rights</span>
                                                                        </button>
                                                                        {user.role !== UserRole.Admin && (
                                                                            <button 
                                                                                onClick={() => handleDeleteUser(user.id)} 
                                                                                className="p-1.5 text-dang hover:opacity-80 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-colors" 
                                                                                title="Delete user"
                                                                            >
                                                                                <TrashIcon className="w-4 h-4" />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ) : (
                                    <CompanyProfileView
                                        profile={companyProfile}
                                        onSave={handleSaveCompanyProfile}
                                    />
                                )}
                            </div>
                        )}
                        {activeTab === 'alerts' && rights.canSyncSheets && (
                            <AlertsView canEdit={rights.canSyncSheets} />
                        )}
                        {activeTab === 'reports' && (
                            <ReportsView
                                data={appData}
                                users={users}
                                currentUser={currentUser!}
                                companyProfile={companyProfile}
                                initialCategoryFilter={categoryFilter}
                                onFollowUp={handleOpenFollowUp}
                                onWhatsApp={handleSendWhatsApp}
                                pdcCheques={pdcCheques}
                                onOpenPdcForCustomer={handleOpenPdcForCustomer}
                            />
                        )}
                         {activeTab === 'templates' && rights.canSyncSheets && (
                            <div>
                                <div className="flex justify-between items-center mb-4">
                                    <h2 className="text-2xl font-bold text-label">Manage Message Templates</h2>
                                    <button 
                                        onClick={() => handleOpenTemplateModal(null)}
                                        className="flex items-center px-3 py-2 text-sm font-semibold rounded-lg bg-accent text-on-accent hover:bg-accent-press"
                                    >
                                        <UserPlusIcon className="w-5 h-5 -ml-1 mr-2" />
                                        <span>New Template</span>
                                    </button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-separator">
                                        <thead className="bg-card-2">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-label-3 uppercase tracking-wider">Template Name</th>
                                                <th className="px-6 py-3 text-right text-xs font-medium text-label-3 uppercase tracking-wider">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-card divide-y divide-separator">
                                            {templates.map(template => (
                                                <tr key={template.id}>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-label">{template.name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                        <div className="flex justify-end items-center space-x-2">
                                                            <button onClick={() => handleOpenTemplateModal(template)} className="w-9 h-9 grid place-items-center rounded-full text-accent hover:text-accent hover:bg-hover" aria-label={`Edit template ${template.name}`}><EditIcon /></button>
                                                            <button onClick={() => handleDeleteTemplate(template.id)} className="w-9 h-9 grid place-items-center rounded-full text-dang hover:opacity-80 hover:bg-hover" aria-label={`Delete template ${template.name}`}><TrashIcon /></button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                        {activeTab === 'source' && rights.canSyncSheets && (
                             <div>
                                <h2 className="text-2xl font-bold mb-6 text-label">Data Source Management</h2>
                                
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                    
                                    {/* Data Format Section */}
                                    <div className="p-6 rounded-lg border border-separator col-span-1 lg:col-span-2 bg-accent-tint">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="text-lg font-semibold mb-2 text-label">1. Data Format Required</h3>
                                                <p className="text-sm text-label-2 mb-4">
                                                    Your Excel file or Google Sheet must have the following columns in this exact order (starting row 1):
                                                </p>
                                            </div>
                                            <div className="flex space-x-2">
                                                 <button onClick={downloadTemplate} className="flex items-center px-3 py-2 bg-card border border-separator-strong rounded-md text-sm font-medium hover:bg-hover transition-colors">
                                                    <DownloadIcon />
                                                    <span className="ml-2">Download Excel Template</span>
                                                </button>
                                                <button onClick={copyHeaders} className="flex items-center px-3 py-2 bg-card border border-separator-strong rounded-md text-sm font-medium hover:bg-hover transition-colors">
                                                    <ClipboardListIcon className="w-4 h-4 mr-2"/> Copy Headers
                                                </button>
                                            </div>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full text-xs text-left text-label-3">
                                                <thead className="text-xs text-label-2 uppercase bg-card-3">
                                                    <tr>
                                                        {EXPECTED_HEADERS.map((h, i) => <th key={i} className="px-2 py-1 border">{h}</th>)}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr className="bg-card">
                                                        <td className="px-2 py-1 border font-mono">out_1</td>
                                                        <td className="px-2 py-1 border">Acme Corp</td>
                                                        <td className="px-2 py-1 border">John Doe</td>
                                                        <td className="px-2 py-1 border">9876543210</td>
                                                        <td className="px-2 py-1 border">5000</td>
                                                        <td className="px-2 py-1 border">5000</td>
                                                        <td className="px-2 py-1 border">0</td>
                                                        <td className="px-2 py-1 border">0</td>
                                                        <td className="px-2 py-1 border">0</td>
                                                        <td className="px-2 py-1 border">Priya Singh</td>
                                                        <td className="px-2 py-1 border">Amit Kumar</td>
                                                        <td className="px-2 py-1 border">2023-12-01</td>
                                                        <td className="px-2 py-1 border">Follow up</td>
                                                        <td className="px-2 py-1 border">FALSE</td>
                                                        <td className="px-2 py-1 border">2023-01-01</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* Data Source Configuration */}
                                    <div className="p-6 rounded-lg border border-separator col-span-1 lg:col-span-2">
                                        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-4">
                                            <h3 className="text-lg font-semibold text-label">2. Select Data Source & Sync Status</h3>
                                            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 text-xs">
                                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                                <span className="font-semibold">Last Synced:</span>
                                                <span>{new Date(lastSyncTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}, {new Date(lastSyncTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex flex-col sm:flex-row gap-6 mb-6">
                                            <label className={`flex-1 p-4 border rounded-lg cursor-pointer transition-all ${dataSourceMode === 'excel' ? 'border-green-500 bg-green-50 dark:bg-green-900/10' : 'border-separator'}`}>
                                                <div className="flex items-center mb-2">
                                                    <input 
                                                        type="radio" 
                                                        name="dataSource" 
                                                        value="excel" 
                                                        checked={dataSourceMode === 'excel'} 
                                                        onChange={() => setDataSourceMode('excel')}
                                                        className="h-4 w-4 text-accent focus:ring-accent"
                                                    />
                                                    <span className="ml-3 font-semibold text-label">Excel Upload (Offline)</span>
                                                </div>
                                                <p className="text-sm text-label-3 ml-7">
                                                    Upload a spreadsheet by hand. It is reviewed before anything is saved, and it saves to the shared database like every other change.
                                                </p>
                                            </label>

                                            <label className={`flex-1 p-4 border rounded-lg cursor-pointer transition-all ${dataSourceMode === 'google' ? 'border-green-500 bg-green-50 dark:bg-green-900/10' : 'border-separator'}`}>
                                                <div className="flex items-center mb-2">
                                                    <input 
                                                        type="radio" 
                                                        name="dataSource" 
                                                        value="google" 
                                                        checked={dataSourceMode === 'google'} 
                                                        onChange={() => setDataSourceMode('google')}
                                                        className="h-4 w-4 text-accent focus:ring-accent"
                                                    />
                                                    <span className="ml-3 font-semibold text-label">Live Google Sheet (Team)</span>
                                                </div>
                                                <p className="text-sm text-label-3 ml-7">
                                                    Best for teams. Multiple users see the same data. Requires sheet to be public/shared.
                                                </p>
                                            </label>
                                        </div>

                                        {dataSourceMode === 'excel' ? (
                                            <div className="flex flex-col items-center justify-center border-2 border-dashed border-separator-strong rounded-lg p-10 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                                                <p className="text-sm text-label-3 mb-4 text-center">
                                                    Upload your .xlsx file here. This will replace the current dataset.
                                                </p>
                                                <label htmlFor="file-upload" className="cursor-pointer flex items-center justify-center px-6 py-3 text-base font-semibold rounded-lg transition-colors bg-accent text-on-accent hover:bg-accent-press disabled:bg-gray-400 shadow-md">
                                                     <UploadIcon />
                                                     <span className="ml-2">{isSyncing ? 'Processing...' : 'Select Excel File'}</span>
                                                </label>
                                                <input id="file-upload" name="file-upload" type="file" className="sr-only" accept=".xlsx, .xls" onChange={handleFileChange} disabled={isSyncing}/>
                                            </div>
                                        ) : (
                                            <div className="space-y-6">
                                                {/* Where each thing lives, said once */}
                                                <div className="p-4 bg-card-2 border border-separator-strong rounded-xl">
                                                    <h4 className="text-sm font-extrabold text-label">How this works</h4>
                                                    <p className="text-xs text-label-2 mt-1 leading-relaxed">
                                                        <strong>The sheet carries the outstanding amounts. The software carries the customers.</strong>
                                                    </p>
                                                    <p className="text-xs text-label-3 mt-1.5 leading-relaxed">
                                                        Sync the outstanding sheet as often as you like — it updates balances and ageing,
                                                        and touches nothing else. Customers, their contacts, credit terms and CRM owners are
                                                        added and corrected here, in the customer list, and no sync overwrites them.
                                                    </p>
                                                    <p className="text-xs text-label-3 mt-1.5 leading-relaxed">
                                                        A name in the outstanding sheet that is not in the customer list yet is added
                                                        automatically so its money is counted, with no CRM against it. Those show up under
                                                        <strong className="text-label-2"> Unassigned</strong> in the customer list, waiting for an owner.
                                                    </p>
                                                </div>

                                                {/* Sheet 1: Outstanding Invoices */}
                                                <div className="bg-card p-5 rounded-xl border border-separator space-y-3">
                                                    <div className="flex justify-between items-center">
                                                        <label className="block text-xs font-bold uppercase tracking-wider text-label">
                                                            1. Outstanding Invoices &amp; Ageing Sheet
                                                        </label>
                                                        <span className="text-[12.5px] text-label-3">The only sheet that is synced</span>
                                                    </div>
                                                    <div className="flex flex-col sm:flex-row gap-2">
                                                        <input 
                                                            type="text" 
                                                            value={googleSheetUrl}
                                                            onChange={(e) => setGoogleSheetUrl(e.target.value)}
                                                            placeholder="https://docs.google.com/spreadsheets/d/..."
                                                            className="flex-1 p-2 border rounded-lg text-xs font-mono"
                                                        />
                                                        <button 
                                                            onClick={() => handleGoogleSync()}
                                                            disabled={isSyncing}
                                                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 flex items-center justify-center font-bold text-xs shadow-xs transition-colors whitespace-nowrap"
                                                        >
                                                            <SyncIcon /> 
                                                            <span className="ml-1.5">{isSyncing ? 'Syncing...' : 'Sync balances'}</span>
                                                        </button>
                                                    </div>
                                                    <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-label-3">
                                                        <span>Balances and ageing only — contacts, credit terms and CRM owners are not read from here</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setGoogleSheetUrl(OFFICIAL_TRANSACTIONS_SHEET_URL);
                                                            }}
                                                            className="inline-flex items-center min-h-[28px] py-1 text-accent hover:opacity-80 font-semibold underline"
                                                        >
                                                            Restore Default Invoices URL
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Sheet 2: Customer Master Directory */}
                                                <div className="bg-card p-5 rounded-xl border border-separator space-y-3">
                                                    <div className="flex justify-between items-center">
                                                        <label className="block text-xs font-bold uppercase tracking-wider text-label">
                                                            2. One-time customer import
                                                        </label>
                                                        <span className="text-[12.5px] text-label-3">Seeding only — not a sync</span>
                                                    </div>
                                                    <div className="flex flex-col sm:flex-row gap-2">
                                                        <input 
                                                            type="text" 
                                                            value={customerMasterSheetUrl}
                                                            onChange={(e) => setCustomerMasterSheetUrl(e.target.value)}
                                                            placeholder="https://docs.google.com/spreadsheets/d/..."
                                                            className="flex-1 p-2 border rounded-lg text-xs font-mono"
                                                        />
                                                        <button 
                                                            onClick={() => handleCustomerMasterSync()}
                                                            disabled={isSyncing}
                                                            className="px-4 py-2 bg-accent hover:bg-accent-press text-on-accent rounded-lg disabled:opacity-50 flex items-center justify-center font-bold text-xs shadow-xs transition-colors whitespace-nowrap"
                                                        >
                                                            <SyncIcon /> 
                                                            <span className="ml-1.5">{isSyncing ? 'Importing...' : 'Import Customers'}</span>
                                                        </button>
                                                    </div>
                                                    <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-label-3">
                                                        <span>Loads customers in bulk. Fills in blanks only — it never overwrites a detail recorded here.</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setCustomerMasterSheetUrl(OFFICIAL_CUSTOMER_MASTER_URL);
                                                            }}
                                                            className="inline-flex items-center min-h-[28px] py-1 text-accent hover:opacity-80 font-semibold underline"
                                                        >
                                                            Restore Default Master URL
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Who owns which account, and how that gets back to the sheet */}
                                                <div className="bg-card p-5 rounded-xl border border-separator space-y-3">
                                                    <div className="flex justify-between items-center">
                                                        <label className="block text-xs font-bold uppercase tracking-wider text-label">
                                                            3. CRM Ownership
                                                        </label>
                                                        <span className="text-[12.5px] text-label-3">Set here, not in the sheet</span>
                                                    </div>
                                                    <p className="text-[12.5px] text-label-2 leading-relaxed">
                                                        Reassigning an account in the customer list is permanent: a sync no longer hands
                                                        it back to whoever the sheet still has in its CRM column. Either sheet may still
                                                        fill in an owner where the app has none, and a new customer arrives with the
                                                        owner the sheet gives it.
                                                    </p>
                                                    <p className="text-[12.5px] text-label-3 leading-relaxed">
                                                        Nothing can be written back to Google Sheets from here, so export the list below
                                                        and paste its CRM column into the <strong className="text-label-2">Customer Master</strong> sheet.
                                                        The outstanding sheet looks its CRM up from the master, so correcting the master
                                                        corrects both.
                                                    </p>
                                                    <p className="text-[12.5px] text-label-3 leading-relaxed">
                                                        A customer missing from the master makes that lookup return
                                                        <code className="mx-1 px-1 rounded bg-card-3 font-mono text-[11.5px]">#N/A</code>,
                                                        which is read as "no owner" rather than filed under an owner of that name. Those
                                                        accounts show as unassigned until the master lists them.
                                                    </p>
                                                    {crmConflicts.length > 0 && (
                                                        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3">
                                                            <p className="text-[12.5px] font-bold text-amber-800 dark:text-amber-200">
                                                                {crmConflicts.length} account{crmConflicts.length === 1 ? '' : 's'} disagree with the sheet
                                                            </p>
                                                            <ul className="mt-1.5 space-y-0.5 max-h-32 overflow-y-auto">
                                                                {crmConflicts.slice(0, 25).map(c => (
                                                                    <li key={c.company} className="text-[12px] text-amber-900 dark:text-amber-100">
                                                                        <span className="font-semibold">{c.company}</span>
                                                                        {' — app: '}<span className="font-mono">{c.appCrm}</span>
                                                                        {', sheet: '}<span className="font-mono">{c.sheetCrm}</span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                            {crmConflicts.length > 25 && (
                                                                <p className="text-[11.5px] text-amber-700 dark:text-amber-300 mt-1">
                                                                    And {crmConflicts.length - 25} more. The export lists every one.
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={handleExportCrmAssignments}
                                                        className="px-4 py-2 bg-card-3 hover:bg-hover text-label rounded-lg border border-separator-strong font-bold text-xs transition-colors"
                                                    >
                                                        Download CRM owner list for the sheet
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        
                                        <div className="mt-8 pt-6 border-t border-separator">
                                            <h4 className="text-sm font-semibold text-label-2 mb-3">Troubleshooting & Fresh Start</h4>
                                            <div className="flex flex-wrap items-center gap-3">
                                                <button 
                                                    onClick={() => handleResetAllDataAndUsers(false)}
                                                    className="px-4 py-2 bg-dang-bg text-dang hover:brightness-95 rounded-lg text-xs font-bold shadow transition-all flex items-center gap-1.5"
                                                    title="Clear follow-ups and cheques for everyone and re-import the live sheet. Logins are not touched."
                                                >
                                                    <TrashIcon /> <span>Reset All Data (Fresh Start)</span>
                                                </button>
                                            </div>
                                            <p className="text-xs text-label-3 mt-2">
                                                This wipes notes, forecasts and PDC cheques for the whole team and
                                                re-imports the sheet. Team logins are managed in Team &amp; access.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                {syncMessage && (
                                    <div className={`mt-6 p-3 rounded-lg text-sm font-medium ${
 syncMessage.type === 'success' 
 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' 
 : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
 }`}>
                                        {syncMessage.text}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
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
    const activeKey = wholeBook ? adminTab : userTab;
    const setActiveKey = wholeBook ? setAdminTab : setUserTab;
    const boxes = wholeBook ? fourBoxesSummary : userBoxMetrics;

    // Needs-attention count drives the badge on"Today" - overdue first,
    // because that is what actually costs the company money.
    const attentionCount = boxes.todayCount + boxes.overdueCount;

    const workItems: NavItem[] = [
        { key: 'overview', label: 'Today', icon: <TodayIcon />, badge: attentionCount, badgeTone: boxes.overdueCount > 0 ? 'dang' : 'neutral' },
        { key: 'customers', label: wholeBook ? 'Customers' : 'My customers', icon: <BookIcon /> },
        { key: 'pdc', label: 'PDC cheques', icon: <ChequeNavIcon />, badge: todayPdcMetrics.todayCount, badgeTone: 'warn' },
        { key: 'reports', label: wholeBook ? 'Reports' : 'My performance', icon: <ChartIcon /> },
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
    const safeKey = allowedKeys.has(activeKey) ? activeKey : 'overview';

    const PAGE_TITLE: Record<string, string> = {
        overview: wholeBook ? 'Collections overview' : 'Today\u2019s follow-ups',
        customers: wholeBook ? 'Customer book' : 'My customers',
        pdc: 'Post-dated cheques',
        reports: wholeBook ? 'Reports' : 'My performance',
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

    const shellBanner = syncMessage ? (
        <div className="px-3 sm:px-5 lg:px-7 pt-4">
            <div
                role="status"
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                    syncMessage.type === 'success'
                        ? 'bg-pos-bg border-pos text-pos'
                        : 'bg-dang-bg border-dang text-dang'
                }`}
            >
                <span className="mt-0.5 flex-none">
                    {syncMessage.type === 'success'
                        ? <CheckCircleIcon className="w-[18px] h-[18px]" />
                        : <ExclamationTriangleIcon className="w-[18px] h-[18px]" />}
                </span>
                <p className="text-[14px] font-medium flex-1 leading-snug">{syncMessage.text}</p>
                {syncMessage.type === 'error' && (
                    <button
                        onClick={() => handleGoogleSync(OFFICIAL_SHEET_URL)}
                        className="text-[13px] font-bold underline underline-offset-2 whitespace-nowrap flex-none"
                    >
                        Retry official sheet
                    </button>
                )}
                <button
                    onClick={() => setSyncMessage(null)}
                    className="opacity-55 hover:opacity-100 flex-none leading-none text-lg"
                >
                    &times;
                </button>
            </div>
        </div>
    ) : null;

    return (
        <>
        <AppShell
            currentUser={currentUser}
            groups={navGroups}
            activeKey={safeKey}
            onNavigate={setActiveKey}
            onLogout={handleLogout}
            onChangePassword={() => setIsPasswordModalOpen(true)}
            title={PAGE_TITLE[safeKey] || 'Timely Payment'}
            subtitle={
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
            searchTerm={searchTerm}
            onSearch={setSearchTerm}
            onSync={rights.canSyncSheets ? () => handleGoogleSync() : undefined}
            isSyncing={isSyncing}
            readOnly={rights.isViewer}
            dataAsOf={sheetUpdatedTillDate}
            lastSyncTime={lastSyncTime}
            banner={shellBanner}
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
                renderDashboard()
            )}
        </AppShell>

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
                />
            )}
            {isPasswordModalOpen && (
                <ChangePasswordModal
                    onClose={() => setIsPasswordModalOpen(false)}
                    onDone={() => {
                        setIsPasswordModalOpen(false);
                        notify('success', 'Your password has been changed.');
                    }}
                />
            )}
            {isUserModalOpen && (
                <UserModal
                    userToEdit={editingUser}
                    onClose={handleCloseUserModal}
                    onSave={handleSaveUser}
                />
            )}
            {isTemplateModalOpen && (
                <TemplateModal
                    templateToEdit={editingTemplate}
                    onClose={handleCloseTemplateModal}
                    onSave={handleSaveTemplate}
                />
            )}
            {isPdcModalOpen && (
                <PdcModal
                    isOpen={isPdcModalOpen}
                    onClose={() => setIsPdcModalOpen(false)}
                    onSave={handleSavePdc}
                    customers={appData}
                    currentUser={currentUser!}
                    chequeToEdit={editingPdcCheque}
                    preselectedCustomerId={pdcPreselectedCustomerId}
                />
            )}
            {pendingSync && (
                <SyncReconciliationModal
                    existingRecords={appData}
                    incomingRecords={pendingSync.records}
                    updatedTillDate={pendingSync.updatedTillDate}
                    sourceName={pendingSync.sourceName}
                    onConfirm={handleConfirmSyncReconciliation}
                    onCancel={handleCancelSyncReconciliation}
                />
            )}
            {isWhatsAppModalOpen && whatsAppCustomer && (
                <WhatsAppReminderModal
                    customer={whatsAppCustomer}
                    templates={templates}
                    onClose={() => {
                        setIsWhatsAppModalOpen(false);
                        setWhatsAppCustomer(null);
                    }}
                />
            )}
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
