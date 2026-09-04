import { Outstanding, FollowUpStatus, User, BalanceType, PaymentRank, ownerKey, companyKey, scopeTo, normaliseCategory } from '../types';


// Parse currency strings and identify if they are Debit (DR - Outstanding payment to take) or Credit (CR - Payment excess with us)
export function parseAmountAndType(val: any): { amount: number; type: BalanceType } {
    if (typeof val === 'number') {
        if (isNaN(val)) return { amount: 0, type: 'Dr' };
        return { amount: Math.abs(val), type: val < 0 ? 'Cr' : 'Dr' };
    }
    if (!val) return { amount: 0, type: 'Dr' };

    const s = String(val).trim();
    const upper = s.toUpperCase();

    // Check if contains "Cr", "(...)", or negative sign (Excess / Credit payment with us)
    const isCredit = upper.includes('CR') || (s.startsWith('(') && s.endsWith(')')) || s.startsWith('-');

    const clean = s.replace(/[^0-9.]/g, '');
    const num = parseFloat(clean);

    return {
        amount: isNaN(num) ? 0 : Math.abs(num),
        type: isCredit ? 'Cr' : 'Dr',
    };
}


/**
 * Ways a spreadsheet says "nothing here" that are not blank.
 *
 * `#N/A`, `#REF!` and the rest arrive whenever a formula cannot resolve, and
 * people type the others by hand. Every one of them is a value the sheet is
 * using to mean the absence of a value.
 */
const SHEET_NON_VALUES = new Set(['NA', 'N/A', 'NIL', 'NULL', 'NONE', '-', '--', '.', '0']);

/** True when a cell holds a spreadsheet error or a hand-written "nothing". */
export const isSheetBlank = (value?: string | null): boolean => {
    const v = (value || '').trim().toUpperCase();
    return !v || v.startsWith('#') || SHEET_NON_VALUES.has(v);
};

/**
 * A CRM code read from a sheet, or '' when the cell does not hold one.
 *
 * The outstanding sheet does not have the CRM typed into it — the column looks
 * the name up from the Customer Master. So a customer who is not in the master
 * reaches us as "#N/A", and a broken formula as "#REF!". Taken at face value
 * those became CRM codes: accounts filed under an owner called "#N/A", counted
 * on the CRM performance table as though "#N/A" were a colleague, and reachable
 * by nobody. Read as blank, they leave the account unassigned — which is what
 * the sheet is actually saying — and the next sync can still fill it in.
 */
export const crmFromSheet = (value?: string | null): string =>
    isSheetBlank(value) ? '' : ownerKey(value);

// Clean CSV parser for handling quotes and comma delimiters
export function parseCSVMatrix(text: string): string[][] {
    const matrix: string[][] = [[]];
    let row = matrix[0];
    let str = '';
    let inQuote = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];

        if (c === '"' && inQuote && next === '"') {
            str += '"';
            i++;
        } else if (c === '"') {
            inQuote = !inQuote;
        } else if (c === ',' && !inQuote) {
            row.push(str);
            str = '';
        } else if ((c === '\r' || c === '\n') && !inQuote) {
            if (c === '\r' && next === '\n') i++;
            row.push(str);
            str = '';
            row = [];
            matrix.push(row);
        } else {
            str += c;
        }
    }
    if (str || row.length > 0) {
        row.push(str);
    }
    return matrix.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

