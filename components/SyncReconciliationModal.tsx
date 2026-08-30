import React, { useState, useMemo } from 'react';
import { Outstanding, companyKey } from '../types';
import { mergeWithExistingFollowUps, needsClearing } from '../services/googleSheetService';

export interface SyncReconciliationModalProps {
    incomingRecords: Outstanding[];
    existingRecords: Outstanding[];
    updatedTillDate?: string;
    sourceName?: string;
    onConfirm: (mergedRecords: Outstanding[]) => void;
    onCancel: () => void;
}

/** What the import will do to one account. */
type Effect = 'updated' | 'added' | 'settled';

interface ReviewRow {
    id: string;
    company: string;
    effect: Effect;
    /** The balance after the import. */
    amount: number;
    /** What it was before — only interesting on a settled row. */
    was: number;
}

/**
 * The last look before an import is written.
 *
 * It used to ask which CRM should win, the sheet's or the app's. That question
 * is gone: the outstanding sheet is the ledger of what is owed and nothing more,
 * and who owns an account is decided in the app. So this is now a plain preview
 * of three things — what gets new figures, what arrives as a new customer, and
 * what gets settled to nil because the sheet has stopped listing it.
 *
 * Nothing is recomputed here. Confirming runs mergeWithExistingFollowUps(), the
 * same function a sync runs when there is nothing to review, so what is shown
 * and what is written cannot drift apart.
 */
