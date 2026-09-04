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

/**
 * Sees the whole book rather than one CRM's slice.
 *
 * What the Team & access form was set to is the answer; the role only supplies
 * the default it started from. Manager and Viewer used to be written in here by
 * name, so switching one of them to "Assigned customers only" and clearing
 * "View all CRMs" changed the form, was saved, and then did nothing at all —
 * they still read every account. Anybody who has not touched those controls is
 * unaffected: the role's own defaults still say what they always said.
 *
 * Admin stays unconditional, exactly as can() treats it.
 */
export function seesWholeBook(user: User | null | undefined): boolean {
    if (!user) return false;
    if (user.role === UserRole.Admin) return true;
    if (user.dataVisibility === DataVisibility.All) return true;
    return permissionsOf(user).canViewAllCrms;
}

/**
 * Whether this person may take the book out of the app as a file.
 *
 * An export is not a view of the book, it is a copy of it — names, contacts,
 * balances and ageing, in a spreadsheet that leaves the app and its audit trail
 * behind and can be sent anywhere. That is a management decision, so it takes a
 * management role *and* the permission: an Admin can withdraw it from a
 * Manager, and nobody below the two can be granted it by ticking a box.
 *
 * Deliberately stricter than `canExportData` alone, which still governs the
 * cheque register's own export.
 */