// Parse Google Sheet rows into structured Outstanding records and extract L1 date
export function parseGoogleSheetCsv(csvText: string): { data: Outstanding[]; records: Outstanding[]; updatedTillDate: string } {
    const rows = parseCSVMatrix(csvText);
    if (rows.length === 0) {
        throw new Error('Spreadsheet data is empty.');
    }

    const headers = rows[0].map(h => h.trim());
    
    // Column L (index 11) carries the date the sheet's figures run to. It has to
    // look like a date before we print it under the dashboard title — taking
    // cell L1 on faith puts whatever a column happens to be called, or last
    // month's leftover text, up there as "Book as of".
    const datePattern = /\d{1,2}-[A-Za-z]{3}-\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}/;
    const updatedTillDate =
        (headers.length > 11 && datePattern.test(headers[11] || '') ? headers[11] : '') ||
        headers.find(h => datePattern.test(h)) ||
        '';

    // Column mapping detection
    const colMap = {
        company: 0,
        total: 1,
        a1_45: 2,
        a46_90: 3,
        a91_135: 4,
        aOver135: 5,
        over90: 6,
        dueOver45: 7,
        crm: 8,
        contactPerson: -1,
        mobile: 9,
        email: 10
    };

    // Header-based override if standard names exist
    headers.forEach((h, idx) => {
        const lower = h.toLowerCase();
        if (lower.includes('company') || lower.includes('party name') || lower.includes('customer name')) colMap.company = idx;
        else if (lower === 'total' || lower.includes('total due')) colMap.total = idx;
        else if (lower.includes('1-45')) colMap.a1_45 = idx;
        else if (lower.includes('46-90')) colMap.a46_90 = idx;
        else if (lower.includes('91-135')) colMap.a91_135 = idx;
        else if (lower.includes('>135') || lower.includes('135+')) colMap.aOver135 = idx;
        else if (lower.includes('>90') || lower.includes('90+')) colMap.over90 = idx;
        else if (lower.includes('due >45') || lower.includes('>45')) colMap.dueOver45 = idx;
        else if (lower.includes('contact person') || lower.includes('contact name') || lower.includes('person')) colMap.contactPerson = idx;
        else if (lower.includes('crm')) colMap.crm = idx;
        else if (lower.includes('mobile') || lower.includes('contact number') || lower.includes('phone')) colMap.mobile = idx;
        else if (lower.includes('email')) colMap.email = idx;
    });

    const parsedData: Outstanding[] = [];

    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const companyName = r[colMap.company]?.trim();
        // A row whose name is "#N/A" is a broken lookup, not a customer.
        if (!companyName || isSheetBlank(companyName)) continue;

        const totalParsed = parseAmountAndType(r[colMap.total]);
        const a1Parsed = parseAmountAndType(r[colMap.a1_45]);
        const a2Parsed = parseAmountAndType(r[colMap.a46_90]);
        const a3Parsed = parseAmountAndType(r[colMap.a91_135]);
        const a4Parsed = parseAmountAndType(r[colMap.aOver135]);

        const over90Parsed = colMap.over90 < r.length && r[colMap.over90] !== '' && r[colMap.over90] !== undefined
            ? parseAmountAndType(r[colMap.over90])
            : { amount: a3Parsed.amount + a4Parsed.amount, type: (a3Parsed.type === 'Cr' && a4Parsed.type === 'Cr' ? 'Cr' : 'Dr') as BalanceType };

        const due45Parsed = colMap.dueOver45 < r.length && r[colMap.dueOver45] !== '' && r[colMap.dueOver45] !== undefined
            ? parseAmountAndType(r[colMap.dueOver45])
            : { amount: a2Parsed.amount + over90Parsed.amount, type: 'Dr' as BalanceType };

        const crm = crmFromSheet(r[colMap.crm]);
        const explicitContact = (colMap.contactPerson >= 0 && colMap.contactPerson < r.length) ? r[colMap.contactPerson]?.trim() : '';
        const mobile = r[colMap.mobile] ? r[colMap.mobile].trim() : '';
        const email = r[colMap.email] ? r[colMap.email].trim() : '';

        const item: Outstanding = {
            id: customerIdFor(companyName),
            company: companyName,
            contactPerson: explicitContact || 'Accounts Dept',
            contactNumber: mobile,
            email: email,
            total: totalParsed.amount,
            totalType: totalParsed.type,
            ageing: {
                '1-45': a1Parsed.amount,
                '46-90': a2Parsed.amount,
                '91-135': a3Parsed.amount,
                '>135': a4Parsed.amount
            },
            ageingTypes: {
                '1-45': a1Parsed.type,
                '46-90': a2Parsed.type,
                '91-135': a3Parsed.type,
                '>135': a4Parsed.type
            },
            over90: over90Parsed.amount,
            over90Type: over90Parsed.type,
            dueOver45: due45Parsed.amount,
            dueOver45Type: due45Parsed.type,
            crmOwnerId: crm,
            assignedCollectorId: undefined,
            followUpDate: undefined,
            status: FollowUpStatus.Pending,
            notes: [],
            isUrgent: (due45Parsed.type === 'Dr' && due45Parsed.amount > 1000000) || (a4Parsed.type === 'Dr' && a4Parsed.amount > 500000),
            creationDate: new Date(),
            lastFollowUpOn: undefined
        };

        parsedData.push(item);
    }

    return { records: parsedData, data: parsedData, updatedTillDate };
}

