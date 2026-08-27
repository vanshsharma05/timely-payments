export enum UserRole {
    Admin = 'Admin',
    Manager = 'Manager',
    CRM = 'CRM',
    Collector = 'Collector',
    Viewer = 'Viewer',
}

export enum DataVisibility {
    All = 'All',
    AssignedOnly = 'AssignedOnly',
}

export interface UserPermissions {
    canViewAllCrms: boolean;       // Can view all CRMs or only assigned CRM/customers
    canAddCustomer: boolean;       // Can create/add new customers
    canEditCustomer: boolean;      // Can edit customer contact details, designation, email, additional contacts
    canEditFinancials: boolean;    // Can edit total amount, ageing breakdown (1-45, 46-90, 91-135, >135)
    canDeleteCustomer: boolean;    // Can remove/delete customer record
    canEditFollowUp: boolean;      // Can log follow-up notes, next follow-up date, cash forecast
    canReassignCrm: boolean;       // Can reassign CRM owner to customers
    canManagePdc: boolean;         // Can add, edit, or mark PDC cheques as cleared/hold/bounced
    canExportData: boolean;        // Can export Excel/CSV reports
}

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, UserPermissions> = {
    [UserRole.Admin]: {
        canViewAllCrms: true,
        canAddCustomer: true,
        canEditCustomer: true,
        canEditFinancials: true,
        canDeleteCustomer: true,
        canEditFollowUp: true,
        canReassignCrm: true,
        canManagePdc: true,
        canExportData: true,
    },
    [UserRole.Manager]: {
        canViewAllCrms: true,
        canAddCustomer: true,
        canEditCustomer: true,
        canEditFinancials: true,
        canDeleteCustomer: false,
        canEditFollowUp: true,
        canReassignCrm: true,
        canManagePdc: true,
        canExportData: true,
    },
    [UserRole.CRM]: {
        canViewAllCrms: false,
        canAddCustomer: true,
        canEditCustomer: true,
        canEditFinancials: false,
        canDeleteCustomer: false,
        canEditFollowUp: true,
        canReassignCrm: false,
        canManagePdc: true,
        canExportData: true,
    },
    [UserRole.Collector]: {
        canViewAllCrms: false,
        canAddCustomer: false,
        canEditCustomer: true,
        canEditFinancials: false,
        canDeleteCustomer: false,
        canEditFollowUp: true,
        canReassignCrm: false,
        canManagePdc: true,
        canExportData: false,
    },
    [UserRole.Viewer]: {
        canViewAllCrms: true,
        canAddCustomer: false,
        canEditCustomer: false,
        canEditFinancials: false,
        canDeleteCustomer: false,
        canEditFollowUp: false,
        canReassignCrm: false,
        canManagePdc: false,
        canExportData: false,
    },
};

export interface User {
    /** CRM code as it appears on customer rows ('ANKUR'); profiles.legacy_id. */
    id: string;
    name: string;
    role: UserRole;
    /** Sign-in address. Held by Supabase Auth, mirrored onto the profile row. */
    email?: string;
    dataVisibility?: DataVisibility;
    permissions?: UserPermissions;
    assignedCrms?: string[]; // Specific CRMs this user is permitted to view/manage
}

/**
 * What the Team & access form produces. Passwords only ever travel in this
 * direction — towards /api/team, which hands them to Supabase Auth. They are
 * never stored on a User or read back.
 */
export interface TeamMemberDraft {
    /** Absent when creating: the CRM code is chosen in the form. */
    id?: string;
    name: string;
    email?: string;
    password?: string;
    role: UserRole;
    dataVisibility: DataVisibility;
    permissions: UserPermissions;
    assignedCrms?: string[];
}

/** Effective permission matrix: what the profile says, or the role's default. */
export function permissionsOf(user: User | null | undefined): UserPermissions {
    if (!user) return DEFAULT_ROLE_PERMISSIONS[UserRole.Viewer];
    const fallback = DEFAULT_ROLE_PERMISSIONS[user.role] || DEFAULT_ROLE_PERMISSIONS[UserRole.CRM];
    return { ...fallback, ...(user.permissions || {}) };
}

