


interface CrmStat {
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
}

interface CrmPerformanceTableProps {
    stats: CrmStat[];
}

const CrmPerformanceTable = ({ stats }: CrmPerformanceTableProps) => {
    return (
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xs border border-gray-200 dark:border-gray-800 overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">Team Performance &amp; Portfolio Allocation</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Accounts carrying a balance, daily task completion and timely score per person.
                        An account handed to a collector counts for both them and its CRM owner.
                    </p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-slate-300">
                    {stats.length} people
                </span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800/90 text-[12.5px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                        <tr>
                            <th className="px-3.5 py-2.5 text-left">CRM / Collector</th>
                            <th className="px-3 py-2.5 text-center">Accounts With Dues</th>
                            <th className="px-3 py-2.5 text-center">Follow-up Done</th>
                            <th className="px-3 py-2.5 text-center">Today's Tasks</th>
                            <th className="px-3 py-2.5 text-center">Overdue</th>
                            <th className="px-3 py-2.5 text-center">Unattended</th>
                            <th className="px-3.5 py-2.5 text-center">Timely Score</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900">
                        {stats.map((stat) => (
                            <tr key={stat.crmId} className={`${stat.crmId === 'Unassigned' ? 'bg-red-50/50 dark:bg-red-950/20' : 'hover:bg-gray-50/70 dark:hover:bg-gray-800/50'} transition-colors`}>
                                <td className="px-3.5 py-2.5 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${stat.crmId === 'Unassigned' ? 'bg-red-500' : 'bg-emerald-500'}`}></div>
                                        <span className={`font-bold text-xs sm:text-sm ${stat.crmId === 'Unassigned' ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                                            {stat.crmName}
                                        </span>
                                        {stat.crmId === 'Unassigned' && (
                                            <span className="px-1.5 py-0.5 rounded text-[11.5px] font-bold bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300">
                                                Assign CRM
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs sm:text-sm text-gray-900 dark:text-white font-bold">
                                    {stat.totalAssigned}
                                    {/* The rest of their book: real customers from the Customer
                                        Master who owe nothing today. Shown so the number above
                                        reconciles with the account list. */}
                                    {!!stat.noDues && (
                                        <span className="block font-normal text-[11.5px] text-gray-500 dark:text-gray-400">
                                            +{stat.noDues} no dues
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs sm:text-sm text-emerald-600 dark:text-emerald-400 font-semibold">
                                    {stat.followUpDone}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs sm:text-sm text-blue-600 dark:text-blue-400 font-semibold">
                                    {stat.todayFollowUp}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs sm:text-sm text-amber-600 dark:text-amber-400 font-semibold">
                                    {stat.overdue}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs sm:text-sm text-red-600 dark:text-red-400 font-bold">
                                    {stat.unattended}
                                </td>
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
                                    No CRM performance data available.
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