// Merge fresh sheet data with existing locally tracked follow-ups, notes, and collector assignments
/**
 * Deterministic customer id, derived from the company name.
 *
 * The old ids carried the sheet's row number, so re-ordering the sheet gave the
 * same customer a new id — which, against a database, means deleting the row
 * and inserting a copy, taking its PDC cheques with it (they cascade). Same
 * company, same id, every import, in every browser.
 */
export function customerIdFor(company: string): string {
    // Same key the merge matches on, so "HARI OM TRADERS" and "HARIOM TRADERS"
    // cannot mint two ids for one firm even if the merge is ever bypassed.
    return `cust_${companyKey(company).slice(0, 60) || 'unnamed'}`;
}

/**
 * The columns an invoice sheet is the authority on. Everything else — contacts,
 * master data, follow-ups, notes, expected collections — belongs to the app and
 * survives an import untouched.
 *
 * The company **name** is not in this list. It is customer data, and customer
 * data is the app's: a name corrected here was being overwritten by the sheet's
 * spelling on the next sync, which is the same complaint that was made about
 * CRM owners. Matching does not depend on it either — accounts are matched on a
 * normalised key or on the id, both of which survive a rename.
 */
export function financialsFromSheet(sheet: Outstanding) {
    return {
        total: sheet.total,
        totalType: sheet.totalType,
        ageing: sheet.ageing,
        ageingTypes: sheet.ageingTypes,
        over90: sheet.over90,
        over90Type: sheet.over90Type,
        dueOver45: sheet.dueOver45,
        dueOver45Type: sheet.dueOver45Type,
    };
}

/**
 * What an account's figures become when the outstanding sheet stops listing it.
 *
 * The outstanding sheet is the whole of what is owed. A customer who drops off
 * it has cleared their balance — so the record stays (with its contacts,
 * cheques and history) but the money goes to nil. Leaving the last known figure
 * in place is what had the app still chasing accounts, and still counting them
 * in every CRM's total, after the accounts team had taken them off the sheet.
 *
 * Urgency is a reading of those figures, so it is cleared with them.
 */
export function clearedFinancials() {
    return {
        total: 0,
        totalType: 'Dr' as BalanceType,
        ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 },
        ageingTypes: {},
        over90: 0,
        over90Type: 'Dr' as BalanceType,
        dueOver45: 0,
        dueOver45Type: 'Dr' as BalanceType,
        isUrgent: false,
    };
}

/** True when this row still carries a balance the sheet no longer accounts for. */
export const needsClearing = (item: Outstanding): boolean =>
    Math.abs(Number(item.total) || 0) > 0;

/** Settles every account handed to it; summariseUnlisted() counts them first. */
export function settleUnlisted(rows: Outstanding[]): Outstanding[] {
    return rows.map(item => (needsClearing(item) ? { ...item, ...clearedFinancials() } : item));
}

/**
 * What a sync is about to settle: the accounts on file that the incoming sheet
 * does not list, and still carry a balance. Counted before the merge so the
 * sync can say what it did instead of quietly writing off money.
 */
export function summariseUnlisted(existingRecords: Outstanding[], incomingRecords: Outstanding[]): { count: number; amount: number } {
    if (!existingRecords?.length || !incomingRecords?.length) return { count: 0, amount: 0 };
    const incomingKeys = new Set(incomingRecords.map(i => companyKey(i.company)));
    const clearing = existingRecords.filter(e => !incomingKeys.has(companyKey(e.company)) && needsClearing(e));
    return {
        count: clearing.length,
        amount: clearing.reduce((sum, e) => sum + Math.abs(Number(e.total) || 0), 0),
    };
}

/**
 * How many names in the incoming sheet the customer list has never seen.
 *
 * They will be added with no owner, so the sync can say how many accounts are
 * about to need one instead of leaving them to be noticed.
 */
export function countNewNames(existingRecords: Outstanding[], incomingRecords: Outstanding[]): number {
    if (!incomingRecords?.length) return 0;
    const known = new Set((existingRecords || []).map(e => companyKey(e.company)));
    return incomingRecords.filter(i => !known.has(companyKey(i.company))).length;
}

/**
 * A row the customer list has never seen, turned into a customer.
 *
 * The owner is dropped whatever the sheet said. Used for every account an
 * outstanding import creates — including the very first import into an empty
 * book, which otherwise took its owners from the sheet and left the rule true
 * in every case but one.
 *
 * `isNewCustomer` is deliberately NOT set. It does not mean "recently arrived";
 * it means "created here rather than read from a sheet", and it is what the
 * customer list's Created / Sheet Synced filter runs on. Setting it here would
 * file every account the sheet brought in under "Created" and hide it from
 * "Sheet Synced". What marks these accounts as needing attention is that they
 * have no owner, which the unassigned queue already shows.
 */
