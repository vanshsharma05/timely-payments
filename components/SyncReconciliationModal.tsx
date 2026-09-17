import React, { useState, useMemo } from 'react';
import { Outstanding } from '../types';
import { mergeWithExistingFollowUps } from '../services/googleSheetService';
import { previewSync, SyncEffect } from '../services/syncPreview';
import { formatINR, formatCompact } from './ui/format';
import { useModal } from './ui/useModal';

export interface SyncReconciliationModalProps {
    incomingRecords: Outstanding[];
    existingRecords: Outstanding[];
    updatedTillDate?: string;
    sourceName?: string;
    onConfirm: (mergedRecords: Outstanding[]) => void;
    onCancel: () => void;
}

const EFFECT: Record<SyncEffect, { label: string; chip: string; hint: string }> = {
    changed: { label: 'Figures change', chip: 'bg-accent-tint text-accent', hint: 'The sheet has different figures for this account — the balance, or how it is aged; the book takes them.' },
    added: { label: 'New customer — needs a CRM', chip: 'bg-pos-bg text-pos', hint: 'A name the customer list has never seen. Added so its money is counted, with no owner yet.' },
    settled: { label: 'Not in sheet — settled to zero', chip: 'bg-warn-bg text-warn', hint: 'The sheet no longer lists this account, so its balance goes to zero. The customer, contacts, cheques and history stay.' },
    unchanged: { label: 'Same as before', chip: 'bg-card-3 text-label-3', hint: 'The sheet and the book already agree; nothing is written.' },
};

