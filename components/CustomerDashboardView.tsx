import React, { useState, useMemo } from 'react';
import { Outstanding, User, UserRole, FollowUpStatus, PdcCheque, DEFAULT_ROLE_PERMISSIONS, getCustomerPaymentRank, DataVisibility } from '../types';
import BalanceAmount from './BalanceAmount';
import StatusBadge from './StatusBadge';
import { WhatsAppIcon, ChequeIcon, SyncIcon, DownloadIcon, TrashIcon, EditIcon } from './icons/Icons';
import { AgeingBar, AgeingLegend, AGE_BANDS } from './ui/Primitives';
import { formatCompact, formatINR } from './ui/format';

interface CustomerDashboardViewProps {
    data: Outstanding[];
    currentUser: User | null;
    users: User[];
    onAddCustomer: () => void;
    onEditCustomer: (customer: Outstanding) => void;
    onDeleteCustomer?: (customerId: string) => void;
    onFollowUp: (customer: Outstanding) => void;
    onWhatsApp: (customer: Outstanding) => void;
    onOpenPdcForCustomer?: (customerId: string) => void;
    onReassignCrm?: (customerId: string, newCrm: string) => void;
    onBulkReassignCrm?: (customerIds: string[], newCrm: string) => void;
    pdcCheques?: PdcCheque[];
    onSyncSheet?: () => void;
    isSyncing?: boolean;
    lastUpdatedTill?: string;
    onExportExcel?: () => void;
    /** Search text from the app bar. Narrows the book before the view's own filters. */
    globalSearch?: string;
}

export type AgeingCategoryFilter = 'all' | 'dueOver45' | 'over90' | 'over135' | '1-45' | '46-90' | '91-135';