const asNewCustomer = (item: Outstanding): Outstanding => ({
    ...item,
    crmOwnerId: '',
    isNewCustomer: false,
    addedAt: item.addedAt || new Date().toISOString(),
});

/**
 * Folds a fresh sheet into the book already on file.
 *
 * **The outstanding sheet changes money and nothing else.** It is the ledger of
 * what is owed; the customer — who they are, who to ring, who owns them — lives
 * in the app. So a matched account takes its figures from the sheet and keeps
 * everything else it has, including its owner and its contact details.
 *
 * Two more rules matter against a shared database:
 *
 *  - A matched customer keeps the id it already has. Old ids carried the
 *    sheet's row number, so re-ordering the sheet gave one customer a new id —
 *    against a database that means deleting the row and inserting a copy,
 *    taking its cheques with it.
 *  - A customer the sheet no longer lists is kept, and settled to nil. Dropping
 *    it would delete the row and its history on the next sync; removing a
 *    customer is a deliberate act, done from the customer list.
 *
 * A name the sheet carries that the app has never seen becomes a new customer
 * with **no owner**, waiting in the unassigned queue. The money is never left
 * out of the book, and the sheet still does not get to say whose account it is.
 */

export function mergeWithExistingFollowUps(existingRecords: Outstanding[], newRecords: Outstanding[]): Outstanding[] {
    if (!existingRecords || existingRecords.length === 0) {
        return processStatuses((newRecords || []).map(asNewCustomer));
    }
    if (!newRecords || newRecords.length === 0) {
        return processStatuses(existingRecords || []);
    }

    const existingMap = new Map<string, Outstanding>();
    existingRecords.forEach(item => {
        // Match by company name (normalized) or id
        const key = companyKey(item.company);
        existingMap.set(key, item);
        existingMap.set(item.id, item);
    });

    const matchedIds = new Set<string>();
    const merged = newRecords.map(item => {
        const key = companyKey(item.company);
        const existing = existingMap.get(key) || existingMap.get(item.id);

        if (existing) {
            matchedIds.add(existing.id);
            // Figures from the sheet; the customer is the app's. The owner is
            // still passed through crmFromSheet() so a "#N/A" stored by an
            // older import — when a failed lookup was read as a name — clears
            // itself and the account surfaces in the unassigned queue.
            return {
                ...existing,
                ...financialsFromSheet(item),
                crmOwnerId: crmFromSheet(existing.crmOwnerId),
            };
        }

        // A name the app has never seen. Seed it from the row — that is all we
        // know about them — but leave the owner blank: who chases an account is
        // decided in the app, never in the sheet.
        return asNewCustomer(item);
    });

    // Anything already on file that this sheet does not mention stays put, with
    // nothing left owing against it.
    const retained = settleUnlisted(existingRecords.filter(item => !matchedIds.has(item.id)));

    return processStatuses([...merged, ...retained]);
}

// Function to simulate checking and updating status based on date
export const processStatuses = (data: Outstanding[]): Outstanding[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return data.map(item => {
        const itemCopy = { ...item };
        if (itemCopy.followUpDate) {
            itemCopy.followUpDate = new Date(itemCopy.followUpDate);
        }
        if (itemCopy.forecastDate) {
            itemCopy.forecastDate = new Date(itemCopy.forecastDate);
        }

        if (itemCopy.status === FollowUpStatus.Completed) return itemCopy;

        if (itemCopy.followUpDate && !isNaN(itemCopy.followUpDate.getTime())) {
            const followUpDate = new Date(itemCopy.followUpDate);
            followUpDate.setHours(0, 0, 0, 0);

            if (followUpDate.getTime() < today.getTime()) {
                return { ...itemCopy, status: FollowUpStatus.Overdue };
            }
            if (followUpDate.getTime() === today.getTime()) {
                return { ...itemCopy, status: FollowUpStatus.Today };
            }
            return { ...itemCopy, status: FollowUpStatus.Upcoming };
        }
        return { ...itemCopy, status: FollowUpStatus.Pending };
    });
};

