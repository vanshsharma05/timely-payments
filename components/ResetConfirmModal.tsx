import React, { useState } from 'react';
import type { ResetPlan } from '../services/reset';
import { useModal } from './ui/useModal';

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
    const panel = useModal(true, onCancel, { closeOnEscape: !busy });
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex justify-center items-center p-3 sm:p-6 overflow-y-auto max-md:p-0 max-md:items-start">
            <div ref={panel} role="alertdialog" aria-modal="true" aria-labelledby="reset-title" className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col border border-gray-100 dark:border-gray-800 max-md:max-h-none max-md:min-h-[100dvh] max-md:max-w-none max-md:rounded-none">
                <div className="p-5 sm:p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-start">
                    <div>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-300">
                            Complete fresh start
                        </span>
                        <h2 id="reset-title" className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mt-1">
                            This resets the book for the whole team
                        </h2>
                        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
                            The live sheet was read just now{plan.updatedTillDate ? ` (updated till ${plan.updatedTillDate})` : ''}. Everything below happens in one step in the database — all of it, or none of it.
                        </p>
                    </div>
                    <button type="button" onClick={onCancel} disabled={busy} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg" title="Cancel — nothing is written" aria-label="Close">
                        ✕
                    </button>
                </div>

                <div className="p-5 sm:p-6 space-y-5 overflow-y-auto text-sm text-gray-800 dark:text-gray-200">
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

                <div className="p-4 sm:px-6 bg-gray-50 dark:bg-gray-800/80 border-t border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-center gap-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                        Nothing is written until you press the red button.
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={busy}
                            className="px-4 py-2 text-xs font-semibold rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={run}
                            disabled={!ready}
                            className="px-5 py-2 text-xs font-bold rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-900/50 disabled:cursor-not-allowed text-white shadow-sm transition-colors"
                        >
                            {busy ? 'Resetting…' : 'Reset the book'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ResetConfirmModal;
