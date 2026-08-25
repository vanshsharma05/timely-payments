import { Outstanding, FollowUpStatus, User, UserRole, DataVisibility, BalanceType, DEFAULT_ROLE_PERMISSIONS } from '../types';

// Updated user list with the real team members from the Google Sheet
export const USERS: User[] = [
    { id: 'Admin', name: 'Admin', role: UserRole.Admin, password: 'admin', dataVisibility: DataVisibility.All, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.Admin] },
    { id: 'ANKUR', name: 'Ankur', role: UserRole.CRM, password: 'password123', dataVisibility: DataVisibility.AssignedOnly, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.CRM], assignedCrms: ['ANKUR'] },
    { id: 'PRIKSHIT', name: 'Prikshit', role: UserRole.CRM, password: 'password123', dataVisibility: DataVisibility.AssignedOnly, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.CRM], assignedCrms: ['PRIKSHIT'] },
    { id: 'VISHNU', name: 'Vishnu', role: UserRole.CRM, password: 'password123', dataVisibility: DataVisibility.AssignedOnly, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.CRM], assignedCrms: ['VISHNU'] },
    { id: 'POONAM', name: 'Poonam', role: UserRole.CRM, password: 'password123', dataVisibility: DataVisibility.AssignedOnly, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.CRM], assignedCrms: ['POONAM'] },
    { id: 'SANDEEP', name: 'Sandeep', role: UserRole.CRM, password: 'password123', dataVisibility: DataVisibility.AssignedOnly, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.CRM], assignedCrms: ['SANDEEP'] },
    { id: 'KAPIL', name: 'Kapil', role: UserRole.CRM, password: 'password123', dataVisibility: DataVisibility.AssignedOnly, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.CRM], assignedCrms: ['KAPIL'] },
    { id: 'SAVIA', name: 'Savia', role: UserRole.CRM, password: 'password123', dataVisibility: DataVisibility.AssignedOnly, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.CRM], assignedCrms: ['SAVIA'] },
    { id: 'ROHINI', name: 'Rohini', role: UserRole.CRM, password: 'password123', dataVisibility: DataVisibility.AssignedOnly, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.CRM], assignedCrms: ['ROHINI'] },
    { id: 'GARRY', name: 'Garry', role: UserRole.CRM, password: 'password123', dataVisibility: DataVisibility.AssignedOnly, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.CRM], assignedCrms: ['GARRY'] },
    { id: 'Amit Kumar', name: 'Amit Kumar', role: UserRole.Collector, password: 'password123', dataVisibility: DataVisibility.AssignedOnly, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.Collector] },
    { id: 'Sunita Devi', name: 'Sunita Devi', role: UserRole.Collector, password: 'password123', dataVisibility: DataVisibility.AssignedOnly, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.Collector] },
];

export const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRJrKqb_XsMoNYlAzO8NYkhbmZC7Z5RID9W9YFAuh6wzi8gnTIPCXj2LMllgpm78MDmOo7D6zdF0bOc/pubhtml?gid=895778621&single=true';

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