/**
 * The slice of the book one person is responsible for.
 *
 * Responsibility runs two ways and either one is enough to see the account: the
 * CRM who owns it, and the collector it has been handed to. Scoping on only one
 * of them is how an account assigned to somebody disappears from their screen —
 * the CRM hands it over and it vanishes for a colleague whose role happens not
 * to be Collector, or the other way round.
 */
export const getOutstandingForUser = (user: User, allData: Outstanding[]): Promise<Outstanding[]> =>
    Promise.resolve(processStatuses(scopeTo(user, allData)));


// Helper to fetch Google Sheet data reliably using backend proxy or direct fallback
export async function fetchGoogleSheetData(sheetUrl: string): Promise<{ data: Outstanding[]; records: Outstanding[]; updatedTillDate: string }> {
    const trimmed = (sheetUrl || '').trim();
    if (!trimmed) {
        throw new Error('Please provide a Google Sheet URL.');
    }

    let csvContent: string | null = null;
    let fetchError: Error | null = null;

    // Strategy 1: Server-side proxy (No CORS restrictions)
    try {
        const res = await fetch('/api/fetch-sheet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: trimmed }),
        });

        if (res.ok) {
            const result = await res.json();
            if (result.ok && result.csv) {
                csvContent = result.csv;
            } else if (result.error) {
                fetchError = new Error(result.error);
            }
        }
    } catch (e: any) {
        console.warn('Backend proxy fetch failed, attempting client-side fallback:', e);
    }

    if (!csvContent) {
        throw fetchError || new Error(
            'Could not read that sheet. Share it as "Anyone with the link can view", or File > Share > Publish to web.'
        );
    }

    return parseGoogleSheetCsv(csvContent);
}


// Parse Customer Master Data CSV
/**
 * Which column of the Customer Master is which.
 *
 * The old matcher was one long if/else chain, so a header containing a generic
 * word was claimed by the generic rule and never tested against anything more
 * specific. Against the real sheet that lost two columns of live data outright:
 *
 *   "SALESPERSON name"     contains "person", so it was taken for the customer's
 *                          contact, found that slot already filled, and was
 *                          dropped — leaving every imported account with no
 *                          owner, which is why 3,262 of them ended up on one
 *                          person's name.
 *   "Customer Emails Id"   contains "customer", so it was taken for the company
 *                          name, found that slot filled, and was dropped. The
 *                          plain "sales email" column matched the email rule
 *                          instead, and every customer in the book was given a
 *                          Shori staff address as their own.
 *
 * So: rules are ordered most specific first, each header is claimed by at most
 * one field, and each field takes the first header that claims it. A header
 * whose field is already taken falls to its natural second slot, which is how a
 * sheet with two "CONTACT PERSON" columns keeps both.
 */
export type MasterField =
    | 'company' | 'contactPerson' | 'contactPost' | 'mobile' | 'altPhone' | 'altPerson'
    | 'email' | 'city' | 'state' | 'address' | 'gstin' | 'crm'
    | 'creditLimit' | 'paymentTermsDays' | 'rank' | 'category' | 'notes';