export const CustomerDashboardView: React.FC<CustomerDashboardViewProps> = ({
    data,
    currentUser,
    users,
    onAddCustomer,
    onEditCustomer,
    onDeleteCustomer,
    onFollowUp,
    onWhatsApp,
    onOpenPdcForCustomer,
    onReassignCrm,
    onBulkReassignCrm,
    pdcCheques = [],
    onSyncSheet,
    isSyncing = false,
    lastUpdatedTill,
    onExportExcel,
    globalSearch = '',
}) => {
    // Permissions and Data Scoping
    const isAdmin = currentUser?.role === UserRole.Admin;
    const permissions = currentUser?.permissions || (currentUser ? (DEFAULT_ROLE_PERMISSIONS[currentUser.role] || DEFAULT_ROLE_PERMISSIONS[UserRole.CRM]) : undefined);
    const canAddCustomer = isAdmin || Boolean(permissions?.canAddCustomer);
    const canEditCustomer = isAdmin || Boolean(permissions?.canEditCustomer);
    const canDeleteCustomer = isAdmin || Boolean(permissions?.canDeleteCustomer);
    const canEditFollowUp = isAdmin || Boolean(permissions?.canEditFollowUp);
    const canManagePdc = isAdmin || Boolean(permissions?.canManagePdc);
    const canReassignCrm = isAdmin || Boolean(permissions?.canReassignCrm);
    const canExport = isAdmin || Boolean(permissions?.canExportData);
    const canViewAllCrms = isAdmin || currentUser?.role === UserRole.Manager || currentUser?.role === UserRole.Viewer || Boolean(permissions?.canViewAllCrms) || currentUser?.dataVisibility === DataVisibility.All;

    // Filter raw data strictly based on user roles and assigned access rights
    const userAllowedData = useMemo(() => {
        if (canViewAllCrms || !currentUser) return data;

        const userIdUpper = (currentUser.id || '').trim().toUpperCase();
        const userNameUpper = (currentUser.name || '').trim().toUpperCase();
        const allowedCrms = new Set((currentUser.assignedCrms || []).map(c => c.trim().toUpperCase()));
        if (currentUser.role === UserRole.CRM) {
            allowedCrms.add(userIdUpper);
            allowedCrms.add(userNameUpper);
        }

        return data.filter(item => {
            if (currentUser.role === UserRole.Collector) {
                const collectorUpper = (item.assignedCollectorId || '').trim().toUpperCase();
                return collectorUpper === userIdUpper || collectorUpper === userNameUpper;
            }
            const ownerUpper = (item.crmOwnerId || '').trim().toUpperCase();
            return allowedCrms.has(ownerUpper);
        });
    }, [data, currentUser, canViewAllCrms]);

    // Filters State
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCrm, setSelectedCrm] = useState<string>('ALL');
    const [showMoreFilters, setShowMoreFilters] = useState(false);
    const [rankFilter, setRankFilter] = useState<'ALL' | 'Good' | 'Bad'>('ALL');
    const [ageingFilter, setAgeingFilter] = useState<AgeingCategoryFilter>('all');
    const [statusFilter, setStatusFilter] = useState<string>('ALL');
    const [balanceTypeFilter, setBalanceTypeFilter] = useState<'ALL' | 'Dr' | 'Cr'>('ALL');
    const [originFilter, setOriginFilter] = useState<'ALL' | 'NEW' | 'SHEET'>('ALL');
    const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

    // Hiding filters must never hide the fact that they are ON.
    const activeFilterCount = [
        rankFilter !== 'ALL',
        ageingFilter !== 'all',
        balanceTypeFilter !== 'ALL',
        originFilter !== 'ALL',
    ].filter(Boolean).length;

    // Bulk selection
    const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
    const [bulkCrm, setBulkCrm] = useState('');

    // List of CRM options (Scoped to user rights)
    const crmUsers = useMemo(() => {
        const allCrms = users.filter(u => u.role === UserRole.CRM);
        if (canViewAllCrms) return allCrms;
        return allCrms.filter(u => {
            const uId = u.id.trim().toUpperCase();
            const uName = u.name.trim().toUpperCase();
            const currId = (currentUser?.id || '').trim().toUpperCase();
            const currName = (currentUser?.name || '').trim().toUpperCase();
            const assigned = (currentUser?.assignedCrms || []).map(c => c.trim().toUpperCase());
            return uId === currId || uName === currName || assigned.includes(uId) || assigned.includes(uName);
        });
    }, [users, canViewAllCrms, currentUser]);

    const allCrmsInDataset = useMemo(() => {
        const set = new Set<string>();
        userAllowedData.forEach(item => {
            if (item.crmOwnerId && item.crmOwnerId.trim()) set.add(item.crmOwnerId.trim());
        });
        return Array.from(set).sort();
    }, [userAllowedData]);

    // Formatters
    const formatCurrency = (amount?: number) => {
        if (amount === undefined || isNaN(amount)) return '₹0';
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.abs(amount));
    };

    const formatDate = (date?: Date | string) => {
        if (!date) return '';
        return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
    };

    /** Matches a record against a free-text query across every field a
        person might search by. */
    const matchesQuery = (item: Outstanding, raw: string) => {
        const q = raw.trim().toLowerCase();
        if (!q) return true;
        const hay = [
            item.company, item.contactPerson, item.contactPost, item.contactNumber,
            item.email, item.city, item.state, item.gstin, item.address, item.crmOwnerId,
            ...(item.additionalContacts || []).flatMap(c => [c.name, c.mobile, c.post || '']),
            ...(item.notes || []),
        ].join(' ').toLowerCase();
        return q.split(/\s+/).every(tok => hay.includes(tok));
    };

    // Filter logic based on userAllowedData
    const filteredData = useMemo(() => {
        return userAllowedData.filter(item => {
            if (!matchesQuery(item, globalSearch)) return false;
            // Search match across company, contact, mobile, email, GSTIN, City, State, additional contacts
            if (searchTerm.trim()) {
                const q = searchTerm.trim().toLowerCase();
                const matchCompany = (item.company || '').toLowerCase().includes(q);
                const matchContact = (item.contactPerson || '').toLowerCase().includes(q);
                const matchPost = (item.contactPost || '').toLowerCase().includes(q);
                const matchNumber = (item.contactNumber || '').toLowerCase().includes(q);
                const matchEmail = (item.email || '').toLowerCase().includes(q);
                const matchCity = (item.city || '').toLowerCase().includes(q);
                const matchState = (item.state || '').toLowerCase().includes(q);
                const matchGstin = (item.gstin || '').toLowerCase().includes(q);
                const matchAddress = (item.address || '').toLowerCase().includes(q);
                const matchAdditional = (item.additionalContacts || []).some(
                    c => c.name.toLowerCase().includes(q) || c.mobile.toLowerCase().includes(q) || (c.post || '').toLowerCase().includes(q)
                );
                if (!matchCompany && !matchContact && !matchPost && !matchNumber && !matchEmail && !matchCity && !matchState && !matchGstin && !matchAddress && !matchAdditional) {
                    return false;
                }
            }

            // Payment Rank Filter (Good vs Bad Payment)
            if (rankFilter !== 'ALL') {
                const itemRank = getCustomerPaymentRank(item);
                if (itemRank !== rankFilter) return false;
            }

            // CRM Filter
            if (selectedCrm !== 'ALL') {
                const ownerUpper = (item.crmOwnerId || '').trim().toUpperCase();
                if (selectedCrm === 'UNASSIGNED') {
                    if (ownerUpper !== '') return false;
                } else {
                    if (ownerUpper !== selectedCrm.toUpperCase()) return false;
                }
            }

            // Ageing Bracket
            if (ageingFilter !== 'all') {
                const a1 = item.ageing?.['1-45'] || 0;
                const a2 = item.ageing?.['46-90'] || 0;
                const a3 = item.ageing?.['91-135'] || 0;
                const a4 = item.ageing?.['>135'] || 0;
                const over90 = item.over90 !== undefined ? item.over90 : (a3 + a4);
                const due45 = item.dueOver45 !== undefined ? item.dueOver45 : (a2 + over90);

                if (ageingFilter === 'over90' && over90 <= 0) return false;
                if (ageingFilter === 'over135' && a4 <= 0) return false;
                if (ageingFilter === 'dueOver45' && due45 <= 0) return false;
                if (ageingFilter === '91-135' && a3 <= 0) return false;
                if (ageingFilter === '46-90' && a2 <= 0) return false;
                if (ageingFilter === '1-45' && a1 <= 0) return false;
            }

            // Balance Type Filter
            if (balanceTypeFilter !== 'ALL') {
                const itemType = item.totalType || 'Dr';
                if (itemType !== balanceTypeFilter) return false;
            }

            // Status Filter
            if (statusFilter !== 'ALL') {
                if (item.status !== statusFilter) return false;
            }

            // Origin Filter
            if (originFilter === 'NEW' && !item.isNewCustomer) return false;
            if (originFilter === 'SHEET' && item.isNewCustomer) return false;

            return true;
        });
    }, [userAllowedData, globalSearch, searchTerm, rankFilter, selectedCrm, ageingFilter, statusFilter, balanceTypeFilter, originFilter]);

    // Metrics summary for filtered dataset
    const metrics = useMemo(() => {
        let totalSum = 0;
        let debitSum = 0;
        let creditSum = 0;
        let due45Sum = 0;
        let over90Sum = 0;
        let over135Sum = 0;
        let forecastSum = 0;
        let newCount = 0;
        let goodCount = 0;
        let badCount = 0;
        let badDebitSum = 0;
        let goodDebitSum = 0;

        filteredData.forEach(item => {
            const isCr = item.totalType === 'Cr';
            const itemTotal = item.total || 0;
            if (isCr) {
                creditSum += itemTotal;
            } else {
                debitSum += itemTotal;
            }
            totalSum += isCr ? -itemTotal : itemTotal;

            const a3 = item.ageing?.['91-135'] || 0;
            const a4 = item.ageing?.['>135'] || 0;
            const a2 = item.ageing?.['46-90'] || 0;
            const itemOver90 = item.over90 !== undefined ? item.over90 : (a3 + a4);
            const itemDue45 = item.dueOver45 !== undefined ? item.dueOver45 : (a2 + itemOver90);

            due45Sum += itemDue45;
            over90Sum += itemOver90;
            over135Sum += a4;
            forecastSum += (item.forecastAmount || 0);
            if (item.isNewCustomer) newCount++;

            const rank = getCustomerPaymentRank(item);
            if (rank === 'Good') {
                goodCount++;
                if (!isCr) goodDebitSum += itemTotal;
            } else {
                badCount++;
                if (!isCr) badDebitSum += itemTotal;
            }
        });

        return {
            count: filteredData.length,
            totalSum,
            debitSum,
            creditSum,
            due45Sum,
            over90Sum,
            over135Sum,
            forecastSum,
            newCount,
            goodCount,
            badCount,
            goodDebitSum,
            badDebitSum
        };
    }, [filteredData]);

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedCustomerIds(filteredData.map(d => d.id));
        } else {
            setSelectedCustomerIds([]);
        }
    };

    const handleToggleRow = (id: string) => {
        setSelectedCustomerIds(prev => 
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const handleApplyBulkCrm = () => {
        if (!bulkCrm) {
            alert('Please select a CRM.');
            return;
        }
        if (selectedCustomerIds.length === 0) {
            alert('Please select customers.');
            return;
        }
        if (onBulkReassignCrm) {
            onBulkReassignCrm(selectedCustomerIds, bulkCrm);
            setSelectedCustomerIds([]);
            setBulkCrm('');
        }
    };

    /* The ledger fits the viewport now, so the slider, the First/Left/Right/Last
       buttons and the scroll-percentage readout that used to compensate for a
       1845px table are gone. The container keeps overflow-x for very narrow
       windows; the browser scrolls it. */

    return (
        <div className="w-full space-y-3.5 pb-2">
            {/* Top Header Banner */}
            <div className="bg-card rounded-[16px] shadow-e1 px-5 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                <div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-[12.5px] font-medium bg-card-3 text-label-2">
                            {filteredData.length} of {data.length} Accounts
                        </span>
                        {lastUpdatedTill && (
                            <span className="px-2 py-0.5 rounded-md text-[12.5px] font-semibold bg-pos-bg text-pos border border-pos">
                                Till: {lastUpdatedTill}
                            </span>
                        )}
                    </div>
                    <div className="hidden">
                        <span>Signed in as <strong className="text-label font-semibold">{currentUser?.name}</strong> ({currentUser?.role})</span>
                        <span className="text-label-3">•</span>
                        <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-pos"></span>
                            Rights: {[canAddCustomer && 'Add', canEditCustomer && 'Edit', canEditFollowUp && 'Follow-up', canManagePdc && 'PDC', isAdmin && 'Admin'].filter(Boolean).join(' · ')}
                        </span>
                    </div>
                </div>

                {/* Primary Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                    {/* Add Customer Button */}
                    <button
                        onClick={onAddCustomer}
                        disabled={!canAddCustomer}
                        title={canAddCustomer ? 'Create a new customer master account' : 'You do not have permission to add new customers'}
                        className={`px-3.5 py-1.5 text-xs font-extrabold rounded-lg transition-all shadow-sm flex items-center gap-1.5 ${
                            canAddCustomer
                                ? 'bg-accent hover:bg-accent-press text-on-accent cursor-pointer'
                                : 'bg-card-3 text-label-3 cursor-not-allowed'
                        }`}
                    >
                        <span>Add Customer</span>
                        
                    </button>

                    {/* Sync from Google Sheet */}
                    {onSyncSheet && (
                        <button
                            onClick={onSyncSheet}
                            disabled={isSyncing}
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-card hover:bg-card-3 text-label-2 hover:text-label border border-separator-strong transition-colors flex items-center gap-1"
                            title="Pull fresh updates from the official Google Sheet"
                        >
                            <SyncIcon className={isSyncing ?"w-3.5 h-3.5 animate-spin" :"w-3.5 h-3.5"} />
                            <span>{isSyncing ? 'Syncing...' : 'Sync'}</span>
                        </button>
                    )}

                    {/* Export Excel */}
                    {onExportExcel && canExport && (
                        <button
                            onClick={onExportExcel}
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-card hover:bg-card-3 text-label-2 hover:text-label border border-separator-strong transition-colors flex items-center gap-1"
                            title="Export filtered customer list to Excel / CSV"
                        >
                            <DownloadIcon className="w-3.5 h-3.5" />
                            <span>Export</span>
                        </button>
                    )}

                    {/* Table / Cards toggle */}
                    <div className="flex bg-card-3 p-0.5 rounded-lg border border-separator">
                        <button
                            onClick={() => setViewMode('table')}
                            className={`h-8 px-3 text-xs font-semibold rounded-lg transition-all ${viewMode === 'table' ? 'bg-card text-label ' : 'text-label-3 hover:text-label'}`}
                            title="Detailed Compact Table View"
                        >
                            Table
                        </button>
                        <button
                            onClick={() => setViewMode('cards')}
                            className={`h-8 px-3 text-xs font-semibold rounded-lg transition-all ${viewMode === 'cards' ? 'bg-card text-label ' : 'text-label-3 hover:text-label'}`}
                            title="Customer Cards View"
                        >
                            Cards
                        </button>
                    </div>
                </div>
            </div>

            {/* Book summary. Flat and divided, not boxed: under the colour rule
                only the ageing figures are allowed hue, so the tiles stay grey. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Receivables</p>
                    <p className="num text-[19px] font-medium text-label mt-1.5 tracking-[-0.02em]">{formatCurrency(metrics.debitSum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">{metrics.count} accounts</p>
                </div>

                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Good payers</p>
                    <p className="num text-[19px] font-medium text-label mt-1.5 tracking-[-0.02em]">{formatCurrency(metrics.goodDebitSum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">{metrics.goodCount} accounts</p>
                </div>

                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Delayed payers</p>
                    <p className="num text-[19px] font-medium text-label mt-1.5 tracking-[-0.02em]">{formatCurrency(metrics.badDebitSum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">{metrics.badCount} accounts</p>
                </div>

                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Past 45 days</p>
                    <p className="num text-[19px] font-medium mt-1.5 tracking-[-0.02em]" style={{ color: 'var(--age-2-ink)' }}>{formatCurrency(metrics.due45Sum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">Working capital held up</p>
                </div>

                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Past 90 days</p>
                    <p className="num text-[19px] font-medium mt-1.5 tracking-[-0.02em]" style={{ color: 'var(--age-3-ink)' }}>{formatCurrency(metrics.over90Sum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">Recovery risk</p>
                </div>

                <div className="bg-card rounded-[14px] shadow-e1 px-4 py-3.5">
                    <p className="label">Advance held</p>
                    <p className="num text-[19px] font-medium mt-1.5 tracking-[-0.02em]" style={{ color: 'var(--age-1-ink)' }}>{formatCurrency(metrics.creditSum)}</p>
                    <p className="text-[12px] text-label-3 mt-1">Credit with us</p>
                </div>
            </div>

            {/* Compact Filter Controls Card */}
            <div className="bg-card rounded-[16px] shadow-e1 p-5 space-y-3.5">
                {/* Search, Rank, CRM, Status Filters Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2">
                    {/* Live Search */}
                    <div className="lg:col-span-4 relative">
                        <label className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">
                            Search Customer / Phone / City
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                placeholder="Search by name, contact, mobile, GST, city..."
                                className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 font-medium"
                            />
                            <svg className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.5-4.5" strokeLinecap="round" /></svg>
                            {searchTerm && (
                                <button
                                    onClick={() => setSearchTerm('')}
                                    className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs font-bold"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Payment Rank Filter Dropdown */}
                    <div className="lg:col-span-3">
                        <label className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">
                            Payment Rank
                        </label>
                        <select aria-label="Payment Rank"
                            value={rankFilter}
                            onChange={e => setRankFilter(e.target.value as any)}
                            className="w-full py-1.5 px-2.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-bold focus:ring-2 focus:ring-green-500"
                        >
                            <option value="ALL">All Payment Ranks ({data.length})</option>
                            <option value="Good">Good Payment (Timely / Healthy)</option>
                            <option value="Bad">Bad Payment (Overdue / High Risk)</option>
                        </select>
                    </div>

                    {/* CRM Filter Dropdown */}
                    <div className="lg:col-span-3">
                        <label className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">
                            CRM Owner
                        </label>
                        <select aria-label="CRM Owner"
                            value={selectedCrm}
                            onChange={e => setSelectedCrm(e.target.value)}
                            disabled={!canViewAllCrms && currentUser?.role === UserRole.CRM}
                            className="w-full py-1.5 px-2.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-bold focus:ring-2 focus:ring-green-500 disabled:opacity-60"
                        >
                            <option value="ALL">All CRMs ({data.length} Accounts)</option>
                            {allCrmsInDataset.map(crm => (
                                <option key={crm} value={crm}>{crm} Portfolio</option>
                            ))}
                            <option value="UNASSIGNED">Unassigned Accounts</option>
                        </select>
                    </div>

                    {/* Status Filter */}
                    <div className="lg:col-span-2">
                        <label className="block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5">
                            Status
                        </label>
                        <select aria-label="Status"
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            className="w-full py-1.5 px-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-medium focus:ring-2 focus:ring-green-500"
                        >
                            <option value="ALL">All Statuses</option>
                            <option value={FollowUpStatus.Today}>Due Today</option>
                            <option value={FollowUpStatus.Overdue}>Overdue</option>
                            <option value={FollowUpStatus.Upcoming}>Upcoming</option>
                            <option value={FollowUpStatus.Pending}>Pending</option>
                            <option value={FollowUpStatus.Completed}>Completed</option>
                        </select>
                    </div>
                </div>

                {/* Secondary filters stay available, just out of the way until asked for. */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-separator">
                    <button
                        type="button"
                        onClick={() => setShowMoreFilters(v => !v)}
                        aria-expanded={showMoreFilters}
                        className="inline-flex items-center gap-1.5 h-8 px-1 -mx-1 text-[13.5px] font-semibold text-label-2 hover:text-label transition-colors"
                    >
                        <svg className={`w-4 h-4 transition-transform ${showMoreFilters ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9.5 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        {showMoreFilters ? 'Fewer filters' : 'More filters'}
                    </button>
                    {activeFilterCount > 0 && (
                        <span className="text-[13px] text-label-3">{activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} on</span>
                    )}
                </div>
                {showMoreFilters && (
                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-gray-100 dark:border-gray-700/60">
                    <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[11.5px] font-bold text-gray-500 dark:text-gray-400 mr-1">Rank:</span>
                        <button
                            onClick={() => setRankFilter('ALL')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                rankFilter === 'ALL'
                                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
                            }`}
                        >
                            All ({data.length})
                        </button>
                        <button
                            onClick={() => setRankFilter(rankFilter === 'Good' ? 'ALL' : 'Good')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all flex items-center gap-1 ${
                                rankFilter === 'Good'
                                    ? 'bg-emerald-600 text-white ring-1 ring-emerald-400'
                                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            }`}
                        >
                            <span>Good Payment ({metrics.goodCount})</span>
                        </button>
                        <button
                            onClick={() => setRankFilter(rankFilter === 'Bad' ? 'ALL' : 'Bad')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all flex items-center gap-1 ${
                                rankFilter === 'Bad'
                                    ? 'bg-rose-600 text-white ring-1 ring-rose-400'
                                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                            }`}
                        >
                            <span>Bad Payment ({metrics.badCount})</span>
                        </button>

                        <span className="text-[11.5px] font-bold text-gray-400 dark:text-gray-500 mx-1">|</span>
                        <span className="text-[11.5px] font-bold text-gray-500 dark:text-gray-400 mr-1">Ageing:</span>
                        <button
                            onClick={() => setAgeingFilter('all')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                ageingFilter === 'all'
                                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
                            }`}
                        >
                            All Ageing
                        </button>
                        <button
                            onClick={() => setAgeingFilter(ageingFilter === 'over90' ? 'all' : 'over90')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                ageingFilter === 'over90'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                            }`}
                        >
                            &gt;90d
                        </button>
                        <button
                            onClick={() => setAgeingFilter(ageingFilter === 'dueOver45' ? 'all' : 'dueOver45')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                ageingFilter === 'dueOver45'
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                            }`}
                        >
                            &gt;45d
                        </button>
                        <button
                            onClick={() => setAgeingFilter(ageingFilter === '1-45' ? 'all' : '1-45')}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-all ${
                                ageingFilter === '1-45'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                            }`}
                        >
                            1-45d
                        </button>
                    </div>

                    {/* Balance Type & Origin Toggles */}
                    <div className="flex items-center gap-1.5">
                        <select
                            value={balanceTypeFilter}
                            onChange={e => setBalanceTypeFilter(e.target.value as any)}
                            className="text-[12.5px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 font-semibold text-gray-800 dark:text-gray-200"
                        >
                            <option value="ALL">All Balances (Dr/Cr)</option>
                            <option value="Dr">Dr (Due)</option>
                            <option value="Cr">Cr (Advance)</option>
                        </select>

                        <select
                            value={originFilter}
                            onChange={e => setOriginFilter(e.target.value as any)}
                            className="text-[12.5px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 font-semibold text-gray-800 dark:text-gray-200"
                        >
                            <option value="ALL">All Sources</option>
                            <option value="NEW">Created ({metrics.newCount})</option>
                            <option value="SHEET">Sheet Synced</option>
                        </select>

                        {(searchTerm || rankFilter !== 'ALL' || selectedCrm !== 'ALL' || ageingFilter !== 'all' || statusFilter !== 'ALL' || balanceTypeFilter !== 'ALL' || originFilter !== 'ALL') && (
                            <button
                                onClick={() => {
                                    setSearchTerm('');
                                    setRankFilter('ALL');
                                    setSelectedCrm('ALL');
                                    setAgeingFilter('all');
                                    setStatusFilter('ALL');
                                    setBalanceTypeFilter('ALL');
                                    setOriginFilter('ALL');
                                }}
                                className="text-[12.5px] text-red-600 dark:text-red-400 font-bold hover:underline px-1"
                            >
                                Reset
                            </button>
                        )}
                    </div>
                </div>
                )}
            </div>

            {/* Bulk Reassign CRM Bar (If selected) */}
            {canReassignCrm && selectedCustomerIds.length > 0 && (
                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-300 dark:border-emerald-700 flex flex-wrap items-center justify-between gap-2 animate-in fade-in">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-900 dark:text-emerald-200">
                        <span>✓ {selectedCustomerIds.length} customer(s) selected</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            value={bulkCrm}
                            onChange={e => setBulkCrm(e.target.value)}
                            className="px-2 py-1 text-xs rounded-lg border border-emerald-400 bg-white dark:bg-gray-800 font-bold text-gray-900 dark:text-white"
                        >
                            <option value="">Select CRM to Reassign...</option>
                            {crmUsers.map(u => (
                                <option key={u.id} value={u.name}>{u.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={handleApplyBulkCrm}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-2xs"
                        >
                            Reassign Selected
                        </button>
                    </div>
                </div>
            )}

            {/* Main Content: Dense & Realigned Table View vs Card View */}
            {filteredData.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs">
                    <svg className="w-8 h-8 mx-auto mb-2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.5-4.5" strokeLinecap="round" /></svg>
                    <h3 className="text-sm font-bold text-gray-800 dark:text-white">No Customers Match Current Filters</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-md mx-auto">
                        Try resetting your search query, Payment Rank, CRM, or ageing filter.
                    </p>
                    {canAddCustomer && (
                        <button
                            onClick={onAddCustomer}
                            className="mt-3 px-3.5 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all inline-flex items-center gap-1"
                        >
                            <span>Add New Customer</span>
                        </button>
                    )}
                </div>
            ) : viewMode === 'table' ? (
                /* Customer Data Table with Dedicated Smooth Horizontal Scroll Container */
                <div className="w-full max-w-full bg-card rounded-[16px] shadow-e1 overflow-hidden flex flex-col">
                    {/* Top Table Control Bar with Quick Horizontal Scroll Slider & Navigation */}
                    <div className="px-3.5 py-2.5 bg-card-2 border-b border-separator flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                                                                <span>Customer Ledger ({filteredData.length} accounts)</span>
                            </span>
                            {/* What the bar colours mean, said once instead of per row. */}
                            <AgeingLegend className="gap-3" />
                        </div>

                    </div>

                    {/* Horizontal Scroll Container (Strict containment without triggering body scroll) */}
                    <div 
                        id="customer-table-scroll-container"
                        className="w-full max-w-full overflow-x-auto overflow-y-visible scrollbar-thin scrollbar-thumb-gray-400 hover:scrollbar-thumb-gray-500 dark:scrollbar-thumb-gray-600 dark:hover:scrollbar-thumb-gray-500 scrollbar-track-slate-100 dark:scrollbar-track-gray-800 focus:outline-none"
                        tabIndex={0}
                    >
                        <table className="min-w-[1040px] w-full text-xs text-left border-collapse table-auto">
                            <thead className="bg-slate-100/95 dark:bg-gray-800/95 text-gray-700 dark:text-gray-300 font-bold uppercase tracking-wider border-b border-gray-200 dark:border-gray-700 text-[11.5px] sticky top-0 z-10 backdrop-blur-xs">
                                <tr>
                                    {canReassignCrm && (
                                        <th className="px-2.5 py-2.5 w-12 text-center">
                                            <label className="inline-flex items-center justify-center p-2 -m-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedCustomerIds.length === filteredData.length && filteredData.length > 0}
                                                    onChange={e => handleSelectAll(e.target.checked)}
                                                    className="w-4 h-4 rounded text-green-600 dark:text-green-400 focus:ring-green-500 cursor-pointer" style={{ outlineOffset: 6 }}
                                                    title="Select all customers on view"
                                                    aria-label="Select all customers in view"
                                                />
                                            </label>
                                        </th>
                                    )}
                                    <th className="px-3.5 py-2.5 min-w-[210px]">Customer & Contact Details</th>
                                    <th className="px-3 py-2.5 text-right w-24">Balance</th>
                                    <th className="px-2.5 py-2.5 text-left w-[204px] min-w-[204px]">Ageing</th>
                                    <th className="px-2.5 py-2.5 text-right w-30 bg-rose-50/40 dark:bg-rose-950/20 font-extrabold text-rose-800 dark:text-rose-300">Due &gt;45 Days</th>
                                    <th className="px-2.5 py-2.5 text-center w-36">Follow-up / Status</th>
                                    <th className="px-2.5 py-2.5 text-left w-32">CRM Owner</th>
                                    <th className="px-3 py-2.5 text-right w-44 z-20 bg-slate-100 dark:bg-gray-800 sticky right-0 shadow-[inset_1px_0_0_0_var(--separator),-12px_0_16px_-12px_rgb(2_6_23_/_0.28)]">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {filteredData.map(item => {
                                    const activePdcs = pdcCheques.filter(p => p.customerId === item.id && (p.status === 'Pending' || p.status === 'DueToday'));
                                    const totalPdc = activePdcs.reduce((sum, p) => sum + p.amount, 0);

                                    const a1 = item.ageing?.['1-45'] || 0;
                                    const a2 = item.ageing?.['46-90'] || 0;
                                    const a3 = item.ageing?.['91-135'] || 0;
                                    const a4 = item.ageing?.['>135'] || 0;
                                    const over90 = item.over90 !== undefined ? item.over90 : (a3 + a4);
                                    const due45 = item.dueOver45 !== undefined ? item.dueOver45 : (a2 + over90);

                                    const isChecked = selectedCustomerIds.includes(item.id);
                                    const rank = getCustomerPaymentRank(item);

                                    return (
                                        <tr 
                                            key={item.id} 
                                            className={`group hover:bg-slate-50/90 dark:hover:bg-gray-800/60 transition-colors ${isChecked ? 'bg-emerald-50/30 dark:bg-emerald-950/10' : ''}`}
                                        >
                                            {canReassignCrm && (
                                                <td className="px-2.5 py-2.5 text-center">
                                                    <label className="inline-flex items-center justify-center p-2 -m-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={() => handleToggleRow(item.id)}
                                                            aria-label={`Select ${item.company}`}
                                                            className="w-4 h-4 rounded text-green-600 dark:text-green-400 focus:ring-green-500 cursor-pointer" style={{ outlineOffset: 6 }}
                                                        />
                                                    </label>
                                                </td>
                                            )}

                                            {/* Company & Contact Column */}
                                            <td className="px-3.5 py-2.5 min-w-[320px]">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="font-extrabold text-gray-900 dark:text-white text-xs whitespace-normal break-words">
                                                        {item.company}
                                                    </span>
                                                    {item.isNewCustomer && (
                                                        <span className="px-1.5 py-0.5 rounded text-[11px] font-extrabold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
                                                            NEW
                                                        </span>
                                                    )}
                                                    {item.isUrgent && (
                                                        <span className="px-1.5 py-0.5 rounded text-[11px] font-extrabold bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200">
                                                            URGENT
                                                        </span>
                                                    )}
                                                    {activePdcs.length > 0 && (
                                                        <button
                                                            onClick={() => onOpenPdcForCustomer?.(item.id)}
                                                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 hover:bg-emerald-200 transition-colors"
                                                            title={`Active PDCs: ₹${totalPdc.toLocaleString('en-IN')}`}
                                                        >
                                                            <ChequeIcon className="w-2.5 h-2.5" />
                                                            <span>PDC {formatCurrency(totalPdc)}</span>
                                                        </button>
                                                    )}
                                                </div>

                                                {/* Compact Contact Line */}
                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[12.5px] text-gray-500 dark:text-gray-400">
                                                    {/* Payment rank used to be its own 178px column; it is one pill,
                                                        so it lives with the customer it describes. */}
                                                    <span
                                                        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                                                            rank === 'Good'
                                                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                                                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-700'
                                                        }`}
                                                        title={item.paymentRank ? `Manually set: ${item.paymentRank} Payment` : `Auto-ranked on credit terms & ageing: ${rank} Payment`}
                                                    >
                                                        {rank}
                                                    </span>
                                                    <span className="text-[11.5px] font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                        {item.paymentTermsDays ? `${item.paymentTermsDays}d terms` : 'Std credit'}
                                                        {item.creditLimit ? ` • ₹${(item.creditLimit / 100000).toFixed(1)}L` : ''}
                                                    </span>
                                                    {item.city && (
                                                        <span className="font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                                            {item.city}
                                                        </span>
                                                    )}
                                                    {item.contactPerson && (
                                                        <span className="text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
                                                            {item.contactPerson} {item.contactPost ? `(${item.contactPost})` : ''}
                                                        </span>
                                                    )}
                                                    {item.contactNumber && (
                                                        <a href={`tel:${item.contactNumber}`} className="inline-flex items-center min-h-[28px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap">
                                                            {item.contactNumber}
                                                        </a>
                                                    )}
                                                    {item.additionalContacts && item.additionalContacts.length > 0 && (
                                                        <span 
                                                            className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 text-[11px] font-bold cursor-help whitespace-nowrap"
                                                            title={`Additional contacts:\n${item.additionalContacts.map(c => `• ${c.name} (${c.post || 'Staff'}): ${c.mobile}`).join('\n')}`}
                                                        >
                                                            +{item.additionalContacts.length} contact{item.additionalContacts.length === 1 ? '' : 's'}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Total Balance — compact by default, exact figure on hover.
                                                A credit balance still gets the full CR (Excess) treatment. */}
                                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                                {item.totalType === 'Cr' && item.total > 0 ? (
                                                    /* One credit row anywhere in the book used to widen this column to
                                                       171px for every row, because the full "CR (Excess)" chip never
                                                       wraps. Same meaning, compact. */
                                                    <span
                                                        className="inline-flex items-center gap-1 num text-xs font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/50 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800/80"
                                                        title={`Excess payment held with us (CR advance) of ${formatINR(item.total)}`}
                                                    >
                                                        {formatINR(item.total)}
                                                        <span className="uppercase font-black text-[10px] px-1 rounded bg-purple-200 text-purple-900 dark:bg-purple-800 dark:text-purple-100">
                                                            CR
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span
                                                        className="num text-xs font-extrabold text-gray-900 dark:text-gray-100"
                                                        title={formatCompact(item.total)}
                                                    >
                                                        {formatINR(item.total)}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Ageing — the bar for shape, then every bucket in full rupees,
                                                colour-keyed to the bar above it. Four separate number columns
                                                cost ~420px; this says the same in ~195px without a tooltip. */}
                                            <td className="px-2.5 py-2 align-middle">
                                                <AgeingBar parts={{ a1, a2, a3, a4 }} height={6} />
                                                <div className="mt-1.5 grid grid-cols-2 gap-x-2.5 gap-y-0.5 text-[11px] leading-[1.35]">
                                                    {AGE_BANDS.map((band, i) => {
                                                        const v = [a1, a2, a3, a4][i];
                                                        return (
                                                            <span
                                                                key={band.key}
                                                                className="inline-flex items-center gap-1 whitespace-nowrap"
                                                                title={`${band.label}: ${formatINR(v)}`}
                                                            >
                                                                <span
                                                                    className="w-1.5 h-1.5 rounded-full flex-none"
                                                                    style={{ background: band.varName, opacity: v > 0 ? 1 : 0.3 }}
                                                                    aria-hidden="true"
                                                                />
                                                                <span className={`num ${v > 0 ? 'font-semibold text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600'}`}>
                                                                    {v > 0 ? formatINR(v) : '—'}
                                                                </span>
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </td>

                                            {/* Due >45 */}
                                            <td className="px-2.5 py-2.5 text-right whitespace-nowrap bg-rose-50/30 dark:bg-rose-950/10">
                                                <span
                                                    className={`num text-[12.5px] ${due45 > 0 ? 'text-rose-700 dark:text-rose-400 font-extrabold' : 'text-gray-500 dark:text-gray-400'}`}
                                                    title={formatCompact(due45)}
                                                >
                                                    {formatINR(due45)}
                                                </span>
                                            </td>

                                            {/* Follow-up Date & Status */}
                                            <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                                                <div className="flex flex-col items-center justify-center gap-0.5">
                                                    <StatusBadge status={item.status} />
                                                    <span className={`text-[11.5px] font-bold ${
                                                        item.status === FollowUpStatus.Overdue ? 'text-red-600 dark:text-red-400' :
                                                        item.status === FollowUpStatus.Today ? 'text-blue-600 dark:text-blue-400 font-extrabold' :
                                                        item.status === FollowUpStatus.Upcoming ? 'text-emerald-600 dark:text-emerald-400 font-semibold' :
                                                        'text-gray-600 dark:text-gray-400'
                                                    }`}>
                                                        {item.followUpDate ? formatDate(item.followUpDate) : 'No date'}
                                                    </span>
                                                    {item.forecastAmount !== undefined && item.forecastAmount > 0 && (
                                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" title={`Committed Cash Forecast: ₹${item.forecastAmount.toLocaleString('en-IN')}`}>
                                                            {formatCurrency(item.forecastAmount)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* CRM Owner */}
                                            <td className="px-2.5 py-2.5 text-left whitespace-nowrap">
                                                {canReassignCrm && onReassignCrm ? (
                                                    <select
                                                        value={item.crmOwnerId || ''}
                                                        onChange={e => onReassignCrm(item.id, e.target.value)}
                                                        aria-label={`CRM owner for ${item.company}`}
                                                        className="text-[12.5px] h-8 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 font-semibold text-gray-800 dark:text-gray-200 cursor-pointer"
                                                    >
                                                        <option value="">Unassigned</option>
                                                        {crmUsers.map(u => (
                                                            <option key={u.id} value={u.name}>{u.name}</option>
                                                        ))}
                                                        {item.crmOwnerId && !crmUsers.some(u => u.name === item.crmOwnerId) && (
                                                            <option value={item.crmOwnerId}>{item.crmOwnerId}</option>
                                                        )}
                                                    </select>
                                                ) : (
                                                    <span className="font-bold text-gray-800 dark:text-gray-200 text-[12.5px]">
                                                        {item.crmOwnerId || 'Unassigned'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Actions — pinned to the right edge. The ledger is ~1850px wide, so on a
                                                laptop this column used to sit past the fold and Edit / Follow Up could
                                                only be reached by scrolling sideways. */}
                                            <td className="px-3 py-2.5 text-right whitespace-nowrap z-10 bg-card group-hover:bg-slate-50 dark:group-hover:bg-gray-800 sticky right-0 shadow-[inset_1px_0_0_0_var(--separator),-12px_0_16px_-12px_rgb(2_6_23_/_0.28)]">
                                                <div className="flex items-center justify-end space-x-1">
                                                    {/* WhatsApp Reminder */}
                                                    <button
                                                        onClick={() => onWhatsApp(item)}
                                                        className="w-8 h-8 grid place-items-center text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-full transition-colors"
                                                        title="Send WhatsApp follow-up"
                                                        aria-label={`Send WhatsApp follow-up to ${item.company}`}
                                                    >
                                                        <WhatsAppIcon className="w-4 h-4" />
                                                    </button>

                                                    {/* Edit — icon only. Follow Up is the primary action and keeps its
                                                        label; this one buys back the width the ageing figures need. */}
                                                    <button
                                                        onClick={() => onEditCustomer(item)}
                                                        disabled={!canEditCustomer}
                                                        className={`w-8 h-8 grid place-items-center rounded-full transition-colors ${
                                                            canEditCustomer
                                                                ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                                                                : 'text-gray-400 opacity-50 cursor-not-allowed'
                                                        }`}
                                                        title={canEditCustomer ? 'Edit customer master details & rank' : 'No rights to edit customer'}
                                                        aria-label={`Edit ${item.company}`}
                                                    >
                                                        <EditIcon className="w-4 h-4" />
                                                    </button>

                                                    {/* Follow-up Button */}
                                                    <button
                                                        onClick={() => onFollowUp(item)}
                                                        disabled={!canEditFollowUp}
                                                        className={`h-8 px-3 text-[12.5px] font-semibold rounded-full transition-all ${
                                                            canEditFollowUp
                                                                ? 'bg-green-600 hover:bg-green-700 text-white shadow-2xs'
                                                                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 opacity-50 cursor-not-allowed'
                                                        }`}
                                                        title="Log follow-up notes & update date"
                                                    >
                                                        Follow Up
                                                    </button>

                                                    {/* Delete Customer Button */}
                                                    {canDeleteCustomer && onDeleteCustomer && (
                                                        <button
                                                            onClick={() => {
                                                                if (confirm(`Delete "${item.company}"? This cannot be undone.`)) {
                                                                    onDeleteCustomer(item.id);
                                                                }
                                                            }}
                                                            className="w-8 h-8 grid place-items-center text-red-600 dark:text-red-400 hover:text-red-800 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-full transition-colors"
                                                            title="Delete customer"
                                                            aria-label={`Delete ${item.company}`}
                                                        >
                                                            <TrashIcon className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                </div>
            ) : (
                /* Grid / Cards View */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredData.map(item => {

                        const a3 = item.ageing?.['91-135'] || 0;
                        const a4 = item.ageing?.['>135'] || 0;
                        const over90 = item.over90 !== undefined ? item.over90 : (a3 + a4);
                        const rank = getCustomerPaymentRank(item);

                        return (
                            <div 
                                key={item.id}
                                className="bg-white dark:bg-gray-800 rounded-xl p-3.5 border border-gray-200 dark:border-gray-700 shadow-2xs flex flex-col justify-between hover:shadow-md transition-shadow"
                            >
                                <div>
                                    {/* Card Header */}
                                    <div className="flex justify-between items-start gap-2">
                                        <div>
                                            <h3 className="font-extrabold text-sm text-gray-900 dark:text-white whitespace-normal break-words">
                                                {item.company}
                                            </h3>
                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                <span 
                                                    className={`px-2 py-0.5 rounded-full text-[11.5px] font-extrabold ${
                                                        rank === 'Good'
                                                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300'
                                                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300'
                                                    }`}
                                                >
                                                    {rank === 'Good' ? 'Good Payment' : 'Bad Payment'}
                                                </span>
                                                <span className="px-2 py-0.5 rounded-md text-[11.5px] font-bold bg-slate-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                                                    CRM: {item.crmOwnerId || 'Unassigned'}
                                                </span>
                                                <StatusBadge status={item.status} />
                                            </div>
                                        </div>

                                        <div className="text-right">
                                            <BalanceAmount
                                                amount={item.total}
                                                type={item.totalType || 'Dr'}
                                                defaultClass="font-extrabold text-sm text-gray-900 dark:text-white"
                                            />
                                            {over90 > 0 && (
                                                <div className="text-[11.5px] font-bold text-red-600 dark:text-red-400 mt-0.5">
                                                    &gt;90d: {formatCurrency(over90)}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Contact Details */}
                                    <div className="mt-2.5 p-2 bg-slate-50 dark:bg-gray-900/60 rounded-lg space-y-1 text-xs">
                                        <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                                            <span className="font-semibold">{item.contactPerson || 'Accounts Dept'}</span>
                                            {item.city && <span className="text-[11.5px] text-gray-500 font-medium">{item.city}</span>}
                                        </div>
                                        {item.contactNumber && (
                                            <div className="flex items-center justify-between text-[12.5px]">
                                                <a href={`tel:${item.contactNumber}`} className="inline-flex items-center min-h-[28px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline">
                                                    {item.contactNumber}
                                                </a>
                                                <button
                                                    onClick={() => onWhatsApp(item)}
                                                    className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 text-xs font-semibold flex items-center gap-1"
                                                >
                                                    <WhatsAppIcon className="w-3.5 h-3.5" />
                                                    <span>WhatsApp</span>
                                                </button>
                                            </div>
                                        )}
                                        {(item.paymentTermsDays || item.creditLimit) && (
                                            <div className="text-[11.5px] text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-200 dark:border-gray-800">
                                                Credit Terms: <span className="font-semibold text-gray-700 dark:text-gray-200">{item.paymentTermsDays ? `${item.paymentTermsDays} Days` : 'Standard'}</span>
                                                {item.creditLimit ? ` • Limit: ₹${(item.creditLimit / 100000).toFixed(1)}L` : ''}
                                            </div>
                                        )}
                                    </div>

                                    {/* Ageing Breakdown Summary */}
                                    <div className="grid grid-cols-4 gap-1 text-center mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/60 text-[11.5px]">
                                        <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-1 rounded">
                                            <div className="text-gray-500">1-45d</div>
                                            <div className="font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(item.ageing?.['1-45'] || 0)}</div>
                                        </div>
                                        <div className="bg-amber-50/50 dark:bg-amber-950/20 p-1 rounded">
                                            <div className="text-gray-500">46-90d</div>
                                            <div className="font-bold text-amber-700 dark:text-amber-300">{formatCurrency(item.ageing?.['46-90'] || 0)}</div>
                                        </div>
                                        <div className="bg-orange-50/50 dark:bg-orange-950/20 p-1 rounded">
                                            <div className="text-gray-500">91-135d</div>
                                            <div className="font-bold text-orange-700 dark:text-orange-300">{formatCurrency(item.ageing?.['91-135'] || 0)}</div>
                                        </div>
                                        <div className="bg-red-50/50 dark:bg-red-950/20 p-1 rounded">
                                            <div className="text-gray-500">&gt;135d</div>
                                            <div className="font-extrabold text-red-700 dark:text-red-400">{formatCurrency(item.ageing?.['>135'] || 0)}</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Card Footer Actions */}
                                <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-between gap-2">
                                    <div className="text-[12.5px] text-gray-500 dark:text-gray-400">
                                        {item.followUpDate ? `Next: ${formatDate(item.followUpDate)}` : 'No date set'}
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => onEditCustomer(item)}
                                            disabled={!canEditCustomer}
                                            className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                                                canEditCustomer
                                                    ? 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'
                                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 opacity-50 cursor-not-allowed'
                                            }`}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => onFollowUp(item)}
                                            disabled={!canEditFollowUp}
                                            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                                                canEditFollowUp
                                                    ? 'bg-green-600 hover:bg-green-700 text-white shadow-2xs'
                                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 opacity-50 cursor-not-allowed'
                                            }`}
                                        >
                                            Follow Up
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default CustomerDashboardView;
