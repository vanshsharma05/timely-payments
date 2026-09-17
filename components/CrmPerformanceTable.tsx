


import type { FollowUpCategoryFilter } from './ReportsView';

export interface CrmStat {
    crmId: string;
    crmName: string;
    totalAssigned: number;
    followUpDone: number;
    todayFollowUp: number;
    overdue: number;
    unattended: number; // Pending or Overdue > 7 days
    score: number; // Percentage of timely follow-ups
    /** On this CRM's books but owing nothing — counted separately, never chased. */
    noDues?: number;
    /** Declared defaulters on this CRM's books — on the recovery list, outside the score. */
    badDebt?: number;
    /**
     * Whether Reports can show this person's accounts. A CRM owns accounts, so
     * Reports can filter to them; a collector's row counts accounts handed to
     * them, which Reports has no filter for — that row stays a number.
     */
    drillable?: boolean;
}

interface CrmPerformanceTableProps {
    stats: CrmStat[];
    /** A name or a count pressed: open Reports on that person, and on that list. */
    onSelectCrm?: (crmId: string, category?: FollowUpCategoryFilter) => void;
}

/** The count columns, in table order, and the Reports list each one opens. */
const COUNTS: { key: 'followUpDone' | 'todayFollowUp' | 'overdue' | 'unattended'; label: string; short: string; tone: string; category: FollowUpCategoryFilter; title: string }[] = [
    { key: 'followUpDone', label: 'Completed', short: 'Done', tone: 'text-emerald-600 dark:text-emerald-400', category: 'completed', title: 'Accounts marked collected' },
    { key: 'todayFollowUp', label: 'Due today', short: 'Today', tone: 'text-blue-600 dark:text-blue-400', category: 'today', title: 'Follow-ups promised for today' },
    { key: 'overdue', label: 'Overdue', short: 'Overdue', tone: 'text-amber-600 dark:text-amber-400', category: 'overdue', title: 'Follow-ups whose promised date has passed' },
    { key: 'unattended', label: 'Unattended', short: 'Unattended', tone: 'text-red-600 dark:text-red-400', category: 'unattended', title: 'Overdue, or no follow-up planned at all' },
];