const headerKey = (h: string): string => (h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** `null` means "recognised, and deliberately not imported". */
const HEADER_RULES: { field: MasterField | null; any: string[] }[] = [
    // Our own staff, wearing a customer field's name. Must be first.
    { field: null, any: ['salesemail', 'staffemail', 'ouremail', 'companyemail'] },

    // Who owns the account. Before anything matching "person".
    { field: 'crm', any: ['salesperson', 'salesman', 'salesexecutive', 'salesname', 'crm', 'accountowner', 'executive', 'owner'] },

    // A second contact pair, before the plain contact/mobile rules claim them.
    { field: 'altPerson', any: ['contactperson2', 'person2', 'contact2', 'altcontact', 'secondarycontact'] },
    { field: 'altPhone', any: ['mobile2', 'phone2', 'altmobile', 'altphone', 'alternate', 'secondary'] },

    // The customer's own address, now that ours has been excluded above.
    { field: 'email', any: ['email', 'mail'] },

    // "Ranking" is the grade the business keeps by hand. "Payment status" holds
    // payment mode (cash / advance / A / B / C), which is not a grade, so it is
    // left out rather than mapped to something it does not mean.
    { field: 'rank', any: ['ranking', 'creditrating'] },

    // What kind of business the account is. Named narrowly on purpose: the same
    // sheet has a "Customer types" column holding DEBTOR for every row, which
    // is a ledger side rather than a category, so 'customertype' is not a name
    // this rule answers to.
    { field: 'category', any: ['category', 'segment', 'businesstype'] },

    { field: 'creditLimit', any: ['creditlimit', 'limitamount', 'sanctionedlimit'] },
    { field: 'paymentTermsDays', any: ['creditday', 'creditperiod', 'paymentterm', 'term'] },
    { field: 'gstin', any: ['gstin', 'gstno', 'gst', 'taxid'] },
    { field: 'contactPost', any: ['designation', 'post', 'role', 'position'] },
    { field: 'mobile', any: ['mobile', 'phone', 'contactno', 'contactnumber', 'tel'] },
    { field: 'address', any: ['address', 'street'] },
    { field: 'city', any: ['city', 'district', 'location', 'town'] },
    { field: 'state', any: ['state', 'province'] },
    { field: 'notes', any: ['note', 'remark', 'comment'] },
    { field: 'contactPerson', any: ['contactperson', 'contactname', 'person', 'contact'] },

    // Last: the name of the account itself, the most generic thing on the sheet.
    { field: 'company', any: ['partyname', 'companyname', 'customername', 'clientname', 'firmname', 'company', 'party', 'client', 'customer'] },
];

/** A duplicate header falls to the natural second slot rather than being lost. */
const SECOND_CHOICE: Partial<Record<MasterField, MasterField>> = {
    contactPerson: 'altPerson',
    mobile: 'altPhone',
};

export function mapMasterColumns(headers: string[]): Record<MasterField, number> {
    const map = {} as Record<MasterField, number>;
    for (const rule of HEADER_RULES) if (rule.field) map[rule.field] = -1;
    map.altPerson = -1;

    headers.forEach((raw, idx) => {
        const key = headerKey(raw);
        if (!key) return;
        const rule = HEADER_RULES.find(r => r.any.some(n => key.includes(n)));
        if (!rule || !rule.field) return;

        const field = map[rule.field] === -1 ? rule.field : SECOND_CHOICE[rule.field];
        if (field && map[field] === -1) map[field] = idx;
    });

    // Without a recognisable name column the first one is the only sensible guess.
    if (map.company === -1) map.company = 0;
    return map;
}

/**
 * The grades the sheet uses, translated into the three the app works in.
 *
 * Only an unambiguous "bad debt" is carried across. "Active", "Inactive" and
 * "Dead" describe whether we still sell to them, not how they pay, and reading
 * them as a payment grade would put quiet customers on the recovery agency's
 * list.
 */
export function rankFromSheet(value?: string): PaymentRank | undefined {
    const v = (value || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!v) return undefined;
    if (v.includes('baddebt') || v.includes('defaulter') || v.includes('writeoff')) return 'Bad';
    if (v.includes('latepay') || v.includes('slowpay')) return 'Late';
    if (v === 'good' || v.includes('goodpay') || v.includes('prompt')) return 'Good';
    return undefined;
}

export function parseCustomerMasterSheetCsv(csvText: string): { records: Outstanding[]; count: number } {
    const rows = parseCSVMatrix(csvText);
    if (rows.length === 0) {
        throw new Error('Customer Master Sheet is empty.');
    }

    const headers = rows[0].map(h => h.trim());
    
    const colMap = mapMasterColumns(headers);

    const parsed: Outstanding[] = [];

    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const companyName = (colMap.company >= 0 && colMap.company < r.length) ? r[colMap.company]?.trim() : '';
        if (!companyName || isSheetBlank(companyName)) continue;

        const contactPerson = (colMap.contactPerson >= 0 && colMap.contactPerson < r.length) ? r[colMap.contactPerson]?.trim() : 'Accounts Dept';
        const contactPost = (colMap.contactPost >= 0 && colMap.contactPost < r.length) ? r[colMap.contactPost]?.trim() : '';
        const mobile = (colMap.mobile >= 0 && colMap.mobile < r.length) ? r[colMap.mobile]?.trim() : '';
        const altPhone = (colMap.altPhone >= 0 && colMap.altPhone < r.length) ? r[colMap.altPhone]?.trim() : '';
        const email = (colMap.email >= 0 && colMap.email < r.length) ? r[colMap.email]?.trim() : '';
        const city = (colMap.city >= 0 && colMap.city < r.length) ? r[colMap.city]?.trim() : '';
        const state = (colMap.state >= 0 && colMap.state < r.length) ? r[colMap.state]?.trim() : '';
        const address = (colMap.address >= 0 && colMap.address < r.length) ? r[colMap.address]?.trim() : '';
        const gstin = (colMap.gstin >= 0 && colMap.gstin < r.length) ? r[colMap.gstin]?.trim() : '';
        const crm = crmFromSheet((colMap.crm >= 0 && colMap.crm < r.length) ? r[colMap.crm] : '');
        const rawLimit = (colMap.creditLimit >= 0 && colMap.creditLimit < r.length) ? r[colMap.creditLimit] : '';
        const creditLimit = rawLimit ? parseFloat(String(rawLimit).replace(/[^0-9.]/g, '')) || undefined : undefined;
        const rawTerms = (colMap.paymentTermsDays >= 0 && colMap.paymentTermsDays < r.length) ? r[colMap.paymentTermsDays] : '';
        const paymentTermsDays = rawTerms ? parseInt(String(rawTerms).replace(/[^0-9]/g, ''), 10) || undefined : undefined;
        const noteStr = (colMap.notes >= 0 && colMap.notes < r.length) ? r[colMap.notes]?.trim() : '';
        const altPerson = (colMap.altPerson >= 0 && colMap.altPerson < r.length) ? r[colMap.altPerson]?.trim() : '';
        const rankRaw = (colMap.rank >= 0 && colMap.rank < r.length) ? r[colMap.rank]?.trim() : '';
        const categoryRaw = (colMap.category >= 0 && colMap.category < r.length) ? r[colMap.category]?.trim() : '';

        const item: Outstanding = {
            id: customerIdFor(companyName),
            company: companyName,
            contactPerson: contactPerson || 'Accounts Dept',
            contactNumber: mobile,
            contactPost: contactPost,
            email: email,
            city: city,
            state: state,
            address: address,
            gstin: gstin,
            creditLimit: creditLimit,
            paymentTermsDays: paymentTermsDays,
            crmOwnerId: crm || '',
            total: 0,
            totalType: 'Dr',
            ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 },
            over90: 0,
            dueOver45: 0,
            status: FollowUpStatus.Pending,
            notes: noteStr ? [noteStr] : [],
            paymentRank: rankFromSheet(rankRaw),
            // "#N/A" and "0" are the sheet saying nothing, not a category.
            category: isSheetBlank(categoryRaw) ? undefined : (normaliseCategory(categoryRaw) || undefined),
            additionalContacts: (altPhone || altPerson) ? [{
                id: `alt_${customerIdFor(companyName)}_2`,
                name: altPerson || (contactPerson ? `${contactPerson} (Alt)` : 'Alternate Contact'),
                mobile: altPhone,
                post: 'Second Contact'
            }] : [],
            creationDate: new Date(),
            // Read from a sheet, so not "created here" — see asNewCustomer().
            isNewCustomer: false
        };

        parsed.push(item);
    }

    return { records: parsed, count: parsed.length };
}

