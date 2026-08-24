import React from 'react';
import { CompanyProfile } from '../types';
import { AppLogo } from './icons/AppLogo';

interface CompanyBannerProps {
    profile: CompanyProfile;
    isAdmin?: boolean;
    onEdit?: () => void;
}

export const CompanyBanner: React.FC<CompanyBannerProps> = ({ 
    profile, 
    isAdmin = false, 
    onEdit 
}) => {
    return (
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white rounded-2xl shadow-lg p-4 sm:p-6 mb-6 border border-slate-700/50 relative overflow-hidden">
            {/* Background Decorative Gradient Accent */}
            <div className="absolute right-0 top-0 -mt-8 -mr-8 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>
            <div className="absolute left-1/3 bottom-0 -mb-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>

            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Left: Company Identity & Core Details */}
                <div className="flex items-start sm:items-center gap-3.5 sm:gap-4">
                    <div className="p-2.5 sm:p-3 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 shadow-inner flex-shrink-0">
                        <AppLogo className="w-9 h-9 sm:w-11 sm:h-11" variant="white" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                                {profile.name || "Shori Chemicals"}
                            </h2>
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                Primary Organization
                            </span>
                        </div>
                        {profile.tagline && (
                            <p className="text-xs sm:text-sm text-slate-300 font-medium mt-0.5">
                                {profile.tagline}
                            </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-300">
                            {profile.gstin && (
                                <span className="inline-flex items-center gap-1">
                                    <strong className="text-slate-400">GSTIN:</strong>
                                    <span className="font-mono font-semibold text-emerald-300">{profile.gstin}</span>
                                </span>
                            )}
                            {profile.phone && (
                                <span className="inline-flex items-center gap-1">
                                    <strong className="text-slate-400">📞 Phone:</strong>
                                    <span>{profile.phone}</span>
                                </span>
                            )}
                            {profile.email && (
                                <span className="inline-flex items-center gap-1">
                                    <strong className="text-slate-400">✉️ Email:</strong>
                                    <span className="text-slate-200">{profile.email}</span>
                                </span>
                            )}
                            {profile.city && (
                                <span className="inline-flex items-center gap-1">
                                    <strong className="text-slate-400">📍 Location:</strong>
                                    <span>{[profile.city, profile.state].filter(Boolean).join(', ')}</span>
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right: Quick Action for Admin or Overview Info */}
                <div className="flex items-center gap-2.5 self-start md:self-center flex-shrink-0">
                    {isAdmin && onEdit && (
                        <button
                            onClick={onEdit}
                            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/20 backdrop-blur-sm transition-all hover:shadow-md hover:scale-[1.02] active:scale-[0.98]"
                            title="Edit organization profile & business details"
                        >
                            <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            <span>Edit Company Details</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CompanyBanner;
