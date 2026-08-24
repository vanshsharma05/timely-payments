import React, { useState, useEffect } from 'react';
import Markdown from 'react-markdown';
import { Outstanding, User, CompanyProfile, AiReportRequest, AiReportResponse, PdcCheque, PdcStatus } from '../types';
import { SparklesIcon, DownloadIcon, CheckCircleIcon, UsersIcon, ClockIcon, ExclamationTriangleIcon, FireIcon } from './icons/Icons';

interface AiReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    data: Outstanding[];
    users: User[];
    companyProfile: CompanyProfile;
    selectedCrm?: string;
    pdcCheques?: PdcCheque[];
    onFollowUp?: (customer: Outstanding) => void;
}

export type AiReportMode = 'credit_reduction' | 'overdue_recovery' | 'crm_performance' | 'cash_forecast' | 'custom';

export const AiReportModal: React.FC<AiReportModalProps> = ({
    isOpen,
    onClose,
    data,
    users,
    companyProfile,
    selectedCrm = 'ALL',
    pdcCheques = [],
    onFollowUp,
}) => {
    const [mode, setMode] = useState<AiReportMode>('credit_reduction');
    const [targetCrm, setTargetCrm] = useState<string>(selectedCrm);
    const [customPrompt, setCustomPrompt] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [reportResult, setReportResult] = useState<AiReportResponse | null>(null);
    const [copied, setCopied] = useState<boolean>(false);
    const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
    const [activeTab, setActiveTab] = useState<'configure' | 'report'>('configure');

    // Check AI status on mount
    useEffect(() => {
        if (isOpen) {
            fetch('/api/ai-status')
                .then(r => r.json())
                .then(res => {
                    if (res && res.ok) {
                        setHasApiKey(res.hasApiKey);
                    }
                })
                .catch(() => setHasApiKey(false));
        }
    }, [isOpen]);

    // Keep targetCrm in sync with props
    useEffect(() => {
        if (selectedCrm) {
            setTargetCrm(selectedCrm);
        }
    }, [selectedCrm]);

    // Filter data for target CRM
    const scopedData = React.useMemo(() => {
        if (targetCrm === 'ALL') return data;
        if (targetCrm === 'UNASSIGNED') {
            return data.filter(d => !d.crmOwnerId || d.crmOwnerId.trim() === '' || d.crmOwnerId.toUpperCase() === 'UNASSIGNED');
        }
        return data.filter(d => (d.crmOwnerId || '').toUpperCase() === targetCrm.toUpperCase());
    }, [data, targetCrm]);

    // Calculate detailed metrics for the AI prompt
    const metrics = React.useMemo(() => {
        let totalOutstanding = 0;
        let dueOver45 = 0;
        let over90 = 0;
        let over135 = 0;
        let totalWeightedDays = 0;
        let activeAccountsCount = 0;

        scopedData.forEach(item => {
            const tot = item.total || 0;
            totalOutstanding += tot;
            const a1 = item.ageing?.['1-45'] || 0;
            const a2 = item.ageing?.['46-90'] || 0;
            const a3 = item.ageing?.['91-135'] || 0;
            const a4 = item.ageing?.['>135'] || 0;
            
            const o90 = item.over90 !== undefined ? item.over90 : (a3 + a4);
            const d45 = item.dueOver45 !== undefined ? item.dueOver45 : (a2 + o90);

            dueOver45 += d45;
            over90 += o90;
            over135 += a4;

            if (tot > 0) {
                // Weighted average collection days estimate
                const weighted = ((a1 * 22.5) + (a2 * 67.5) + (a3 * 112.5) + (a4 * 165)) / tot;
                totalWeightedDays += weighted;
                activeAccountsCount++;
            }
        });

        // Active PDCs in hand
        const scopedIds = new Set(scopedData.map(d => d.id));
        const activePdcs = pdcCheques.filter(p => scopedIds.has(p.customerId) && p.status !== PdcStatus.Cleared && p.status !== PdcStatus.Bounced);
        const clearedPdcs = pdcCheques.filter(p => scopedIds.has(p.customerId) && p.status === PdcStatus.Cleared);

        const totalPdcInHand = activePdcs.reduce((sum, p) => sum + p.amount, 0);
        const pdcClearedTotal = clearedPdcs.reduce((sum, p) => sum + p.amount, 0);

        const scheduledCount = scopedData.filter(d => d.followUpDate || d.status === 'Completed').length;
        const coverageRate = scopedData.length > 0 ? Math.round((scheduledCount / scopedData.length) * 100) : 0;
        const averageCollectionDays = activeAccountsCount > 0 ? Math.round(totalWeightedDays / activeAccountsCount) : 0;

        // Top critical accounts
        const criticalAccounts = [...scopedData]
            .sort((a, b) => {
                const aOver = (a.ageing?.['>135'] || 0) + (a.ageing?.['91-135'] || 0);
                const bOver = (b.ageing?.['>135'] || 0) + (b.ageing?.['91-135'] || 0);
                return bOver - aOver || (b.total || 0) - (a.total || 0);
            })
            .slice(0, 15)
            .map(acc => {
                const tot = acc.total || 0;
                const a1 = acc.ageing?.['1-45'] || 0;
                const a2 = acc.ageing?.['46-90'] || 0;
                const a3 = acc.ageing?.['91-135'] || 0;
                const a4 = acc.ageing?.['>135'] || 0;
                const o90 = acc.over90 !== undefined ? acc.over90 : (a3 + a4);
                const d45 = acc.dueOver45 !== undefined ? acc.dueOver45 : (a2 + o90);
                const avg = tot > 0 ? Math.round(((a1 * 22.5) + (a2 * 67.5) + (a3 * 112.5) + (a4 * 165)) / tot) : 0;

                const custPdcs = pdcCheques.filter(p => p.customerId === acc.id && p.status !== PdcStatus.Cleared && p.status !== PdcStatus.Bounced);
                const activePdc = custPdcs.reduce((s, p) => s + p.amount, 0);

                return {
                    company: acc.company,
                    crm: acc.crmOwnerId || 'Unassigned',
                    totalDue: tot,
                    dueOver45: d45,
                    over90: o90,
                    over135: a4,
                    avgDays: avg,
                    status: acc.status,
                    activePdc,
                    lastNote: acc.notes && acc.notes.length > 0 ? acc.notes[acc.notes.length - 1] : undefined
                };
            });

        return {
            totalAccounts: scopedData.length,
            totalOutstanding,
            dueOver45,
            over90,
            over135,
            totalPdcInHand,
            pdcClearedTotal,
            averageCollectionDays,
            coverageRate,
            criticalAccounts
        };
    }, [scopedData, pdcCheques]);

    if (!isOpen) return null;

    const handleGenerateReport = async () => {
        setIsLoading(true);
        setActiveTab('report');
        try {
            const payload: AiReportRequest = {
                mode,
                customPrompt: mode === 'custom' ? customPrompt : undefined,
                companyProfile,
                targetCrm,
                metricsSummary: {
                    totalAccounts: metrics.totalAccounts,
                    totalOutstanding: metrics.totalOutstanding,
                    dueOver45: metrics.dueOver45,
                    over90: metrics.over90,
                    over135: metrics.over135,
                    totalPdcInHand: metrics.totalPdcInHand,
                    pdcClearedTotal: metrics.pdcClearedTotal,
                    averageCollectionDays: metrics.averageCollectionDays,
                    coverageRate: metrics.coverageRate
                },
                criticalAccounts: metrics.criticalAccounts
            };

            const response = await fetch('/api/gemini-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result: AiReportResponse = await response.json();
            setReportResult(result);
        } catch (err: any) {
            setReportResult({
                ok: false,
                error: err.message || 'Failed to generate AI report.'
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = () => {
        if (reportResult?.reportMarkdown) {
            navigator.clipboard.writeText(reportResult.reportMarkdown);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        }
    };

    const handlePrint = () => {
        window.print();
    };

    const formatInr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-5 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gradient-to-r from-emerald-600 via-teal-600 to-green-700 text-white">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-xl backdrop-blur-xs">
                            <SparklesIcon className="w-6 h-6 text-yellow-300 animate-pulse" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg sm:text-xl font-bold tracking-tight">
                                    AI Financial & Credit Optimization Report
                                </h2>
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-yellow-400 text-gray-900">
                                    Gemini 3.7
                                </span>
                            </div>
                            <p className="text-xs text-emerald-100 mt-0.5">
                                Powered by Google Gemini API • Automated credit days reduction & cash flow intelligence
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {reportResult && activeTab === 'report' && (
                            <button
                                onClick={() => setActiveTab('configure')}
                                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold transition-colors"
                            >
                                ⚙️ Settings
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-1.5 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
                            title="Close"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* API Status Banner */}
                <div className="px-6 py-2 bg-slate-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700/60 flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${hasApiKey ? 'bg-emerald-500 animate-pulse' : 'bg-blue-500'}`}></span>
                        <span>
                            {hasApiKey 
                                ? 'Gemini API Connected (Live Model Analysis)' 
                                : 'Using High-Precision Algorithmic Analytics Engine (Add GEMINI_API_KEY for custom AI neural generation)'}
                        </span>
                    </div>
                    <div className="font-semibold text-gray-700 dark:text-gray-200">
                        {companyProfile.name} • {scopedData.length} Accounts Selected
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
                    {activeTab === 'configure' ? (
                        <div className="space-y-6 max-w-4xl mx-auto">
                            {/* Step 1: Select Scope */}
                            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 sm:p-5 rounded-xl border border-gray-200 dark:border-gray-700">
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
                                    <UsersIcon />
                                    <span>1. Select Report Scope & Portfolio</span>
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                                            CRM Account Owner:
                                        </label>
                                        <select
                                            value={targetCrm}
                                            onChange={(e) => setTargetCrm(e.target.value)}
                                            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                        >
                                            <option value="ALL">🏢 Entire Company ({data.length} total accounts)</option>
                                            {users.filter(u => u.role === 'CRM').map(u => (
                                                <option key={u.id} value={u.id}>
                                                    👤 {u.name} ({data.filter(d => (d.crmOwnerId || '').toUpperCase() === u.id.toUpperCase() || (d.crmOwnerId || '').toUpperCase() === u.name.toUpperCase()).length} accounts)
                                                </option>
                                            ))}
                                            <option value="UNASSIGNED">⚠️ Unassigned Accounts</option>
                                        </select>
                                    </div>
                                    
                                    {/* Real-time Scope Summary Cards */}
                                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                        <div className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                                            <span className="text-gray-500 dark:text-gray-400 block text-[10px]">Total Due</span>
                                            <span className="font-extrabold text-gray-900 dark:text-white">{formatInr(metrics.totalOutstanding)}</span>
                                        </div>
                                        <div className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                                            <span className="text-red-500 block text-[10px]">Due &gt;45d</span>
                                            <span className="font-extrabold text-red-600 dark:text-red-400">{formatInr(metrics.dueOver45)}</span>
                                        </div>
                                        <div className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                                            <span className="text-emerald-500 block text-[10px]">Avg Collection</span>
                                            <span className="font-extrabold text-emerald-600 dark:text-emerald-400">{metrics.averageCollectionDays} days</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Step 2: Choose Objective Mode */}
                            <div>
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
                                    <ClockIcon />
                                    <span>2. Choose AI Strategic Intelligence Objective</span>
                                </h3>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {/* Mode 1: Credit Days Reduction */}
                                    <label
                                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                                            mode === 'credit_reduction'
                                                ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/40 ring-2 ring-emerald-400'
                                                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-emerald-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <input
                                                type="radio"
                                                name="ai_mode"
                                                checked={mode === 'credit_reduction'}
                                                onChange={() => setMode('credit_reduction')}
                                                className="mt-1 text-emerald-600 focus:ring-emerald-500"
                                            />
                                            <div>
                                                <span className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-1.5">
                                                    <span>📉 Credit Days Reduction Strategy</span>
                                                    <span className="px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">Recommended</span>
                                                </span>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                    Analyze average collection days for each customer, identify slow payers, and generate concrete terms to cut credit days from 60/90 to 30 days.
                                                </p>
                                            </div>
                                        </div>
                                    </label>

                                    {/* Mode 2: Overdue Recovery */}
                                    <label
                                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                                            mode === 'overdue_recovery'
                                                ? 'border-red-500 bg-red-50/80 dark:bg-red-950/40 ring-2 ring-red-400'
                                                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-red-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <input
                                                type="radio"
                                                name="ai_mode"
                                                checked={mode === 'overdue_recovery'}
                                                onChange={() => setMode('overdue_recovery')}
                                                className="mt-1 text-red-600 focus:ring-red-500"
                                            />
                                            <div>
                                                <span className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-1.5">
                                                    <span>🚨 High-Risk Overdue (&gt;90d &gt;135d) Action Plan</span>
                                                </span>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                    Escalation roadmap for stuck debts, legal alerts, holding dispatch, and negotiating PDC installments.
                                                </p>
                                            </div>
                                        </div>
                                    </label>

                                    {/* Mode 3: CRM Performance */}
                                    <label
                                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                                            mode === 'crm_performance'
                                                ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-950/40 ring-2 ring-blue-400'
                                                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <input
                                                type="radio"
                                                name="ai_mode"
                                                checked={mode === 'crm_performance'}
                                                onChange={() => setMode('crm_performance')}
                                                className="mt-1 text-blue-600 focus:ring-blue-500"
                                            />
                                            <div>
                                                <span className="font-bold text-sm text-gray-900 dark:text-white">
                                                    👥 CRM Follow-up & Accountability Audit
                                                </span>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                    Audit CRM follow-up schedule discipline, unscheduled accounts, and collection velocity score.
                                                </p>
                                            </div>
                                        </div>
                                    </label>

                                    {/* Mode 4: Cash Forecast */}
                                    <label
                                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                                            mode === 'cash_forecast'
                                                ? 'border-teal-500 bg-teal-50/80 dark:bg-teal-950/40 ring-2 ring-teal-400'
                                                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-teal-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <input
                                                type="radio"
                                                name="ai_mode"
                                                checked={mode === 'cash_forecast'}
                                                onChange={() => setMode('cash_forecast')}
                                                className="mt-1 text-teal-600 focus:ring-teal-500"
                                            />
                                            <div>
                                                <span className="font-bold text-sm text-gray-900 dark:text-white">
                                                    🔮 Cash Flow & Working Capital Forecast
                                                </span>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                    Project expected cash inflows for next 15-30 days based on PDC cheques in hand and scheduled follow-ups.
                                                </p>
                                            </div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            {/* Custom Prompt Box if Mode is Custom */}
                            <div className="bg-gray-50 dark:bg-gray-800/40 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                    💡 Custom AI Query or Additional Directives (Optional):
                                </label>
                                <textarea
                                    value={customPrompt}
                                    onChange={(e) => setCustomPrompt(e.target.value)}
                                    placeholder="e.g. Focus on customers in Gujarat area, highlight accounts with pending PDC, and suggest a 15-day recovery sprint plan..."
                                    rows={2}
                                    className="w-full p-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                />
                            </div>

                            {/* Action Button */}
                            <div className="pt-2 flex justify-end">
                                <button
                                    onClick={handleGenerateReport}
                                    disabled={isLoading}
                                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 text-sm"
                                >
                                    <SparklesIcon className="w-5 h-5 text-yellow-300" />
                                    <span>{isLoading ? 'Analyzing Portfolio with Gemini AI...' : 'Generate Intelligent AI Report'}</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {isLoading ? (
                                <div className="py-20 text-center space-y-4">
                                    <div className="inline-block p-4 bg-emerald-100 dark:bg-emerald-950/60 rounded-full text-emerald-600 animate-spin">
                                        <SparklesIcon className="w-10 h-10" />
                                    </div>
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                        Generating Intelligent Financial Report...
                                    </h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                                        Analyzing overdue ageing curves, evaluating weighted average collection days, and compiling reduction strategies...
                                    </p>
                                </div>
                            ) : reportResult?.error ? (
                                <div className="p-6 bg-red-50 dark:bg-red-950/40 rounded-xl border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 space-y-3">
                                    <div className="flex items-center gap-2 font-bold text-base">
                                        <ExclamationTriangleIcon className="w-5 h-5" />
                                        <span>Error Generating AI Report</span>
                                    </div>
                                    <p className="text-sm">{reportResult.error}</p>
                                    <button
                                        onClick={handleGenerateReport}
                                        className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg text-xs hover:bg-red-700 transition-colors"
                                    >
                                        Try Again
                                    </button>
                                </div>
                            ) : reportResult?.reportMarkdown ? (
                                <div>
                                    {/* Action Bar */}
                                    <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 mb-4 print:hidden">
                                        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                            <span className="font-semibold">Generated on:</span>
                                            <span>{new Date(reportResult.generatedAt || Date.now()).toLocaleString('en-IN')}</span>
                                            <span className="mx-1">•</span>
                                            <span className="font-semibold">Model:</span>
                                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 font-mono text-[11px] font-bold">
                                                {reportResult.modelUsed || 'Gemini 3.7'}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={handleCopy}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-semibold hover:bg-gray-50 transition-colors"
                                            >
                                                {copied ? (
                                                    <>
                                                        <CheckCircleIcon className="w-4 h-4 text-green-600" />
                                                        <span className="text-green-600 font-bold">Copied!</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span>📋 Copy Report</span>
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                onClick={handlePrint}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-semibold hover:bg-gray-50 transition-colors"
                                            >
                                                <DownloadIcon />
                                                <span>Print / PDF</span>
                                            </button>
                                            <button
                                                onClick={handleGenerateReport}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors shadow-xs"
                                            >
                                                <SparklesIcon className="w-3.5 h-3.5" />
                                                <span>Regenerate</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Rendered Markdown Document */}
                                    <div className="p-6 sm:p-8 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm print:border-none print:p-0">
                                        <div className="prose prose-sm sm:prose max-w-none dark:prose-invert prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-table:text-xs">
                                            <Markdown>{reportResult.reportMarkdown}</Markdown>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 sm:px-6 bg-gray-50 dark:bg-gray-800/80 border-t border-gray-200 dark:border-gray-800 flex justify-between items-center text-xs">
                    <span className="text-gray-500 dark:text-gray-400">
                        Timely Payment AI Intelligence • Shori Chemicals System
                    </span>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 text-gray-800 dark:text-gray-200 rounded-lg font-bold transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AiReportModal;
