import { useState } from 'react';
import { PdcCheque, PdcStatus } from '../types';
import { replaceOrAdd } from '../services/refresh';
import { SaveOutcome, outcomeFor, SyncPassResult } from '../services/useSupabaseSync';

interface ChequesInputs {
    pdcCheques: PdcCheque[];
    setPdcCheques: React.Dispatch<React.SetStateAction<PdcCheque[]>>;
    /** The cheques' sync: a save waits for its verdict. */
    chequesSync: { flush: () => Promise<SyncPassResult> };
    notify: (type: 'success' | 'error', text: string) => void;
    reportBulk: (r: SyncPassResult, ids: string[], done: string) => void;
    setTab: (key: string) => void;
}

/** The cheque dialog: a cheque to edit, or none with the customer it is for. */
export type ChequeDialog = { cheque: PdcCheque | null; customerId?: string };

/**
 * The cheque register's actions: record, edit, delete, mark one or many,
 * and the two ways Today opens the register (a customer's cheques, the
 * ones due today). The list itself stays in App, where the sync reads it.
 */
export function useCheques({ pdcCheques, setPdcCheques, chequesSync, notify, reportBulk, setTab }: ChequesInputs) {
    const [chequeDialog, setChequeDialog] = useState<ChequeDialog | null>(null);
    const [pdcInitialStatusFilter, setPdcInitialStatusFilter] = useState<string | null>(null);
    const [pdcInitialCustomerFilter, setPdcInitialCustomerFilter] = useState<string | null>(null);


    const handleOpenAddPdc = (customerId?: string) => {
        setChequeDialog({ cheque: null, customerId });
    };

    const handleOpenEditPdc = (cheque: PdcCheque) => {
        setChequeDialog({ cheque, customerId: cheque.customerId });
    };

    /** The cheque dialog waits for the verdict the same way the customer dialogs do. */
    const handleSavePdc = async (chequeData: Omit<PdcCheque, 'id'> & { id?: string }): Promise<SaveOutcome> => {
        const id = chequeData.id || `pdc_${Date.now()}`;
        const cheque: PdcCheque = { ...(chequeData as Omit<PdcCheque, 'id'>), id };
        // The dialog keeps one id for the cheque it is composing, so a Save
        // pressed again after a refusal replaces the pending cheque instead of
        // adding a second one.
        setPdcCheques(prev => replaceOrAdd(prev, cheque));
        const outcome = outcomeFor(id, await chequesSync.flush());
        if (outcome.ok) setChequeDialog(null);
        return outcome;
    };

    const handleDeletePdc = (chequeId: string) => {
        setPdcCheques(prev => prev.filter(p => p.id !== chequeId));
        void chequesSync.flush().then(r => {
            const failed = r.failed.find(f => f.id === chequeId);
            if (failed) notify('error', `The cheque could not be deleted: ${failed.message}. It will be tried again.`);
        });
    };

    const handleUpdatePdcStatus = (chequeId: string, newStatus: PdcStatus) => {
        // Pressing the state a cheque is already in is not a change — it used
        // to rewrite clearedDate to now on a cleared cheque and save the row.
        if (pdcCheques.find(p => p.id === chequeId)?.status === newStatus) return;
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
        void chequesSync.flush().then(r => {
            const failed = r.failed.find(f => f.id === chequeId);
            if (failed) notify('error', `The cheque's status could not be saved: ${failed.message}. It is kept in this tab and will be retried.`);
        });
    };

    /**
     * The same two actions across a whole selection.
     *
     * A morning's clearing is a dozen cheques at once, and marking them one
     * dialog at a time is the reason the register goes stale. One pass over the
     * list, one render, one message.
     */
    const handleBulkPdcStatus = (chequeIds: string[], newStatus: PdcStatus) => {
        const idSet = new Set(chequeIds);
        setPdcCheques(prev => prev.map(p => (
            idSet.has(p.id)
                ? { ...p, status: newStatus, clearedDate: newStatus === PdcStatus.Cleared ? new Date() : p.clearedDate }
                : p
        )));
        void chequesSync.flush().then(r => reportBulk(r, chequeIds, `Marked ${chequeIds.length} cheque${chequeIds.length === 1 ? '' : 's'} as ${newStatus}.`));
    };

    const handleBulkDeletePdc = (chequeIds: string[]) => {
        const idSet = new Set(chequeIds);
        setPdcCheques(prev => prev.filter(p => !idSet.has(p.id)));
        void chequesSync.flush().then(r => reportBulk(r, chequeIds, `Deleted ${chequeIds.length} cheque${chequeIds.length === 1 ? '' : 's'}.`));
    };

    const handleOpenPdcForCustomer = (customerId: string) => {
        setTab('pdc');
        setPdcInitialCustomerFilter(customerId);
        setPdcInitialStatusFilter('all');
    };

    const handleOpenTodayPdc = () => {
        setTab('pdc');
        setPdcInitialStatusFilter('today');
        setPdcInitialCustomerFilter('all');
    };

    return {
        chequeDialog, closeChequeDialog: () => setChequeDialog(null),
        pdcInitialStatusFilter, pdcInitialCustomerFilter,
        handleOpenAddPdc, handleOpenEditPdc, handleSavePdc, handleDeletePdc, handleUpdatePdcStatus,
        handleBulkPdcStatus, handleBulkDeletePdc, handleOpenPdcForCustomer, handleOpenTodayPdc,
    };
}