// Fetch Customer Master Sheet data via backend proxy or direct
export async function fetchCustomerMasterSheetData(sheetUrl: string): Promise<{ records: Outstanding[]; count: number }> {
    const trimmed = (sheetUrl || '').trim();
    if (!trimmed) {
        throw new Error('Please enter a valid Customer Master Google Sheet URL.');
    }

    let csvContent: string | null = null;
    let fetchError: Error | null = null;

    // Strategy 1: Server-side proxy
    try {
        const res = await fetch('/api/fetch-sheet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: trimmed }),
        });

        if (res.ok) {
            const result = await res.json();
            if (result.ok && result.csv) {
                csvContent = result.csv;
            } else if (result.error) {
                fetchError = new Error(result.error);
            }
        }
    } catch (e: any) {
        console.warn('Backend proxy fetch failed for Master sheet, attempting client-side fallback:', e);
    }

    if (!csvContent) {
        throw fetchError || new Error(
            'Could not read the customer master sheet. Share it as "Anyone with the link can view", or publish it to the web.'
        );
    }

    return parseCustomerMasterSheetCsv(csvContent);
}

/** An account whose owner in the app no longer matches the one in the sheet. */
export interface CrmConflict {
    company: string;
    appCrm: string;
    sheetCrm: string;
}

/**
 * The one-time customer import.
 *
 * This is a **seeding** step, not a sync. The customer database lives in the
 * app: names, contacts, addresses, GSTINs, credit terms and ownership are
 * maintained there, and new customers are added there. This exists to load a
 * spreadsheet of customers into an empty book, and to bulk-add later if one
 * ever needs loading again.
 *
 * So it never overwrites. Every field fills a blank or is left alone, which
 * means running it twice cannot undo a correction somebody typed. It used to
 * work the other way round — the sheet overwrote contacts, addresses, limits
 * and terms on every run — which is why a phone number fixed during a call came
 * back wrong the next morning.
 *
 * Where the sheet's CRM column disagrees with the app's, the app wins and the
 * disagreement is reported, so the sheet can be brought in line rather than
 * silently fighting the app.
 */