export function canExportBook(user: User | null | undefined): boolean {
    if (!user) return false;
    if (user.role !== UserRole.Admin && user.role !== UserRole.Manager) return false;
    return can(user, 'canExportData');
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

/**
 * Which half of the book a screen is showing.
 *
 * Roughly four customers in five owe nothing. They are real customers — the
 * ledger, the contacts and every word of the history still matter, and a
 * settled account is the point of the whole exercise — but they are not work,
 * and mixed into a worklist they bury the few hundred accounts that are. "No
 * follow-up set" read 3,835 when the true answer was a few hundred, because the
 * other three thousand had nothing to follow up.
 *
 * So every list about work defaults to `withDues`, and `settled` is a place to
 * go rather than a thing to wade through. Nothing is hidden and nothing is
 * dropped: settling an account only zeroes its money.
 */
export type SettlementFilter = 'withDues' | 'settled' | 'all';

export const SETTLEMENT_LABELS: Record<SettlementFilter, string> = {
    withDues: 'With dues',
    settled: 'Settled',
    all: 'All',
};

export const matchesSettlement = (
    item: Pick<Outstanding, 'total'>,
    filter: SettlementFilter,
): boolean => {
    if (filter === 'all') return true;
    return filter === 'settled' ? !hasOutstanding(item) : hasOutstanding(item);
};


/**
 * The teammate a stored owner value refers to, whichever spelling was saved.
 *
 * `crmOwnerId` is meant to hold the CRM **code** — `profiles.legacy_id`, the
 * same string the accounts sheet uses. For a while three of the four owner
 * dropdowns wrote the display **name** instead, so the column also holds
 * "Vishnu", "kapil" and "Vansh Sharma". Matching on the code first and the name
 * second resolves every one of them to the right person, so a dropdown selects
 * the owner an account actually has rather than falling back to its first
 * option and reading as "Unassigned".
 */
export function findOwner<T extends Pick<User, 'id' | 'name'>>(
    people: T[],
    value?: string | null,
): T | undefined {
    const key = ownerKey(value);
    if (!key) return undefined;
    return people.find(u => ownerKey(u.id) === key)
        || people.find(u => ownerKey(u.name) === key);
}

/** True when this person owns the account, or is the collector working it. */
export function isResponsibleFor(user: Pick<User, 'id' | 'name'>, item: Pick<Outstanding, 'crmOwnerId' | 'assignedCollectorId'>): boolean {
    const me = [ownerKey(user.id), ownerKey(user.name)].filter(Boolean);
    const owner = ownerKey(item.crmOwnerId);
    const collector = ownerKey(item.assignedCollectorId);
    return me.includes(owner) || me.includes(collector);
}

/** The shape any record needs before it can be scoped to a person. */
export type Owned = Pick<Outstanding, 'crmOwnerId' | 'assignedCollectorId'>;

/**
 * The slice of the book one person is responsible for. The only copy.
 *
 * This rule was written out by hand in five places — the dashboard, the
 * customer book, the reports, the cheque register and the digest — and they had
 * drifted apart. The view-level copies branched on the role instead of taking
 * the union, so a Collector saw only what was handed to them and never an
 * account they owned as CRM, and a CRM never saw one handed to them as
 * collector. Responsibility runs both ways and either direction is enough.
 *
 * An explicit CRM scope widens what somebody reads; it never takes away an
 * account handed to them personally.
 */
export function scopeTo<T extends Owned>(user: User | null | undefined, rows: T[]): T[] {
    if (!user) return [];
    if (seesWholeBook(user)) return rows;

    const allowed = new Set((user.assignedCrms || []).map(ownerKey).filter(Boolean));
    return rows.filter(row => isResponsibleFor(user, row) || allowed.has(ownerKey(row.crmOwnerId)));
}

/**
 * One company, written one way.
 *
 * "HARIOM TRADERS", "HARI OM TRADERS" and "HARI OM TRADERS," are one firm. The
 * imports matched on the trimmed lowercase name, which let all three through as
 * separate customers when the Customer Master was loaded alongside the invoice
 * sheet — the book ended up carrying 33 shadow accounts at zero balance, each
 * splitting one customer's contact details and history from their money.
 *
 * Punctuation and spacing carry no meaning in a company name here, so they are
 * dropped before anything is compared.
 */
export const companyKey = (name?: string | null): string =>
    (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

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
 *   Late  — pays, but late; worth chasing normally. However old the money is,
 *           a customer who is still paying is late, not a defaulter.
 *   Bad   — a defaulter. This is the list that goes to the recovery agency.
 *
 * `Bad` is **declared, never calculated.** Whether somebody has stopped paying
 * is a judgement about the customer, and ageing cannot make it: money sitting
 * past 135 days may be a dispute, a retention, or an invoice nobody chased.
 * Worked out from ageing it called 416 of 696 owing accounts defaulters, which
 * is both untrue and useless — a recovery list of four hundred names is not a
 * recovery list. It now comes from the defaulters the business names, set here
 * or loaded in bulk.
 */
export type PaymentRank = 'Good' | 'Late' | 'Bad';

export const PAYMENT_RANK_LABELS: Record<PaymentRank, string> = {
    Good: 'Good',
    Late: 'Late pay',
    Bad: 'Bad debt',
};

/**
 * What kind of business a customer is, as the Customer Master records it.
 *
 * Builder, Dealer, Dealer Offset and Retailer are the four the business talks
 * about, so they lead the list. The master's CATEGORY column also carries the
 * trade an account is in — Screen Printing alone is roughly 3,400 of the 4,000
 * accounts — and both meanings share the one column, so both are kept.
 *
 * The list is what the dropdown offers, not a fence. A value the sheet holds
 * that is not on it is kept word for word: a category nobody has told us about
 * is still the truth about that customer, and dropping it would quietly lose
 * data on import.
 */
export const CUSTOMER_CATEGORIES: readonly string[] = [
    'Builder',
    'Dealer',
    'Dealer Offset',
    'Retailer',
    'Screen Printing',
    'Garmentor',
    'Offset',
    'Offset & Packaging',
    'Paint',
    'Fabric Printing',
    'Fabric Distributor',
    'Digital Printing',
    'Transfer Printing',
    'Sublimation',
    'DTF',
    'Dyeing',
    'Finishing',
    'Nonwoven',
    'Waterproofing',
    'Sports',
    'Soap',
    'General',
];

/** Letters and digits only, so spacing and punctuation cannot split a category. */
const categoryKey = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Spellings the master uses for a category that already has a name here.
 *
 * `detailer` is the odd one: there is no detailing trade in a textile chemicals
 * book, and Retailer is the category the business actually names, so the two
 * rows spelt that way are read as Retailer.
 */
const CATEGORY_ALIASES: Record<string, string> = {
    screenprintor: 'Screen Printing',
    screenprinter: 'Screen Printing',
    onlydtf: 'DTF',
    detailer: 'Retailer',
    nonvoven: 'Nonwoven',
    nonwovens: 'Nonwoven',
    garmenter: 'Garmentor',
    offsetdealer: 'Dealer Offset',
};

const CATEGORY_BY_KEY: Record<string, string> = CUSTOMER_CATEGORIES.reduce(
    (acc, c) => { acc[categoryKey(c)] = c; return acc; },
    {} as Record<string, string>,
);

/**
 * One spelling for a category, whoever typed it.
 *
 * The master holds "OFFSET", "offset" and "Offset" for the same thing; left
 * alone they would be three entries in the filter and three groups in a report.
 * An unrecognised value keeps its own words, title-cased so it reads like the
 * rest of the list.
 */
export function normaliseCategory(raw?: string | null): string {
    const trimmed = (raw || '').trim();
    const key = categoryKey(trimmed);
    if (!key) return '';
    return CATEGORY_BY_KEY[key]
        || CATEGORY_ALIASES[key]
        || trimmed.toLowerCase().replace(/\b[a-z]/g, ch => ch.toUpperCase());
}

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
    category?: string;         // Kind of business — Builder / Dealer / Retailer / the trade. See CUSTOMER_CATEGORIES.
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
    /**
     * When this account last went from owing something to owing nothing.
     *
     * Without it a customer who cleared this morning is indistinguishable from
     * one who cleared two years ago, and the settled list — three thousand rows
     * — is unreadable. Cleared again the moment a balance comes back.
     */
    settledAt?: string;
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

/**
 * What somebody has decided about a cheque — never what the calendar says.
 *
 * `DueToday` used to be offered in the Add Cheque form, and it was chosen for
 * cheques that were genuinely due that morning. It was then stored and never
 * expired, so a cheque dated the 25th was still announcing itself as due on the
 * 29th and the day's presentation total kept adding it in. It is kept here only
 * so a historical row still parses; nothing writes it. Whether a cheque is due
 * is worked out from its date by chequeState(), every time it is read.
 */
export enum PdcStatus {
    Pending = 'Pending',       // In hand, waiting for its date
    Cleared = 'Cleared',       // The bank paid it
    Hold = 'Hold',             // Deliberately not being presented
    Bounced = 'Bounced',       // Returned unpaid
    /** @deprecated Read-only. Treated as Pending everywhere. */
    DueToday = 'DueToday',
}

/** The statuses a person may actually choose, in the order they happen. */
export const PDC_STATUS_CHOICES: { value: PdcStatus; label: string }[] = [
    { value: PdcStatus.Pending, label: 'Pending — waiting for its date' },
    { value: PdcStatus.Hold, label: 'On hold (customer request)' },
    { value: PdcStatus.Cleared, label: 'Cleared' },
    { value: PdcStatus.Bounced, label: 'Bounced / returned' },
];

/** A cheque still with us, whatever a stale stored status claims. */
export const isInHand = (status: PdcStatus): boolean =>
    status === PdcStatus.Pending || status === PdcStatus.DueToday;

/**
 * Where a cheque stands today.
 *
 *   cleared / bounced / hold  — somebody decided; the date no longer matters
 *   due                       — in hand, dated today: present it
 *   overdue                   — in hand, its date has gone: bank it or say why
 *   upcoming                  — in hand, still waiting for its date
 *
 * "overdue" had nowhere to go before this, so a past-dated cheque fell in with
 * the ones still waiting and nothing ever prompted anyone to bank it.
 */
export type ChequeState = 'due' | 'overdue' | 'upcoming' | 'hold' | 'cleared' | 'bounced';

export function chequeState(
    cheque: Pick<PdcCheque, 'status' | 'chequeDate'>,
    today: Date = new Date(),
): ChequeState {
    if (cheque.status === PdcStatus.Cleared) return 'cleared';
    if (cheque.status === PdcStatus.Bounced) return 'bounced';
    if (cheque.status === PdcStatus.Hold) return 'hold';

    const on = new Date(cheque.chequeDate);
    if (isNaN(on.getTime())) return 'upcoming';
    on.setHours(0, 0, 0, 0);
    const t = new Date(today);
    t.setHours(0, 0, 0, 0);

    if (on.getTime() === t.getTime()) return 'due';
    return on.getTime() < t.getTime() ? 'overdue' : 'upcoming';
}

/** A cheque state still counts as money in hand until the bank acts. */
export const CHEQUE_ACTIVE: ChequeState[] = ['due', 'overdue', 'upcoming', 'hold'];

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
 * A customer's payment rank.
 *
 * A rank somebody set by hand always wins — including `Bad`, which is the only
 * way an account becomes one, because being a defaulter is a decision about the
 * customer and not something ageing can tell you. Everything else is worked out
 * from what is owed: nothing overdue is Good, anything overdue is Late.
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

    // Anything past its date is Late, however far past. Old money is shown by
    // the ageing buckets, which say how old far better than a grade can; it is
    // not evidence that a customer has stopped paying.
    if (over90 > 0 || dueOver45 > 0) return 'Late';

    return 'Good';
}


