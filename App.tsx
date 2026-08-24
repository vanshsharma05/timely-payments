
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Outstanding, User, UserRole, FollowUpStatus, Template, DataVisibility, PdcCheque, PdcStatus, BalanceType, CompanyProfile, DEFAULT_COMPANY_PROFILE, DEFAULT_ROLE_PERMISSIONS, getFollowUpCategory } from './types';
import { 
    getOutstandingForUser, 
    USERS as INITIAL_USERS, 
    MOCK_DATA, 
    processStatuses,
    parseGoogleSheetCsv,
    mergeWithExistingFollowUps,
    fetchGoogleSheetData,
    parseAmountAndType,
    fetchCustomerMasterSheetData,
    mergeCustomerMasterIntoAppData
} from './services/googleSheetService';
import Header from './components/Header';
import SummaryCard from './components/SummaryCard';
import OutstandingTable from './components/PaymentTable';
import { CustomerDashboardView } from './components/CustomerDashboardView';
import { CustomerEditModal } from './components/CustomerEditModal';
import CrmPerformanceTable from './components/CrmPerformanceTable';
import LoginScreen from './components/LoginScreen';
import { DollarSignIcon, CheckCircleIcon, ClockIcon, UsersIcon, EditIcon, TrashIcon, UserPlusIcon, FireIcon, ChartBarIcon, LinkIcon, DocumentTextIcon, ClipboardListIcon, UploadIcon, ExclamationTriangleIcon, DownloadIcon, CalendarIcon, SyncIcon, WhatsAppIcon, ChequeIcon, BuildingOfficeIcon, SparklesIcon } from './components/icons/Icons';
import FollowUpModal from './components/FollowUpModal';
import UserModal from './components/UserModal';
import TemplateModal from './components/TemplateModal';
import NotificationBanner from './components/NotificationBanner';
import ReportsView, { FollowUpCategoryFilter } from './components/ReportsView';
import SyncReconciliationModal from './components/SyncReconciliationModal';
import PdcChequesView from './components/PdcChequesView';
import PdcModal from './components/PdcModal';
import { CompanyBanner } from './components/CompanyBanner';
import { CompanyProfileView } from './components/CompanyProfileView';
import { CompanyProfileModal } from './components/CompanyProfileModal';
import WhatsAppReminderModal from './components/WhatsAppReminderModal';

// FIX: Add type declaration for SheetJS.
declare global {
    interface Window {
      XLSX: any;
    }
}

// Helper to get today's date at midnight
const getToday = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
};

const OFFICIAL_TRANSACTIONS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1DoBq1UVK53Z_029eIGUQzZ6g3sN2ytVVFCF0tFoYu_4/edit?usp=sharing';
const OFFICIAL_CUSTOMER_MASTER_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRJrKqb_XsMoNYlAzO8NYkhbmZC7Z5RID9W9YFAuh6wzi8gnTIPCXj2LMllgpm78MDmOo7D6zdF0bOc/pubhtml?gid=895778621&single=true';
const OFFICIAL_SHEET_URL = OFFICIAL_TRANSACTIONS_SHEET_URL;

const EXPECTED_HEADERS = [
    "ID", "Company", "Contact Person", "Contact Number", "Total Due", 
    "Ageing 1-45", "Ageing 46-90", "Ageing 91-135", "Ageing >135", 
    "CRM Owner Name", "Assigned Collector Name", "Follow-up Date", "Notes", 
    "Is Urgent", "Creation Date"
];

const CUSTOMER_MASTER_HEADERS = [
    "Company Name", "Contact Person", "Designation", "Mobile Number", "Email Address",
    "City", "State", "GSTIN", "Billing Address", "Credit Limit", "Payment Terms (Days)", "CRM Owner"
];

const DEFAULT_TEMPLATE: Template = {
    id: 'template_default',
    name: 'Standard Reminder',
    content: `Hello {{contactPerson}},

This is a friendly reminder from Timely Payment regarding your outstanding balance for {{companyName}}.

Total Due: ₹{{totalDue}}

Ageing Details:
- 1-45 days: ₹{{ageing1_45}}
- 46-90 days: ₹{{ageing46_90}}
- 91-135 days: ₹{{ageing91_135}}
- >135 days: ₹{{ageingOver135}}

Please let us know when we can expect the payment.

Thank you!`
};

const INITIAL_PDC_CHEQUES: PdcCheque[] = [];

