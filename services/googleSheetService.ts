import { Outstanding, FollowUpStatus, User, BalanceType, PaymentRank, ownerKey, companyKey, scopeTo } from '../types';


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
        if (!companyName) continue;

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

        const crm = ownerKey(r[colMap.crm]);
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
 */
export function financialsFromSheet(sheet: Outstanding) {
    return {
        company: sheet.company,
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
 * Folds a fresh sheet into the book already on file.
 *
 * Two rules matter for the shared database: a matched customer keeps the id it
 * already has, and a customer the sheet no longer lists is kept rather than
 * dropped. Dropping it here would delete the row — and its cheques and history
 * — on the next sync. Removing a customer is a deliberate act, done from the
 * customer list.
 */
export function mergeWithExistingFollowUps(existingRecords: Outstanding[], newRecords: Outstanding[]): Outstanding[] {
    if (!existingRecords || existingRecords.length === 0) {
        return processStatuses(newRecords || []);
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
            return {
                ...existing,
                ...financialsFromSheet(item),
                crmOwnerId: item.crmOwnerId || existing.crmOwnerId,
                // The sheet's contact details fill gaps; they never overwrite
                // what someone has taken the trouble to record.
                contactPerson:
                    existing.contactPerson && existing.contactPerson !== 'Accounts Dept'
                        ? existing.contactPerson
                        : item.contactPerson,
                contactNumber: existing.contactNumber || item.contactNumber,
                email: existing.email || item.email,
            };
        }
        return item;
    });

    // Anything already on file that this sheet does not mention stays put.
    const retained = existingRecords.filter(item => !matchedIds.has(item.id));

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
    | 'creditLimit' | 'paymentTermsDays' | 'rank' | 'notes';

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
        if (!companyName) continue;

        const contactPerson = (colMap.contactPerson >= 0 && colMap.contactPerson < r.length) ? r[colMap.contactPerson]?.trim() : 'Accounts Dept';
        const contactPost = (colMap.contactPost >= 0 && colMap.contactPost < r.length) ? r[colMap.contactPost]?.trim() : '';
        const mobile = (colMap.mobile >= 0 && colMap.mobile < r.length) ? r[colMap.mobile]?.trim() : '';
        const altPhone = (colMap.altPhone >= 0 && colMap.altPhone < r.length) ? r[colMap.altPhone]?.trim() : '';
        const email = (colMap.email >= 0 && colMap.email < r.length) ? r[colMap.email]?.trim() : '';
        const city = (colMap.city >= 0 && colMap.city < r.length) ? r[colMap.city]?.trim() : '';
        const state = (colMap.state >= 0 && colMap.state < r.length) ? r[colMap.state]?.trim() : '';
        const address = (colMap.address >= 0 && colMap.address < r.length) ? r[colMap.address]?.trim() : '';
        const gstin = (colMap.gstin >= 0 && colMap.gstin < r.length) ? r[colMap.gstin]?.trim() : '';
        const crm = ownerKey((colMap.crm >= 0 && colMap.crm < r.length) ? r[colMap.crm] : '');
        const rawLimit = (colMap.creditLimit >= 0 && colMap.creditLimit < r.length) ? r[colMap.creditLimit] : '';
        const creditLimit = rawLimit ? parseFloat(String(rawLimit).replace(/[^0-9.]/g, '')) || undefined : undefined;
        const rawTerms = (colMap.paymentTermsDays >= 0 && colMap.paymentTermsDays < r.length) ? r[colMap.paymentTermsDays] : '';
        const paymentTermsDays = rawTerms ? parseInt(String(rawTerms).replace(/[^0-9]/g, ''), 10) || undefined : undefined;
        const noteStr = (colMap.notes >= 0 && colMap.notes < r.length) ? r[colMap.notes]?.trim() : '';
        const altPerson = (colMap.altPerson >= 0 && colMap.altPerson < r.length) ? r[colMap.altPerson]?.trim() : '';
        const rankRaw = (colMap.rank >= 0 && colMap.rank < r.length) ? r[colMap.rank]?.trim() : '';

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
            additionalContacts: (altPhone || altPerson) ? [{
                id: `alt_${customerIdFor(companyName)}_2`,
                name: altPerson || (contactPerson ? `${contactPerson} (Alt)` : 'Alternate Contact'),
                mobile: altPhone,
                post: 'Second Contact'
            }] : [],
            creationDate: new Date(),
            isNewCustomer: true
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

// Merge Customer Master Data into existing application dataset
export function mergeCustomerMasterIntoAppData(existingData: Outstanding[], masterData: Outstanding[]): { updatedData: Outstanding[]; enrichedCount: number; newAccountsCount: number } {
    const existingMap = new Map<string, Outstanding>();
    existingData.forEach(item => {
        const key = companyKey(item.company);
        existingMap.set(key, item);
    });

    let enrichedCount = 0;
    let newAccountsCount = 0;
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
            const updated: Outstanding = {
                ...current,
                contactPerson: masterItem.contactPerson && masterItem.contactPerson !== 'Accounts Dept' ? masterItem.contactPerson : current.contactPerson,
                contactPost: masterItem.contactPost || current.contactPost,
                contactNumber: masterItem.contactNumber || current.contactNumber,
                email: masterItem.email || current.email,
                city: masterItem.city || current.city,
                state: masterItem.state || current.state,
                address: masterItem.address || current.address,
                gstin: masterItem.gstin || current.gstin,
                creditLimit: masterItem.creditLimit !== undefined ? masterItem.creditLimit : current.creditLimit,
                paymentTermsDays: masterItem.paymentTermsDays !== undefined ? masterItem.paymentTermsDays : current.paymentTermsDays,
                crmOwnerId: masterItem.crmOwnerId || current.crmOwnerId,
                // A grade somebody set in the app is a judgement about the
                // account; the sheet only fills the gap where nobody has.
                paymentRank: current.paymentRank || masterItem.paymentRank,
                additionalContacts: [
                    ...(current.additionalContacts || []),
                    ...(masterItem.additionalContacts || []).filter(mc => 
                        !(current.additionalContacts || []).some(ec => ec.mobile === mc.mobile)
                    )
                ]
            };
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
        newAccountsCount
    };
}

