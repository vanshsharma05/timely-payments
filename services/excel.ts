/**
 * SheetJS on demand, and everything the app reads from or writes to an
 * Excel file: the upload's row parser, the blank template, the customer
 * export and the CRM-owners export.
 *
 * The library is half a megabyte minified and was preloaded for everyone at
 * sign-in, though only an export or an upload ever uses it. Importing it here,
 * when the button is pressed, keeps it out of the first load; the browser
 * fetches the chunk once and keeps it.
 */
import { Outstanding, FollowUpStatus, followUpStatusOf, getCustomerPaymentRank, PAYMENT_RANK_LABELS } from '../types';
import { parseAmountAndType, netRollUp } from './googleSheetService';

export const loadXlsx = () => import('xlsx');

/** The columns an uploaded workbook is read in, and the blank template's header row. */
export const EXPECTED_HEADERS = ["ID","Company","Contact Person","Contact Number","Total Due","Ageing 1-45","Ageing 46-90","Ageing 91-135","Ageing >135","CRM Owner Name","Assigned Collector Name","Follow-up Date","Notes","Is Urgent","Creation Date"
];

const today = () => new Date().toISOString().split('T')[0];

/** One workbook row per account, in EXPECTED_HEADERS order; a row that cannot be read is logged and skipped. */
export function parseExcelRows(values: any[][]): Outstanding[] {
    return values.map((row, index) => {
        try {
            const totalParsed = parseAmountAndType(row[4]);
            const a1Parsed = parseAmountAndType(row[5]);
            const a2Parsed = parseAmountAndType(row[6]);
            const a3Parsed = parseAmountAndType(row[7]);
            const a4Parsed = parseAmountAndType(row[8]);
            const over90Net = netRollUp([a3Parsed, a4Parsed]);
            const dueOver45Net = netRollUp([a2Parsed, a3Parsed, a4Parsed]);

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
                over90: over90Net.amount,
                over90Type: over90Net.type,
                dueOver45: dueOver45Net.amount,
                dueOver45Type: dueOver45Net.type,
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
}

/** Reads the first sheet of an uploaded workbook into rows, header row dropped. */
export async function readWorkbookRows(data: string | ArrayBuffer): Promise<any[][]> {
    const XLSX = await loadXlsx();
    const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const json: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
    if (json.length < 1) {
        throw new Error("Excel sheet is empty or invalid.");
    }
    // Slice(1) to skip header row, assuming file has one.
    return json.slice(1);
}

/** A workbook with only the header row, for somebody starting a sheet from scratch. */
export async function downloadTemplate(): Promise<void> {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([EXPECTED_HEADERS]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, "TimelyPayment_Template.xlsx");
}

/**
 * Exports the accounts given, not the whole book: filtering to the bad
 * debts and pressing Export used to hand you all four thousand customers,
 * which made the one job this is for — giving the recovery agency a
 * defaulter list — impossible. `bookSize` names the file "All" when the
 * rows are the whole book.
 */
export async function exportCustomersExcel(rowsToExport: Outstanding[], bookSize: number): Promise<void> {
    const XLSX = await loadXlsx();
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
        followUpStatusOf(c),
        c.followUpDate ? new Date(c.followUpDate).toISOString().split('T')[0] : '',
        (c.notes && c.notes.length > 0) ? c.notes[c.notes.length - 1] : ''
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    const scope = rowsToExport.length === bookSize ? 'All' : `${rowsToExport.length}_selected`;
    XLSX.writeFile(wb, `Customers_${scope}_${today()}.xlsx`);
}

/**
 * The CRM column as the app holds it, in a form that can be pasted back
 * into the Customer Master.
 *
 * Ownership is decided here — a handover typed into the app is not undone
 * by the next import — but the sheet is read by people who never open the
 * app, and there is no way to write to it from here. This is the bridge:
 * one row per account, the owner the app is working to, and the owner the
 * sheet last supplied where the two disagree.
 */
export async function exportCrmAssignments(book: Outstanding[], crmConflicts: { company: string; sheetCrm: string }[]): Promise<void> {
    const XLSX = await loadXlsx();
    const sheetSays = new Map(crmConflicts.map(c => [c.company, c.sheetCrm]));
    const headers = ['Company', 'CRM Owner (app)', 'CRM Owner (master sheet)', 'Differs', 'Total Outstanding'];
    const rows = [...book]
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
    XLSX.writeFile(wb, `CRM_Owners_${today()}.xlsx`);
}