// Backward-compatible amount parser returning absolute number
export function parseAmount(val: any): number {
    return parseAmountAndType(val).amount;
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
    
    // Column L (index 11) contains the date till which the sheet is updated
    let updatedTillDate = '';
    if (headers.length > 11 && headers[11]) {
        updatedTillDate = headers[11];
    } else {
        // Look for any date header or fallback to cell L1 / today
        const datePattern = /\d{1,2}-[A-Za-z]{3}-\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}/;
        const found = headers.find(h => datePattern.test(h));
        if (found) {
            updatedTillDate = found;
        }
    }

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

        const crm = r[colMap.crm] ? r[colMap.crm].trim() : '';
        const explicitContact = (colMap.contactPerson >= 0 && colMap.contactPerson < r.length) ? r[colMap.contactPerson]?.trim() : '';
        const mobile = r[colMap.mobile] ? r[colMap.mobile].trim() : '';
        const email = r[colMap.email] ? r[colMap.email].trim() : '';

        const item: Outstanding = {
            id: `out_${i}_${encodeURIComponent(companyName.slice(0, 15).replace(/\s+/g, '_'))}`,
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
        const key = item.company.trim().toLowerCase();
        existingMap.set(key, item);
        existingMap.set(item.id, item);
    });

    const merged = newRecords.map(item => {
        const key = item.company.trim().toLowerCase();
        const existing = existingMap.get(key) || existingMap.get(item.id);

        if (existing) {
            return {
                ...item,
                assignedCollectorId: existing.assignedCollectorId || item.assignedCollectorId,
                followUpDate: existing.followUpDate,
                forecastAmount: existing.forecastAmount !== undefined ? existing.forecastAmount : item.forecastAmount,
                forecastDate: existing.forecastDate || existing.followUpDate,
                status: existing.status || item.status,
                notes: existing.notes && existing.notes.length > 0 ? existing.notes : item.notes,
                isUrgent: existing.isUrgent !== undefined ? existing.isUrgent : item.isUrgent,
                lastFollowUpOn: existing.lastFollowUpOn,
                contactPerson: existing.contactPerson && existing.contactPerson !== 'Accounts Dept' ? existing.contactPerson : item.contactPerson,
                contactNumber: existing.contactNumber || item.contactNumber,
                contactPost: existing.contactPost || item.contactPost,
                additionalContacts: existing.additionalContacts && existing.additionalContacts.length > 0 
                    ? existing.additionalContacts 
                    : (item.additionalContacts || []),
            };
        }
        return item;
    });

    return processStatuses(merged);
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
 * filters data for the specific user based on roles, explicit permissions, and assigned CRM scopes.
 */
export const getOutstandingForUser = (user: User, allData: Outstanding[]): Promise<Outstanding[]> => {
    return new Promise((resolve) => {
        let userSpecificData: Outstanding[];
        
        // Check if user has global viewing permission (Admin, Manager, Viewer, or canViewAllCrms)
        const canViewAll = 
            user.role === UserRole.Admin || 
            user.role === UserRole.Manager || 
            user.role === UserRole.Viewer || 
            user.dataVisibility === DataVisibility.All || 
            user.permissions?.canViewAllCrms;

        if (canViewAll) {
            userSpecificData = allData;
        } else if (user.assignedCrms && user.assignedCrms.length > 0) {
            const allowedCrms = new Set(user.assignedCrms.map(c => c.trim().toUpperCase()));
            userSpecificData = allData.filter(d => {
                const ownerUpper = (d.crmOwnerId || '').trim().toUpperCase();
                return allowedCrms.has(ownerUpper);
            });
        } else if (user.role === UserRole.CRM) {
            const userIdUpper = user.id.trim().toUpperCase();
            const userNameUpper = user.name.trim().toUpperCase();
            userSpecificData = allData.filter(d => {
                const ownerUpper = (d.crmOwnerId || '').trim().toUpperCase();
                return ownerUpper === userIdUpper || ownerUpper === userNameUpper;
            });
        } else { // Collector with AssignedOnly visibility
            const userIdUpper = user.id.trim().toUpperCase();
            const userNameUpper = user.name.trim().toUpperCase();
            userSpecificData = allData.filter(d => {
                const collectorUpper = (d.assignedCollectorId || '').trim().toUpperCase();
                return collectorUpper === userIdUpper || collectorUpper === userNameUpper;
            });
        }
        resolve(processStatuses(userSpecificData));
    });
};

