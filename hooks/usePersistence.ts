import { useState, useEffect, useMemo, useCallback, useRef, Dispatch, SetStateAction } from 'react';
import * as repo from '../services/repository';
import { useCollectionSync, useValueSync, SyncStatus } from '../services/useSupabaseSync';
import { combineStatus } from '../components/SaveStatus';
import { mergeServerRows } from '../services/refresh';
import { processStatuses } from '../services/googleSheetService';
import { Outstanding, PdcCheque, Template, CompanyProfile } from '../types';

/** The settings row, as the app holds it. */
export interface AppSettingsValue {
    dataSourceMode: 'excel' | 'google';
    googleSheetUrl: string;
    customerMasterSheetUrl: string;
    sheetUpdatedTillDate: string;
    lastSyncTime: string;
}

interface PersistenceInputs {
    /** Signed in, hydrated, and Supabase configured: nothing is written before all three. */
    enabled: boolean;
    appData: Outstanding[];
    setAppData: Dispatch<SetStateAction<Outstanding[]>>;
    pdcCheques: PdcCheque[];
    templates: Template[];
    companyProfile: CompanyProfile;
    settings: AppSettingsValue;
    /** A dialog is open: the book must not be refreshed under a form mid-edit. */
    dialogOpen: boolean;
}

/**
 * Supabase is the master record and the only one: state is loaded from it on
 * sign-in and written back as it changes. Nothing about the book is cached in
 * the browser, so a stale tab can never overwrite the team's work.
 *
 * This hook is the writing half: one sync per collection (customers,
 * cheques, templates) and per value (profile, settings), what each has
 * saved or could not save folded into one status for the header, a retry
 * for all of them, and the periodic re-read of the book that keeps a
 * long-open tab honest.
 */