/** Admins are never restricted by the matrix, whatever it happens to contain. */
export function can(user: User | null | undefined, right: keyof UserPermissions): boolean {
    if (!user) return false;
    if (user.role === UserRole.Admin) return true;
    return Boolean(permissionsOf(user)[right]);
}

/** Sees the whole book rather than one CRM's slice. */
export function seesWholeBook(user: User | null | undefined): boolean {
    if (!user) return false;
    return (
        user.role === UserRole.Admin ||
        user.role === UserRole.Manager ||
        user.role === UserRole.Viewer ||
        user.dataVisibility === DataVisibility.All ||
        Boolean(user.permissions?.canViewAllCrms)
    );
}

export enum FollowUpStatus {
    Today = 'Today',
    Upcoming = 'Upcoming',
    Pending = 'Pending', 
    Overdue = 'Overdue',
    Completed = 'Completed',
}

export function getFollowUpCategory(item: Outstanding, today: Date = new Date()): 'today' | 'future' | 'overdue' | 'no_follow_up' | 'completed' {
    if (item.status === FollowUpStatus.Completed) return 'completed';

    const t = new Date(today);
    t.setHours(0, 0, 0, 0);

    if (item.followUpDate) {
        const d = new Date(item.followUpDate);
        if (!isNaN(d.getTime())) {
            d.setHours(0, 0, 0, 0);
            if (d.getTime() === t.getTime()) return 'today';
            if (d.getTime() > t.getTime()) return 'future';
            if (d.getTime() < t.getTime()) return 'overdue';
        }
    }

    if (item.status === FollowUpStatus.Today) return 'today';
    if (item.status === FollowUpStatus.Upcoming) return 'future';
    if (item.status === FollowUpStatus.Overdue) return 'overdue';

    return 'no_follow_up';
}

export type BalanceType = 'Dr' | 'Cr';

export interface AdditionalContact {
    id: string;
    name: string;
    mobile: string;
    post?: string;             // Designation / Role / Post (e.g. Accounts Head, Director, Purchase Manager, Billing Executive)
    email?: string;
    notes?: string;
}

export type PaymentRank = 'Good' | 'Bad';

export interface Outstanding {
    id: string;
    company: string;
    contactPerson: string;
    contactNumber: string;
    contactPost?: string;      // Designation / Post of primary contact
    additionalContacts?: AdditionalContact[]; // Additional persons in the company
    email?: string;
    city?: string;             // Customer city/location from master data
    state?: string;            // Customer state
    address?: string;          // Customer street/billing address
    gstin?: string;            // GSTIN number
    pan?: string;              // PAN number
    creditLimit?: number;      // Sanctioned Credit limit
    paymentTermsDays?: number; // Standard credit terms in days (e.g. 30, 45, 60)
    paymentRank?: PaymentRank; // Customer payment behaviour rank: 'Good' (timely payer) or 'Bad' (delayed/habitual defaulter)
    total: number;
    totalType?: BalanceType;       // 'Dr' = Outstanding payment to take, 'Cr' = Payment excess with us
    ageing: {
        '1-45': number;
        '46-90': number;
        '91-135': number;
        '>135': number;
    };
    ageingTypes?: {
        '1-45'?: BalanceType;
        '46-90'?: BalanceType;
        '91-135'?: BalanceType;
        '>135'?: BalanceType;
    };
    over90?: number;
    over90Type?: BalanceType;
    dueOver45?: number;
    dueOver45Type?: BalanceType;
    crmOwnerId: string;
    assignedCollectorId?: string;
    followUpDate?: Date;
    forecastAmount?: number;   // Expected cash collection forecast amount for Cash Flow planning
    forecastDate?: Date | string; // Expected collection date
    status: FollowUpStatus;
    notes: string[];
    isUrgent?: boolean;
    isNewCustomer?: boolean;
    addedAt?: string;
    creationDate: Date;
    lastFollowUpOn?: Date;
}