export function mergeCustomerMasterIntoAppData(existingData: Outstanding[], masterData: Outstanding[]): { updatedData: Outstanding[]; enrichedCount: number; newAccountsCount: number; categorisedCount: number; crmConflicts: CrmConflict[] } {
    const existingMap = new Map<string, Outstanding>();
    existingData.forEach(item => {
        const key = companyKey(item.company);
        existingMap.set(key, item);
    });

    let enrichedCount = 0;
    let newAccountsCount = 0;
    // Accounts that had no category and now have one. Worth counting on its
    // own: it is the whole point of re-running the import after the category
    // column was added, and without it the run reports "0 new, 4018 already on
    // file" and looks like it did nothing.
    let categorisedCount = 0;
    const crmConflicts: CrmConflict[] = [];
    const mergedList: Outstanding[] = [...existingData];

    // Index once. Scanning the list per master row is quadratic, and with a few
    // thousand accounts on each side that locks the tab for seconds.
    const indexByCompany = new Map<string, number>();
    mergedList.forEach((item, idx) => indexByCompany.set(companyKey(item.company), idx));

    masterData.forEach(masterItem => {
        const key = companyKey(masterItem.company);
        const existingIdx = indexByCompany.has(key) ? indexByCompany.get(key)! : -1;

        if (existingIdx >= 0) {
            // Enrich existing customer
            const current = mergedList[existingIdx];
            if (
                crmFromSheet(masterItem.crmOwnerId) &&
                crmFromSheet(current.crmOwnerId) &&
                ownerKey(masterItem.crmOwnerId) !== ownerKey(current.crmOwnerId)
            ) {
                crmConflicts.push({
                    company: current.company,
                    appCrm: current.crmOwnerId,
                    sheetCrm: masterItem.crmOwnerId,
                });
            }
            // Every line reads app-first: the import fills what is missing and
            // touches nothing else. 'Accounts Dept' is the placeholder the
            // parsers write when a row has no name, so it counts as missing.
            const named = current.contactPerson && current.contactPerson !== 'Accounts Dept';
            const updated: Outstanding = {
                ...current,
                contactPerson: named ? current.contactPerson : (masterItem.contactPerson || current.contactPerson),
                contactPost: current.contactPost || masterItem.contactPost,
                contactNumber: current.contactNumber || masterItem.contactNumber,
                email: current.email || masterItem.email,
                city: current.city || masterItem.city,
                state: current.state || masterItem.state,
                address: current.address || masterItem.address,
                gstin: current.gstin || masterItem.gstin,
                creditLimit: current.creditLimit !== undefined ? current.creditLimit : masterItem.creditLimit,
                paymentTermsDays: current.paymentTermsDays !== undefined ? current.paymentTermsDays : masterItem.paymentTermsDays,
                // Whoever the app says owns the account keeps it. On a first
                // import nothing is set yet, so the sheet's column seeds it —
                // and a stored "#N/A" from an earlier import is blank, not an
                // owner.
                crmOwnerId: crmFromSheet(current.crmOwnerId) || masterItem.crmOwnerId,
                // A grade somebody set in the app is a judgement about the
                // account; the sheet only fills the gap where nobody has.
                paymentRank: current.paymentRank || masterItem.paymentRank,
                // Same rule: a category set here is somebody's decision about
                // the account, and the sheet only fills the gap where there
                // isn't one.
                category: current.category || masterItem.category,
                additionalContacts: [
                    ...(current.additionalContacts || []),
                    ...(masterItem.additionalContacts || []).filter(mc => 
                        !(current.additionalContacts || []).some(ec => ec.mobile === mc.mobile)
                    )
                ]
            };
            if (!current.category && updated.category) categorisedCount++;
            mergedList[existingIdx] = updated;
            enrichedCount++;
        } else {
            // Add new master account
            indexByCompany.set(key, mergedList.length);
            mergedList.push(masterItem);
            newAccountsCount++;
        }
    });

    return {
        updatedData: processStatuses(mergedList),
        enrichedCount,
        newAccountsCount,
        categorisedCount,
        crmConflicts
    };
}

