
import UserSwitcher from './UserSwitcher';
import { User } from '../types';
import { SyncIcon } from './icons/Icons';
import { AppLogo } from './icons/AppLogo';

interface HeaderProps {
    currentUser: User;
    onUserChange: (userId: string) => void;
    users: User[];
    onLogout: () => void;
    sheetUpdatedTillDate?: string;
    lastSyncTime?: string;
    onSync?: () => void;
    onResetAll?: () => void;
    isSyncing?: boolean;
    dataSourceMode?: 'excel' | 'google';
    companyName?: string;
}

export const formatSyncDateTime = (dateStr?: string): string => {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }) + ', ' + d.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch {
        return dateStr;
    }
};

const Header = ({ 
    currentUser, 
    onUserChange, 
    users, 
    onLogout,
    sheetUpdatedTillDate,
    lastSyncTime,
    onSync,
    onResetAll,
    isSyncing,
    dataSourceMode = 'google',
    companyName
}: HeaderProps) => {
    const formattedSyncTime = formatSyncDateTime(lastSyncTime);

    return (
        <header className="bg-white dark:bg-gray-900 shadow-xs border-b border-gray-200 dark:border-gray-800 sticky top-0 z-30">
            <div className="w-full max-w-[1750px] mx-auto px-2 sm:px-4 lg:px-6">
                <div className="flex justify-between items-center min-h-16 py-2 gap-2">
                    <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
                        <div className="p-1.5 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-xs flex-shrink-0">
                            <AppLogo className="w-6 h-6 sm:w-7 sm:h-7" variant="full-color" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                                <span className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">Timely Payment</span>
                                {companyName && (
                                    <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 truncate max-w-[200px]">
                                        {companyName}
                                    </span>
                                )}
                                <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded text-[11.5px] sm:text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                                    {dataSourceMode === 'google' ? 'Live Google Sheet' : 'Excel Mode'}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] sm:text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {formattedSyncTime && (
                                    <div className="flex items-center gap-1">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                        <span className="text-gray-400 dark:text-gray-500">Synced:</span>
                                        <span className="text-gray-800 dark:text-gray-200 font-semibold">{formattedSyncTime}</span>
                                    </div>
                                )}
                                {sheetUpdatedTillDate && (
                                    <div className="flex items-center gap-1 border-l border-gray-200 dark:border-gray-700 pl-2">
                                        <span className="text-gray-400 dark:text-gray-500">Sheet updated till:</span>
                                        <strong className="text-gray-800 dark:text-gray-200 font-semibold">{sheetUpdatedTillDate}</strong>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0">
                        {onResetAll && (
                            <button
                                onClick={onResetAll}
                                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors shadow-xs"
                                title="Fresh Start: Reset all data, users, and passwords"
                            >
                                <span>🔄</span>
                                <span className="hidden lg:inline">Fresh Start / Reset</span>
                            </button>
                        )}

                        {onSync && (
                            <button
                                onClick={onSync}
                                disabled={isSyncing}
                                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors disabled:opacity-50 shadow-xs"
                                title={formattedSyncTime ? `Click to re-sync. Last synced at ${formattedSyncTime}` :"Sync with Google Sheet"}
                            >
                                <span className={isSyncing ? 'animate-spin' : ''}>
                                    <SyncIcon />
                                </span>
                                <span className="hidden md:inline">{isSyncing ? 'Syncing...' : 'Sync Sheet'}</span>
                            </button>
                        )}

                        <UserSwitcher currentUser={currentUser} onUserChange={onUserChange} users={users} />
                        <div className="h-6 w-px bg-gray-300 dark:bg-gray-700"></div>
                        <button 
                            onClick={onLogout}
                            className="flex items-center text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors font-medium text-sm p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                            title="Logout"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
                            </svg>
                            <span className="hidden sm:inline ml-1">Logout</span>
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
};

export default Header;