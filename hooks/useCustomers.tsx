import React, { useState, useMemo, useCallback, useRef } from 'react';
import * as repo from '../services/repository';
import { processStatuses } from '../services/googleSheetService';
import { exportCustomersExcel } from '../services/excel';
import { SaveOutcome, outcomeFor, SyncPassResult } from '../services/useSupabaseSync';
import { formatINR, formatDate, dateFromLocalIso, startOfToday } from '../components/ui/format';
import { Outstanding, User, UserRole, FollowUpStatus, PdcCheque, PaymentRank, PAYMENT_RANK_LABELS, findOwner, getFollowUpCategory } from '../types';
import type { Question } from './useDataSource';

interface CustomersInputs {
    appData: Outstanding[];
    setAppData: React.Dispatch<React.SetStateAction<Outstanding[]>>;
    pdcCheques: PdcCheque[];
    users: User[];
    currentUser: User | null;
    /** The customers' sync: a save waits for its verdict. */
    customersSync: { flush: () => Promise<SyncPassResult> };
    notify: (type: 'success' | 'error', text: string) => void;
    reportBulk: (r: SyncPassResult, ids: string[], done: string) => void;
    ask: (q: Question) => void;
    /** Which screen is open, and the Today list: what the follow-up dialog steps through. */
    tab: string;
    todayList: Outstanding[];
}

/**
 * Everything done to a customer from the book, Today or Reports: add and
 * edit (one dialog), delete (after the question), the follow-up dialog
 * with its stepping through the list it was opened from, the WhatsApp
 * reminder, reassigning an owner, and the three bulk tools. Every change
 * lands in the book through setAppData and the sync carries it; the
 * dialogs wait for the server's verdict before they close.
 */