// Initial fallback mock data (Clean fresh state)
export const MOCK_DATA: Outstanding[] = [
    {
        id: 'out_1',
        company: 'BBF PACKAGING PRIVATE LIMITED',
        contactPerson: 'Mr. Ramesh Gupta',
        contactNumber: '6239501363',
        contactPost: 'Finance & Accounts Head',
        additionalContacts: [
            { id: 'c1_1', name: 'Sanjay Sharma', mobile: '9876541230', post: 'Purchase Director', email: 'sanjay@bbfpack.com' }
        ],
        email: 'ankur@shorichemicals.com',
        total: 3953804.00,
        ageing: { '1-45': 1464982, '46-90': 1379377, '91-135': 755592, '>135': 353853 },
        over90: 1109445,
        dueOver45: 2488822,
        crmOwnerId: 'ANKUR',
        status: FollowUpStatus.Pending,
        notes: [],
        creationDate: new Date(),
    },
    {
        id: 'out_2',
        company: 'PVM ENTERPRISES PVT.LTD.',
        contactPerson: 'Sunil Kumar',
        contactNumber: '9501078688',
        contactPost: 'Managing Director',
        additionalContacts: [],
        email: 'prikshit@shorichemicals.com',
        total: 3665574.00,
        ageing: { '1-45': 1328831, '46-90': 1419401, '91-135': 80519, '>135': 836823 },
        over90: 917342,
        dueOver45: 2336743,
        crmOwnerId: 'PRIKSHIT',
        status: FollowUpStatus.Pending,
        notes: [],
        creationDate: new Date(),
    },
    {
        id: 'out_3',
        company: 'ASHWANI KNIT',
        contactPerson: 'Ashwani Mittal',
        contactNumber: '9876690090',
        contactPost: 'Proprietor',
        additionalContacts: [],
        email: 'prikshit@shorichemicals.com',
        total: 3136357.00,
        ageing: { '1-45': 807423, '46-90': 384444, '91-135': 879411, '>135': 1065079 },
        over90: 1944490,
        dueOver45: 2328934,
        crmOwnerId: 'PRIKSHIT',
        status: FollowUpStatus.Pending,
        notes: [],
        creationDate: new Date(),
    }
];

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

    // Strategy 2: Client-side direct candidate URLs (for Published links & Google Visualization API)
    if (!csvContent) {
        const OFFICIAL_FALLBACK_SHEET_ID = '1DoBq1UVK53Z_029eIGUQzZ6g3sN2ytVVFCF0tFoYu_4';
        const candidateUrls: string[] = [];

        // Bare sheet ID
        let cleanUrl = trimmed;
        if (/^[a-zA-Z0-9-_]{25,}$/.test(cleanUrl) && !cleanUrl.startsWith('http')) {
            cleanUrl = `https://docs.google.com/spreadsheets/d/${cleanUrl}/edit`;
        }

        if (cleanUrl.includes('/pub?output=csv') || cleanUrl.includes('/export?format=csv') || cleanUrl.includes('/gviz/tq?tqx=out:csv')) {
            candidateUrls.push(cleanUrl);
        }

        if (cleanUrl.includes('/spreadsheets/d/e/')) {
            let pubCsv = cleanUrl.replace(/\/edit.*/, '');
            if (pubCsv.includes('/pubhtml')) {
                pubCsv = pubCsv.replace(/\/pubhtml.*/, '/pub?output=csv');
            } else if (!pubCsv.includes('/pub?output=csv')) {
                pubCsv = pubCsv.replace(/\/pub.*/, '/pub?output=csv');
                if (!pubCsv.includes('output=csv')) {
                    pubCsv += (pubCsv.includes('?') ? '&' : '?') + 'output=csv';
                }
            }
            candidateUrls.push(pubCsv);
            candidateUrls.push(pubCsv + '&gid=0&single=true');
        }

        const sheetIdMatch = cleanUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (sheetIdMatch && sheetIdMatch[1] && sheetIdMatch[1] !== 'e') {
            const sheetId = sheetIdMatch[1];
            const gidMatch = cleanUrl.match(/gid=([0-9]+)/);
            const gid = gidMatch ? gidMatch[1] : '0';
            candidateUrls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`);
            candidateUrls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`);
        }

        candidateUrls.push(`https://docs.google.com/spreadsheets/d/${OFFICIAL_FALLBACK_SHEET_ID}/gviz/tq?tqx=out:csv`);
        candidateUrls.push(`https://docs.google.com/spreadsheets/d/${OFFICIAL_FALLBACK_SHEET_ID}/export?format=csv`);

        for (const targetUrl of candidateUrls) {
            try {
                const response = await fetch(targetUrl);
                if (response.ok) {
                    const text = await response.text();
                    if (!text.includes('<!DOCTYPE html>') && !text.includes('<html') && text.trim().length > 0) {
                        csvContent = text;
                        break;
                    }
                }
            } catch (e: any) {
                fetchError = e;
            }
        }
    }

    if (!csvContent) {
        throw fetchError || new Error('Could not fetch data. Please ensure the Google Sheet is shared with "Anyone with the link can view" or File > Share > Publish to web.');
    }

    return parseGoogleSheetCsv(csvContent);
}