/**
 * The last look before an import is written.
 *
 * It now says what actually changes. Every account the sheet listed used to
 * be marked "Figures updated" — 684 on a morning when ten had moved — so a
 * person could not tell a routine refresh from a re-cut sheet. The rows are
 * grouped by what happens, changes first, and the button names the count.
 *
 * Nothing is recomputed here. Confirming runs mergeWithExistingFollowUps(),
 * the same function a sync runs when there is nothing to review, so what is
 * shown and what is written cannot drift apart.
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
    const [viewFilter, setViewFilter] = useState<'all' | SyncEffect>('all');
    const panel = useModal(true, onCancel);

    const preview = useMemo(() => previewSync(existingRecords, incomingRecords), [incomingRecords, existingRecords]);

    const filteredRows = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        return preview.rows.filter(row => {
            if (viewFilter !== 'all' && row.effect !== viewFilter) return false;
            if (!q) return true;
            return row.company.toLowerCase().includes(q);
        });
    }, [preview.rows, viewFilter, searchTerm]);

    const handleApplySync = () => {
        onConfirm(mergeWithExistingFollowUps(existingRecords, incomingRecords));
    };

    const nothingMoves = preview.changed === 0 && preview.added === 0 && preview.settled === 0;
    const chips: { key: 'all' | SyncEffect; label: string; count: number }[] = [
        { key: 'all', label: 'Everything', count: preview.rows.length },
        { key: 'changed', label: 'Figures change', count: preview.changed },
        { key: 'added', label: 'New customers', count: preview.added },
        { key: 'settled', label: 'Settled to zero', count: preview.settled },
        { key: 'unchanged', label: 'Unchanged', count: preview.unchanged },
    ];

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex justify-center items-center p-3 sm:p-6 overflow-y-auto max-md:p-0 max-md:items-start">
            <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="sync-review-title" className="bg-card rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col border border-separator max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:my-0">
                {/* Header */}
                <div className="px-5 sm:px-6 py-4 border-b border-separator flex justify-between items-start bg-card-2 rounded-t-2xl max-md:rounded-none">
                    <div className="min-w-0">
                        <h2 id="sync-review-title" className="text-[19px] font-extrabold text-label tracking-[-0.02em]">
                            Review before the balances are updated
                        </h2>
                        <p className="text-[13px] text-label-2 mt-1">
                            {preview.incoming.toLocaleString('en-IN')} rows read from {sourceName}
                            {updatedTillDate ? <> · sheet updated till <strong className="text-label">{updatedTillDate}</strong></> : null}.
                            {' '}Only balances and ageing change — contacts, CRM owners, follow-ups, notes and cheques are left exactly as they are.
                        </p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl font-bold p-1 leading-none rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex-none"
                        title="Cancel — nothing is written (Esc)"
                        aria-label="Close"
                    >
                        &times;
                    </button>
                </div>

                {/* What this sync does, in four numbers */}
                <div className="px-5 sm:px-6 py-3 border-b border-separator grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {([
                        ['changed', 'Figures change', preview.changed, preview.changed ? `${preview.balancesMoved} balance${preview.balancesMoved === 1 ? '' : 's'} move (${preview.netChange >= 0 ? '+' : '−'}${formatCompact(Math.abs(preview.netChange))}) · ${preview.changed - preview.balancesMoved} ageing only` : 'the sheet and the book agree', 'text-accent'],
                        ['added', 'New customers', preview.added, preview.added ? 'will need a CRM owner' : 'none this time', 'text-pos'],
                        ['settled', 'Settled to zero', preview.settled, preview.settled ? `${formatCompact(preview.settledAmount)} no longer listed` : 'none this time', 'text-warn'],
                        ['unchanged', 'Unchanged', preview.unchanged, 'same figures as before', 'text-label-2'],
                    ] as const).map(([key, label, count, sub, tone]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setViewFilter(viewFilter === key ? 'all' : key)}
                            aria-pressed={viewFilter === key}
                            title={EFFECT[key].hint}
                            className={`text-left rounded-[12px] px-3 py-2 transition-colors ${viewFilter === key ? 'bg-accent-tint ring-2 ring-accent' : 'bg-card-2 hover:bg-hover'}`}
                        >
                            <span className="block text-[11.5px] font-bold uppercase tracking-wider text-label-3">{label}</span>
                            <span className={`num block text-[22px] font-semibold leading-tight mt-0.5 ${count === 0 ? 'text-label-3' : tone}`}>{count.toLocaleString('en-IN')}</span>
                            <span className="block text-[12px] text-label-3 mt-0.5 truncate">{sub}</span>
                        </button>
                    ))}
                </div>

                {/* Filters */}
                <div className="px-4 sm:px-6 py-2.5 border-b border-separator flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2">
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
                        {chips.map(c => (
                            <button
                                key={c.key}
                                type="button"
                                onClick={() => setViewFilter(c.key)}
                                aria-pressed={viewFilter === c.key}
                                className={`h-8 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
                                    viewFilter === c.key ? 'bg-accent text-on-accent shadow-e1' : 'bg-card text-label-2 border border-separator-strong hover:bg-hover hover:text-label'
                                }`}
                            >
                                {c.label} <span className="num opacity-80">({c.count.toLocaleString('en-IN')})</span>
                            </button>
                        ))}
                    </div>
                    <input
                        type="text"
                        placeholder="Search customer…"
                        aria-label="Search customer"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full sm:w-56 h-9 px-3 text-[13px] bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40"
                    />
                </div>

                {/* Table */}
                <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[420px] max-md:max-h-none">
                    <table className="min-w-full divide-y divide-separator text-xs">
                        <thead className="bg-card-2 sticky top-0 z-10 text-[11.5px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            <tr>
                                <th className="px-4 py-2.5 text-left">Customer</th>
                                <th className="px-3 py-2.5 text-right">Balance now</th>
                                <th className="px-3 py-2.5 text-right">After sync</th>
                                <th className="px-4 py-2.5 text-left">What happens</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-separator">
                            {filteredRows.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="text-center py-8 text-label-3">
                                        Nothing matches.
                                    </td>
                                </tr>
                            ) : (
                                filteredRows.slice(0, 400).map(row => {
                                    const delta = row.after - row.before;
                                    return (
                                        <tr key={`${row.effect}_${row.id}`} className={`hover:bg-hover transition-colors ${row.effect === 'unchanged' ? 'text-label-3' : ''}`}>
                                            <td className="px-4 py-2 font-semibold text-label">{row.company}</td>
                                            <td className="px-3 py-2 text-right num text-label-3 whitespace-nowrap">
                                                {row.effect === 'added' ? '—' : formatINR(row.before)}
                                            </td>
                                            <td className="px-3 py-2 text-right whitespace-nowrap">
                                                <span className={`num font-semibold ${row.effect === 'unchanged' ? 'text-label-3' : 'text-label'}`}>{formatINR(row.after)}</span>
                                                {row.effect === 'changed' && delta !== 0 && (
                                                    <span className={`num block text-[11px] ${delta > 0 ? 'text-dang' : 'text-pos'}`}>{delta > 0 ? '+' : '−'}{formatINR(Math.abs(delta))}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap ${EFFECT[row.effect].chip}`} title={row.effect === 'changed' && !row.balanceMoves ? 'The balance is the same; how it is aged (the buckets or the over-90 figures) changed.' : EFFECT[row.effect].hint}>
                                                    {row.effect === 'changed' ? (row.balanceMoves ? 'Balance changes' : 'Ageing changes · same balance') : EFFECT[row.effect].label}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                    {filteredRows.length > 400 && (
                        <p className="px-4 py-3 text-xs text-label-3">
                            Showing the first 400 of {filteredRows.length.toLocaleString('en-IN')}. Search to narrow it down.
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 sm:px-6 py-3.5 bg-card-2 border-t border-separator flex flex-col sm:flex-row justify-between items-center gap-3 rounded-b-2xl max-md:rounded-none max-md:pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <div className="text-[12.5px] text-label-2">
                        {nothingMoves
                            ? <strong className="text-label">Nothing changes — the book already matches the sheet.</strong>
                            : <strong className="text-label">Follow-ups, notes, contacts, cheques and CRM owners are kept.</strong>}
                        {preview.untouched > 0 && <span> {preview.untouched.toLocaleString('en-IN')} account{preview.untouched === 1 ? '' : 's'} not in the sheet were already at zero.</span>}
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end max-md:[&>button]:flex-1 max-md:[&>button]:min-h-[44px]">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="h-9 px-4 rounded-full text-[13px] font-semibold bg-card border border-separator-strong text-label-2 hover:bg-hover hover:text-label"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleApplySync}
                            title={nothingMoves ? 'Records that the book was checked against the sheet just now; nothing else is written' : `Writes the ${preview.changed + preview.added + preview.settled} changes above`}
                            className="h-9 px-4 rounded-full text-[13px] font-semibold bg-accent text-on-accent hover:bg-accent-press shadow-e1 inline-flex items-center gap-2 whitespace-nowrap"
                        >
                            <span>Update balances</span>
                            <span className="num px-1.5 py-0.5 rounded-full bg-black/15 text-[11.5px]">{preview.incoming} rows</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SyncReconciliationModal;
