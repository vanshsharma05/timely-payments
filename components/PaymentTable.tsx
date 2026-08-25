
import React, { useState } from 'react';
import { Outstanding, User, UserRole, FollowUpStatus, PdcCheque, PdcStatus } from '../types';
import StatusBadge from './StatusBadge';
import { FireIcon, WhatsAppIcon, UsersIcon, ChequeIcon } from './icons/Icons';
import BalanceAmount from './BalanceAmount';


interface OutstandingTableProps {
    outstandingData: Outstanding[];
    onFollowUp: (customer: Outstanding) => void;
    onWhatsApp: (customer: Outstanding) => void;
    users: User[];
    isAdmin?: boolean;
    onReassignCrm?: (customerId: string, newCrmId: string) => void;
    onBulkReassignCrm?: (customerIds: string[], newCrmId: string) => void;
    pdcCheques?: PdcCheque[];
    onOpenPdcForCustomer?: (customerId: string) => void;
}

export type TableAgeingFilter = 'all' | 'dueOver45' | 'over90' | 'over135' | '1-45' | '46-90' | '91-135';

const OutstandingTable = ({ 
    outstandingData, 
    onFollowUp, 
    onWhatsApp, 
    users, 
    isAdmin = false,
    onReassignCrm,
    onBulkReassignCrm,
    pdcCheques = [],
    onOpenPdcForCustomer
}: OutstandingTableProps) => {
    const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
    const [bulkSelectedCrm, setBulkSelectedCrm] = useState<string>('');
    const [tableAgeingFilter, setTableAgeingFilter] = useState<TableAgeingFilter>('all');

    const crmUsers = users.filter(u => u.role === UserRole.CRM);

    const getUserNameById = (id?: string) => {
        if (!id) return 'Unassigned';
        const user = users.find(u => u.id.toUpperCase() === id.toUpperCase() || u.name.toUpperCase() === id.toUpperCase());
        return user ? user.name : id;
    }

    const formatCurrency = (amount?: number) => {
        if (amount === undefined || isNaN(amount)) return '₹0';
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.abs(amount));
    }
    
    const formatDate = (date?: Date) => {
        if (!date) return '';
        return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
    }

    // Calculate ageing metrics across the dataset
    const ageingMetrics = React.useMemo(() => {
        let over90Count = 0;
        let over90Sum = 0;
        let over135Count = 0;
        let over135Sum = 0;
        let due45Count = 0;
        let due45Sum = 0;

        outstandingData.forEach(item => {
            const a3 = item.ageing?.['91-135'] || 0;
            const a4 = item.ageing?.['>135'] || 0;
            const a2 = item.ageing?.['46-90'] || 0;
            const itemOver90 = item.over90 !== undefined ? item.over90 : (a3 + a4);
            const itemDue45 = item.dueOver45 !== undefined ? item.dueOver45 : (a2 + itemOver90);

            if (itemOver90 > 0) {
                over90Count++;
                over90Sum += itemOver90;
            }
            if (a4 > 0) {
                over135Count++;
                over135Sum += a4;
            }
            if (itemDue45 > 0) {
                due45Count++;
                due45Sum += itemDue45;
            }
        });

        return {
            over90Count,
            over90Sum,
            over135Count,
            over135Sum,
            due45Count,
            due45Sum
        };
    }, [outstandingData]);

    // Filter displayed data based on active tableAgeingFilter
    const displayedData = React.useMemo(() => {
        if (tableAgeingFilter === 'all') return outstandingData;
        return outstandingData.filter(item => {
            const a1 = item.ageing?.['1-45'] || 0;
            const a2 = item.ageing?.['46-90'] || 0;
            const a3 = item.ageing?.['91-135'] || 0;
            const a4 = item.ageing?.['>135'] || 0;
            const itemOver90 = item.over90 !== undefined ? item.over90 : (a3 + a4);
            const itemDue45 = item.dueOver45 !== undefined ? item.dueOver45 : (a2 + itemOver90);

            if (tableAgeingFilter === 'over90') return itemOver90 > 0;
            if (tableAgeingFilter === 'over135') return a4 > 0;
            if (tableAgeingFilter === '91-135') return a3 > 0;
            if (tableAgeingFilter === 'dueOver45') return itemDue45 > 0;
            if (tableAgeingFilter === '46-90') return a2 > 0;
            if (tableAgeingFilter === '1-45') return a1 > 0;
            return true;
        });
    }, [outstandingData, tableAgeingFilter]);

    if (outstandingData.length === 0) {
        return <div className="text-center py-12 text-gray-500">No outstanding records match the current filters.</div>;
    }

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedCustomerIds(displayedData.map(item => item.id));
        } else {
            setSelectedCustomerIds([]);
        }
    };

    const handleToggleSelectRow = (id: string) => {
        setSelectedCustomerIds(prev => 
            prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
        );
    };

    const handleApplyBulkCrm = () => {
        if (!bulkSelectedCrm) {
            alert('Please select a CRM from the dropdown.');
            return;
        }
        if (selectedCustomerIds.length === 0) {
            alert('Please select at least one customer.');
            return;
        }
        if (onBulkReassignCrm) {
            onBulkReassignCrm(selectedCustomerIds, bulkSelectedCrm);
            setSelectedCustomerIds([]);
            setBulkSelectedCrm('');
        }
    };

    // Logic for row styling based on customer follow-up status
    const getRowClass = (item: Outstanding) => {
        const today = new Date();
        today.setHours(0,0,0,0);
        let followUpTime = item.followUpDate ? new Date(item.followUpDate).setHours(0,0,0,0) : 0;

        // 1. Future Follow-up (Green)
        if (item.followUpDate && followUpTime > today.getTime() && item.status !== FollowUpStatus.Completed) {
            return 'bg-green-50/50 dark:bg-green-900/10 border-l-4 border-green-500';
        }

        // 2. Unattended / Overdue / Pending with no date (Red)
        if (item.status === FollowUpStatus.Overdue || (item.status === FollowUpStatus.Pending && (!item.lastFollowUpOn))) {
            return 'bg-red-50/50 dark:bg-red-900/10 border-l-4 border-red-500';
        }

        // 3. Urgent fallback
        if (item.isUrgent) {
            return 'bg-red-50/40 dark:bg-red-900/10';
        }

        return '';
    };

    return (
        <div className="space-y-3">
            {/* Ageing Quick-Focus Bar (Specifically for >90d and >135d instant focus) */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 dark:bg-gray-800/80 rounded-xl border border-slate-200 dark:border-gray-700">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                    <span className="text-gray-500 dark:text-gray-400 mr-1 text-[12.5px] uppercase tracking-wider font-bold">Ageing Focus:</span>
                    
                    <button
                        onClick={() => setTableAgeingFilter('all')}
                        className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
                            tableAgeingFilter === 'all'
                                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-bold shadow-xs'
                                : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 border border-gray-200 dark:border-gray-600'
                        }`}
                    >
                        All ({outstandingData.length})
                    </button>

                    {/* Prominent >90 Days Focus Button */}
                    <button
                        onClick={() => setTableAgeingFilter(tableAgeingFilter === 'over90' ? 'all' : 'over90')}
                        className={`px-3 py-1 rounded-lg text-xs transition-all flex items-center gap-1.5 ${
                            tableAgeingFilter === 'over90'
                                ? 'bg-red-600 text-white font-bold ring-2 ring-red-400 shadow-sm'
                                : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 border border-red-200 dark:border-red-800'
                        }`}
                        title="Focus on customers with overdue balance > 90 Days (91-135d and >135d)"
                    >
                        <span>&gt;90 Days Overdue</span>
                        <span className={`px-1.5 py-0.5 rounded-full text-[11.5px] font-extrabold ${tableAgeingFilter === 'over90' ? 'bg-white text-red-700' : 'bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200'}`}>
                            {ageingMetrics.over90Count} ({formatCurrency(ageingMetrics.over90Sum)})
                        </span>
                    </button>

                    {/* Prominent >135 Days Focus Button */}
                    <button
                        onClick={() => setTableAgeingFilter(tableAgeingFilter === 'over135' ? 'all' : 'over135')}
                        className={`px-3 py-1 rounded-lg text-xs transition-all flex items-center gap-1.5 ${
                            tableAgeingFilter === 'over135'
                                ? 'bg-rose-700 text-white font-bold ring-2 ring-rose-400 shadow-sm'
                                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 border border-rose-200 dark:border-rose-800'
                        }`}
                        title="Critical overdue balance > 135 Days"
                    >
                        <span>&gt;135 Days Critical</span>
                        <span className={`px-1.5 py-0.5 rounded-full text-[11.5px] font-extrabold ${tableAgeingFilter === 'over135' ? 'bg-white text-rose-800' : 'bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-200'}`}>
                            {ageingMetrics.over135Count} ({formatCurrency(ageingMetrics.over135Sum)})
                        </span>
                    </button>

                    {/* 91-135d button */}
                    <button
                        onClick={() => setTableAgeingFilter(tableAgeingFilter === '91-135' ? 'all' : '91-135')}
                        className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
                            tableAgeingFilter === '91-135'
                                ? 'bg-amber-600 text-white font-bold'
                                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 border border-amber-200 dark:border-amber-800'
                        }`}
                    >
                        91-135d
                    </button>

                    {/* 46-90d button */}
                    <button
                        onClick={() => setTableAgeingFilter(tableAgeingFilter === '46-90' ? 'all' : '46-90')}
                        className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
                            tableAgeingFilter === '46-90'
                                ? 'bg-amber-600 text-white font-bold'
                                : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 border border-gray-200 dark:border-gray-600'
                        }`}
                    >
                        46-90d
                    </button>

                    {/* 1-45d button */}
                    <button
                        onClick={() => setTableAgeingFilter(tableAgeingFilter === '1-45' ? 'all' : '1-45')}
                        className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
                            tableAgeingFilter === '1-45'
                                ? 'bg-emerald-600 text-white font-bold'
                                : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 border border-gray-200 dark:border-gray-600'
                        }`}
                    >
                        1-45d
                    </button>
                </div>

                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                    <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-slate-700 dark:bg-slate-300"></span>
                        <span><strong>DR</strong>: Debit due</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-purple-600"></span>
                        <span className="text-purple-700 dark:text-purple-300 font-bold">CR: Advance</span>
                    </span>
                    <span className="text-gray-400 font-medium">
                        {displayedData.length} accounts
                    </span>
                </div>
            </div>

            {/* Bulk CRM Reassignment Bar for Admin */}
            {isAdmin && selectedCustomerIds.length > 0 && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl flex flex-col sm:flex-row justify-between items-center gap-3 shadow-sm">
                    <div className="flex items-center gap-2 text-xs font-semibold text-blue-900 dark:text-blue-200">
                        <UsersIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <span><strong>{selectedCustomerIds.length}</strong> customer{selectedCustomerIds.length > 1 ? 's' : ''} selected</span>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <select
                            value={bulkSelectedCrm}
                            onChange={e => setBulkSelectedCrm(e.target.value)}
                            className="px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">-- Reassign to CRM --</option>
                            {crmUsers.map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={handleApplyBulkCrm}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
                        >
                            Assign Selected
                        </button>
                        <button
                            type="button"
                            onClick={() => setSelectedCustomerIds([])}
                            className="px-2.5 py-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 text-gray-700 dark:text-gray-300 text-xs rounded-lg font-medium transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto shadow-xs">
                <table className="w-full text-left border-collapse text-xs min-w-[900px]">
                    <thead className="bg-gray-50 dark:bg-gray-800/90 text-gray-600 dark:text-gray-300 text-[12.5px] uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                        <tr>
                            {isAdmin && (
                                <th scope="col" className="w-7 px-2 py-2.5 text-center">
                                    <input
                                        type="checkbox"
                                        checked={selectedCustomerIds.length === displayedData.length && displayedData.length > 0}
                                        onChange={e => handleSelectAll(e.target.checked)}
                                        className="w-4 h-4 rounded text-green-600 dark:text-green-400 focus:ring-green-500"
                                        title="Select all customers"
                                    />
                                </th>
                            )}
                            <th scope="col" className="px-3 py-2.5 font-bold min-w-[180px]">Company / Contact</th>
                            <th scope="col" className="px-2.5 py-2.5 font-bold text-right">Total Due</th>
                            
                            {/* Live on screen 4 Ageing Columns with prominent focus for >90d */}
                            <th scope="col" className="px-2 py-2.5 font-bold text-right text-gray-600 dark:text-gray-400">1-45d</th>
                            <th scope="col" className="px-2 py-2.5 font-bold text-right text-gray-700 dark:text-gray-300">46-90d</th>
                            <th scope="col" className="px-2.5 py-2.5 font-bold text-right bg-amber-50/70 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-l border-amber-200 dark:border-amber-900">
                                91-135d
                            </th>
                            <th scope="col" className="px-2.5 py-2.5 font-bold text-right bg-red-50/70 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-l border-r border-red-200 dark:border-red-900">
                                &gt;135D
                            </th>
                            <th scope="col" className="px-2.5 py-2.5 font-bold text-right text-red-600 dark:text-red-400">
                                &gt;90d Total
                            </th>
                            
                            <th scope="col" className="px-2.5 py-2.5 font-bold text-center">Status</th>
                            <th scope="col" className="px-2.5 py-2.5 font-bold">
                                {isAdmin ? 'CRM Owner' : 'CRM'}
                            </th>
                            <th scope="col" className="px-2.5 py-2.5 font-bold text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900">
                        {displayedData.length === 0 ? (
                            <tr>
                                <td colSpan={isAdmin ? 11 : 10} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">No matching accounts found for this ageing criteria</p>
                                    <p className="text-[12.5px] text-gray-400 mt-0.5">Try selecting"All" in the Ageing Focus filter bar above.</p>
                                </td>
                            </tr>
                        ) : (
                            displayedData.map(item => {
                            const rowClass = getRowClass(item);
                            const isFuture = item.followUpDate && new Date(item.followUpDate) > new Date();
                            const a1 = item.ageing?.['1-45'] || 0;
                            const a2 = item.ageing?.['46-90'] || 0;
                            const a3 = item.ageing?.['91-135'] || 0;
                            const a4 = item.ageing?.['>135'] || 0;
                            const over90Total = item.over90 !== undefined ? item.over90 : (a3 + a4);
                            const hasOver90Dues = over90Total > 0;
                            const isRowSelected = selectedCustomerIds.includes(item.id);
                            
                            // Customer active PDC cheques
                            const customerPdcs = pdcCheques.filter(p => p.customerId === item.id);
                            const activePdcs = customerPdcs.filter(p => p.status !== PdcStatus.Cleared && p.status !== PdcStatus.Bounced);
                            const totalPdcAmount = activePdcs.reduce((sum, p) => sum + p.amount, 0);

                            return (
                                <tr key={item.id} className={`${rowClass} ${isRowSelected ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''} ${hasOver90Dues ? 'hover:bg-red-50/30 dark:hover:bg-red-950/20' : 'hover:bg-gray-50/80 dark:hover:bg-gray-800/60'} transition-colors`}>
                                    {isAdmin && (
                                        <td className="px-2 py-2 text-center">
                                            <input
                                                type="checkbox"
                                                checked={isRowSelected}
                                                onChange={() => handleToggleSelectRow(item.id)}
                                                className="w-4 h-4 rounded text-green-600 dark:text-green-400 focus:ring-green-500"
                                            />
                                        </td>
                                    )}
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <button 
                                                onClick={() => onFollowUp(item)} 
                                                className="text-left font-bold text-green-700 dark:text-green-400 hover:underline flex items-center gap-1 leading-tight"
                                            >
                                                <span>{item.company}</span>
                                                {item.isUrgent && <FireIcon className="text-red-500 w-3.5 h-3.5 flex-shrink-0" />}
                                            </button>
                                            {hasOver90Dues && (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11.5px] font-extrabold bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200 border border-red-200 dark:border-red-800" title="Overdue > 90 Days late payment focus">
                                                    &gt;90d
                                                </span>
                                            )}
                                            {activePdcs.length > 0 && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onOpenPdcForCustomer?.(item.id);
                                                    }}
                                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11.5px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 hover:bg-emerald-200 transition-colors flex-shrink-0"
                                                    title={`Active PDC Cheques: ₹${totalPdcAmount.toLocaleString('en-IN')} (${activePdcs.length} cheques)`}
                                                >
                                                    <ChequeIcon className="w-2.5 h-2.5" />
                                                    <span>PDC {formatCurrency(totalPdcAmount)}</span>
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[12.5px] text-gray-500 dark:text-gray-400">
                                            {item.contactNumber ? (
                                                <a href={`tel:${item.contactNumber}`} className="inline-flex items-center min-h-[28px] hover:text-green-600 dark:text-green-400 transition-colors font-medium">
                                                    {item.contactNumber}
                                                </a>
                                            ) : null}
                                            {item.contactPerson && (
                                                <span className="text-gray-600 dark:text-gray-300 font-medium">
                                                    {item.contactPerson} {item.contactPost ? <span className="text-gray-400 text-[11.5px]">({item.contactPost})</span> : null}
                                                </span>
                                            )}
                                            {item.additionalContacts && item.additionalContacts.length > 0 && (
                                                <span 
                                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11.5px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 cursor-help"
                                                    title={`Other company contacts:\n${item.additionalContacts.map(c => `• ${c.name} (${c.post || 'Staff'}): ${c.mobile}`).join('\n')}`}
                                                >
                                                    +{item.additionalContacts.length} person{item.additionalContacts.length > 1 ? 's' : ''}
                                                </span>
                                            )}
                                            {item.forecastAmount !== undefined && item.forecastAmount > 0 && (
                                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11.5px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" title={`Expected Cash Forecast: ₹${item.forecastAmount.toLocaleString('en-IN')}`}>
                                                    {formatCurrency(item.forecastAmount)}
                                                </span>
                                            )}
                                            {isFuture && item.status !== FollowUpStatus.Completed && (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11.5px] font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                                                    Next: {formatDate(item.followUpDate)}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-2.5 py-2 whitespace-nowrap text-right">
                                        <BalanceAmount
                                            amount={item.total}
                                            type={item.totalType || 'Dr'}
                                            defaultClass="font-extrabold text-gray-900 dark:text-gray-100"
                                        />
                                    </td>

                                    {/* 1-45d Column */}
                                    <td className="px-2 py-2 whitespace-nowrap text-right">
                                        <BalanceAmount
                                            amount={a1}
                                            type={item.ageingTypes?.['1-45'] || 'Dr'}
                                            defaultClass={`text-xs ${a1 > 0 ? 'text-gray-700 dark:text-gray-300 font-medium' : 'text-gray-500 dark:text-gray-400'}`}
                                        />
                                    </td>

                                    {/* 46-90d Column */}
                                    <td className="px-2 py-2 whitespace-nowrap text-right">
                                        <BalanceAmount
                                            amount={a2}
                                            type={item.ageingTypes?.['46-90'] || 'Dr'}
                                            defaultClass={`text-xs ${a2 > 0 ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-gray-500 dark:text-gray-400'}`}
                                        />
                                    </td>

                                    {/* 91-135d Column (Highlighted Amber/Orange) */}
                                    <td className="px-2.5 py-2 whitespace-nowrap text-right bg-amber-50/50 dark:bg-amber-950/20 border-l border-amber-100 dark:border-amber-900/40">
                                        <BalanceAmount
                                            amount={a3}
                                            type={item.ageingTypes?.['91-135'] || 'Dr'}
                                            defaultClass={`text-xs ${a3 > 0 ? 'text-amber-800 dark:text-amber-300 font-bold' : 'text-gray-500 dark:text-gray-400'}`}
                                        />
                                    </td>

                                    {/* >135D Column (Highlighted Bold Red) */}
                                    <td className="px-2.5 py-2 whitespace-nowrap text-right bg-red-50/50 dark:bg-red-950/20 border-l border-r border-red-100 dark:border-red-900/40">
                                        <BalanceAmount
                                            amount={a4}
                                            type={item.ageingTypes?.['>135'] || 'Dr'}
                                            defaultClass={`text-xs ${a4 > 0 ? 'text-red-700 dark:text-red-400 font-extrabold' : 'text-gray-500 dark:text-gray-400'}`}
                                        />
                                    </td>

                                    {/* >90d Total Column */}
                                    <td className="px-2.5 py-2 whitespace-nowrap text-right">
                                        <BalanceAmount
                                            amount={over90Total}
                                            type={item.over90Type || 'Dr'}
                                            defaultClass={`text-xs ${over90Total > 0 ? 'text-red-600 dark:text-red-400 font-extrabold' : 'text-gray-500 dark:text-gray-400'}`}
                                        />
                                    </td>

                                    <td className="px-2.5 py-2 whitespace-nowrap text-center">
                                        <StatusBadge status={item.status} />
                                    </td>
                                    <td className="px-2.5 py-2 whitespace-nowrap text-xs font-medium text-gray-700 dark:text-gray-300">
                                        {isAdmin && onReassignCrm ? (
                                            <select
                                                value={item.crmOwnerId || ''}
                                                onChange={e => onReassignCrm(item.id, e.target.value)}
                                                className="px-1.5 py-0.5 text-[12.5px] border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-green-500 max-w-[105px]"
                                                title="Reassign CRM"
                                            >
                                                <option value="">Unassigned</option>
                                                {item.crmOwnerId && !crmUsers.some(u => u.name.toUpperCase() === item.crmOwnerId.toUpperCase() || u.id.toUpperCase() === item.crmOwnerId.toUpperCase()) && (
                                                    <option value={item.crmOwnerId}>{item.crmOwnerId}</option>
                                                )}
                                                {crmUsers.map(u => (
                                                    <option key={u.id} value={u.id}>{u.name}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <span className="truncate block max-w-[95px] text-xs font-semibold">{getUserNameById(item.crmOwnerId)}</span>
                                        )}
                                    </td>
                                    <td className="px-2.5 py-2 whitespace-nowrap text-right">
                                       <div className="flex justify-end items-center space-x-1">
                                            <button
                                                onClick={() => onWhatsApp(item)}
                                                className="p-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded transition-colors"
                                                title="Send WhatsApp Message"
                                            >
                                                <WhatsAppIcon className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => onFollowUp(item)}
                                                className="px-2.5 py-1 text-[12.5px] font-bold rounded transition-colors bg-green-600 text-white hover:bg-green-700 shadow-2xs"
                                            >
                                                Follow Up
                                            </button>
                                       </div>
                                    </td>
                                </tr>
                            );
                        }))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default OutstandingTable;
