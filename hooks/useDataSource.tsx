import React, { useState, useRef, Dispatch, SetStateAction } from 'react';
import * as repo from '../services/repository';
import { Outstanding, PdcCheque, Template, CompanyProfile, DEFAULT_COMPANY_PROFILE, DEFAULT_TEMPLATE } from '../types';
import {
    processStatuses,
    mergeWithExistingFollowUps,
    fetchGoogleSheetData,
    OFFICIAL_TRANSACTIONS_SHEET_URL,
    OFFICIAL_CUSTOMER_MASTER_URL,
    fetchCustomerMasterSheetData,
    mergeCustomerMasterIntoAppData,
    summariseUnlisted,
    countNewNames,
} from '../services/googleSheetService';
import { EXPECTED_HEADERS, parseExcelRows, readWorkbookRows, exportCrmAssignments } from '../services/excel';
import { previewSync, describePreview } from '../services/syncPreview';
import { buildResetPlan, resetBook, backupFileContents, backupFileName, ResetPlan } from '../services/reset';
import { formatCompact } from '../components/ui/format';
import type { SheetCheck } from '../components/DataSourceView';

export type SyncMessage = { type: 'success' | 'error'; text: string; action?: { label: string; run: () => void } } | null;
export type Question = { title: string; body: React.ReactNode; confirmLabel: string; tone?: 'danger' | 'primary'; run: () => void };

interface DataSourceInputs {
    appData: Outstanding[];
    setAppData: Dispatch<SetStateAction<Outstanding[]>>;
    pdcCheques: PdcCheque[];
    templates: Template[];
    companyProfile: CompanyProfile;
    isAdmin: boolean;
    setSyncMessage: (m: SyncMessage) => void;
    /** A question asked in the app before something big (the one-time import). */
    ask: (q: Question) => void;
    /** After a fresh start: the tab reloads everything from the server. */
    onReset: () => void;
}

/**
 * Where the balances come from, and everything that reads or resets them:
 * the sheet addresses and mode, "Check the sheet", the balance sync and its
 * review, the Excel upload, the one-time customer import, the CRM-owners
 * export, and the fresh start. Nothing here writes to the database
 * directly — a confirmed sync or import lands in the book through
 * setAppData and the sync hook carries it; the fresh start is one server
 * transaction (services/reset.ts).
 */