export const SyncReconciliationModal: React.FC<SyncReconciliationModalProps> = ({
    incomingRecords,
    existingRecords,
    updatedTillDate,
    sourceName = 'Google Sheet',
    onConfirm,
    onCancel,
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [viewFilter, setViewFilter] = useState<'all' | 'added' | 'settled'>('all');

    const analysis = useMemo(() => {
        const existingByKey = new Map<string, Outstanding>();
        existingRecords.forEach(item => {
            existingByKey.set(companyKey(item.company), item);
            existingByKey.set(item.id, item);
        });

        const rows: ReviewRow[] = [];
        const matchedIds = new Set<string>();
        let updatedCount = 0;
        let addedCount = 0;

        incomingRecords.forEach(item => {
            const existing = existingByKey.get(companyKey(item.company)) || existingByKey.get(item.id);
            if (existing) matchedIds.add(existing.id);
            if (existing) updatedCount++;
            else addedCount++;

            rows.push({
                id: item.id,
                company: item.company,
                effect: existing ? 'updated' : 'added',
                amount: item.total || 0,
                was: existing?.total || 0,
            });
        });

        // On file, not in this sheet. The sheet is the whole of what is owed, so
        // a balance still standing against one of these has been paid.
        const unlisted = existingRecords.filter(item => !matchedIds.has(item.id));
        const settling = unlisted.filter(needsClearing);
        settling.forEach(item => {
            rows.push({
                id: item.id,
                company: item.company,
                effect: 'settled',
                amount: 0,
                was: item.total || 0,
            });
        });

        return {
            rows,
            totalIncoming: incomingRecords.length,
            updatedCount,
            addedCount,
            untouchedCount: unlisted.length - settling.length,
            settledCount: settling.length,
            settledAmount: settling.reduce((sum, i) => sum + Math.abs(Number(i.total) || 0), 0),
        };
    }, [incomingRecords, existingRecords]);

    const filteredRows = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        return analysis.rows.filter(row => {
            if (viewFilter === 'added' && row.effect !== 'added') return false;
            if (viewFilter === 'settled' && row.effect !== 'settled') return false;
            if (!q) return true;
            return row.company.toLowerCase().includes(q);
        });
    }, [analysis.rows, viewFilter, searchTerm]);

    const formatCurrency = (amount: number) =>
        new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

    const handleApplySync = () => {
        onConfirm(mergeWithExistingFollowUps(existingRecords, incomingRecords));
    };

    const EFFECT: Record<Effect, { label: string; chip: string }> = {
        updated: {
            label: 'Figures updated',
            chip: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
        },
        added: {
            label: 'New customer — needs a CRM',
            chip: 'bg-green-100 dark:bg-green-900/60 text-green-800 dark:text-green-300',
        },
        settled: {
            label: 'Not in sheet — settled to zero',
            chip: 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300',
        },
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex justify-center items-center p-3 sm:p-6 overflow-y-auto">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col border border-gray-100 dark:border-gray-800">
                {/* Header */}
                <div className="p-5 sm:p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 dark:bg-green-900/60 text-green-800 dark:text-green-300">
                                Outstanding Import
                            </span>
                            {updatedTillDate && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                    Updated till: <strong className="text-gray-700 dark:text-gray-200">{updatedTillDate}</strong>
                                </span>
                            )}
                        </div>
                        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mt-1">
                            Review before the balances are updated
                        </h2>
                        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {analysis.totalIncoming} rows read from {sourceName}. This changes money only — contact
                            details, CRM owners, follow-ups and cheques are left exactly as they are.
                        </p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg"
                        title="Cancel — nothing is written"
                    >
                        ✕
                    </button>
                </div>

                {/* What this import does */}
                <div className="px-5 sm:px-6 py-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <span className="text-gray-500 dark:text-gray-400 block">Rows in sheet</span>
                        <span className="text-lg font-bold text-gray-900 dark:text-white">{analysis.totalIncoming}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <span className="text-gray-500 dark:text-gray-400 block">Existing accounts updated</span>
                        <span className="text-lg font-bold text-blue-600 dark:text-blue-400">{analysis.updatedCount}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <span
                            className="text-gray-500 dark:text-gray-400 block"
                            title="Names in the sheet that are not in the customer list yet. They are added so their money is counted, with no CRM against them — assign one from the customer list."
                        >
                            New customers
                        </span>
                        <span className="text-lg font-bold text-green-600 dark:text-green-400">{analysis.addedCount}</span>
                        {analysis.addedCount > 0 && (
                            <span className="block text-[11px] text-green-700 dark:text-green-400 font-semibold leading-tight mt-0.5">
                                will need a CRM
                            </span>
                        )}
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <span
                            className="text-gray-500 dark:text-gray-400 block"
                            title="Accounts in the book that this sheet does not list. The customer, their contacts, cheques and history stay — only the balance goes to zero, because the sheet is the whole of what is owed."
                        >
                            Settled to zero
                        </span>
                        <span className="text-lg font-bold text-amber-600 dark:text-amber-400">{analysis.settledCount}</span>
                        {analysis.settledCount > 0 && (
                            <span className="block text-[11px] text-amber-600 dark:text-amber-400 font-semibold leading-tight mt-0.5">
                                {formatCurrency(analysis.settledAmount)} written off
                            </span>
                        )}
                    </div>
                </div>

                {/* Filters */}
                <div className="p-4 sm:px-6 bg-gray-50/70 dark:bg-gray-800/40 border-b border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setViewFilter('all')}
                            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                                viewFilter === 'all'
                                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700'
                            }`}
                        >
                            Everything ({analysis.rows.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewFilter('added')}
                            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                                viewFilter === 'added'
                                    ? 'bg-green-600 text-white'
                                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700'
                            }`}
                        >
                            New customers ({analysis.addedCount})
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewFilter('settled')}
                            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                                viewFilter === 'settled'
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700'
                            }`}
                        >
                            Settled ({analysis.settledCount})
                        </button>
                    </div>

                    <input
                        type="text"
                        placeholder="Search company…"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full sm:w-56 px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                </div>

                {/* Table */}
                <div className="flex-1 overflow-y-auto min-h-[260px] max-h-[420px]">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-xs">
                        <thead className="bg-gray-100/70 dark:bg-gray-800/80 sticky top-0 z-10">
                            <tr>
                                <th className="px-4 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">Customer</th>
                                <th className="px-3 py-2.5 text-right font-semibold text-gray-600 dark:text-gray-300">Balance now</th>
                                <th className="px-3 py-2.5 text-right font-semibold text-gray-600 dark:text-gray-300">After import</th>
                                <th className="px-4 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">What happens</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
                            {filteredRows.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="text-center py-8 text-gray-400">
                                        Nothing matches the current filter.
                                    </td>
                                </tr>
                            ) : (
                                filteredRows.slice(0, 400).map(row => (
                                    <tr
                                        key={`${row.effect}_${row.id}`}
                                        className={`hover:bg-gray-50/80 dark:hover:bg-gray-800/50 transition-colors ${
                                            row.effect === 'settled' ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''
                                        }`}
                                    >
                                        <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{row.company}</td>
                                        <td className="px-3 py-2.5 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                            {row.effect === 'added' ? '—' : formatCurrency(row.was)}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-semibold text-gray-800 dark:text-gray-200 whitespace-nowrap">
                                            {formatCurrency(row.amount)}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <span className={`px-2 py-0.5 rounded font-semibold ${EFFECT[row.effect].chip}`}>
                                                {EFFECT[row.effect].label}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                    {filteredRows.length > 400 && (
                        <p className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                            Showing the first 400 of {filteredRows.length}. Search to narrow it down.
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 sm:px-6 bg-gray-50 dark:bg-gray-800/80 border-t border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-center gap-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                        {analysis.untouchedCount > 0 && (
                            <span>{analysis.untouchedCount} account{analysis.untouchedCount === 1 ? '' : 's'} already at zero are untouched. </span>
                        )}
                        <strong>Follow-ups, notes, contacts, cheques and CRM owners are kept.</strong>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-4 py-2 text-xs font-semibold rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleApplySync}
                            className="px-5 py-2 text-xs font-bold rounded-xl bg-green-600 hover:bg-green-700 text-white shadow-sm transition-colors flex items-center gap-1.5"
                        >
                            <span>Update balances</span>
                            <span className="px-1.5 py-0.5 rounded-full bg-green-700 text-[11.5px]">
                                {analysis.totalIncoming} rows
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SyncReconciliationModal;