const CrmPerformanceTable = ({ stats, onSelectCrm }: CrmPerformanceTableProps) => {
    const drill = (stat: CrmStat, category?: FollowUpCategoryFilter) =>
        onSelectCrm && stat.drillable !== false ? () => onSelectCrm(stat.crmId, category) : undefined;
    /** A count that opens a list is a button; one that cannot is plain text. */
    const Count = ({ stat, col }: { stat: CrmStat; col: typeof COUNTS[number] }) => {
        const open = drill(stat, col.category);
        const value = stat[col.key];
        if (!open) return <span className={`num ${col.tone}`}>{value}</span>;
        return (
            <button
                type="button"
                onClick={open}
                title={`${col.title} — open in Reports`}
                className={`num ${col.tone} min-h-[30px] min-w-[30px] px-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 hover:underline underline-offset-2 transition-colors`}
            >
                {value}
            </button>
        );
    };
    // The person with the most waiting is the one a manager asks about first,
    // so they are at the top; roster order put them wherever the alphabet did.
    const ordered = [...stats].sort((a, b) => b.unattended - a.unattended || b.overdue - a.overdue || b.totalAssigned - a.totalAssigned || a.crmName.localeCompare(b.crmName));
    return (
        <div className="bg-card rounded-[16px] shadow-e1 overflow-hidden">
            <div className="px-5 py-4 border-b border-separator flex items-center justify-between max-md:flex-wrap max-md:gap-2">
                <div>
                    <h3 className="text-[17px] font-extrabold text-label tracking-[-0.02em]">Team</h3>
                    <p className="text-[13px] text-label-3 mt-0.5">
                        Accounts with dues, what is done and what is waiting, per person — most unattended first.
                        {onSelectCrm ? ' Press a name or a count to see those accounts in Reports.' : ''}
                        {' '}An account handed to a collector counts for both them and its CRM owner.
                    </p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-slate-300 whitespace-nowrap flex-none">
                    {stats.length} people
                </span>
            </div>
            {/* On a phone the seven columns do not fit and scrolling a table
                sideways hides the very numbers the row is for, so each person
                becomes a card: the name, the book, the four counts, the score. */}
            <div className="md:hidden divide-y divide-gray-200 dark:divide-gray-800">
                {ordered.map((stat) => {
                    const unassigned = stat.crmId === 'Unassigned';
                    return (
                        <div key={stat.crmId} className={`px-4 py-3.5 ${unassigned ? 'bg-red-50/50 dark:bg-red-950/20' : ''}`}>
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className={`w-2 h-2 rounded-full flex-none ${unassigned ? 'bg-red-500' : 'bg-emerald-500'}`} />
                                    {drill(stat) ? (
                                        <button type="button" onClick={drill(stat)} className={`font-bold text-[15px] truncate text-left hover:underline underline-offset-2 ${unassigned ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                                            {stat.crmName}
                                        </button>
                                    ) : (
                                        <span className={`font-bold text-[15px] truncate ${unassigned ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                                            {stat.crmName}
                                        </span>
                                    )}
                                    {unassigned && (
                                        <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300 flex-none">
                                            Assign CRM
                                        </span>
                                    )}
                                </div>
                                <div className="text-right flex-none">
                                    <span className="num text-[15px] font-bold text-gray-900 dark:text-white">{stat.totalAssigned}</span>
                                    <span className="block text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
                                        with dues{stat.noDues ? ` · +${stat.noDues} no dues` : ''}{stat.badDebt ? ` · +${stat.badDebt} bad debt` : ''}
                                    </span>
                                </div>
                            </div>
                            <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                                {COUNTS.map(col => {
                                    const open = drill(stat, col.category);
                                    const Tile: any = open ? 'button' : 'div';
                                    return (
                                        <Tile key={col.key} type={open ? 'button' : undefined} onClick={open} className={`rounded-[10px] bg-gray-50 dark:bg-gray-800/70 px-1 py-2 ${open ? 'hover:bg-gray-100 dark:hover:bg-gray-800' : ''}`}>
                                            <span className={`block num text-[15px] font-bold ${col.tone}`}>{stat[col.key]}</span>
                                            <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-0.5">{col.short}</span>
                                        </Tile>
                                    );
                                })}
                            </div>
                            <div className="flex items-center gap-2.5 mt-3">
                                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex-none">Timely</span>
                                <div className="flex-1 bg-gray-200 rounded-full h-2 dark:bg-gray-700 overflow-hidden">
                                    <div
                                        className={`h-2 rounded-full ${stat.score >= 80 ? 'bg-emerald-500' : stat.score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                                        style={{ width: `${stat.score}%` }}
                                    />
                                </div>
                                <span className="num text-xs font-bold text-gray-700 dark:text-gray-300 min-w-[36px] text-right">{stat.score}%</span>
                            </div>
                        </div>
                    );
                })}
                {stats.length === 0 && (
                    <p className="px-4 py-8 text-center text-xs text-gray-500 dark:text-gray-400">No one on the team yet.</p>
                )}
            </div>
            <div className="overflow-x-auto max-md:hidden">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800/90 text-[12.5px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                        <tr>
                            <th className="px-3.5 py-2.5 text-left">CRM / Collector</th>
                            <th className="px-3 py-2.5 text-center">Accounts with dues</th>
                            {COUNTS.map(col => <th key={col.key} className="px-3 py-2.5 text-center" title={col.title}>{col.label}</th>)}
                            <th className="px-3.5 py-2.5 text-center" title="Share of accounts with dues that are completed, due today or upcoming — nothing overdue, nothing unplanned">Timely score</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900">
                        {ordered.map((stat) => (
                            <tr key={stat.crmId} className={`${stat.crmId === 'Unassigned' ? 'bg-red-50/50 dark:bg-red-950/20' : 'hover:bg-gray-50/70 dark:hover:bg-gray-800/50'} transition-colors`}>
                                <td className="px-3.5 py-2.5 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${stat.crmId === 'Unassigned' ? 'bg-red-500' : 'bg-emerald-500'}`}></div>
                                        {drill(stat) ? (
                                            <button type="button" onClick={drill(stat)} title="Open this person's accounts in Reports" className={`font-bold text-xs sm:text-sm text-left hover:underline underline-offset-2 min-h-[30px] ${stat.crmId === 'Unassigned' ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white hover:text-accent'}`}>
                                                {stat.crmName}
                                            </button>
                                        ) : (
                                            <span className={`font-bold text-xs sm:text-sm ${stat.crmId === 'Unassigned' ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                                                {stat.crmName}
                                            </span>
                                        )}
                                        {stat.crmId === 'Unassigned' && (
                                            <span className="px-1.5 py-0.5 rounded text-[11.5px] font-bold bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300">
                                                Assign CRM
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs sm:text-sm text-gray-900 dark:text-white font-bold">
                                    {drill(stat) ? (
                                        <button type="button" onClick={drill(stat, 'all')} title="All of this person's accounts with dues — open in Reports" className="num min-h-[30px] min-w-[30px] px-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 hover:underline underline-offset-2">
                                            {stat.totalAssigned}
                                        </button>
                                    ) : stat.totalAssigned}
                                    {/* The rest of their book: real customers from the Customer
                                        Master who owe nothing today. Shown so the number above
                                        reconciles with the account list. */}
                                    {!!stat.noDues && (
                                        <span className="block font-normal text-[11.5px] text-gray-500 dark:text-gray-400">
                                            +{stat.noDues} no dues
                                        </span>
                                    )}
                                    {/* Defaulters: on the recovery list, outside this score. */}
                                    {!!stat.badDebt && (
                                        <span className="block font-normal text-[11.5px] text-dang">
                                            +{stat.badDebt} bad debt
                                        </span>
                                    )}
                                </td>
                                {COUNTS.map(col => (
                                    <td key={col.key} className={`px-3 py-2.5 whitespace-nowrap text-center text-xs sm:text-sm ${col.key === 'unattended' ? 'font-bold' : 'font-semibold'}`}>
                                        <Count stat={stat} col={col} />
                                    </td>
                                ))}
                                <td className="px-3.5 py-2.5 whitespace-nowrap text-center">
                                    <div className="flex items-center justify-center gap-2">
                                        <div className="w-16 sm:w-20 bg-gray-200 rounded-full h-2 dark:bg-gray-700 overflow-hidden">
                                            <div 
                                                className={`h-2 rounded-full ${stat.score >= 80 ? 'bg-emerald-500' : stat.score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} 
                                                style={{ width: `${stat.score}%` }}
                                            ></div>
                                        </div>
                                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300 min-w-[32px] text-right">{stat.score}%</span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {stats.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-4 py-8 text-center text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                                    No one on the team yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default CrmPerformanceTable;