export function usePersistence({ enabled, appData, setAppData, pdcCheques, templates, companyProfile, settings, dialogOpen }: PersistenceInputs) {
    /**
     * What each collection has saved, is saving, or could not save — folded
     * into one line in the header (SaveStatus) and a banner while anything is
     * refused. The hooks retry on their own; "Retry now" runs them at once.
     */
    const [syncStatuses, setSyncStatuses] = useState<Record<string, SyncStatus>>({});
    const statusFor = (key: string) => (status: SyncStatus) => setSyncStatuses(prev => ({ ...prev, [key]: status }));
    const customersStatus = useCallback(statusFor('customers'), []);
    const chequesStatus = useCallback(statusFor('cheques'), []);
    const templatesStatus = useCallback(statusFor('templates'), []);
    const profileStatus = useCallback(statusFor('profile'), []);
    const settingsStatus = useCallback(statusFor('settings'), []);
    const saveStatus = useMemo(() => combineStatus(Object.values(syncStatuses)), [syncStatuses]);

    // Stable adapters. These tables are small, so a sequential loop is fine.
    /**
     * Genuinely new accounts go out as an upsert, so the database can ask for
     * the "add customer" right only when one is being added. An id we have not
     * seen may still exist server-side (someone else created it since this tab
     * loaded), which is why that path upserts. Edits to accounts the server
     * already has never come here: the sync hook writes them column by column
     * through `customerColumns` below.
     */
    const saveCustomerRows = useCallback(async (rows: Outstanding[], created: Set<string>) => {
        const fresh = rows.filter(r => created.has(r.id));
        if (fresh.length) await repo.upsertCustomers(fresh);
    }, []);
    /**
     * An edit writes only the columns that changed since this tab last saved
     * the row. It used to write the whole row from this tab's copy of the
     * book, so two people working one account overwrote each other's
     * unrelated fields — see customerRowDiff() in the repository.
     */
    const customerColumns = useMemo(() => ({
        toRow: repo.outstandingToRow,
        diff: repo.customerRowDiff,
        update: (id: string, changes: Partial<repo.CustomerRow>) => repo.updateCustomerColumns(id, changes),
    }), []);

    const upsertPdcRows = useCallback(async (rows: PdcCheque[]) => {
        for (const r of rows) await repo.upsertPdcCheque(r);
    }, []);
    const upsertTemplateRows = useCallback(async (rows: Template[]) => {
        for (const r of rows) await repo.upsertTemplate(r);
    }, []);
    const customerSignature = useCallback((c: Outstanding) => JSON.stringify(repo.outstandingToRow(c)), []);
    const jsonSignature = useCallback((r: unknown) => JSON.stringify(r), []);

    const customersSync = useCollectionSync<Outstanding, repo.CustomerRow>({
        rows: appData, enabled, label: 'customers',
        toSignature: customerSignature,
        upsert: saveCustomerRows, remove: repo.deleteCustomer,
        partial: customerColumns,
        onStatus: customersStatus,
    });
    const chequesSync = useCollectionSync({
        rows: pdcCheques, enabled, label: 'PDC cheques',
        toSignature: jsonSignature,
        upsert: upsertPdcRows, remove: repo.deletePdcCheque,
        onStatus: chequesStatus,
    });
    const templatesSync = useCollectionSync({
        rows: templates, enabled, label: 'templates',
        toSignature: jsonSignature,
        upsert: upsertTemplateRows, remove: repo.deleteTemplate,
        onStatus: templatesStatus,
    });
    useValueSync({
        value: companyProfile, enabled, label: 'company profile',
        save: repo.saveCompanyProfile, onStatus: profileStatus,
    });

    const { dataSourceMode, googleSheetUrl, customerMasterSheetUrl, sheetUpdatedTillDate, lastSyncTime } = settings;
    const settingsValue = useMemo(
        () => ({ dataSourceMode, googleSheetUrl, customerMasterSheetUrl, sheetUpdatedTillDate, lastSyncTime }),
        [dataSourceMode, googleSheetUrl, customerMasterSheetUrl, sheetUpdatedTillDate, lastSyncTime]
    );
    useValueSync({
        value: settingsValue, enabled, label: 'settings',
        save: repo.saveAppSettings, onStatus: settingsStatus,
    });

    const retryAllSaves = useCallback(() => {
        void Promise.all([customersSync.retry(), chequesSync.retry(), templatesSync.retry()]);
    }, [customersSync, chequesSync, templatesSync]);

    /**
     * Keeping a long-open tab honest.
     *
     * The book was read once at sign-in and never again; a colleague's note
     * or reassignment from the morning stayed invisible all day, and the
     * next save from here was compared with that morning's copy. Now the
     * book is re-read when the person comes back to the tab (and every few
     * minutes while it is open), and the server's rows replace this tab's —
     * except any row this tab has changed and not yet saved, which is kept
     * exactly as it is, and any dialog that is open, which pauses the
     * refresh so a form is never pulled from under a person mid-edit.
     */
    const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const appDataRef = useRef<Outstanding[]>(appData);
    appDataRef.current = appData;
    const refreshBook = useCallback(async () => {
        if (!enabled || refreshing) return;
        setRefreshing(true);
        try {
            await customersSync.idle();
            const server = processStatuses(await repo.fetchCustomers());
            const { merged, accepted, dropped } = mergeServerRows(appDataRef.current, server, customersSync.pendingIds());
            // The baseline moves first, so the new rows are not mistaken for local edits.
            customersSync.accept(accepted);
            customersSync.forget(dropped);
            setAppData(merged);
            setRefreshedAt(Date.now());
        } catch {
            // The book stays as it was; the next return to the tab tries again.
        } finally {
            setRefreshing(false);
        }
    }, [enabled, refreshing, customersSync, setAppData]);
    const refreshRef = useRef(refreshBook);
    refreshRef.current = refreshBook;
    const dialogOpenRef = useRef(dialogOpen);
    dialogOpenRef.current = dialogOpen;
    useEffect(() => {
        if (!enabled) return;
        setRefreshedAt(Date.now());   // the load itself is a fresh read
        let last = Date.now();
        const maybe = (minAgeMs: number) => {
            if (document.visibilityState !== 'visible' || dialogOpenRef.current) return;
            if (Date.now() - last < minAgeMs) return;
            last = Date.now();
            void refreshRef.current();
        };
        const onVisible = () => maybe(60_000);
        const onOnline = () => maybe(10_000);
        const every = window.setInterval(() => maybe(5 * 60_000), 60_000);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        window.addEventListener('online', onOnline);
        return () => {
            window.clearInterval(every);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
            window.removeEventListener('online', onOnline);
        };
    }, [enabled]);
    // "x min ago" has to move without anything else changing.
    const [, setClock] = useState(0);
    useEffect(() => { const t = window.setInterval(() => setClock(n => n + 1), 30_000); return () => window.clearInterval(t); }, []);

    return { customersSync, chequesSync, templatesSync, syncStatuses, saveStatus, retryAllSaves, refreshBook, refreshedAt, refreshing };
}
