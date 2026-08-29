import React, { useState } from 'react';
import { CompanyProfile } from '../types';
import { AppLogo } from './icons/AppLogo';

interface CompanyProfileViewProps {
    profile: CompanyProfile;
    onSave: (updatedProfile: CompanyProfile) => void;
}

export const CompanyProfileView: React.FC<CompanyProfileViewProps> = ({ profile, onSave }) => {
    const [formData, setFormData] = useState<CompanyProfile>({ ...profile });
    const [savedNotice, setSavedNotice] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 4000);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-200 dark:border-gray-700">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Organization & Company Profile</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Configure company branding, address, tax identification, and contact info displayed on dashboards and exported statements.
                    </p>
                </div>
            </div>

            {savedNotice && (
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 rounded-xl text-emerald-800 dark:text-emerald-200 text-sm font-semibold flex items-center gap-2 shadow-xs">
                    <span className="text-base">✓</span> Company profile updated successfully!
                </div>
            )}

            <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-xs space-y-6">
                {/* Organization Identity Header */}
                <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700">
                    <div className="p-3 bg-white dark:bg-gray-800 rounded-xl shadow-xs border border-gray-200 dark:border-gray-700">
                        <AppLogo className="w-10 h-10" variant="full-color" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-gray-900 dark:text-white">{formData.name || 'Your Company Name'}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{formData.tagline || 'Collection & Accounts Receivable Management'}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                            Company / Organization Legal Name <span className="text-red-600 dark:text-red-400" aria-hidden="true">*</span>
                        </label>
                        <input
                            type="text"
                            required
                            value={formData.name || ''}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            placeholder="e.g. Shori Chemicals Pvt. Ltd."
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-semibold focus:ring-2 focus:ring-accent focus:outline-none"
                        />
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                            Business Tagline / Subtitle
                        </label>
                        <input
                            type="text"
                            value={formData.tagline || ''}
                            onChange={e => setFormData({ ...formData, tagline: e.target.value })}
                            placeholder="e.g. Chemical Distribution & Specialty Solutions"
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-accent focus:outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                            GSTIN / Tax Identification
                        </label>
                        <input
                            type="text"
                            value={formData.gstin || ''}
                            onChange={e => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
                            placeholder="e.g. 07AAAAA0000A1Z5"
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono focus:ring-2 focus:ring-accent focus:outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                            PAN Number
                        </label>
                        <input
                            type="text"
                            value={formData.pan || ''}
                            onChange={e => setFormData({ ...formData, pan: e.target.value.toUpperCase() })}
                            placeholder="e.g. ABCDE1234F"
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono focus:ring-2 focus:ring-accent focus:outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                            Official Contact Phone
                        </label>
                        <input
                            type="text"
                            value={formData.phone || ''}
                            onChange={e => setFormData({ ...formData, phone: e.target.value })}
                            placeholder="e.g. +91 9876543210"
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-accent focus:outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                            Official Email Address
                        </label>
                        <input
                            type="email"
                            value={formData.email || ''}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            placeholder="e.g. ankur@shorichemicals.com"
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-accent focus:outline-none"
                        />
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                            Office Address
                        </label>
                        <textarea
                            rows={2}
                            value={formData.address || ''}
                            onChange={e => setFormData({ ...formData, address: e.target.value })}
                            placeholder="Street address, office suite, industrial area"
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-accent focus:outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                            City
                        </label>
                        <input
                            type="text"
                            value={formData.city || ''}
                            onChange={e => setFormData({ ...formData, city: e.target.value })}
                            placeholder="e.g. New Delhi"
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-accent focus:outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                            State & PIN Code
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <input
                                type="text"
                                value={formData.state || ''}
                                onChange={e => setFormData({ ...formData, state: e.target.value })}
                                placeholder="State"
                                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-accent focus:outline-none"
                            />
                            <input
                                type="text"
                                value={formData.pincode || ''}
                                onChange={e => setFormData({ ...formData, pincode: e.target.value })}
                                placeholder="PIN Code"
                                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-accent focus:outline-none"
                            />
                        </div>
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                            Bank Accounts & Payment Instructions
                        </label>
                        <textarea
                            rows={3}
                            value={formData.bankDetails || ''}
                            onChange={e => setFormData({ ...formData, bankDetails: e.target.value })}
                            placeholder="Bank Name, Account Holder, A/C Number, IFSC Code, Branch"
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono text-xs focus:ring-2 focus:ring-accent focus:outline-none"
                        />
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
                    <button
                        type="submit"
                        className="px-6 py-2.5 rounded-xl bg-accent hover:bg-accent-press text-on-accent text-sm font-bold shadow-md hover:shadow-lg transition-all"
                    >
                        Save Company Profile
                    </button>
                </div>
            </form>
        </div>
    );
};

export default CompanyProfileView;