export function useDataSource({ appData, setAppData, pdcCheques, templates, companyProfile, isAdmin, setSyncMessage, ask, onReset }: DataSourceInputs) {
    const [isSyncing, setIsSyncing] = useState(false);
    const [sheetUpdatedTillDate, setSheetUpdatedTillDate] = useState<string>('');
    const [lastSyncTime, setLastSyncTime] = useState<string>('');

    /** A fresh start waiting for its confirmation: the sheet has been read and the plan computed; nothing is written yet. */
    const [resetPlan, setResetPlan] = useState<ResetPlan | null>(null);

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
    /** What "Check the sheet" found: reachable or not, and what the next sync would do. */
    const [sheetCheck, setSheetCheck] = useState<SheetCheck | null>(null);

    // Data Source State - default to Google Sheet
    const [dataSourceMode, setDataSourceMode] = useState<'excel' | 'google'>('google');
    const [googleSheetUrl, setGoogleSheetUrl] = useState(OFFICIAL_TRANSACTIONS_SHEET_URL);
    const [customerMasterSheetUrl, setCustomerMasterSheetUrl] = useState(OFFICIAL_CUSTOMER_MASTER_URL);


    /**
     * Factory reset. With a backend this rewrites the shared dataset for
     * everyone — customers, cheques, templates and the company profile — but
     * deliberately leaves logins alone: those are real accounts, and they are
     * removed one at a time in Team & access.
     */
    /**
     * "Complete fresh start", step one: read the sheet and work out the plan.
     *
     * Nothing in the tab or the database changes here. The sheet is read
     * first because a reset that could not re-import it has nothing to reset
     * to — the old version emptied the cheques, templates and profile in
     * memory *before* trying the sheet, and the sync hooks wrote that
     * through even when the fetch then failed. The plan is shown as counts
     * in a dialog that asks for a backup copy and a typed phrase; the reset
     * itself is one database transaction (services/reset.ts, supabase/reset.sql).
     */
    const handleResetAllDataAndUsers = async () => {
        if (!isAdmin) {
            setSyncMessage({ type: 'error', text: 'Only an Admin can reset the book.' });
            return;
        }
        setIsSyncing(true);
        setSyncMessage({ type: 'success', text: 'Reading the live sheet before anything changes…' });
        try {
            const parsed = await fetchGoogleSheetData(OFFICIAL_TRANSACTIONS_SHEET_URL);
            if (!parsed.records || parsed.records.length === 0) {
                throw new Error('The sheet returned no rows.');
            }
            setResetPlan(buildResetPlan(appData, parsed.records, pdcCheques, parsed.updatedTillDate));
            setSyncMessage(null);
        } catch (err: any) {
            setSyncMessage({
                type: 'error',
                text: `Could not read the sheet, so nothing was reset: ${err?.message || err}`,
            });
        } finally {
            setIsSyncing(false);
        }
    };

    /** The copy of the book the dialog asks the person to keep, from what this tab has loaded. */
    const handleDownloadResetBackup = () => {
        const blob = new Blob([backupFileContents(appData, pdcCheques, templates, companyProfile)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = backupFileName();
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    /**
     * Step two: the database applies the plan in one transaction, then this
     * tab reloads everything from the server. Dropping `serverLoaded` is the
     * same path sign-out uses: the sync hooks forget their baselines and
     * re-seed from the reloaded data without writing anything back.
     */
    const handleConfirmReset = async (phrase: string) => {
        if (!resetPlan) return;
        const result = await resetBook(resetPlan, {
            templates: [DEFAULT_TEMPLATE],
            profile: DEFAULT_COMPANY_PROFILE,
            settings: {
                data_source_mode: 'google',
                google_sheet_url: OFFICIAL_TRANSACTIONS_SHEET_URL,
                sheet_updated_till_date: resetPlan.updatedTillDate || '',
                last_sync_time: new Date().toISOString(),
            },
        }, phrase);
        setResetPlan(null);
        onReset();
        setSyncMessage({
            type: 'success',
            text: `Fresh start done: ${result.cheques_deleted} cheque${result.cheques_deleted === 1 ? '' : 's'} removed, `
                + `${result.accounts_updated} account${result.accounts_updated === 1 ? '' : 's'} re-imported (${result.accounts_settled} settled), `
                + `${result.accounts_added} added. Owners, collectors, contacts and activity history were kept. `
                + `Snapshot ${String(result.backup_id).slice(0, 8)} is saved in the database.`,
        });
        setTimeout(() => setSyncMessage(null), 12000);
    };

    // Sync Reconciliation Handlers
    const handleConfirmSyncReconciliation = (reconciledRecords: Outstanding[]) => {
        // The same preview the review showed, so the message says what the
        // sync did — "Balances updated for 4,027 accounts" counted the whole
        // book on a morning when nine had moved.
        const done = pendingSync ? previewSync(appData, pendingSync.records) : null;
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
                (done ? `Sync done: ${describePreview(done)}.` : `Balances updated for ${reconciledRecords.length} accounts.`) +
                (added
                    ? ` The ${added} new customer${added === 1 ? '' : 's'} need a CRM — they are under "Unassigned" in the customer book.`
                    : '') +
                (settled.count
                    ? ` ${formatCompact(settled.amount)} settled to zero on ${settled.count} account${settled.count === 1 ? '' : 's'} the sheet no longer lists.`
                    : '') +
                (pendingSync?.updatedTillDate ? ` Sheet updated till ${pendingSync.updatedTillDate}.` : '')
        });
        setPendingSync(null);
        setSheetCheck(null);
        checkedRecords.current = null;
        setTimeout(() => setSyncMessage(null), 7000);
    };

    const handleCancelSyncReconciliation = () => {
        setPendingSync(null);
    };

    /**
     * "Check the sheet": read it and say what a sync would do, without opening
     * the review or writing anything. The answer stays on the page until the
     * next check or sync, so a manager can see the source is healthy and what
     * the next sync changes before pressing anything.
     */
    const handleCheckSheet = async () => {
        const url = (googleSheetUrl || OFFICIAL_TRANSACTIONS_SHEET_URL).trim();
        setIsSyncing(true);
        setSyncMessage(null);
        try {
            const { records, updatedTillDate } = await fetchGoogleSheetData(url);
            if (records.length === 0) throw new Error('The sheet has no customer rows.');
            setSheetCheck({ at: new Date().toISOString(), url, rows: records.length, updatedTillDate, preview: previewSync(appData, records) });
            // Kept for "Review and update", so the review opens on exactly what was checked.
            checkedRecords.current = { records, updatedTillDate };
        } catch (err) {
            setSheetCheck({ at: new Date().toISOString(), url, error: err instanceof Error ? err.message : String(err) });
            checkedRecords.current = null;
        } finally {
            setIsSyncing(false);
        }
    };
    const checkedRecords = useRef<{ records: Outstanding[]; updatedTillDate: string } | null>(null);
    const handleReviewCheck = () => {
        const c = checkedRecords.current;
        if (!c) { void handleGoogleSync(); return; }
        setPendingSync({ records: c.records, updatedTillDate: c.updatedTillDate, sourceName: 'Transactions Google Sheet' });
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
            setSyncMessage({ type: 'error', text: msg, action: { label: 'Retry official sheet', run: () => handleGoogleSync(OFFICIAL_TRANSACTIONS_SHEET_URL) } });
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
    const handleCustomerMasterSync = async (overrideUrl?: string, opts: { confirmed?: boolean } = {}) => {
        const urlToUse = (typeof overrideUrl === 'string' && overrideUrl.trim())
            ? overrideUrl.trim()
            : (customerMasterSheetUrl || OFFICIAL_CUSTOMER_MASTER_URL).trim();

        if (overrideUrl && typeof overrideUrl === 'string') {
            setCustomerMasterSheetUrl(overrideUrl);
        }

        // The Data source page asks in its own dialog, naming what the import
        // does; the browser confirm() below is only for any other caller.
        if (appData.length > 0 && !opts.confirmed) {
            ask({
                title: 'Import customers from the master sheet?',
                confirmLabel: 'Import customers',
                tone: 'primary',
                body: <p>Customers already on file keep every detail recorded here; blanks are filled in and names not on file are added. No balances change.</p>,
                run: () => { void handleCustomerMasterSync(urlToUse, { confirmed: true }); },
            });
            return;
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

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsSyncing(true);
        setSyncMessage(null);

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const parsedData = parseExcelRows(await readWorkbookRows(e.target?.result as string | ArrayBuffer));
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




    const handleExportCrmAssignments = () => exportCrmAssignments(appData, crmConflicts);

    /** The settings row as loaded at sign-in; blanks keep the defaults. */
    const applySettings = (all: Partial<repo.AppSettings>) => {
        if (all.dataSourceMode) setDataSourceMode(all.dataSourceMode);
        if (all.googleSheetUrl) setGoogleSheetUrl(all.googleSheetUrl);
        if (all.customerMasterSheetUrl) setCustomerMasterSheetUrl(all.customerMasterSheetUrl);
        if (all.sheetUpdatedTillDate) setSheetUpdatedTillDate(all.sheetUpdatedTillDate);
        if (all.lastSyncTime) setLastSyncTime(all.lastSyncTime);
    };

    return {
        // settings
        dataSourceMode, setDataSourceMode, googleSheetUrl, setGoogleSheetUrl, customerMasterSheetUrl, setCustomerMasterSheetUrl,
        sheetUpdatedTillDate, lastSyncTime, applySettings,
        // in flight
        isSyncing, sheetCheck, crmConflicts, pendingSync, resetPlan, setResetPlan,
        // actions
        handleCheckSheet, handleReviewCheck, handleGoogleSync, handleCustomerMasterSync,
        handleConfirmSyncReconciliation, handleCancelSyncReconciliation,
        handleFileChange, copyHeaders, handleExportCrmAssignments,
        handleResetAllDataAndUsers, handleDownloadResetBackup, handleConfirmReset,
    };
}