export interface AiReportRequest {
    mode: 'credit_reduction' | 'overdue_recovery' | 'crm_performance' | 'cash_forecast' | 'custom';
    customPrompt?: string;
    companyProfile?: CompanyProfile;
    targetCrm?: string;
    metricsSummary?: {
        totalAccounts: number;
        totalOutstanding: number;
        dueOver45: number;
        over90: number;
        over135: number;
        totalPdcInHand: number;
        pdcClearedTotal: number;
        averageCollectionDays: number;
        coverageRate: number;
    };
    criticalAccounts?: Array<{
        company: string;
        crm: string;
        totalDue: number;
        dueOver45: number;
        over90: number;
        over135: number;
        avgDays: number;
        status: string;
        activePdc: number;
        lastNote?: string;
    }>;
}

export interface AiReportResponse {
    ok: boolean;
    reportMarkdown?: string;
    mode?: string;
    generatedAt?: string;
    modelUsed?: string;
    error?: string;
    hasApiKey?: boolean;
}

export interface Template {
    id: string;
    name: string;
    content: string;
}

export enum PdcStatus {
    Pending = 'Pending',       // Awaiting deposit / presentation date
    DueToday = 'DueToday',     // Cheque date is today - ready for presentation
    Cleared = 'Cleared',       // Successfully cleared in bank
    Hold = 'Hold',             // Put on hold upon customer/CRM request
    Bounced = 'Bounced',       // Returned / Bounced
}

export interface PdcCheque {
    id: string;
    customerId: string;
    customerName: string;
    chequeNumber: string;
    bankName: string;
    chequeDate: Date;          // Date on the cheque (PDC date)
    amount: number;
    status: PdcStatus;
    receivedDate: Date;
    clearedDate?: Date;
    remarks?: string;
    crmOwnerId?: string;
    addedBy?: string;
}

export interface CompanyProfile {
    name: string;
    tagline?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    phone?: string;
    email?: string;
    gstin?: string;
    pan?: string;
    website?: string;
    bankDetails?: string;
}

/**
 * Placeholder shown only until the real profile loads from the database.
 * Everything beyond the name is deliberately blank: invented addresses, GSTINs
 * and bank accounts must never reach a reminder or a report.
 */
export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
    name: 'Shori Chemicals Pvt. Ltd.',
};

/**
 * Determine a customer's Payment Rank: 'Good' or 'Bad'
 * If explicitly assigned on the customer record, use that.
 * Otherwise, intelligently auto-calculate based on credit days terms and overdue ageing.
 */
export function getCustomerPaymentRank(customer: Outstanding): PaymentRank {
    if (customer.paymentRank === 'Good' || customer.paymentRank === 'Bad') {
        return customer.paymentRank;
    }
    // Advance / Credit balance is always Good
    if (customer.totalType === 'Cr' || (customer.total || 0) <= 0) {
        return 'Good';
    }

    const a2 = customer.ageing?.['46-90'] || 0;
    const a3 = customer.ageing?.['91-135'] || 0;
    const a4 = customer.ageing?.['>135'] || 0;
    const over90 = customer.over90 !== undefined ? customer.over90 : (a3 + a4);
    const dueOver45 = customer.dueOver45 !== undefined ? customer.dueOver45 : (a2 + over90);

    // If critical overdue >90d or >135d exists -> Bad Payment
    if (over90 > 0 || a4 > 0) {
        return 'Bad';
    }
    // If overdue >45d is more than 35% of total balance -> Bad Payment
    if (dueOver45 > 0 && dueOver45 > (customer.total * 0.35)) {
        return 'Bad';
    }
    // If payment credit terms days are strict (<=45d) and overdue >45d exists -> Bad Payment
    if (customer.paymentTermsDays && customer.paymentTermsDays <= 45 && dueOver45 > 0) {
        return 'Bad';
    }
    return 'Good';
}


