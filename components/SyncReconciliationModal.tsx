import React, { useState, useMemo } from 'react';
import { Outstanding, User, UserRole } from '../types';
import { financialsFromSheet, processStatuses } from '../services/googleSheetService';

export interface SyncReconciliationModalProps {
    incomingRecords: Outstanding[];
    existingRecords: Outstanding[];
    users: User[];
    updatedTillDate?: string;
    sourceName?: string;
    onConfirm: (mergedRecords: Outstanding[]) => void;
    onCancel: () => void;
}

export type CrmAssignmentMode = 'keep_earlier' | 'use_new_sync' | 'custom';

export const SyncReconciliationModal: React.FC<SyncReconciliationModalProps> = ({
    incomingRecords,
    existingRecords,
    users,
    updatedTillDate,
    sourceName = 'Google Sheet',
    onConfirm,
    onCancel,
}) => {
    const crmUsers = useMemo(() => users.filter(u => u.role === UserRole.CRM), [users]);

    // Build map of existing records by company normalized name and id
    const existingMap = useMemo(() => {
        const map = new Map<string, Outstanding>();
        existingRecords.forEach(item => {
            map.set(item.company.trim().toLowerCase(), item);
            map.set(item.id, item);
        });
        return map;
    }, [existingRecords]);

    // Analyze overlapping, differing, and new records
    const analysis = useMemo(() => {
        let matchedCount = 0;
        let diffCrmCount = 0;
        let newAccountsCount = 0;

        const customerRows = incomingRecords.map(incoming => {
            const key = incoming.company.trim().toLowerCase();
            const existing = existingMap.get(key) || existingMap.get(incoming.id);

            const earlierCrm = existing?.crmOwnerId?.trim() || '';
            const newCrm = incoming.crmOwnerId?.trim() || '';
            const isMatched = !!existing;
            const isCrmDiff = isMatched && earlierCrm.toUpperCase() !== newCrm.toUpperCase();

            if (isMatched) {
                matchedCount++;
                if (isCrmDiff) diffCrmCount++;
            } else {
                newAccountsCount++;
            }

            return {
                id: incoming.id,
                company: incoming.company,
                total: incoming.total,
                isMatched,
                isCrmDiff,
                earlierCrm,
                newCrm,
                // Default chosen CRM starts as earlier if matched, else new
                chosenCrm: earlierCrm || newCrm,
                existingRecord: existing,
                incomingRecord: incoming
            };
        });

        return {
            customerRows,
            totalIncoming: incomingRecords.length,
            matchedCount,
            diffCrmCount,
            newAccountsCount,
            retainedCount: existingRecords.filter(
                e => !incomingRecords.some(i => i.company.trim().toLowerCase() === e.company.trim().toLowerCase())
            ).length,
        };
    }, [incomingRecords, existingMap]);

    const [assignmentMode, setAssignmentMode] = useState<CrmAssignmentMode>('keep_earlier');
    
    // Per-customer custom CRM selections (customerId -> chosenCrm)
    const [customAssignments, setCustomAssignments] = useState<Record<string, string>>(() => {
        const initial: Record<string, string> = {};
        analysis.customerRows.forEach(r => {
            initial[r.id] = r.earlierCrm || r.newCrm;
        });
        return initial;
    });

    const [searchTerm, setSearchTerm] = useState('');
    const [viewFilter, setViewFilter] = useState<'all' | 'diff_only' | 'new_only'>('all');

    // Handle global mode changes
    const handleModeChange = (mode: CrmAssignmentMode) => {
        setAssignmentMode(mode);
        const updated: Record<string, string> = {};
        analysis.customerRows.forEach(r => {
            if (mode === 'keep_earlier') {
                updated[r.id] = r.earlierCrm || r.newCrm;
            } else if (mode === 'use_new_sync') {
                updated[r.id] = r.newCrm || r.earlierCrm;
            } else {
                updated[r.id] = customAssignments[r.id] || (r.earlierCrm || r.newCrm);
            }
        });
        setCustomAssignments(updated);
    };

    const handleSingleCustomerCrmChange = (id: string, crm: string) => {
        setCustomAssignments(prev => ({
            ...prev,
            [id]: crm
        }));
        if (assignmentMode !== 'custom') {
            setAssignmentMode('custom');
        }
    };

    const handleSetAllToEarlier = () => {
        const updated: Record<string, string> = {};
        analysis.customerRows.forEach(r => {
            updated[r.id] = r.earlierCrm || r.newCrm;
        });
        setCustomAssignments(updated);
        setAssignmentMode('keep_earlier');
    };

    const handleSetAllToNew = () => {
        const updated: Record<string, string> = {};
        analysis.customerRows.forEach(r => {
            updated[r.id] = r.newCrm || r.earlierCrm;
        });
        setCustomAssignments(updated);
        setAssignmentMode('use_new_sync');
    };

    const filteredRows = useMemo(() => {
        return analysis.customerRows.filter(r => {
            if (viewFilter === 'diff_only' && !r.isCrmDiff) return false;
            if (viewFilter === 'new_only' && r.isMatched) return false;
            if (!searchTerm.trim()) return true;

            const q = searchTerm.toLowerCase();
            return (
                r.company.toLowerCase().includes(q) ||
                r.earlierCrm.toLowerCase().includes(q) ||
                r.newCrm.toLowerCase().includes(q) ||
                (customAssignments[r.id] && customAssignments[r.id].toLowerCase().includes(q))
            );
        });
    }, [analysis.customerRows, viewFilter, searchTerm, customAssignments]);

    const handleApplySync = () => {
        // Construct final merged list
        const matchedIds = new Set<string>();
        const merged: Outstanding[] = incomingRecords.map(item => {
            const key = item.company.trim().toLowerCase();
            const existing = existingMap.get(key) || existingMap.get(item.id);
            if (existing) matchedIds.add(existing.id);

            // Determine final CRM
            let finalCrm = item.crmOwnerId;
            if (assignmentMode === 'keep_earlier' && existing?.crmOwnerId) {
                finalCrm = existing.crmOwnerId;
            } else if (assignmentMode === 'use_new_sync') {
                finalCrm = item.crmOwnerId || existing?.crmOwnerId || '';
            } else if (assignmentMode === 'custom' && customAssignments[item.id]) {
                finalCrm = customAssignments[item.id];
            } else if (existing?.crmOwnerId) {
                finalCrm = existing.crmOwnerId;
            }

            if (existing) {
                // Start from the row on file and overwrite only what the sheet
                // is the authority on. Building from the sheet row instead threw
                // away credit limits, GSTINs, designations, extra contacts and
                // expected collections on every account it matched.
                return {
                    ...existing,
                    ...financialsFromSheet(item),
                    crmOwnerId: finalCrm,
                    isNewCustomer: false,
                    contactPerson:
                        existing.contactPerson && existing.contactPerson !== 'Accounts Dept'
                            ? existing.contactPerson
                            : item.contactPerson,
                    contactNumber: existing.contactNumber || item.contactNumber,
                    email: existing.email || item.email,
                };
            }

            // Brand new customer record detected from sync
            return {
                ...item,
                crmOwnerId: finalCrm,
                isNewCustomer: true,
                addedAt: new Date().toISOString(),
            };
        });

        // Accounts this sheet does not mention are kept, not deleted.
        const retained = existingRecords.filter(item => !matchedIds.has(item.id));
        const finalProcessed = processStatuses([...merged, ...retained]);
        onConfirm(finalProcessed);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex justify-center items-center p-3 sm:p-6 overflow-y-auto">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col border border-gray-100 dark:border-gray-800">
                {/* Header */}
                <div className="p-5 sm:p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 dark:bg-green-900/60 text-green-800 dark:text-green-300">
                                Data Sync Review
                            </span>
                            {updatedTillDate && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                    Updated till: <strong className="text-gray-700 dark:text-gray-200">{updatedTillDate}</strong>
                                </span>
                            )}
                        </div>
                        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mt-1">
                            Review CRM Assignments for Synced Data
                        </h2>
                        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {analysis.totalIncoming} records loaded from {sourceName}. Choose whether to retain previously assigned CRMs or apply new assignments from the sync.
                        </p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg"
                        title="Cancel Sync"
                    >
                        ✕
                    </button>
                </div>

                {/* KPI Overview Pills */}
                <div className="px-5 sm:px-6 py-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700/60 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <span className="text-gray-500 dark:text-gray-400 block">Total Synced</span>
                        <span className="text-lg font-bold text-gray-900 dark:text-white">{analysis.totalIncoming}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <span className="text-gray-500 dark:text-gray-400 block">Existing Accounts</span>
                        <span className="text-lg font-bold text-blue-600 dark:text-blue-400">{analysis.matchedCount}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <span className="text-gray-500 dark:text-gray-400 block">CRM Changed/Differs</span>
                        <span className="text-lg font-bold text-amber-600 dark:text-amber-400">{analysis.diffCrmCount}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <span className="text-gray-500 dark:text-gray-400 block">New Accounts</span>
                        <span className="text-lg font-bold text-green-600 dark:text-green-400">{analysis.newAccountsCount}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <span className="text-gray-500 dark:text-gray-400 block" title="Accounts already in the book that this sheet does not list. They are kept, not deleted.">Kept (not in sheet)</span>
                        <span className="text-lg font-bold text-gray-600 dark:text-gray-300">{analysis.retainedCount}</span>
                    </div>
                </div>

                {/* Assignment Strategy Selector */}
                <div className="p-5 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                        Assignment Strategy
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <button
                            type="button"
                            onClick={() => handleModeChange('keep_earlier')}
                            className={`text-left p-3.5 rounded-xl border-2 transition-all ${
                                assignmentMode === 'keep_earlier'
                                    ? 'border-green-600 bg-green-50/70 dark:bg-green-950/40 ring-1 ring-green-500'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-sm text-gray-900 dark:text-white">Keep Earlier Assigned CRM</span>
                                <input
                                    type="radio"
                                    name="crm_strategy"
                                    checked={assignmentMode === 'keep_earlier'}
                                    onChange={() => handleModeChange('keep_earlier')}
                                    className="text-green-600 dark:text-green-400 focus:ring-green-500"
                                />
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                                Retain all previously assigned CRMs for existing customers. New customers take CRM from sync.
                            </p>
                        </button>

                        <button
                            type="button"
                            onClick={() => handleModeChange('use_new_sync')}
                            className={`text-left p-3.5 rounded-xl border-2 transition-all ${
                                assignmentMode === 'use_new_sync'
                                    ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 ring-1 ring-blue-500'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-sm text-gray-900 dark:text-white">Update to New Synced CRM</span>
                                <input
                                    type="radio"
                                    name="crm_strategy"
                                    checked={assignmentMode === 'use_new_sync'}
                                    onChange={() => handleModeChange('use_new_sync')}
                                    className="text-blue-600 dark:text-blue-400 focus:ring-blue-500"
                                />
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                                Overwrite CRM assignments with the newly synced spreadsheet/file data.
                            </p>
                        </button>

                        <button
                            type="button"
                            onClick={() => handleModeChange('custom')}
                            className={`text-left p-3.5 rounded-xl border-2 transition-all ${
                                assignmentMode === 'custom'
                                    ? 'border-purple-600 bg-purple-50/70 dark:bg-purple-950/40 ring-1 ring-purple-500'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-sm text-gray-900 dark:text-white">Custom Per-Customer</span>
                                <input
                                    type="radio"
                                    name="crm_strategy"
                                    checked={assignmentMode === 'custom'}
                                    onChange={() => handleModeChange('custom')}
                                    className="text-purple-600 focus:ring-purple-500"
                                />
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                                Manually select or toggle the CRM owner for individual customers below.
                            </p>
                        </button>
                    </div>
                </div>

                {/* Customer Table Filter & Controls */}
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
                            All ({analysis.totalIncoming})
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewFilter('diff_only')}
                            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                                viewFilter === 'diff_only'
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700'
                            }`}
                        >
                            CRM Changed ({analysis.diffCrmCount})
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewFilter('new_only')}
                            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                                viewFilter === 'new_only'
                                    ? 'bg-green-600 text-white'
                                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700'
                            }`}
                        >
                            New Accounts ({analysis.newAccountsCount})
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            placeholder="Search company, CRM..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full sm:w-56 px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                        <button
                            type="button"
                            onClick={handleSetAllToEarlier}
                            className="px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
                            title="Set all to earlier CRM"
                        >
                            Reset Earlier
                        </button>
                        <button
                            type="button"
                            onClick={handleSetAllToNew}
                            className="px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
                            title="Set all to new synced CRM"
                        >
                            Set All New
                        </button>
                    </div>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-y-auto min-h-[260px] max-h-[420px] divide-y divide-gray-100 dark:divide-gray-800">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-xs">
                        <thead className="bg-gray-100/70 dark:bg-gray-800/80 sticky top-0 z-10">
                            <tr>
                                <th className="px-4 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">Customer Company</th>
                                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">Total Due</th>
                                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">Earlier Assigned CRM</th>
                                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">New Synced CRM</th>
                                <th className="px-4 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">Assign To CRM (Final)</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
                            {filteredRows.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-8 text-gray-400">
                                        No customer records match the current filter.
                                    </td>
                                </tr>
                            ) : (
                                filteredRows.map(row => {
                                    const selectedCrm = customAssignments[row.id] || row.chosenCrm;
                                    const hasConflict = row.isCrmDiff;

                                    return (
                                        <tr
                                            key={row.id}
                                            className={`hover:bg-gray-50/80 dark:hover:bg-gray-800/50 transition-colors ${
                                                hasConflict ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''
                                            }`}
                                        >
                                            <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                                                <div className="flex items-center gap-1.5">
                                                    <span>{row.company}</span>
                                                    {!row.isMatched && (
                                                        <span className="px-1.5 py-0.5 rounded text-[11.5px] font-bold bg-green-100 dark:bg-green-900/60 text-green-700 dark:text-green-300">
                                                            NEW
                                                        </span>
                                                    )}
                                                    {hasConflict && (
                                                        <span className="px-1.5 py-0.5 rounded text-[11.5px] font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
                                                            CRM DIFF
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                                {formatCurrency(row.total)}
                                            </td>
                                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">
                                                {row.earlierCrm ? (
                                                    <span className="px-2 py-0.5 rounded font-medium bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200">
                                                        {row.earlierCrm}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 italic">None (New)</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">
                                                {row.newCrm ? (
                                                    <span className={`px-2 py-0.5 rounded font-medium ${
                                                        hasConflict
                                                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 font-bold'
                                                            : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200'
                                                    }`}>
                                                        {row.newCrm}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 italic">Unspecified</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <div className="flex items-center gap-1.5">
                                                    <select
                                                        aria-label="CRM owner for this account"
                                                        value={selectedCrm}
                                                        onChange={e => handleSingleCustomerCrmChange(row.id, e.target.value)}
                                                        className="px-2.5 py-1 border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-green-500"
                                                    >
                                                        {row.earlierCrm && !crmUsers.some(u => u.name.toUpperCase() === row.earlierCrm.toUpperCase() || u.id.toUpperCase() === row.earlierCrm.toUpperCase()) && (
                                                            <option value={row.earlierCrm}>{row.earlierCrm} (Earlier)</option>
                                                        )}
                                                        {row.newCrm && !crmUsers.some(u => u.name.toUpperCase() === row.newCrm.toUpperCase() || u.id.toUpperCase() === row.newCrm.toUpperCase()) && (
                                                            <option value={row.newCrm}>{row.newCrm} (Sheet)</option>
                                                        )}
                                                        {crmUsers.map(user => (
                                                            <option key={user.id} value={user.id}>
                                                                {user.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    
                                                    {row.earlierCrm && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSingleCustomerCrmChange(row.id, row.earlierCrm)}
                                                            className={`px-1.5 py-0.5 text-[11.5px] font-medium rounded ${
                                                                selectedCrm === row.earlierCrm
                                                                    ? 'bg-green-100 text-green-800 font-bold dark:bg-green-900/60 dark:text-green-300'
                                                                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'
                                                            }`}
                                                            title="Use Earlier CRM"
                                                        >
                                                            Earlier
                                                        </button>
                                                    )}
                                                    {row.newCrm && row.newCrm !== row.earlierCrm && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSingleCustomerCrmChange(row.id, row.newCrm)}
                                                            className={`px-1.5 py-0.5 text-[11.5px] font-medium rounded ${
                                                                selectedCrm === row.newCrm
                                                                    ? 'bg-blue-100 text-blue-800 font-bold dark:bg-blue-900/60 dark:text-blue-300'
                                                                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'
                                                            }`}
                                                            title="Use New Synced CRM"
                                                        >
                                                            New
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer Controls */}
                <div className="p-4 sm:px-6 bg-gray-50 dark:bg-gray-800/80 border-t border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-center gap-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                        <strong>Note:</strong> All follow-up history, notes, next follow-up dates, and collector assignments are safely preserved.
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
                            <span>Apply Sync & Update Dashboard</span>
                            <span className="px-1.5 py-0.5 rounded-full bg-green-700 text-[11.5px]">
                                {analysis.totalIncoming} records
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SyncReconciliationModal;