const TabButton = ({ tabName, activeTab, setActiveTab, label, icon }: { tabName: string, activeTab: string, setActiveTab: (t: string) => void, label: string, icon: React.ReactNode }) => (
    <button
        onClick={() => setActiveTab(tabName)}
        className={`flex items-center space-x-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${activeTab === tabName ? 'bg-green-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
    >
        {icon}
        <span>{label}</span>
    </button>
);

const App = () => {
    const [users, setUsers] = useState<User[]>(() => {
        const saved = localStorage.getItem('timely_users');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed.map((u: any) => ({
                        ...u,
                        password: u.id === 'Admin' ? 'admin' : (u.password || 'password123'),
                        permissions: {
                            ...(DEFAULT_ROLE_PERMISSIONS[u.role as UserRole] || DEFAULT_ROLE_PERMISSIONS[UserRole.CRM]),
                            ...(u.permissions || {})
                        },
                        assignedCrms: u.assignedCrms || (u.role === UserRole.CRM ? [u.id] : undefined)
                    }));
                }
            } catch (e) {
                console.error('Failed to parse saved users', e);
            }
        }
        return INITIAL_USERS;
    });

    const handleResetUserPassword = (userId: string, newPass: string) => {
        setUsers(prev => {
            const updated = prev.map(u => u.id === userId ? { ...u, password: newPass } : u);
            localStorage.setItem('timely_users', JSON.stringify(updated));
            return updated;
        });
    };

    useEffect(() => {
        localStorage.setItem('timely_users', JSON.stringify(users));
    }, [users]);

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    // Dashboard Tab States (Lifted up to prevent reset on re-renders)
    const [adminTab, setAdminTab] = useState('overview');
    const [userTab, setUserTab] = useState('overview');

    // This state holds the "Master" data for the application
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

    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);

    // PDC (Post Dated Cheques) State
    const [pdcCheques, setPdcCheques] = useState<PdcCheque[]>(() => {
        const saved = localStorage.getItem('timely_pdc_cheques');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                return parsed.map((p: any) => ({
                    ...p,
                    chequeDate: new Date(p.chequeDate),
                    receivedDate: new Date(p.receivedDate),
                    clearedDate: p.clearedDate ? new Date(p.clearedDate) : undefined
                }));
            } catch (e) {
                console.error('Failed to parse saved PDC cheques', e);
            }
        }
        return INITIAL_PDC_CHEQUES;
    });

    useEffect(() => {
        localStorage.setItem('timely_pdc_cheques', JSON.stringify(pdcCheques));
    }, [pdcCheques]);

    const [isPdcModalOpen, setIsPdcModalOpen] = useState(false);
    const [editingPdcCheque, setEditingPdcCheque] = useState<PdcCheque | null>(null);
    const [pdcPreselectedCustomerId, setPdcPreselectedCustomerId] = useState<string | undefined>(undefined);
    const [pdcInitialStatusFilter, setPdcInitialStatusFilter] = useState<string | null>(null);
    const [pdcInitialCustomerFilter, setPdcInitialCustomerFilter] = useState<string | null>(null);

    // Company Profile state
    const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(() => {
        const saved = localStorage.getItem('timely_company_profile');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error('Failed to parse saved company profile', e);
            }
        }
        return DEFAULT_COMPANY_PROFILE;
    });

    useEffect(() => {
        localStorage.setItem('timely_company_profile', JSON.stringify(companyProfile));
    }, [companyProfile]);

    const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
    const [userManagementTab, setUserManagementTab] = useState<'users' | 'company'>('users');

    const handleSaveCompanyProfile = (updated: CompanyProfile) => {
        setCompanyProfile(updated);
        setSyncMessage({ type: 'success', text: 'Company profile details updated successfully.' });
        setTimeout(() => setSyncMessage(null), 4000);
    };

    const [templates, setTemplates] = useState<Template[]>(() => {
        const savedTemplates = localStorage.getItem('templates');
        return savedTemplates ? JSON.parse(savedTemplates) : [DEFAULT_TEMPLATE];
    });
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
    
    const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [sheetUpdatedTillDate, setSheetUpdatedTillDate] = useState<string>(() => {
        return localStorage.getItem('sheetUpdatedTillDate') || '18-Aug-2026';
    });
    const [lastSyncTime, setLastSyncTime] = useState<string>(() => {
        return localStorage.getItem('lastSyncTime') || new Date().toISOString();
    });

    // Pending sync data waiting for Admin reconciliation
    const [pendingSync, setPendingSync] = useState<{
        records: Outstanding[];
        updatedTillDate?: string;
        sourceName: string;
    } | null>(null);

    // State for notifications
    const [priorityFilter, setPriorityFilter] = useState(false);
    const [unattendedFilter, setUnattendedFilter] = useState(false);
    const [showNotificationBanner, setShowNotificationBanner] = useState(true);

    // Data Source State - default to Google Sheet
    const [dataSourceMode, setDataSourceMode] = useState<'excel' | 'google'>(() => {
        return (localStorage.getItem('dataSourceMode') as 'excel' | 'google') || 'google';
    });
    const [googleSheetUrl, setGoogleSheetUrl] = useState(() => {
        return localStorage.getItem('googleSheetUrl') || OFFICIAL_SHEET_URL;
    });
    const [customerMasterSheetUrl, setCustomerMasterSheetUrl] = useState(() => {
        return localStorage.getItem('customerMasterSheetUrl') || OFFICIAL_CUSTOMER_MASTER_URL;
    });

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
        localStorage.setItem('timely_payment_data', JSON.stringify(processed));
        setIsCustomerModalOpen(false);
        setCustomerToEdit(null);
        setSyncMessage({
            type: 'success',
            text: `Customer "${savedCustomer.company}" ${isExisting ? 'updated' : 'added'} successfully!`
        });
        setTimeout(() => setSyncMessage(null), 4000);
    };

    const handleDeleteCustomer = (customerId: string) => {
        const target = appData.find(c => c.id === customerId);
        if (!target) return;
        if (window.confirm(`Are you sure you want to delete customer "${target.company}"?`)) {
            const updated = appData.filter(c => c.id !== customerId);
            const processed = processStatuses(updated);
            setAppData(processed);
            localStorage.setItem('timely_payment_data', JSON.stringify(processed));
            setSyncMessage({
                type: 'success',
                text: `Customer "${target.company}" deleted successfully.`
            });
            setTimeout(() => setSyncMessage(null), 4000);
        }
    };

    const handleExportCustomerExcel = () => {
        if (window.XLSX) {
            const headers = [
                "ID", "Company", "Contact Person", "Designation", "Contact Number", 
                "Email", "Total Outstanding", "Type", "1-45 Days", "46-90 Days", 
                "91-135 Days", ">135 Days", "Due >45 Days", "Over 90 Days", 
                "CRM Owner", "Status", "Follow-up Date", "Last Note"
            ];
            const rows = appData.map(c => [
                c.id,
                c.company,
                c.contactPerson,
                c.contactPost || '',
                c.contactNumber,
                c.email || '',
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
            const ws = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, "Customers");
            window.XLSX.writeFile(wb, `Customer_Dashboard_${new Date().toISOString().split('T')[0]}.xlsx`);
        } else {
            alert("Export functionality ready. Please try again.");
        }
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

    // Load Data based on mode
    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                // Check if we have cached data in LocalStorage
                const storedData = localStorage.getItem('timely_payment_data');
                let existingList: Outstanding[] = [];
                if (storedData) {
                    try {
                        const parsed = JSON.parse(storedData);
                        existingList = parsed.map((item: any) => {
                            const a1 = Math.abs(item.ageing?.['1-45'] || 0);
                            const a2 = Math.abs(item.ageing?.['46-90'] || 0);
                            const a3 = Math.abs(item.ageing?.['91-135'] || 0);
                            const a4 = Math.abs(item.ageing?.['>135'] || 0);
                            const over90 = Math.abs(item.over90 !== undefined ? item.over90 : (a3 + a4));
                            const dueOver45 = Math.abs(item.dueOver45 !== undefined ? item.dueOver45 : (a2 + over90));

                            return {
                                ...item,
                                total: Math.abs(item.total || 0),
                                totalType: item.totalType || 'Dr',
                                ageing: {
                                    '1-45': a1,
                                    '46-90': a2,
                                    '91-135': a3,
                                    '>135': a4
                                },
                                ageingTypes: item.ageingTypes || {
                                    '1-45': 'Dr',
                                    '46-90': 'Dr',
                                    '91-135': 'Dr',
                                    '>135': 'Dr'
                                },
                                over90: over90,
                                over90Type: item.over90Type || 'Dr',
                                dueOver45: dueOver45,
                                dueOver45Type: item.dueOver45Type || 'Dr',
                                followUpDate: item.followUpDate ? new Date(item.followUpDate) : undefined,
                                forecastAmount: item.forecastAmount !== undefined ? Number(item.forecastAmount) : undefined,
                                forecastDate: item.forecastDate ? new Date(item.forecastDate) : (item.followUpDate ? new Date(item.followUpDate) : undefined),
                                creationDate: new Date(item.creationDate),
                                lastFollowUpOn: item.lastFollowUpOn ? new Date(item.lastFollowUpOn) : undefined,
                            };
                        });
                    } catch (e) {
                        console.warn("Failed to parse cached data:", e);
                    }
                }

                if (existingList.length > 0) {
                    setAppData(processStatuses(existingList));
                } else {
                    setAppData(processStatuses(MOCK_DATA));
                }

                // If in Google mode, always attempt fresh fetch on mount
                if (dataSourceMode === 'google') {
                    try {
                        const targetUrl = (googleSheetUrl || OFFICIAL_SHEET_URL).trim();
                        const parsed = await fetchGoogleSheetData(targetUrl);
                        if (parsed.records && parsed.records.length > 0) {
                            if (parsed.updatedTillDate) {
                                setSheetUpdatedTillDate(parsed.updatedTillDate);
                                localStorage.setItem('sheetUpdatedTillDate', parsed.updatedTillDate);
                            }
                            const nowIso = new Date().toISOString();
                            setLastSyncTime(nowIso);
                            localStorage.setItem('lastSyncTime', nowIso);
                            const baseList = existingList.length > 3 ? existingList : [];
                            const merged = mergeWithExistingFollowUps(baseList, parsed.records);
                            const processed = processStatuses(merged);
                            setAppData(processed);
                        }
                    } catch (e) {
                        console.warn("Initial Google Sheet sync notice, using cached data:", e);
                    }
                }
            } catch (e) {
                console.error("Failed to load initial data", e);
                setAppData(processStatuses(MOCK_DATA));
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [dataSourceMode]);

    // Persist settings
    useEffect(() => {
        localStorage.setItem('dataSourceMode', dataSourceMode);
        localStorage.setItem('googleSheetUrl', googleSheetUrl);
        localStorage.setItem('customerMasterSheetUrl', customerMasterSheetUrl);
        localStorage.setItem('templates', JSON.stringify(templates));
        localStorage.setItem('sheetUpdatedTillDate', sheetUpdatedTillDate);
        localStorage.setItem('lastSyncTime', lastSyncTime);
    }, [dataSourceMode, googleSheetUrl, customerMasterSheetUrl, templates, sheetUpdatedTillDate, lastSyncTime]);

    // Whenever master appData changes, save to local storage (acts as cache for Google mode too)
    useEffect(() => {
        if (appData.length > 0) {
            localStorage.setItem('timely_payment_data', JSON.stringify(appData));
        }
    }, [appData]);

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

    const handleLogout = () => {
        setIsAuthenticated(false);
        setCurrentUser(null);
        setOutstandingData([]);
        setAdminTab('overview');
        setUserTab('overview');
    };

    const handleUserChange = (userId: string) => {
        const userToSwitchTo = users.find(u => u.id === userId);
        if (userToSwitchTo) {
            const enteredPassword = prompt(`Enter password for ${userToSwitchTo.name}:`);
            if (enteredPassword === userToSwitchTo.password) {
                const fullUser: User = {
                    ...userToSwitchTo,
                    permissions: {
                        ...(DEFAULT_ROLE_PERMISSIONS[userToSwitchTo.role] || DEFAULT_ROLE_PERMISSIONS[UserRole.CRM]),
                        ...(userToSwitchTo.permissions || {})
                    },
                    assignedCrms: userToSwitchTo.assignedCrms || (userToSwitchTo.role === UserRole.CRM ? [userToSwitchTo.id] : undefined)
                };
                setCurrentUser(fullUser);
            } else {
                alert('Incorrect password. User switch cancelled.');
            }
        }
    };
    
    const handleOpenFollowUp = (customer: Outstanding) => {
        setSelectedCustomer(customer);
        setIsModalOpen(true);
    };

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
        localStorage.setItem('timely_payment_data', JSON.stringify(fullyProcessed));
    };

    const handleCardClick = (filter: FollowUpStatus | null) => {
        setPriorityFilter(false);
        setUnattendedFilter(false);
        setCategoryFilter('all');
        if (filter === null) {
            setStatusFilter(null);
            return;
        }
        setStatusFilter(currentFilter => (currentFilter === filter ? null : filter));
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

    const handleViewPriorityItems = () => {
        setStatusFilter(null);
        setCategoryFilter('all');
        setUnattendedFilter(false);
        setPriorityFilter(true);
        setShowNotificationBanner(false);
    };
    
    const handleOpenUserModal = (user: User | null) => {
        setEditingUser(user);
        setIsUserModalOpen(true);
    };

    const handleCloseUserModal = () => {
        setEditingUser(null);
        setIsUserModalOpen(false);
    };

    const handleSaveUser = (userToSave: Omit<User, 'id'> & { id?: string }) => {
        let updatedRecord: User | null = null;
        setUsers(currentUsers => {
            if (userToSave.id) {
                // Edit existing user
                return currentUsers.map(u => {
                    if (u.id === userToSave.id) {
                        const updatedUser: User = {
                            ...u,
                            name: userToSave.name,
                            role: userToSave.role,
                            dataVisibility: userToSave.dataVisibility,
                            permissions: userToSave.permissions || DEFAULT_ROLE_PERMISSIONS[userToSave.role] || DEFAULT_ROLE_PERMISSIONS[UserRole.CRM],
                            assignedCrms: userToSave.assignedCrms || (userToSave.role === UserRole.CRM ? [u.id] : undefined),
                        };
                        // Only update password if a new one was entered
                        if (userToSave.password) {
                            updatedUser.password = userToSave.password;
                        }
                        updatedRecord = updatedUser;
                        return updatedUser;
                    }
                    return u;
                });
            } else {
                // Add new user
                const newUser: User = {
                    ...userToSave,
                    id: userToSave.name.trim(), // ID is Name
                    password: userToSave.password || 'password123', // Default password for new users
                    dataVisibility: userToSave.dataVisibility || DataVisibility.AssignedOnly,
                    permissions: userToSave.permissions || DEFAULT_ROLE_PERMISSIONS[userToSave.role] || DEFAULT_ROLE_PERMISSIONS[UserRole.CRM],
                    assignedCrms: userToSave.assignedCrms || (userToSave.role === UserRole.CRM ? [userToSave.name.trim()] : undefined),
                };
                updatedRecord = newUser;
                return [...currentUsers, newUser];
            }
        });
        if (updatedRecord && currentUser && (currentUser.id === (updatedRecord as User).id || currentUser.name === (updatedRecord as User).name)) {
            setCurrentUser(updatedRecord);
        }
        handleCloseUserModal();
    };

    const handleDeleteUser = (userId: string) => {
        if (window.confirm('Are you sure you want to delete this user?')) {
            setUsers(currentUsers => currentUsers.filter(u => u.id !== userId));
            // If deleting the current user, log them out
            if (currentUser?.id === userId) {
                handleLogout();
            }
        }
    };

    // Reset Users Only to Default
    const handleResetUsersOnly = () => {
        if (window.confirm("Are you sure you want to reset all users to the default team roster?\n\nPasswords will reset to:\n• Admin: admin\n• Team members: password123")) {
            setUsers(INITIAL_USERS);
            localStorage.setItem('timely_users', JSON.stringify(INITIAL_USERS));
            setSyncMessage({ type: 'success', text: 'User accounts and default passwords have been reset to original roster.' });
            setTimeout(() => setSyncMessage(null), 4000);
        }
    };

    // Factory Reset: Reset All Data & All Users to Fresh Start
    const handleResetAllDataAndUsers = async (skipConfirm = false) => {
        if (!skipConfirm) {
            const confirmed = window.confirm(
                "⚠️ COMPLETE FRESH START\n\nAre you sure you want to reset ALL data and ALL users?\n\nThis will:\n1. Reset all user accounts & restore default passwords (Admin: 'admin', Team: 'password123')\n2. Clear all follow-up notes, tags, forecast amounts, and custom contacts\n3. Clear all Post-Dated Cheques (PDC)\n4. Fetch a 100% clean, fresh dataset from the live Google Sheet\n5. Restore default message templates & company profile\n\nClick OK to proceed with fresh start."
            );
            if (!confirmed) return;
        }

        setIsSyncing(true);
        setSyncMessage({ type: 'success', text: 'Resetting system and fetching clean fresh data...' });

        try {
            // Clear all localStorage keys
            localStorage.removeItem('timely_payment_data');
            localStorage.removeItem('timely_users');
            localStorage.removeItem('timely_pdc_cheques');
            localStorage.removeItem('timely_company_profile');
            localStorage.removeItem('templates');
            localStorage.removeItem('sheetUpdatedTillDate');
            localStorage.removeItem('lastSyncTime');
            localStorage.removeItem('dataSourceMode');
            localStorage.removeItem('googleSheetUrl');

            // Reset React state variables
            setUsers(INITIAL_USERS);
            setPdcCheques([]);
            setCompanyProfile(DEFAULT_COMPANY_PROFILE);
            setTemplates([DEFAULT_TEMPLATE]);
            setDataSourceMode('google');
            setGoogleSheetUrl(OFFICIAL_SHEET_URL);

            // Fetch clean data from Google Sheet without merging old overrides
            try {
                const parsed = await fetchGoogleSheetData(OFFICIAL_SHEET_URL);
                if (parsed.records && parsed.records.length > 0) {
                    const freshProcessed = processStatuses(parsed.records);
                    setAppData(freshProcessed);
                    localStorage.setItem('timely_payment_data', JSON.stringify(freshProcessed));
                    if (parsed.updatedTillDate) {
                        setSheetUpdatedTillDate(parsed.updatedTillDate);
                        localStorage.setItem('sheetUpdatedTillDate', parsed.updatedTillDate);
                    }
                } else {
                    setAppData(processStatuses(MOCK_DATA));
                }
            } catch (fetchErr) {
                console.warn("Could not fetch live sheet during reset, using clean mock data:", fetchErr);
                setAppData(processStatuses(MOCK_DATA));
            }

            const nowIso = new Date().toISOString();
            setLastSyncTime(nowIso);
            localStorage.setItem('lastSyncTime', nowIso);
            localStorage.setItem('timely_users', JSON.stringify(INITIAL_USERS));

            setSyncMessage({
                type: 'success',
                text: 'System successfully reset! All users and data have been restored for a clean fresh start.'
            });
            setTimeout(() => setSyncMessage(null), 6000);
        } catch (err) {
            console.error("Failed to reset:", err);
            setSyncMessage({ type: 'error', text: 'Reset encountered an error. Please try again.' });
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
        const processed = processStatuses(reconciledRecords);
        setAppData(processed);
        const nowIso = new Date().toISOString();
        setLastSyncTime(nowIso);
        localStorage.setItem('lastSyncTime', nowIso);
        if (pendingSync?.updatedTillDate) {
            setSheetUpdatedTillDate(pendingSync.updatedTillDate);
            localStorage.setItem('sheetUpdatedTillDate', pendingSync.updatedTillDate);
        }
        setSyncMessage({
            type: 'success',
            text: `Sync complete: Successfully reconciled and updated ${reconciledRecords.length} customer records.${pendingSync?.updatedTillDate ? ` Sheet updated till: ${pendingSync.updatedTillDate}` : ''}`
        });
        setPendingSync(null);
        setTimeout(() => setSyncMessage(null), 5000);
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
            localStorage.setItem('googleSheetUrl', overrideUrl);
        }
        
        setIsSyncing(true);
        setSyncMessage(null);

        try {
            const { records, updatedTillDate } = await fetchGoogleSheetData(urlToUse);
            
            if (records.length === 0) {
                 throw new Error("No customer records found in the provided Google Sheet.");
            }

            // Open reconciliation review modal for Admin or when existing data exists
            const nowIso = new Date().toISOString();
            setLastSyncTime(nowIso);
            localStorage.setItem('lastSyncTime', nowIso);

            if (appData.length > 0) {
                setPendingSync({
                    records,
                    updatedTillDate,
                    sourceName: 'Transactions Google Sheet'
                });
            } else {
                if (updatedTillDate) {
                    setSheetUpdatedTillDate(updatedTillDate);
                    localStorage.setItem('sheetUpdatedTillDate', updatedTillDate);
                }
                const merged = mergeWithExistingFollowUps(appData, records);
                const processedData = processStatuses(merged);
                setAppData(processedData);
                setSyncMessage({ 
                    type: 'success', 
                    text: `Successfully synced ${records.length} transaction records from Google Sheet.${updatedTillDate ? ` Sheet updated till: ${updatedTillDate}` : ''}` 
                });
            }

        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error during sync";
            setSyncMessage({ type: 'error', text: msg });
        } finally {
            setIsSyncing(false);
        }
    };

    // Customer Master Data Google Sheet Sync Logic
    const handleCustomerMasterSync = async (overrideUrl?: string) => {
        const urlToUse = (typeof overrideUrl === 'string' && overrideUrl.trim())
            ? overrideUrl.trim()
            : (customerMasterSheetUrl || OFFICIAL_CUSTOMER_MASTER_URL).trim();

        if (overrideUrl && typeof overrideUrl === 'string') {
            setCustomerMasterSheetUrl(overrideUrl);
            localStorage.setItem('customerMasterSheetUrl', overrideUrl);
        }

        setIsSyncing(true);
        setSyncMessage(null);

        try {
            const { records } = await fetchCustomerMasterSheetData(urlToUse);
            if (records.length === 0) {
                throw new Error("No customer records found in the Customer Master Google Sheet.");
            }

            const { updatedData, enrichedCount, newAccountsCount } = mergeCustomerMasterIntoAppData(appData, records);
            setAppData(updatedData);

            const nowIso = new Date().toISOString();
            setLastSyncTime(nowIso);
            localStorage.setItem('lastSyncTime', nowIso);

            setSyncMessage({
                type: 'success',
                text: `Customer Master Sync Successful: Enriched ${enrichedCount} customer accounts, added ${newAccountsCount} new accounts into directory.`
            });
            setTimeout(() => setSyncMessage(null), 6000);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error during customer master sync";
            setSyncMessage({ type: 'error', text: msg });
        } finally {
            setIsSyncing(false);
        }
    };

    // Combined Dual Sync: Synchronizes Transactions + Customer Master Data in sequence
    const handleCombinedSync = async () => {
        setIsSyncing(true);
        setSyncMessage({ type: 'success', text: 'Starting dual sync: Fetching Transactions & Customer Master data...' });

        try {
            // 1. Fetch Transactions
            const txUrl = (googleSheetUrl || OFFICIAL_TRANSACTIONS_SHEET_URL).trim();
            const { records: txRecords, updatedTillDate } = await fetchGoogleSheetData(txUrl);

            // 2. Fetch Customer Master
            const masterUrl = (customerMasterSheetUrl || OFFICIAL_CUSTOMER_MASTER_URL).trim();
            let masterRecords: Outstanding[] = [];
            try {
                const masterRes = await fetchCustomerMasterSheetData(masterUrl);
                masterRecords = masterRes.records;
            } catch (masterErr) {
                console.warn('Customer master fetch note during combined sync:', masterErr);
            }

            // Merge Transactions with existing follow-ups
            const baseMerged = mergeWithExistingFollowUps(appData, txRecords);

            // Merge Customer Master data
            let finalData = baseMerged;
            let enriched = 0;
            let newAccounts = 0;
            if (masterRecords.length > 0) {
                const masterMerged = mergeCustomerMasterIntoAppData(baseMerged, masterRecords);
                finalData = masterMerged.updatedData;
                enriched = masterMerged.enrichedCount;
                newAccounts = masterMerged.newAccountsCount;
            }

            const processed = processStatuses(finalData);
            setAppData(processed);

            if (updatedTillDate) {
                setSheetUpdatedTillDate(updatedTillDate);
                localStorage.setItem('sheetUpdatedTillDate', updatedTillDate);
            }

            const nowIso = new Date().toISOString();
            setLastSyncTime(nowIso);
            localStorage.setItem('lastSyncTime', nowIso);

            setSyncMessage({
                type: 'success',
                text: `Dual Sync Complete: Updated ${txRecords.length} transaction records, enriched ${enriched} accounts, and added ${newAccounts} master customers.${updatedTillDate ? ` Sheet updated till: ${updatedTillDate}` : ''}`
            });
            setTimeout(() => setSyncMessage(null), 6000);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Error during combined sync";
            setSyncMessage({ type: 'error', text: msg });
        } finally {
            setIsSyncing(false);
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(amount);
    }
    
    // WhatsApp Reminder Handler (opens recipient & template selector with 'Other number' option)
    const handleSendWhatsApp = (customer: Outstanding) => {
        setWhatsAppCustomer(customer);
        setIsWhatsAppModalOpen(true);
    };

    const filteredData = useMemo(() => {
        const today = getToday();
        return outstandingData.filter(item => {
            if (priorityFilter) {
                return (item.isUrgent && item.status !== FollowUpStatus.Completed) || item.status === FollowUpStatus.Overdue;
            }

            const itemCategory = getFollowUpCategory(item, today);

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
        let totalCount = outstandingData.length;
        let totalAmount = 0;

        outstandingData.forEach(item => {
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

    const summaryData = useMemo(() => {
        const today = getToday();
        const activeData = outstandingData.filter(p => p.status !== FollowUpStatus.Completed);
        
        const totalOutstanding = activeData.reduce((sum, p) => sum + p.total, 0);
        const overdueCount = outstandingData.filter(p => p.status === FollowUpStatus.Overdue).length;
        const customerCount = outstandingData.length;

        const collectedToday = outstandingData.reduce((sum, p) => {
            if (p.status === FollowUpStatus.Completed && p.followUpDate) {
                 const collectedDate = new Date(p.followUpDate);
                 collectedDate.setHours(0,0,0,0);
                 if (collectedDate.getTime() === today.getTime()) {
                     return sum + p.total;
                 }
            }
            return sum;
        }, 0);

        return { totalOutstanding, collectedToday, overdueCount, customerCount };
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

    // User Specific Stats (CRM/Collector)
    const userStats = useMemo(() => {
        const today = getToday();
        let todayCount = 0;
        let futureCount = 0;
        let unattendedCount = 0;

        outstandingData.forEach(item => {
            const cat = getFollowUpCategory(item, today);
            if (cat === 'completed') return;
            if (cat === 'today') todayCount++;
            else if (cat === 'future') futureCount++;
            else if (cat === 'overdue' || cat === 'no_follow_up') unattendedCount++;
        });
        return { todayCount, futureCount, unattendedCount };
    }, [outstandingData]);

    // CRM Performance Statistics Calculation (Admin View)
    const crmPerformanceStats = useMemo(() => {
        const today = getToday();
        const statsMap = new Map<string, {
            crmId: string, crmName: string, totalAssigned: number, followUpDone: number, 
            todayFollowUp: number, overdue: number, unattended: number, timelyCount: number
        }>();

        // Initialize for known CRMs and Collectors
        users.filter(u => u.role === UserRole.CRM || u.role === UserRole.Collector).forEach(u => {
            statsMap.set(u.id, {
                crmId: u.id,
                crmName: u.name,
                totalAssigned: 0,
                followUpDone: 0,
                todayFollowUp: 0,
                overdue: 0,
                unattended: 0,
                timelyCount: 0
            });
        });

        // Add bucket for "Unassigned"
        statsMap.set('Unassigned', {
            crmId: 'Unassigned',
            crmName: 'No CRM Assigned',
            totalAssigned: 0,
            followUpDone: 0,
            todayFollowUp: 0,
            overdue: 0,
            unattended: 0,
            timelyCount: 0
        });

        outstandingData.forEach(item => {
            const ownerId = item.crmOwnerId && item.crmOwnerId.trim() !== '' ? item.crmOwnerId : 'Unassigned';
            
            if (!statsMap.has(ownerId)) {
                 statsMap.set(ownerId, {
                    crmId: ownerId,
                    crmName: ownerId, 
                    totalAssigned: 0,
                    followUpDone: 0,
                    todayFollowUp: 0,
                    overdue: 0,
                    unattended: 0,
                    timelyCount: 0
                });
            }

            const stat = statsMap.get(ownerId)!;
            stat.totalAssigned++;

            const cat = getFollowUpCategory(item, today);
            if (cat === 'completed') {
                stat.followUpDone++;
                stat.timelyCount++; 
            } else {
                if (cat === 'today') {
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


    const todayFollowUps = useMemo(() => {
        const today = getToday();
        return outstandingData.filter(item => {
             if (!item.followUpDate) return false;
             const followUpDate = new Date(item.followUpDate);
             followUpDate.setHours(0,0,0,0);
             return followUpDate.getTime() === today.getTime() && item.status !== FollowUpStatus.Completed;
        });
    }, [outstandingData]);

    // PDC Cheque Handlers & Calculations
    const todayPdcMetrics = useMemo(() => {
        const today = new Date();
        
        let visiblePdcs = pdcCheques;
        if (currentUser?.role === UserRole.CRM) {
            const userCustIds = new Set(appData.filter(a => a.crmOwnerId?.toUpperCase() === currentUser.id?.toUpperCase() || a.crmOwnerId?.toUpperCase() === currentUser.name?.toUpperCase()).map(a => a.id));
            visiblePdcs = pdcCheques.filter(p => userCustIds.has(p.customerId) || p.crmOwnerId?.toUpperCase() === currentUser.id?.toUpperCase() || p.crmOwnerId?.toUpperCase() === currentUser.name?.toUpperCase());
        }

        const todayCheques = visiblePdcs.filter(p => {
            const cDate = p.chequeDate instanceof Date ? p.chequeDate : new Date(p.chequeDate);
            return (
                (p.status === PdcStatus.DueToday || p.status === PdcStatus.Pending) &&
                cDate.getFullYear() === today.getFullYear() &&
                cDate.getMonth() === today.getMonth() &&
                cDate.getDate() === today.getDate()
            );
        });

        const totalTodayAmount = todayCheques.reduce((sum, c) => sum + c.amount, 0);
        const activePdcs = visiblePdcs.filter(p => p.status !== PdcStatus.Cleared && p.status !== PdcStatus.Bounced);
        const activeAmount = activePdcs.reduce((sum, c) => sum + c.amount, 0);

        return {
            todayCount: todayCheques.length,
            todayAmount: totalTodayAmount,
            activeCount: activePdcs.length,
            activeAmount,
        };
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
        <>
            {showNotificationBanner && (notificationSummary.urgentCount > 0 || notificationSummary.overdueCount > 0) && (
                <NotificationBanner
                    urgentCount={notificationSummary.urgentCount}
                    overdueCount={notificationSummary.overdueCount}
                    onView={handleViewPriorityItems}
                    onDismiss={() => setShowNotificationBanner(false)}
                />
            )}

            {/* Today PDC Cheques Bank Presentation Highlight Banner */}
            <div className="mb-8 p-5 bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-900 text-white rounded-2xl shadow-lg border border-emerald-600/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
                <div className="flex items-center gap-4">
                    <div className="p-3.5 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 shadow-inner flex items-center justify-center">
                        <ChequeIcon className="w-8 h-8 text-emerald-300" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-300">Bank Action Today</span>
                            <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-emerald-400/20 text-emerald-100 border border-emerald-400/30">
                                {todayPdcMetrics.todayCount} Cheque{todayPdcMetrics.todayCount === 1 ? '' : 's'} Due
                            </span>
                        </div>
                        <h3 className="text-xl font-bold mt-0.5 text-white">Today PDC Cheques To Present in Bank</h3>
                        <p className="text-xs text-emerald-100/90 mt-1">
                            Total amount to present today: <strong className="text-white text-sm font-extrabold">₹ {formatCurrency(todayPdcMetrics.todayAmount)}</strong> • Total active PDC portfolio: ₹ {formatCurrency(todayPdcMetrics.activeAmount)} ({todayPdcMetrics.activeCount} cheques)
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2.5 self-stretch sm:self-auto">
                    <button
                        onClick={handleOpenTodayPdc}
                        className="px-4 py-2.5 bg-emerald-400 hover:bg-emerald-300 text-gray-950 font-bold rounded-xl text-xs shadow-md transition-all flex items-center justify-center gap-1.5 flex-1 sm:flex-initial"
                    >
                        <span>View Today's Cheques ({todayPdcMetrics.todayCount})</span>
                    </button>
                    <button
                        onClick={() => handleOpenAddPdc()}
                        className="px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-xs border border-white/20 transition-all flex items-center justify-center gap-1.5"
                    >
                        <span>+ Add PDC</span>
                    </button>
                </div>
            </div>

            {/* REQUIREMENT 2: Daily Cash Flow Forecast & Committed Inflows Banner */}
            <div className="mb-8 p-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white rounded-2xl shadow-lg border border-indigo-500/30 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
                <div className="flex items-start sm:items-center gap-4">
                    <div className="p-3.5 bg-indigo-500/20 backdrop-blur-md rounded-2xl border border-indigo-400/30 shadow-inner flex items-center justify-center flex-shrink-0">
                        <SparklesIcon className="w-8 h-8 text-indigo-300" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-300">Cash Flow Forecast Intelligence</span>
                            <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-indigo-500/20 text-indigo-200 border border-indigo-400/30">
                                {cashFlowForecastMetrics.totalCount} Account{cashFlowForecastMetrics.totalCount === 1 ? '' : 's'} with Target Forecast
                            </span>
                        </div>
                        <h3 className="text-xl font-bold mt-0.5 text-white">Daily Cash Flow Forecast (Collection Purpose)</h3>
                        <p className="text-xs text-indigo-200/90 mt-1">
                            Live collection projections committed during CRM/Sales follow-up calls for daily financial planning.
                        </p>
                    </div>
                </div>
                
                {/* Metric Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full lg:w-auto">
                    <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-center">
                        <div className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">🎯 Today's Inflow</div>
                        <div className="text-base sm:text-lg font-extrabold text-emerald-400 mt-0.5">₹ {formatCurrency(cashFlowForecastMetrics.todayForecast)}</div>
                        <div className="text-[10px] text-gray-400">{cashFlowForecastMetrics.todayCount} commitment{cashFlowForecastMetrics.todayCount === 1 ? '' : 's'}</div>
                    </div>
                    <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-center">
                        <div className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">📅 7-Day Inflow</div>
                        <div className="text-base sm:text-lg font-extrabold text-blue-300 mt-0.5">₹ {formatCurrency(cashFlowForecastMetrics.weekForecast)}</div>
                        <div className="text-[10px] text-gray-400">{cashFlowForecastMetrics.weekCount} commitment{cashFlowForecastMetrics.weekCount === 1 ? '' : 's'}</div>
                    </div>
                    <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-center col-span-2 sm:col-span-1">
                        <div className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">💼 Total Forecast</div>
                        <div className="text-base sm:text-lg font-extrabold text-amber-300 mt-0.5">₹ {formatCurrency(cashFlowForecastMetrics.totalForecast)}</div>
                        <div className="text-[10px] text-gray-400">{cashFlowForecastMetrics.totalCount} account{cashFlowForecastMetrics.totalCount === 1 ? '' : 's'}</div>
                    </div>
                </div>
            </div>

            {/* 4 Main Follow-up Performance Boxes */}
            <div className="mb-8">
                <div className="flex justify-between items-center mb-3">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white">Follow-up Categories</h2>
                    {categoryFilter !== 'all' && (
                        <button
                            onClick={handleClearFilters}
                            className="text-xs font-semibold text-red-600 hover:text-red-700 dark:text-red-400 flex items-center"
                        >
                            Reset Filter
                        </button>
                    )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <button
                        type="button"
                        onClick={() => {
                            handleCategoryBoxClick('today');
                            setAdminTab('customers');
                        }}
                        className={`text-left p-4 rounded-xl border-2 transition-all shadow-sm ${categoryFilter === 'today' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 ring-2 ring-blue-400' : 'border-blue-100 dark:border-blue-900 bg-white dark:bg-gray-800 hover:border-blue-300'}`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">📅 Today Follow Up</span>
                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">{fourBoxesSummary.todayCount}</span>
                        </div>
                        <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{fourBoxesSummary.todayCount} <span className="text-sm font-normal text-gray-500">accounts</span></p>
                        <p className="text-xs text-blue-700 dark:text-blue-300 font-semibold mt-1">₹ {formatCurrency(fourBoxesSummary.todayAmount)}</p>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            handleCategoryBoxClick('no_follow_up');
                            setAdminTab('customers');
                        }}
                        className={`text-left p-4 rounded-xl border-2 transition-all shadow-sm ${categoryFilter === 'no_follow_up' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 ring-2 ring-amber-400' : 'border-amber-100 dark:border-amber-900 bg-white dark:bg-gray-800 hover:border-amber-300'}`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">⚠️ No Follow Up Customer List</span>
                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300">{fourBoxesSummary.noFollowUpCount}</span>
                        </div>
                        <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{fourBoxesSummary.noFollowUpCount} <span className="text-sm font-normal text-gray-500">accounts</span></p>
                        <p className="text-xs text-amber-700 dark:text-amber-300 font-semibold mt-1">₹ {formatCurrency(fourBoxesSummary.noFollowUpAmount)}</p>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            handleCategoryBoxClick('overdue');
                            setAdminTab('customers');
                        }}
                        className={`text-left p-4 rounded-xl border-2 transition-all shadow-sm ${categoryFilter === 'overdue' ? 'border-red-500 bg-red-50 dark:bg-red-950/40 ring-2 ring-red-400' : 'border-red-100 dark:border-red-900 bg-white dark:bg-gray-800 hover:border-red-300'}`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400">🚨 Overdue Follow Up</span>
                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300">{fourBoxesSummary.overdueCount}</span>
                        </div>
                        <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{fourBoxesSummary.overdueCount} <span className="text-sm font-normal text-gray-500">accounts</span></p>
                        <p className="text-xs text-red-700 dark:text-red-300 font-semibold mt-1">₹ {formatCurrency(fourBoxesSummary.overdueAmount)}</p>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            handleCategoryBoxClick('future');
                            setAdminTab('customers');
                        }}
                        className={`text-left p-4 rounded-xl border-2 transition-all shadow-sm ${categoryFilter === 'future' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 ring-2 ring-emerald-400' : 'border-emerald-100 dark:border-emerald-900 bg-white dark:bg-gray-800 hover:border-emerald-300'}`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">📆 Future Follow Up</span>
                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">{fourBoxesSummary.futureCount}</span>
                        </div>
                        <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{fourBoxesSummary.futureCount} <span className="text-sm font-normal text-gray-500">accounts</span></p>
                        <p className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold mt-1">₹ {formatCurrency(fourBoxesSummary.futureAmount)}</p>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <SummaryCard title="Total Outstanding" value={formatCurrency(summaryData.totalOutstanding)} icon={<DollarSignIcon />} color="text-amber-500" onClick={() => handleCardClick(null)} />
                <SummaryCard title="Total Overdue" value={summaryData.overdueCount.toString()} icon={<ClockIcon />} color="text-red-500" onClick={() => handleCardClick(FollowUpStatus.Overdue)} isActive={statusFilter === FollowUpStatus.Overdue} />
                <SummaryCard title="Total Customers" value={summaryData.customerCount.toString()} icon={<UsersIcon />} color="text-slate-500" onClick={() => handleCardClick(null)} />
                <SummaryCard title="Collected Today" value={formatCurrency(summaryData.collectedToday)} icon={<CheckCircleIcon />} color="text-green-500" onClick={() => handleCardClick(FollowUpStatus.Completed)} isActive={statusFilter === FollowUpStatus.Completed} />
            </div>
            <CrmPerformanceTable stats={crmPerformanceStats} />
        </>
    );

    const renderCustomerListView = () => (
        <CustomerDashboardView
            data={appData}
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
            pdcCheques={pdcCheques}
            onSyncSheet={() => syncData(true)}
            isSyncing={isSyncing}
            lastUpdatedTill={sheetUpdatedTillDate}
            onExportExcel={handleExportCustomerExcel}
        />
    );

    // Unified User Dashboard for CRM and Collector
    const renderUserDashboard = (title: string) => {
        // Use lifted state
        const activeTab = userTab;
        const setActiveTab = setUserTab;

        return (
            <>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800 dark:text-white">{title}</h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Logged in as: <span className="font-semibold text-gray-700 dark:text-gray-200">{currentUser?.name}</span> ({currentUser?.role})</p>
                    </div>
                    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-100 dark:border-gray-800 p-1.5 flex items-center overflow-x-auto">
                        <div className="flex space-x-1 min-w-max">
                            <TabButton tabName="overview" activeTab={activeTab} setActiveTab={setActiveTab} label="Daily Follow-ups" icon={<ChartBarIcon />} />
                            <TabButton tabName="pdc" activeTab={activeTab} setActiveTab={setActiveTab} label="PDC Cheques" icon={<ChequeIcon />} />
                            <TabButton tabName="reports" activeTab={activeTab} setActiveTab={setActiveTab} label="Performance Report" icon={<ClipboardListIcon />} />
                            <TabButton tabName="customers" activeTab={activeTab} setActiveTab={setActiveTab} label="Customer List" icon={<UsersIcon />} />
                        </div>
                    </div>
                </div>
                
                {activeTab === 'overview' && (
                    <div className="space-y-6">
                        {/* Today PDC Cheques Focus Banner */}
                        {todayPdcMetrics.todayCount > 0 && (
                            <div className="p-4 bg-gradient-to-r from-emerald-900 to-teal-900 text-white rounded-2xl shadow-md border border-emerald-700/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 bg-white/10 rounded-xl border border-white/20">
                                        <ChequeIcon className="w-6 h-6 text-emerald-300" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">Bank Presentation</span>
                                            <span className="px-2 py-0.2 text-xs font-bold rounded-full bg-emerald-500/30 text-emerald-200">
                                                {todayPdcMetrics.todayCount} Cheque{todayPdcMetrics.todayCount === 1 ? '' : 's'} Due Today
                                            </span>
                                        </div>
                                        <p className="text-sm font-bold mt-0.5">
                                            ₹ {formatCurrency(todayPdcMetrics.todayAmount)} due for presentation in bank today
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleOpenTodayPdc}
                                        className="px-3.5 py-2 bg-emerald-400 hover:bg-emerald-300 text-gray-950 font-bold rounded-xl text-xs shadow transition-all"
                                    >
                                        View Today's Cheques
                                    </button>
                                    <button
                                        onClick={() => handleOpenAddPdc()}
                                        className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-xs border border-white/20 transition-all"
                                    >
                                        + Add PDC
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Cash Flow Forecast Banner for CRM */}
                        <div className="p-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white rounded-2xl shadow-md border border-indigo-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-indigo-500/20 rounded-xl border border-indigo-400/30">
                                    <SparklesIcon className="w-6 h-6 text-indigo-300" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">Daily Cash Flow Forecast</span>
                                        <span className="px-2 py-0.2 text-xs font-bold rounded-full bg-indigo-500/30 text-indigo-200">
                                            {cashFlowForecastMetrics.todayCount} Expected Today
                                        </span>
                                    </div>
                                    <p className="text-sm font-bold mt-0.5">
                                        Today's Inflow Forecast: <strong className="text-emerald-300 font-extrabold">₹ {formatCurrency(cashFlowForecastMetrics.todayForecast)}</strong> • 7-Day Target: ₹ {formatCurrency(cashFlowForecastMetrics.weekForecast)}
                                    </p>
                                </div>
                            </div>
                            <div className="text-xs text-indigo-200 bg-white/10 px-3 py-1.5 rounded-lg border border-white/15">
                                Total Portfolio Forecast: <strong className="text-amber-300 font-bold">₹ {formatCurrency(cashFlowForecastMetrics.totalForecast)}</strong> ({cashFlowForecastMetrics.totalCount} accounts)
                            </div>
                        </div>

                        {/* 4 Main Clickable Boxes for CRM Dashboard */}
                        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800">
                            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 mb-4">
                                <div>
                                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Daily Focus Areas</h2>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Click any box below to filter your priority accounts and update follow-up notes.</p>
                                </div>
                                {categoryFilter !== 'all' && (
                                    <button
                                        onClick={handleClearFilters}
                                        className="text-xs font-semibold text-red-600 hover:text-red-700 dark:text-red-400 self-start sm:self-auto"
                                    >
                                        Clear Active Filter ({categoryFilter})
                                    </button>
                                )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                <button
                                    type="button"
                                    onClick={() => handleCategoryBoxClick('today')}
                                    className={`text-left p-4 rounded-xl border-2 transition-all shadow-sm ${categoryFilter === 'today' ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-950/40 ring-2 ring-blue-400' : 'border-blue-100 dark:border-blue-900/50 bg-white dark:bg-gray-800 hover:border-blue-300'}`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">📅 Today Follow Up</span>
                                        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">{userBoxMetrics.todayCount}</span>
                                    </div>
                                    <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{userBoxMetrics.todayCount} <span className="text-sm font-normal text-gray-500">accounts</span></p>
                                    <p className="text-xs text-blue-700 dark:text-blue-300 font-semibold mt-1">₹ {formatCurrency(userBoxMetrics.todayAmount)}</p>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => handleCategoryBoxClick('overdue')}
                                    className={`text-left p-4 rounded-xl border-2 transition-all shadow-sm ${categoryFilter === 'overdue' ? 'border-red-500 bg-red-50/80 dark:bg-red-950/40 ring-2 ring-red-400' : 'border-red-100 dark:border-red-900/50 bg-white dark:bg-gray-800 hover:border-red-300'}`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400">🚨 Overdue Follow Up</span>
                                        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300">{userBoxMetrics.overdueCount}</span>
                                    </div>
                                    <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{userBoxMetrics.overdueCount} <span className="text-sm font-normal text-gray-500">accounts</span></p>
                                    <p className="text-xs text-red-700 dark:text-red-300 font-semibold mt-1">₹ {formatCurrency(userBoxMetrics.overdueAmount)}</p>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => handleCategoryBoxClick('no_follow_up')}
                                    className={`text-left p-4 rounded-xl border-2 transition-all shadow-sm ${categoryFilter === 'no_follow_up' ? 'border-amber-500 bg-amber-50/80 dark:bg-amber-950/40 ring-2 ring-amber-400' : 'border-amber-100 dark:border-amber-900/50 bg-white dark:bg-gray-800 hover:border-amber-300'}`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">⚠️ No Follow Up List</span>
                                        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300">{userBoxMetrics.noFollowUpCount}</span>
                                    </div>
                                    <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{userBoxMetrics.noFollowUpCount} <span className="text-sm font-normal text-gray-500">accounts</span></p>
                                    <p className="text-xs text-amber-700 dark:text-amber-300 font-semibold mt-1">₹ {formatCurrency(userBoxMetrics.noFollowUpAmount)}</p>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => handleCategoryBoxClick('future')}
                                    className={`text-left p-4 rounded-xl border-2 transition-all shadow-sm ${categoryFilter === 'future' ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/40 ring-2 ring-emerald-400' : 'border-emerald-100 dark:border-emerald-900/50 bg-white dark:bg-gray-800 hover:border-emerald-300'}`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">📆 Future Follow Up</span>
                                        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">{userBoxMetrics.futureCount}</span>
                                    </div>
                                    <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{userBoxMetrics.futureCount} <span className="text-sm font-normal text-gray-500">accounts</span></p>
                                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold mt-1">₹ {formatCurrency(userBoxMetrics.futureAmount)}</p>
                                </button>
                            </div>
                        </div>

                        {/* Filtered Active Customer Tasks */}
                        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                                <div>
                                    <h2 className="text-xl font-bold text-gray-800 dark:text-white">
                                        {categoryFilter === 'today' ? "Today's Follow-up Schedule" :
                                         categoryFilter === 'overdue' ? "Overdue Accounts Requiring Action" :
                                         categoryFilter === 'no_follow_up' ? "Accounts Without Planned Follow-ups" :
                                         categoryFilter === 'future' ? "Upcoming Future Follow-ups" :
                                         "My Assigned Accounts"}
                                    </h2>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Showing {filteredData.length} accounts</p>
                                </div>
                                <div className="relative w-full sm:w-64">
                                    <input
                                        type="text"
                                        placeholder="Search customer, phone..."
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        className="w-full pl-9 pr-3 py-1.5 border rounded-lg bg-gray-50 dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 text-xs"
                                    />
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                    </div>
                                </div>
                            </div>

                            {filteredData.length === 0 ? (
                                <div className="text-center py-10 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                                    <p className="text-gray-500 dark:text-gray-400 font-medium">No accounts match the current filter.</p>
                                    <button
                                        onClick={handleClearFilters}
                                        className="mt-2 text-sm text-green-600 hover:text-green-700 font-semibold"
                                    >
                                        View All Assigned Accounts
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {filteredData.map(customer => {
                                        const isOverdue = customer.status === FollowUpStatus.Overdue || (customer.followUpDate && new Date(customer.followUpDate).setHours(0,0,0,0) < getToday().getTime());
                                        const isNoFollow = !customer.followUpDate;

                                        return (
                                            <div
                                                key={customer.id}
                                                className={`rounded-xl p-4 flex flex-col md:flex-row justify-between md:items-center gap-4 transition-all border ${
                                                    customer.isUrgent
                                                        ? 'bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-900/50'
                                                        : isOverdue
                                                        ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40'
                                                        : isNoFollow
                                                        ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40'
                                                        : 'bg-white dark:bg-gray-800/80 border-gray-100 dark:border-gray-700/60 shadow-sm'
                                                }`}
                                            >
                                                <div className="flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <button
                                                            onClick={() => handleOpenFollowUp(customer)}
                                                            className="font-bold text-base text-gray-900 dark:text-white hover:text-green-600 dark:hover:text-green-400 text-left"
                                                        >
                                                            {customer.company}
                                                        </button>
                                                        {customer.isUrgent && (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                                                                🔥 Urgent
                                                            </span>
                                                        )}
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                            customer.status === FollowUpStatus.Today ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                                                            customer.status === FollowUpStatus.Overdue ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                                                            customer.status === FollowUpStatus.Upcoming ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' :
                                                            'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                                                        }`}>
                                                            {customer.status}
                                                        </span>
                                                    </div>

                                                    <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-600 dark:text-gray-300">
                                                        <div>
                                                            <span className="text-gray-400">Contact: </span>
                                                            <span className="font-medium">{customer.contactPerson || 'N/A'} ({customer.contactNumber || 'No phone'})</span>
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-400">Follow-up Date: </span>
                                                            <span className={`font-semibold ${isOverdue ? 'text-red-600' : isNoFollow ? 'text-amber-600' : 'text-gray-800 dark:text-gray-200'}`}>
                                                                {customer.followUpDate ? new Date(customer.followUpDate).toLocaleDateString('en-GB') : '⚠️ Not Scheduled'}
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-400">Balance: </span>
                                                            <span className="font-bold text-gray-900 dark:text-white">₹ {formatCurrency(customer.total)}</span>
                                                        </div>
                                                    </div>

                                                    {customer.notes && customer.notes.length > 0 && (
                                                        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 italic bg-gray-50 dark:bg-gray-800/60 px-2 py-1 rounded">
                                                            Last Note: "{customer.notes[customer.notes.length - 1]}"
                                                        </p>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-2 self-end md:self-center">
                                                    <button
                                                        onClick={() => handleOpenEditCustomer(customer)}
                                                        className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-semibold transition-colors shadow-2xs flex items-center gap-1 border border-gray-200 dark:border-gray-700"
                                                        title="Edit Customer Master Info & Name"
                                                    >
                                                        ✏️ Edit
                                                    </button>
                                                    <button
                                                        onClick={() => handleOpenFollowUp(customer)}
                                                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors shadow-sm flex items-center"
                                                    >
                                                        <EditIcon className="w-3.5 h-3.5 mr-1" />
                                                        Update
                                                    </button>
                                                    <button
                                                        onClick={() => handleSendWhatsApp(customer)}
                                                        className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-semibold hover:bg-emerald-600 transition-colors shadow-sm flex items-center"
                                                    >
                                                        <WhatsAppIcon className="w-3.5 h-3.5 mr-1" />
                                                        WhatsApp
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'pdc' && (
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
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
                    </div>
                )}

                {activeTab === 'reports' && (
                    <ReportsView
                        data={appData}
                        users={users}
                        currentUser={currentUser!}
                        initialCrmFilter={currentUser?.role === UserRole.CRM ? currentUser.id : 'ALL'}
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

    const ReportCard = ({ title, value }: { title: string, value: string | number }) => (
        <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg shadow">
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{title}</p>
            <p className="text-2xl font-bold text-gray-800 dark:text-white">{value}</p>
        </div>
    );

    const ReportsDashboard = () => {
        const [selectedUserId, setSelectedUserId] = useState<string>(users.filter(u => u.role !== UserRole.Admin)[0]?.id || '');
        
        const selectedUser = useMemo(() => users.find(u => u.id === selectedUserId), [selectedUserId, users]);
        
        const userReports = useMemo(() => {
            if (!selectedUser) return [];
            // For reports, we need to look at the full, unfiltered dataset
            if (selectedUser.role === UserRole.CRM) {
                return outstandingData.filter(d => d.crmOwnerId === selectedUserId);
            }
            if (selectedUser.role === UserRole.Collector) {
                return outstandingData.filter(d => d.assignedCollectorId === selectedUserId);
            }
            return [];
        }, [selectedUserId, outstandingData, selectedUser]);

        const crmMetrics = useMemo(() => {
            if (!selectedUser || selectedUser.role !== UserRole.CRM || userReports.length === 0) return null;
            
            const totalCustomers = userReports.length;
            const totalOutstanding = userReports.reduce((sum, item) => item.status !== FollowUpStatus.Completed ? sum + item.total : sum, 0);
            const followUpRate = (userReports.filter(c => !!c.followUpDate).length / totalCustomers) * 100;
            const overdue = userReports.filter(c => c.status === FollowUpStatus.Overdue).length;
            const urgent = userReports.filter(c => c.isUrgent).length;

            const completedTasks = userReports.filter(c => c.status === FollowUpStatus.Completed && c.lastFollowUpOn);
            const collectionTimes = completedTasks.map(c => (new Date(c.lastFollowUpOn!).getTime() - new Date(c.creationDate).getTime()) / (1000 * 3600 * 24));
            const avgCollectionTime = collectionTimes.length > 0 ? collectionTimes.reduce((a, b) => a + b, 0) / collectionTimes.length : 0;

            return { totalCustomers, totalOutstanding, followUpRate, overdue, urgent, avgCollectionTime };

        }, [selectedUser, userReports]);

        const collectorMetrics = useMemo(() => {
            if (!selectedUser || selectedUser.role !== UserRole.Collector || userReports.length === 0) return null;

            const totalAssigned = userReports.length;
            const completed = userReports.filter(c => c.status === FollowUpStatus.Completed);
            const completedToday = completed.filter(c => c.lastFollowUpOn && getToday().getTime() === new Date(c.lastFollowUpOn).setHours(0,0,0,0)).length;
            const successRate = totalAssigned > 0 ? (completed.length / totalAssigned) * 100 : 0;
            
            const delayedTasks = userReports.filter(c => c.followUpDate && c.lastFollowUpOn && new Date(c.lastFollowUpOn) > new Date(c.followUpDate));
            const delays = delayedTasks.map(c => (new Date(c.lastFollowUpOn!).getTime() - new Date(c.followUpDate!).getTime()) / (1000 * 3600 * 24));
            const avgDelay = delays.length > 0 ? delays.reduce((a, b) => a + b, 0) / delays.length : 0;

            return { totalAssigned, completedToday, successRate, avgDelay };

        }, [selectedUser, userReports]);

        return (
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
                    <label htmlFor="userSelect" className="text-lg font-semibold text-gray-700 dark:text-gray-300">Select User:</label>
                    <select
                        id="userSelect"
                        value={selectedUserId}
                        onChange={e => setSelectedUserId(e.target.value)}
                        className="w-full sm:w-72 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md p-2 text-sm font-medium text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                        {users.filter(u => u.role !== UserRole.Admin).map(user => (
                            <option key={user.id} value={user.id}>{user.name} ({user.role})</option>
                        ))}
                    </select>
                </div>
                
                {selectedUser && userReports.length === 0 && (
                    <div className="text-center py-12 text-gray-500 dark:text-gray-400">No data available for this user.</div>
                )}
                
                {crmMetrics && (
                    <div>
                        <h3 className="text-xl font-bold mb-4 text-gray-800 dark:text-white">CRM Performance</h3>
                         <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            <ReportCard title="Total Customers" value={crmMetrics.totalCustomers} />
                            <ReportCard title="Total Outstanding" value={formatCurrency(crmMetrics.totalOutstanding)} />
                            <ReportCard title="Follow-up Rate" value={`${crmMetrics.followUpRate.toFixed(1)}%`} />
                            <ReportCard title="Overdue Accounts" value={crmMetrics.overdue} />
                            <ReportCard title="Avg. Collection Time" value={`${crmMetrics.avgCollectionTime.toFixed(1)} days`} />
                             <ReportCard title="Urgent Tasks" value={crmMetrics.urgent} />
                        </div>
                    </div>
                )}
                {collectorMetrics && (
                    <div>
                        <h3 className="text-xl font-bold mb-4 text-gray-800 dark:text-white">Collector Performance</h3>
                         <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <ReportCard title="Total Assigned Visits" value={collectorMetrics.totalAssigned} />
                            <ReportCard title="Completed Today" value={collectorMetrics.completedToday} />
                            <ReportCard title="Success Rate" value={`${collectorMetrics.successRate.toFixed(1)}%`} />
                            <ReportCard title="Avg. Follow-up Delay" value={`${collectorMetrics.avgDelay.toFixed(1)} days`} />
                        </div>
                    </div>
                )}
            </div>
        );
    }

    const renderAdminDashboard = () => {
        // Use lifted state
        const activeTab = adminTab;
        const setActiveTab = setAdminTab;

        const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;

            setIsSyncing(true);
            setSyncMessage(null);

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = e.target?.result;
                    const workbook = window.XLSX.read(data, { type: 'binary', cellDates: true });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const json: any[][] = window.XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                    
                    if (json.length < 1) {
                         throw new Error("Excel sheet is empty or invalid.");
                    }
                    
                    // Slice(1) to skip header row, assuming file has one.
                    const parsedData = parseRawDataArray(json.slice(1));
                    const nowIso = new Date().toISOString();
                    setLastSyncTime(nowIso);
                    localStorage.setItem('lastSyncTime', nowIso);
                    if (appData.length > 0) {
                        setPendingSync({
                            records: parsedData,
                            sourceName: file.name || 'Excel File'
                        });
                    } else {
                        const processedData = processStatuses(parsedData);
                        setAppData(processedData); // This saves to State -> LocalStorage
                        setSyncMessage({ type: 'success', text: `Successfully loaded ${parsedData.length} records. Data saved to browser.` });
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
            if (window.XLSX) {
                const ws = window.XLSX.utils.aoa_to_sheet([EXPECTED_HEADERS]);
                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
                window.XLSX.writeFile(wb, "TimelyPayment_Template.xlsx");
            } else {
                alert("Export functionality not ready yet. Please try again in a moment.");
            }
        };

        const resetData = () => {
            if(window.confirm("Are you sure? This will delete all uploaded data and restore the sample mock data.")) {
                localStorage.removeItem('timely_payment_data');
                setAppData(processStatuses(MOCK_DATA));
                setSyncMessage({ type: 'success', text: "Data reset to default."});
            }
        }

        return (
             <>
                <h1 className="text-3xl font-bold mb-6 text-gray-800 dark:text-white">Admin Dashboard</h1>
                <div className="mb-6 bg-white dark:bg-gray-900 rounded-lg shadow-md p-2 flex items-center justify-between overflow-x-auto">
                     <div className="flex space-x-2 min-w-max">
                        <TabButton tabName="overview" activeTab={activeTab} setActiveTab={setActiveTab} label="Overview" icon={<ChartBarIcon />} />
                        <TabButton tabName="pdc" activeTab={activeTab} setActiveTab={setActiveTab} label="PDC Cheques" icon={<ChequeIcon />} />
                        <TabButton tabName="customers" activeTab={activeTab} setActiveTab={setActiveTab} label="Customer List" icon={<ClipboardListIcon />} />
                        <TabButton tabName="users" activeTab={activeTab} setActiveTab={setActiveTab} label="User Management" icon={<UsersIcon />} />
                        <TabButton tabName="reports" activeTab={activeTab} setActiveTab={setActiveTab} label="Reports" icon={<ChartBarIcon />} />
                        <TabButton tabName="templates" activeTab={activeTab} setActiveTab={setActiveTab} label="Templates" icon={<DocumentTextIcon />} />
                        <TabButton tabName="source" activeTab={activeTab} setActiveTab={setActiveTab} label="Data Source" icon={<LinkIcon />} />
                    </div>
                </div>
                
                {activeTab === 'overview' && renderAdminOverviewCards()}
                
                {activeTab === 'customers' && renderCustomerListView()}

                {activeTab === 'pdc' && (
                    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-md p-6">
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
                    </div>
                )}

                {activeTab !== 'overview' && activeTab !== 'customers' && activeTab !== 'pdc' && (
                    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-md p-6">
                        {activeTab === 'users' && (
                            <div className="space-y-6">
                                {/* Sub-navigation tabs inside User Management */}
                                <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-gray-700 pb-3">
                                    <button
                                        onClick={() => setUserManagementTab('users')}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                                            userManagementTab === 'users'
                                                ? 'bg-green-600 text-white shadow-xs'
                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                    >
                                        <UsersIcon className="w-4 h-4" />
                                        <span>User Accounts ({users.length})</span>
                                    </button>
                                    <button
                                        onClick={() => setUserManagementTab('company')}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                                            userManagementTab === 'company'
                                                ? 'bg-green-600 text-white shadow-xs'
                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
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
                                                <h2 className="text-xl font-bold text-gray-800 dark:text-white">System Users & Access Roles</h2>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Manage executive admin, CRM account owners, and collection staff.</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button 
                                                    onClick={handleResetUsersOnly}
                                                    className="flex items-center px-3 py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 transition-colors"
                                                    title="Reset user list and passwords to default roster"
                                                >
                                                    <span>🔄 Reset Users to Default</span>
                                                </button>
                                                <button 
                                                    onClick={() => handleOpenUserModal(null)}
                                                    className="flex items-center px-3.5 py-2 text-sm font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 shadow-xs"
                                                >
                                                    <UserPlusIcon className="w-4 h-4 -ml-1 mr-2" />
                                                    <span>Add User</span>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-left text-xs sm:text-sm">
                                                <thead className="bg-gray-50 dark:bg-gray-800">
                                                    <tr>
                                                        <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">User & ID</th>
                                                        <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">Role</th>
                                                        <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">Assigned CRMs / Scope</th>
                                                        <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">Granted Permissions</th>
                                                        <th className="px-4 py-3 text-right font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                                                    {users.map(user => {
                                                        const p = user.permissions;
                                                        return (
                                                            <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                                                                <td className="px-4 py-3 whitespace-nowrap">
                                                                    <div className="font-bold text-gray-900 dark:text-white">{user.name}</div>
                                                                    <div className="text-xs text-gray-400 font-mono">ID: {user.id}</div>
                                                                </td>
                                                                <td className="px-4 py-3 whitespace-nowrap">
                                                                    <span className={`inline-flex px-2.5 py-1 text-xs font-bold rounded-lg ${
                                                                        user.role === UserRole.Admin ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800' :
                                                                        user.role === UserRole.Manager ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800' :
                                                                        user.role === UserRole.CRM ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800' :
                                                                        user.role === UserRole.Collector ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800' :
                                                                        'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700'
                                                                    }`}>
                                                                        {user.role}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    {user.role === UserRole.Admin || user.dataVisibility === DataVisibility.All ? (
                                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                                                            🌐 All Accounts
                                                                        </span>
                                                                    ) : (
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {(user.assignedCrms && user.assignedCrms.length > 0 ? user.assignedCrms : [user.id]).map(c => (
                                                                                <span key={c} className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                                                                    {c}
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    <div className="flex flex-wrap gap-1 text-[10px]">
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
                                                                                className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-colors" 
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
                        {activeTab === 'reports' && (
                            <ReportsView
                                data={appData}
                                users={users}
                                currentUser={currentUser!}
                                companyProfile={companyProfile}
                                onFollowUp={handleOpenFollowUp}
                                onWhatsApp={handleSendWhatsApp}
                                pdcCheques={pdcCheques}
                                onOpenPdcForCustomer={handleOpenPdcForCustomer}
                            />
                        )}
                         {activeTab === 'templates' && (
                            <div>
                                <div className="flex justify-between items-center mb-4">
                                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Manage Message Templates</h2>
                                    <button 
                                        onClick={() => handleOpenTemplateModal(null)}
                                        className="flex items-center px-3 py-2 text-sm font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700"
                                    >
                                        <UserPlusIcon className="w-5 h-5 -ml-1 mr-2" />
                                        <span>New Template</span>
                                    </button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                        <thead className="bg-gray-50 dark:bg-gray-800">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Template Name</th>
                                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                                            {templates.map(template => (
                                                <tr key={template.id}>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-800 dark:text-gray-200">{template.name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                        <div className="flex justify-end items-center space-x-2">
                                                            <button onClick={() => handleOpenTemplateModal(template)} className="p-2 text-green-600 hover:text-green-800"><EditIcon /></button>
                                                            <button onClick={() => handleDeleteTemplate(template.id)} className="p-2 text-red-600 hover:text-red-800"><TrashIcon /></button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                        {activeTab === 'source' && (
                             <div>
                                <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">Data Source Management</h2>
                                
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                    
                                    {/* Data Format Section */}
                                    <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-700 col-span-1 lg:col-span-2 bg-blue-50 dark:bg-blue-900/20">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-white">1. Data Format Required</h3>
                                                <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                                                    Your Excel file or Google Sheet must have the following columns in this exact order (starting row 1):
                                                </p>
                                            </div>
                                            <div className="flex space-x-2">
                                                 <button onClick={downloadTemplate} className="flex items-center px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                                    <DownloadIcon />
                                                    <span className="ml-2">Download Excel Template</span>
                                                </button>
                                                <button onClick={copyHeaders} className="flex items-center px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                                    <ClipboardListIcon className="w-4 h-4 mr-2"/> Copy Headers
                                                </button>
                                            </div>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full text-xs text-left text-gray-500 dark:text-gray-400">
                                                <thead className="text-xs text-gray-700 uppercase bg-gray-100 dark:bg-gray-700 dark:text-gray-400">
                                                    <tr>
                                                        {EXPECTED_HEADERS.map((h, i) => <th key={i} className="px-2 py-1 border dark:border-gray-600">{h}</th>)}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr className="bg-white dark:bg-gray-800">
                                                        <td className="px-2 py-1 border dark:border-gray-600 font-mono">out_1</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">Acme Corp</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">John Doe</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">9876543210</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">5000</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">5000</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">0</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">0</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">0</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">Priya Singh</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">Amit Kumar</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">2023-12-01</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">Follow up</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">FALSE</td>
                                                        <td className="px-2 py-1 border dark:border-gray-600">2023-01-01</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* Data Source Configuration */}
                                    <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-700 col-span-1 lg:col-span-2">
                                        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-4">
                                            <h3 className="text-lg font-semibold text-gray-800 dark:text-white">2. Select Data Source & Sync Status</h3>
                                            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 text-xs">
                                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                                <span className="font-semibold">Last Synced:</span>
                                                <span>{new Date(lastSyncTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}, {new Date(lastSyncTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex flex-col sm:flex-row gap-6 mb-6">
                                            <label className={`flex-1 p-4 border rounded-lg cursor-pointer transition-all ${dataSourceMode === 'excel' ? 'border-green-500 bg-green-50 dark:bg-green-900/10' : 'border-gray-200 dark:border-gray-700'}`}>
                                                <div className="flex items-center mb-2">
                                                    <input 
                                                        type="radio" 
                                                        name="dataSource" 
                                                        value="excel" 
                                                        checked={dataSourceMode === 'excel'} 
                                                        onChange={() => setDataSourceMode('excel')}
                                                        className="h-4 w-4 text-green-600 focus:ring-green-500"
                                                    />
                                                    <span className="ml-3 font-semibold text-gray-900 dark:text-white">Excel Upload (Offline)</span>
                                                </div>
                                                <p className="text-sm text-gray-500 dark:text-gray-400 ml-7">
                                                    Best for single users. Data is stored in your browser. No internet needed after load.
                                                </p>
                                            </label>

                                            <label className={`flex-1 p-4 border rounded-lg cursor-pointer transition-all ${dataSourceMode === 'google' ? 'border-green-500 bg-green-50 dark:bg-green-900/10' : 'border-gray-200 dark:border-gray-700'}`}>
                                                <div className="flex items-center mb-2">
                                                    <input 
                                                        type="radio" 
                                                        name="dataSource" 
                                                        value="google" 
                                                        checked={dataSourceMode === 'google'} 
                                                        onChange={() => setDataSourceMode('google')}
                                                        className="h-4 w-4 text-green-600 focus:ring-green-500"
                                                    />
                                                    <span className="ml-3 font-semibold text-gray-900 dark:text-white">Live Google Sheet (Team)</span>
                                                </div>
                                                <p className="text-sm text-gray-500 dark:text-gray-400 ml-7">
                                                    Best for teams. Multiple users see the same data. Requires sheet to be public/shared.
                                                </p>
                                            </label>
                                        </div>

                                        {dataSourceMode === 'excel' ? (
                                            <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-10 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 text-center">
                                                    Upload your .xlsx file here. This will replace the current dataset.
                                                </p>
                                                <label htmlFor="file-upload" className="cursor-pointer flex items-center justify-center px-6 py-3 text-base font-semibold rounded-lg transition-colors bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-400 shadow-md">
                                                     <UploadIcon />
                                                     <span className="ml-2">{isSyncing ? 'Processing...' : 'Select Excel File'}</span>
                                                </label>
                                                <input id="file-upload" name="file-upload" type="file" className="sr-only" accept=".xlsx, .xls" onChange={handleFileChange} disabled={isSyncing}/>
                                            </div>
                                        ) : (
                                            <div className="space-y-6">
                                                {/* Top Action: Dual Sync */}
                                                <div className="p-4 bg-gradient-to-r from-emerald-500/10 via-blue-500/10 to-emerald-500/10 dark:from-emerald-950/40 dark:to-blue-950/40 border border-emerald-300 dark:border-emerald-700 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3">
                                                    <div>
                                                        <h4 className="text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-1.5">
                                                            <span>⚡ One-Click Dual Sync</span>
                                                            <span className="px-2 py-0.5 text-[10px] bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 rounded font-bold">Recommended</span>
                                                        </h4>
                                                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                                            Synchronizes both Outstanding Invoices and Customer Master details (GSTIN, credit terms, contacts) in a single run.
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={handleCombinedSync}
                                                        disabled={isSyncing}
                                                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl disabled:opacity-50 flex items-center gap-2 font-bold text-xs shadow-md transition-all whitespace-nowrap"
                                                    >
                                                        <SyncIcon />
                                                        <span>{isSyncing ? 'Syncing All Sheets...' : 'Sync Both Sheets Now'}</span>
                                                    </button>
                                                </div>

                                                {/* Sheet 1: Outstanding Invoices */}
                                                <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                                                    <div className="flex justify-between items-center">
                                                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200">
                                                            📊 1. Outstanding Invoices & Ageing Sheet
                                                        </label>
                                                        <span className="text-[11px] text-gray-500">Live transaction balances</span>
                                                    </div>
                                                    <div className="flex flex-col sm:flex-row gap-2">
                                                        <input 
                                                            type="text" 
                                                            value={googleSheetUrl}
                                                            onChange={(e) => setGoogleSheetUrl(e.target.value)}
                                                            placeholder="https://docs.google.com/spreadsheets/d/..."
                                                            className="flex-1 p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 text-xs font-mono"
                                                        />
                                                        <button 
                                                            onClick={() => handleGoogleSync()}
                                                            disabled={isSyncing}
                                                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 flex items-center justify-center font-bold text-xs shadow-xs transition-colors whitespace-nowrap"
                                                        >
                                                            <SyncIcon /> 
                                                            <span className="ml-1.5">{isSyncing ? 'Syncing...' : 'Sync Invoices'}</span>
                                                        </button>
                                                    </div>
                                                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
                                                        <span>ID, Company, Contact, Total Due, Ageing columns</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setGoogleSheetUrl(OFFICIAL_TRANSACTIONS_SHEET_URL);
                                                                localStorage.setItem('googleSheetUrl', OFFICIAL_TRANSACTIONS_SHEET_URL);
                                                            }}
                                                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 font-semibold underline"
                                                        >
                                                            Restore Default Invoices URL
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Sheet 2: Customer Master Directory */}
                                                <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                                                    <div className="flex justify-between items-center">
                                                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200">
                                                            🏛️ 2. Customer Master Directory & Credit Terms Sheet
                                                        </label>
                                                        <span className="text-[11px] text-gray-500">GSTIN, addresses, multiple contacts, limits</span>
                                                    </div>
                                                    <div className="flex flex-col sm:flex-row gap-2">
                                                        <input 
                                                            type="text" 
                                                            value={customerMasterSheetUrl}
                                                            onChange={(e) => setCustomerMasterSheetUrl(e.target.value)}
                                                            placeholder="https://docs.google.com/spreadsheets/d/..."
                                                            className="flex-1 p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 text-xs font-mono"
                                                        />
                                                        <button 
                                                            onClick={() => handleCustomerMasterSync()}
                                                            disabled={isSyncing}
                                                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 flex items-center justify-center font-bold text-xs shadow-xs transition-colors whitespace-nowrap"
                                                        >
                                                            <SyncIcon /> 
                                                            <span className="ml-1.5">{isSyncing ? 'Syncing...' : 'Sync Master'}</span>
                                                        </button>
                                                    </div>
                                                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
                                                        <span>Company Name, Contact Person, Designation, Mobile, City, State, GSTIN, Credit Limit</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setCustomerMasterSheetUrl(OFFICIAL_CUSTOMER_MASTER_URL);
                                                                localStorage.setItem('customerMasterSheetUrl', OFFICIAL_CUSTOMER_MASTER_URL);
                                                            }}
                                                            className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 font-semibold underline"
                                                        >
                                                            Restore Default Master URL
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        
                                        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                                            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Troubleshooting & Fresh Start</h4>
                                            <div className="flex flex-wrap items-center gap-3">
                                                <button 
                                                    onClick={() => handleResetAllDataAndUsers(false)}
                                                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow transition-all flex items-center gap-1.5"
                                                    title="Reset all users, passwords, follow-ups, and fetch clean live Google Sheet data"
                                                >
                                                    <TrashIcon /> <span>Reset All Data & Users (Fresh Start)</span>
                                                </button>
                                                <button 
                                                    onClick={handleResetUsersOnly}
                                                    className="px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-semibold transition-colors"
                                                >
                                                    <span>Reset Users Only</span>
                                                </button>
                                            </div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                                Use "Reset All Data & Users" to wipe custom notes, passwords, and PDC cheques to begin cleanly from scratch.
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

    const renderDashboard = () => {
        if (!currentUser) {
             return <div className="text-center py-12"><p className="text-lg">No user selected.</p></div>;
        }
        switch (currentUser.role) {
            case UserRole.Admin:
                return renderAdminDashboard();
            case UserRole.CRM:
                return renderUserDashboard("CRM Dashboard");
            case UserRole.Collector:
                return renderUserDashboard("Collection Agent Dashboard");
            default:
                return <div className="text-center py-12 text-red-500"><p className="text-lg">Invalid user role.</p></div>;
        }
    };

    if (!isAuthenticated) {
        return (
            <LoginScreen 
                users={users} 
                onLogin={handleLogin} 
                onResetPassword={handleResetUserPassword}
                onResetAll={() => handleResetAllDataAndUsers(false)} 
            />
        );
    }

    if (!currentUser) return null;

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            <Header 
                currentUser={currentUser} 
                onUserChange={handleUserChange} 
                users={users} 
                onLogout={handleLogout} 
                sheetUpdatedTillDate={sheetUpdatedTillDate}
                lastSyncTime={lastSyncTime}
                onSync={() => handleCombinedSync()}
                onResetAll={() => handleResetAllDataAndUsers(false)}
                isSyncing={isSyncing}
                dataSourceMode={dataSourceMode}
                companyName={companyProfile.name}
            />

            {syncMessage && (
                <div className="w-full max-w-[1750px] mx-auto px-2 sm:px-4 lg:px-6 pt-4">
                    <div className={`p-4 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-md border ${
                        syncMessage.type === 'success'
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100'
                            : 'bg-red-50 dark:bg-red-950/50 border-red-300 dark:border-red-700 text-red-900 dark:text-red-100'
                    }`}>
                        <div className="flex items-center gap-3 text-sm font-medium flex-1">
                            {syncMessage.type === 'success' ? (
                                <CheckCircleIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                            ) : (
                                <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                            )}
                            <span>{syncMessage.text}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {syncMessage.type === 'error' && (
                                <button
                                    onClick={() => handleGoogleSync(OFFICIAL_SHEET_URL)}
                                    className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow transition-colors flex items-center gap-1.5"
                                >
                                    <SyncIcon />
                                    <span>Sync Official Sheet</span>
                                </button>
                            )}
                            <button
                                onClick={() => setSyncMessage(null)}
                                className="text-current opacity-60 hover:opacity-100 p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                                aria-label="Dismiss notification"
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <main className="p-2 sm:p-4 lg:p-6">
                <div className="w-full max-w-[1750px] mx-auto">
                    {loading ? (
                         <div className="text-center py-12"><p className="text-lg">Loading data...</p></div>
                    ) : error ? (
                        <div className="text-center py-12 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 p-4 rounded-lg"><p className="text-lg font-semibold">An Error Occurred</p><p className="text-sm">{error}</p></div>
                    ) : (
                       renderDashboard()
                    )}
                </div>
            </main>
            {isModalOpen && selectedCustomer && (
                <FollowUpModal
                    customer={selectedCustomer}
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
                    users={users}
                    currentUser={currentUser!}
                    chequeToEdit={editingPdcCheque}
                    preselectedCustomerId={pdcPreselectedCustomerId}
                />
            )}
            {pendingSync && (
                <SyncReconciliationModal
                    existingCustomers={appData}
                    incomingCustomers={pendingSync.records}
                    users={users}
                    sourceName={pendingSync.sourceName}
                    onConfirm={handleConfirmSyncReconciliation}
                    onCancel={handleCancelSyncReconciliation}
                />
            )}
            {isCompanyModalOpen && (
                <CompanyProfileModal
                    isOpen={isCompanyModalOpen}
                    onClose={() => setIsCompanyModalOpen(false)}
                    profile={companyProfile}
                    onSave={handleSaveCompanyProfile}
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
        </div>
    );
};

export default App;