export const CUSTOMER_MASTER_EXPECTED_HEADERS = [
    "Company / Customer Name",
    "Contact Person",
    "Designation",
    "Mobile Number",
    "Alternate Phone",
    "Email",
    "City",
    "State",
    "Address",
    "GSTIN",
    "Assigned CRM",
    "Credit Limit",
    "Credit Terms (Days)",
    "Notes"
];

// Parse Customer Master Data CSV
export function parseCustomerMasterSheetCsv(csvText: string): { records: Outstanding[]; count: number } {
    const rows = parseCSVMatrix(csvText);
    if (rows.length === 0) {
        throw new Error('Customer Master Sheet is empty.');
    }

    const headers = rows[0].map(h => h.trim());
    
    // Column detection mapping
    const colMap: Record<string, number> = {
        company: -1,
        contactPerson: -1,
        contactPost: -1,
        mobile: -1,
        altPhone: -1,
        email: -1,
        city: -1,
        state: -1,
        address: -1,
        gstin: -1,
        crm: -1,
        creditLimit: -1,
        paymentTermsDays: -1,
        notes: -1
    };

    headers.forEach((h, idx) => {
        const lower = h.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (lower.includes('company') || lower.includes('customer') || lower.includes('party') || lower.includes('client')) {
            if (colMap.company === -1) colMap.company = idx;
        } else if (lower.includes('contactperson') || lower.includes('contactname') || lower.includes('person') || lower === 'contact') {
            if (colMap.contactPerson === -1) colMap.contactPerson = idx;
        } else if (lower.includes('designation') || lower.includes('post') || lower.includes('role') || lower.includes('position')) {
            if (colMap.contactPost === -1) colMap.contactPost = idx;
        } else if (lower.includes('alt') || lower.includes('secondary') || lower.includes('phone2') || lower.includes('mobile2')) {
            if (colMap.altPhone === -1) colMap.altPhone = idx;
        } else if (lower.includes('mobile') || lower.includes('phone') || lower.includes('contactno') || lower.includes('tel')) {
            if (colMap.mobile === -1) colMap.mobile = idx;
        } else if (lower.includes('email') || lower.includes('mail')) {
            if (colMap.email === -1) colMap.email = idx;
        } else if (lower.includes('city') || lower.includes('district') || lower.includes('location')) {
            if (colMap.city === -1) colMap.city = idx;
        } else if (lower.includes('state') || lower.includes('province')) {
            if (colMap.state === -1) colMap.state = idx;
        } else if (lower.includes('address') || lower.includes('street')) {
            if (colMap.address === -1) colMap.address = idx;
        } else if (lower.includes('gst') || lower.includes('taxid')) {
            if (colMap.gstin === -1) colMap.gstin = idx;
        } else if (lower.includes('crm') || lower.includes('salesperson') || lower.includes('owner') || lower.includes('executive')) {
            if (colMap.crm === -1) colMap.crm = idx;
        } else if (lower.includes('creditlimit') || lower.includes('limit')) {
            if (colMap.creditLimit === -1) colMap.creditLimit = idx;
        } else if (lower.includes('term') || lower.includes('creditdays') || lower.includes('period')) {
            if (colMap.paymentTermsDays === -1) colMap.paymentTermsDays = idx;
        } else if (lower.includes('note') || lower.includes('remark') || lower.includes('comment')) {
            if (colMap.notes === -1) colMap.notes = idx;
        }
    });

    // Fallback if company column wasn't identified
    if (colMap.company === -1) colMap.company = 0;

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
        const crm = (colMap.crm >= 0 && colMap.crm < r.length) ? r[colMap.crm]?.trim() : '';
        const rawLimit = (colMap.creditLimit >= 0 && colMap.creditLimit < r.length) ? r[colMap.creditLimit] : '';
        const creditLimit = rawLimit ? parseFloat(String(rawLimit).replace(/[^0-9.]/g, '')) || undefined : undefined;
        const rawTerms = (colMap.paymentTermsDays >= 0 && colMap.paymentTermsDays < r.length) ? r[colMap.paymentTermsDays] : '';
        const paymentTermsDays = rawTerms ? parseInt(String(rawTerms).replace(/[^0-9]/g, ''), 10) || undefined : undefined;
        const noteStr = (colMap.notes >= 0 && colMap.notes < r.length) ? r[colMap.notes]?.trim() : '';

        const item: Outstanding = {
            id: `cust_${i}_${encodeURIComponent(companyName.slice(0, 15).replace(/\s+/g, '_'))}`,
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
            crmOwnerId: crm || 'ANKUR',
            total: 0,
            totalType: 'Dr',
            ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 },
            over90: 0,
            dueOver45: 0,
            status: FollowUpStatus.Pending,
            notes: noteStr ? [noteStr] : [],
            additionalContacts: altPhone ? [{
                id: `alt_${Date.now()}_${i}`,
                name: contactPerson ? `${contactPerson} (Alt)` : 'Alternate Contact',
                mobile: altPhone,
                post: 'Secondary Contact'
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

    // Strategy 2: Client fallback
    if (!csvContent) {
        let cleanUrl = trimmed;
        if (/^[a-zA-Z0-9-_]{25,}$/.test(cleanUrl) && !cleanUrl.startsWith('http')) {
            cleanUrl = `https://docs.google.com/spreadsheets/d/${cleanUrl}/edit`;
        }

        const candidateUrls: string[] = [];
        if (cleanUrl.includes('/pub?output=csv') || cleanUrl.includes('/export?format=csv') || cleanUrl.includes('/gviz/tq?tqx=out:csv')) {
            candidateUrls.push(cleanUrl);
        }
        if (cleanUrl.includes('/spreadsheets/d/e/')) {
            let pubCsv = cleanUrl.replace(/\/edit.*/, '');
            if (pubCsv.includes('/pubhtml')) {
                pubCsv = pubCsv.replace(/\/pubhtml.*/, '/pub?output=csv');
            } else if (!pubCsv.includes('/pub?output=csv')) {
                pubCsv = pubCsv.replace(/\/pub.*/, '/pub?output=csv');
                if (!pubCsv.includes('output=csv')) {
                    pubCsv += (pubCsv.includes('?') ? '&' : '?') + 'output=csv';
                }
            }
            candidateUrls.push(pubCsv);
        }
        const sheetIdMatch = cleanUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (sheetIdMatch && sheetIdMatch[1] && sheetIdMatch[1] !== 'e') {
            const sheetId = sheetIdMatch[1];
            const gidMatch = cleanUrl.match(/gid=([0-9]+)/);
            const gid = gidMatch ? gidMatch[1] : '0';
            candidateUrls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`);
            candidateUrls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`);
        }

        for (const targetUrl of candidateUrls) {
            try {
                const response = await fetch(targetUrl);
                if (response.ok) {
                    const text = await response.text();
                    if (!text.includes('<!DOCTYPE html>') && !text.includes('<html') && text.trim().length > 0) {
                        csvContent = text;
                        break;
                    }
                }
            } catch (e: any) {
                fetchError = e;
            }
        }
    }

    if (!csvContent) {
        throw fetchError || new Error('Could not fetch Customer Master sheet. Please ensure it is shared publicly or published to web.');
    }

    return parseCustomerMasterSheetCsv(csvContent);
}

// Merge Customer Master Data into existing application dataset
export function mergeCustomerMasterIntoAppData(existingData: Outstanding[], masterData: Outstanding[]): { updatedData: Outstanding[]; enrichedCount: number; newAccountsCount: number } {
    const existingMap = new Map<string, Outstanding>();
    existingData.forEach(item => {
        const key = item.company.trim().toLowerCase();
        existingMap.set(key, item);
    });

    let enrichedCount = 0;
    let newAccountsCount = 0;
    const mergedList: Outstanding[] = [...existingData];

    masterData.forEach(masterItem => {
        const key = masterItem.company.trim().toLowerCase();
        const existingIdx = mergedList.findIndex(item => item.company.trim().toLowerCase() === key);

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
                crmOwnerId: (masterItem.crmOwnerId && masterItem.crmOwnerId !== 'ANKUR') ? masterItem.crmOwnerId : current.crmOwnerId,
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

