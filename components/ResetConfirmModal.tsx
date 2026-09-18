import React, { useState } from 'react';
import type { ResetPlan } from '../services/reset';
import { DialogShell } from './ui/DialogShell';
import { Button } from './ui/Primitives';

export interface ResetConfirmModalProps {
    plan: ResetPlan;
    /** Hands the person a copy of the book before anything changes. */
    onDownloadBackup: () => void;
    /** Runs the reset with the phrase typed; rejects with a message when it is refused. */
    onConfirm: (phrase: string) => Promise<void>;
    onCancel: () => void;
}

export const RESET_PHRASE = 'RESET';

/**
 * The last look before a complete fresh start.
 *
 * It replaced a single browser confirm() with a long paragraph. The person
 * now sees exactly what will happen as counts from the sheet just read and
 * the book as loaded, what will not happen, has to take a backup copy, and
 * has to type the word. The database takes its own snapshot as part of the
 * reset itself; the copy downloaded here is the one in their own hands.
 */
export const ResetConfirmModal: React.FC<ResetConfirmModalProps> = ({ plan, onDownloadBackup, onConfirm, onCancel }) => {
    const [downloaded, setDownloaded] = useState(false);
    const [phrase, setPhrase] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { counts } = plan;
    const ready = downloaded && phrase.trim() === RESET_PHRASE && !busy;

    const run = async () => {
        if (!ready) return;
        setBusy(true);
        setError(null);
        try {
            await onConfirm(phrase.trim());
        } catch (e: any) {
            setError(e?.message || 'The reset was refused. Nothing was changed.');
            setBusy(false);
        }
    };

    const n = (v: number, one: string, many = one + 's') => `${v} ${v === 1 ? one : many}`;

    return (
        <DialogShell
            title="This resets the book for the whole team"
            subtitle={<>
                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-dang-bg text-dang mr-2">Complete fresh start</span>
                The live sheet was read just now{plan.updatedTillDate ? ` (updated till ${plan.updatedTillDate})` : ''}. Everything below happens in one step in the database — all of it, or none of it.
            </>}
            role="alertdialog"
            onClose={onCancel}
            closeOnEscape={!busy}
            footerNote="Nothing is written until you press the red button."
            footer={<>
                <Button type="button" variant="quiet" onClick={onCancel} disabled={busy}>Cancel</Button>
                <Button type="button" variant="destructive" onClick={run} disabled={!ready}>
                    {busy ? 'Resetting…' : 'Reset the book'}
                </Button>
            </>}
        >
                <div className="space-y-5 text-sm text-gray-800 dark:text-gray-200">
                    <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-300 mb-2">What will happen</h3>
                        <ul className="space-y-1.5 list-disc pl-5">
                            <li><strong>{n(counts.cheques, 'post-dated cheque')}</strong> deleted.</li>
                            <li>Follow-up work cleared on <strong>every account</strong> ({n(counts.withFollowUpWork, 'account')} carry a date, note, forecast or urgency today): next follow-up date, notes on the card, forecast, urgency flag, "last follow-up".</li>
                            <li>Money re-imported from the sheet for <strong>{n(counts.listed, 'listed account')}</strong>.</li>
                            <li><strong>{n(counts.settled, 'account')}</strong> that still show a balance the sheet no longer carries, settled to nil and stamped{counts.untouched ? ` (${n(counts.untouched, 'account')} already at nil stay as they are)` : ''}.</li>
                            <li><strong>{n(counts.added, 'new account')}</strong> from the sheet added (unassigned).</li>
                            <li>Message template, company profile and data-source settings back to their defaults.</li>
                        </ul>
                    </div>

                    <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-green-700 dark:text-green-300 mb-2">What will not happen</h3>
                        <ul className="space-y-1.5 list-disc pl-5">
                            <li>No account is deleted and none gets a new id — the {n(counts.onFile, 'account')} on file stay the same accounts.</li>
                            <li>CRM owners, collectors, contacts, category, rank, GSTIN/PAN and the activity history on every account are kept.</li>
                            <li>Team logins are not touched.</li>
                        </ul>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 space-y-3">
                        <p className="text-xs text-gray-600 dark:text-gray-300">
                            A snapshot of customers, cheques, templates and settings is saved in the database as part of the reset; an Admin can restore it. Keep a copy of your own as well:
                        </p>
                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                onClick={() => { onDownloadBackup(); setDownloaded(true); }}
                                disabled={busy}
                                className="px-4 py-2 text-xs font-bold rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                Download backup file
                            </button>
                            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                <input type="checkbox" checked={downloaded} onChange={e => setDownloaded(e.target.checked)} disabled={busy} className="rounded" />
                                I have the backup file
                            </label>
                        </div>
                        <label className="block text-xs text-gray-700 dark:text-gray-300">
                            Type <strong className="font-mono">{RESET_PHRASE}</strong> to confirm
                            <input
                                type="text"
                                value={phrase}
                                onChange={e => setPhrase(e.target.value)}
                                disabled={busy}
                                autoComplete="off"
                                spellCheck={false}
                                aria-label="Confirmation phrase"
                                className="mt-1 w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-sm font-mono font-bold text-gray-900 dark:text-white"
                            />
                        </label>
                        {error && (
                            <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-300">{error}</p>
                        )}
                    </div>
                </div>

        </DialogShell>
    );
};

export default ResetConfirmModal;
