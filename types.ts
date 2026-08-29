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
    /** Supabase Auth user id. Set on every user loaded from the database. */
    authId?: string;
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

/**
 * One CRM code, written one way.
 *
 * The sheet, the user list and anything typed by hand disagree about case and
 * stray spaces — "ANKUR", "Ankur" and "ankur " are the same person. Every
 * comparison of ownership goes through here so they land in one bucket instead
 * of three.
 */
export const ownerKey = (value?: string | null): string => (value || '').trim().toUpperCase();

/**
 * Whether an account belongs in a collections count.
 *
 * The Customer Master sheet carries the whole customer list, including accounts
 * that owe nothing; syncing it adds them to the book with a zero balance. They
 * are real customers and belong in search and in their ledger, but counting
 * them as things to chase overstates every CRM's workload.
 */
export const hasOutstanding = (item: Pick<Outstanding, 'total'>): boolean =>
    Math.abs(Number(item.total) || 0) > 0;

/** True when this person owns the account, or is the collector working it. */
export function isResponsibleFor(user: Pick<User, 'id' | 'name'>, item: Pick<Outstanding, 'crmOwnerId' | 'assignedCollectorId'>): boolean {
    const me = [ownerKey(user.id), ownerKey(user.name)].filter(Boolean);
    const owner = ownerKey(item.crmOwnerId);
    const collector = ownerKey(item.assignedCollectorId);
    return me.includes(owner) || me.includes(collector);
}

/* ------------------------------ activity log ------------------------------ */

/**
 * What kind of thing happened. The list is deliberately short — a CRM working
 * through a call list will not pick from twenty options, and anything that does
 * not fit is a plain note.
 */
export type ActivityKind =
    | 'note'        // anything typed freehand
    | 'no_answer'   // rang out
    | 'declined'    // they cut the call
    | 'promise'     // committed to pay an amount by a date
    | 'payment'     // money actually arrived
    | 'visit'       // someone went in person
    | 'dispute'     // they are contesting the amount
    | 'system';     // written by the app, not a person

export interface ActivityEntry {
    id: string;
    customerId: string;
    authorId?: string;
    authorName: string;
    kind: ActivityKind;
    body: string;
    /** Set on a 'promise': what they committed to, and by when. */
    promisedAmount?: number;
    promisedOn?: string;
    /** On a settling entry, the id of the promise it answers. */
    resolvesId?: string;
    createdAt: string;
}

/** A promise, once we know how it turned out. */
export type PromiseState = 'open' | 'due' | 'overdue' | 'kept' | 'broken';

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
    note: 'Note',
    no_answer: 'No answer',
    declined: 'Call declined',
    promise: 'Promised to pay',
    payment: 'Payment received',
    visit: 'Visited',
    dispute: 'Disputed',
    system: 'System',
};

/**
 * How a promise stands today.
 *
 * A promise answered by a payment was kept; answered by anything else it was
 * not. Until something answers it, it is open, and it becomes overdue the day
 * after the date they gave — which is the moment somebody should be ringing.
 */
export function promiseState(
    entry: ActivityEntry,
    resolvedBy: ActivityEntry | undefined,
    today: Date = new Date(),
): PromiseState {
    if (resolvedBy) return resolvedBy.kind === 'payment' ? 'kept' : 'broken';
    if (!entry.promisedOn) return 'open';

    const due = new Date(entry.promisedOn);
    due.setHours(0, 0, 0, 0);
    const t = new Date(today);
    t.setHours(0, 0, 0, 0);

    if (due.getTime() < t.getTime()) return 'overdue';
    if (due.getTime() === t.getTime()) return 'due';
    return 'open';
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

/**
 * How a customer pays, in the three grades the business actually uses.
 *
 *   Good  — pays to terms.
 *   Late  — pays, but late; worth chasing normally.
 *   Bad   — old money stuck. This is the list that goes to the recovery agency,
 *           so it must not be diluted with people who are merely slow.
 */
export type PaymentRank = 'Good' | 'Late' | 'Bad';

export const PAYMENT_RANK_LABELS: Record<PaymentRank, string> = {
    Good: 'Good',
    Late: 'Late pay',
    Bad: 'Bad debt',
};

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

/** Settings for the daily reminder email. */
export interface AlertSettings {
    dailyEmail: boolean;
    recipientRoles: UserRole[];
    /** Do not mail somebody who has nothing to chase today. */
    skipWhenEmpty: boolean;
    /** Addresses outside the roster that always get the company summary. */
    extraRecipients: string[];
}

/** One line of what the reminder actually did. */
export interface AlertLogEntry {
    id: number;
    sentAt: string;
    kind: string;
    recipients: number;
    delivered: number;
    failed: number;
    provider: string | null;
    detail: string | null;
    triggeredBy: string | null;
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
    // Somebody who knows the account has said what it is; that beats any rule.
    if (customer.paymentRank === 'Good' || customer.paymentRank === 'Late' || customer.paymentRank === 'Bad') {
        return customer.paymentRank;
    }
    // Advance / credit balance owes nothing.
    if (customer.totalType === 'Cr' || (customer.total || 0) <= 0) {
        return 'Good';
    }

    const a2 = customer.ageing?.['46-90'] || 0;
    const a3 = customer.ageing?.['91-135'] || 0;
    const a4 = customer.ageing?.['>135'] || 0;
    const over90 = customer.over90 !== undefined ? customer.over90 : (a3 + a4);
    const dueOver45 = customer.dueOver45 !== undefined ? customer.dueOver45 : (a2 + over90);
    const total = customer.total || 0;

    // Money sitting past 135 days, or most of the balance past 90, is stuck
    // rather than slow.
    if (a4 > 0) return 'Bad';
    if (over90 > 0 && over90 > total * 0.35) return 'Bad';

    // Late but still moving: something is past its date, but none of it is old.
    if (over90 > 0 || dueOver45 > 0) return 'Late';
    if (customer.paymentTermsDays && customer.paymentTermsDays <= 45 && dueOver45 > 0) return 'Late';

    return 'Good';
}