export function useCustomers({ appData, setAppData, pdcCheques, users, currentUser, customersSync, notify, reportBulk, ask, tab, todayList }: CustomersInputs) {
    /** The add/edit dialog: a customer to edit, or none for a new one. */
    const [customerDialog, setCustomerDialog] = useState<{ customer: Outstanding | null } | null>(null);
    /** The account open in the follow-up dialog; none when it is closed. */
    const [selectedCustomer, setSelectedCustomer] = useState<Outstanding | null>(null);
    /** The account a WhatsApp reminder is being composed for; none when that dialog is closed. */
    const [whatsAppCustomer, setWhatsAppCustomer] = useState<Outstanding | null>(null);


    const handleOpenAddCustomer = () => {
        setCustomerDialog({ customer: null });
    };

    const handleOpenEditCustomer = (customer: Outstanding) => {
        setCustomerDialog({ customer });
    };

    /**
     * The dialog waits for the server's verdict: the record goes into the
     * book at once (so the tab keeps it and retries if need be), but the
     * dialog only closes, and "saved" is only said, once the write was
     * accepted. A refusal goes back to the dialog, which stays open with
     * everything typed still in it.
     */
    const handleSaveCustomer = async (savedCustomer: Outstanding): Promise<SaveOutcome> => {
        const isExisting = appData.some(c => c.id === savedCustomer.id);
        let updated: Outstanding[];
        if (isExisting) {
            updated = appData.map(c => c.id === savedCustomer.id ? savedCustomer : c);
        } else {
            updated = [savedCustomer, ...appData];
        }
        const processed = processStatuses(updated);
        setAppData(processed);
        const outcome = outcomeFor(savedCustomer.id, await customersSync.flush());
        if (outcome.ok) {
            setCustomerDialog(null);
            notify('success', `Customer "${savedCustomer.company}" ${isExisting ? 'updated' : 'added'}.`);
        }
        return outcome;
    };

    const handleDeleteCustomer = (customerId: string) => {
        const target = appData.find(c => c.id === customerId);
        if (!target) return;
        const cheques = pdcCheques.filter(p => p.customerId === customerId).length;
        ask({
            title: 'Delete this customer?',
            confirmLabel: 'Delete customer',
            body: <>
                <p><strong className="text-label">{target.company}</strong>{target.contactPerson ? ` · ${target.contactPerson}` : ''} · balance <span className="num font-semibold text-label">{formatINR(target.total || 0)}</span>{cheques ? ` · ${cheques} cheque${cheques === 1 ? '' : 's'} in the register` : ''}.</p>
                <p className="mt-2">The account, its contacts, notes, follow-up history{cheques ? ' and its cheques' : ''} leave the book for everyone. This cannot be undone. A customer who has simply paid up should be left in place — the sheet settles them to zero.</p>
            </>,
            run: () => {
                const updated = appData.filter(c => c.id !== customerId);
                const processed = processStatuses(updated);
                setAppData(processed);
                void customersSync.flush().then(r => {
                    const failed = r.failed.find(f => f.id === customerId);
                    if (failed) notify('error', `Could not delete "${target.company}": ${failed.message}. It will be tried again.`);
                    else notify('success', `Customer "${target.company}" deleted.`);
                });
            },
        });
    };

    const handleExportCustomerExcel = (rowsToExport: Outstanding[] = appData) => exportCustomersExcel(rowsToExport, appData.length);

    /**
     * The list an account was opened from, so the dialog can step to the next
     * one without closing: the book's rows in their current order when it is
     * open, otherwise the Today list's.
     */
    const bookVisibleIds = useRef<string[]>([]);
    const onBookRowsChange = useCallback((ids: string[]) => { bookVisibleIds.current = ids; }, []);
    const [followUpList, setFollowUpList] = useState<string[]>([]);
    const handleOpenFollowUp = (customer: Outstanding) => {
        const source = tab === 'customers' ? bookVisibleIds.current : todayList.map(c => c.id);
        setFollowUpList(source.includes(customer.id) ? source : [customer.id]);
        setSelectedCustomer(customer);
    };
    const followUpPosition = useMemo(() => {
        if (!selectedCustomer) return undefined;
        const index = followUpList.indexOf(selectedCustomer.id);
        return index >= 0 ? { index, total: followUpList.length } : undefined;
    }, [selectedCustomer, followUpList]);
    const handleNavigateFollowUp = useCallback((direction: -1 | 1) => {
        if (!selectedCustomer) return;
        const index = followUpList.indexOf(selectedCustomer.id);
        const next = appData.find(c => c.id === followUpList[index + direction]);
        if (next) setSelectedCustomer(next);
    }, [selectedCustomer, followUpList, appData]);

    /**
     * The follow-up dialog stays open while entries are logged against the
     * account, and each one writes back. Handing it the row out of appData
     * rather than the copy taken when it opened means the second entry builds
     * on the first instead of rebuilding from a snapshot that no longer has it.
     */
    const liveSelectedCustomer = useMemo(
        () => (selectedCustomer ? appData.find(c => c.id === selectedCustomer.id) || selectedCustomer : null),
        [selectedCustomer, appData],
    );

    const handleCloseModal = () => setSelectedCustomer(null);

    /** The follow-up dialog's save: applied at once, then the server's verdict for that one account. */
    const handleUpdateOutstanding = async (updatedCustomer: Outstanding): Promise<SaveOutcome> => {
        const processedCustomer = processStatuses([updatedCustomer])[0] || updatedCustomer;
        setAppData(current => processStatuses(current.map(item =>
            item.id === processedCustomer.id ? processedCustomer : item
        )));
        return outcomeFor(updatedCustomer.id, await customersSync.flush());
    };

    // Reassign single customer to a CRM
    const handleReassignCrm = (customerId: string, newCrmId: string) => {
        setAppData(current => current.map(item =>
            item.id === customerId ? { ...item, crmOwnerId: newCrmId } : item
        ));
        void customersSync.flush().then(r => {
            const failed = r.failed.find(f => f.id === customerId);
            if (failed) notify('error', `The owner change could not be saved: ${failed.message}. It is kept in this tab and will be retried.`);
        });
    };

    // Bulk reassign multiple customers to a CRM
    /**
     * Grades a whole selection at once.
     *
     * The agency list is hundreds of accounts; deciding which of them are truly
     * stuck is a sit-down job done against a filtered list, not one dialog at a
     * time.
     */
    const handleBulkSetRank = (customerIds: string[], rank: PaymentRank | '') => {
        const idSet = new Set(customerIds);
        setAppData(current => current.map(item =>
            idSet.has(item.id) ? { ...item, paymentRank: rank || undefined } : item
        ));
        void customersSync.flush().then(r => reportBulk(r, customerIds, rank
            ? `Marked ${customerIds.length} account${customerIds.length === 1 ? '' : 's'} as ${PAYMENT_RANK_LABELS[rank]}.`
            : `Cleared the rank on ${customerIds.length} account${customerIds.length === 1 ? '' : 's'}; they go back to being worked out from ageing.`));
    };

    const handleBulkReassignCrm = (customerIds: string[], newCrmId: string) => {
        const idSet = new Set(customerIds);
        setAppData(current => current.map(item =>
            idSet.has(item.id) ? { ...item, crmOwnerId: newCrmId } : item
        ));
        const targetCrmUser = users.find(u => u.id === newCrmId || u.name === newCrmId);
        const targetName = targetCrmUser ? targetCrmUser.name : (newCrmId || 'Unassigned');
        void customersSync.flush().then(r => reportBulk(r, customerIds, `Reassigned ${customerIds.length} customer${customerIds.length === 1 ? '' : 's'} to ${targetName}.`));
    };

    /**
     * Puts one follow-up date on a whole selection — an Admin's tool for the
     * overdue list.
     *
     * A follow-up that has gone past its date is supposed to be rescheduled by
     * the CRM who owns it. When it is not, the account sits in "Overdue" and
     * nobody is prompted to ring. Ticking those rows and setting today brings
     * them back into the day's worklist in one go, instead of opening each
     * account to move a date the owner should have moved.
     *
     * Two things are deliberate. Each account gets a system entry in its
     * activity — who moved the date, from what, and that the owner had left it
     * — so the reschedule is on the record beside the owner's name rather than
     * silently in a column. And `lastFollowUpOn` is left alone: an Admin
     * moving a date is not a follow-up, and pretending it was would hide the
     * very gap this exists to show.
     */
    const handleBulkSetFollowUp = async (customerIds: string[], isoDate: string) => {
        if (!currentUser || currentUser.role !== UserRole.Admin) return;
        const nextDate = dateFromLocalIso(isoDate);
        if (!nextDate) {
            notify('error', 'Pick a follow-up date first.');
            return;
        }
        if (nextDate.getTime() < startOfToday().getTime()) {
            notify('error', 'A follow-up date in the past would be overdue the moment it is set.');
            return;
        }

        const idSet = new Set(customerIds);
        const nextLabel = formatDate(nextDate);
        const changed: Outstanding[] = [];
        const entries: repo.NewActivity[] = [];
        let overdueMoved = 0;

        const updated = appData.map(item => {
            if (!idSet.has(item.id)) return item;

            const prev = item.followUpDate ? new Date(item.followUpDate) : undefined;
            const hadDate = !!prev && !isNaN(prev.getTime());
            const prevMidnight = hadDate ? new Date(prev!).setHours(0, 0, 0, 0) : NaN;
            const wasCompleted = item.status === FollowUpStatus.Completed;
            // Already on that date: nothing to move, nothing to record.
            if (hadDate && !wasCompleted && prevMidnight === nextDate.getTime()) return item;

            const owner = findOwner(users, item.crmOwnerId)?.name || (item.crmOwnerId || '').trim();
            const wasOverdue = getFollowUpCategory(item, startOfToday()) === 'overdue';
            let body: string;
            if (wasCompleted) {
                // "Payment collected" closes an account with the day it was
                // collected as its date, so that date is not a follow-up.
                body = `Follow-up reopened for ${nextLabel} in a bulk update; it had been closed as collected`
                    + (hadDate ? ` on ${formatDate(prev)}.` : '.');
            } else if (hadDate) {
                body = `Follow-up date moved from ${formatDate(prev)} to ${nextLabel} in a bulk update.`;
                if (wasOverdue) {
                    overdueMoved++;
                    const days = Math.max(1, Math.round((startOfToday().getTime() - prevMidnight) / 86_400_000));
                    body += owner
                        ? ` It was ${days} day${days === 1 ? '' : 's'} overdue and ${owner} had not rescheduled it.`
                        : ` It was ${days} day${days === 1 ? '' : 's'} overdue with no CRM assigned to reschedule it.`;
                }
            } else {
                body = `Follow-up date set to ${nextLabel} in a bulk update.`
                    + (owner ? ` No follow-up had been planned by ${owner}.` : ' No follow-up had been planned, and no CRM was assigned.');
            }
            entries.push({ customerId: item.id, kind: 'system', body });

            // Where the follow-up stands is read from the date; the only status
            // written here is the reopening of an account closed as collected,
            // the same way the follow-up form does it.
            const next: Outstanding = { ...item, followUpDate: nextDate, ...(wasCompleted ? { status: FollowUpStatus.Pending } : {}) };
            changed.push(next);
            return next;
        });

        if (!changed.length) {
            notify('success', `Every selected account already has its follow-up on ${nextLabel}.`);
            return;
        }

        setAppData(processStatuses(updated));

        const unchanged = customerIds.length - changed.length;
        reportBulk(await customersSync.flush(), changed.map(c => c.id),
            `Follow-up set to ${nextLabel} on ${changed.length} account${changed.length === 1 ? '' : 's'}`
            + (unchanged ? ` (${unchanged} already had it)` : '')
            + `. Each one's activity records the move`
            + (overdueMoved ? `, and for the ${overdueMoved} that were overdue, that the owner had not rescheduled it.` : '.'),
        );

        // The date is saved regardless; the record is written best-effort and
        // any failure is said out loud rather than swallowed.
        try {
            await repo.addActivities(entries, currentUser);
        } catch (e: any) {
            notify('error', `The dates are saved, but the activity note could not be written: ${e?.message || e}`);
        }
    };

    // WhatsApp Reminder Handler (opens recipient & template selector with 'Other number' option)
    const handleSendWhatsApp = (customer: Outstanding) => {
        setWhatsAppCustomer(customer);
    };

    return {
        customerDialog, closeCustomerDialog: () => setCustomerDialog(null),
        handleOpenAddCustomer, handleOpenEditCustomer, handleSaveCustomer, handleDeleteCustomer, handleExportCustomerExcel,
        selectedCustomer, liveSelectedCustomer, followUpPosition, onBookRowsChange,
        handleOpenFollowUp, handleCloseModal, handleNavigateFollowUp, handleUpdateOutstanding,
        whatsAppCustomer, handleSendWhatsApp, closeWhatsApp: () => setWhatsAppCustomer(null),
        handleReassignCrm, handleBulkSetRank, handleBulkReassignCrm, handleBulkSetFollowUp,
    };
}
