import React, { useState } from 'react';
import { CompanyProfile } from '../types';
import { AppLogo } from './icons/AppLogo';

interface CompanyProfileModalProps {
    isOpen: boolean;
    onClose: () => void;
    profile: CompanyProfile;
    onSave: (updatedProfile: CompanyProfile) => void;
}

export const CompanyProfileModal: React.FC<CompanyProfileModalProps> = ({
    isOpen,
    onClose,
    profile,
    onSave,
}) => {
    const [formData, setFormData] = useState<CompanyProfile>({ ...profile });
    const [saveNotice, setSaveNotice] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
        setSaveNotice(true);
        setTimeout(() => {
            setSaveNotice(false);
            onClose();
        }, 600);
    };

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-gray-200 dark:border-gray-800 animate-in fade-in zoom-in-95 duration-150">
                {/* Header */}
                <div className="bg-accent p-5 text-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/10 rounded-xl border border-white/20">
                            <AppLogo className="w-6 h-6" variant="white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">Edit Company Profile</h3>
                            <p className="text-xs text-slate-300">Update complete organization details displayed across dashboards and reports</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 grid place-items-center text-slate-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
                     aria-label="Close">
                        ✕
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="sm:col-span-2">
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                Company / Business Name <span className="text-red-600 dark:text-red-400" aria-hidden="true">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={formData.name || ''}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                placeholder="e.g. Shori Chemicals Pvt. Ltd."
                                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-semibold focus:ring-2 focus:ring-green-500 focus:outline-none"
                            />
                        </div>

                        <div className="sm:col-span-2">
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                Business Tagline / Subtitle
                            </label>
                            <input
                                type="text"
                                value={formData.tagline || ''}
                                onChange={e => setFormData({ ...formData, tagline: e.target.value })}
                                placeholder="e.g. Industrial Chemicals & Distribution"
                                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                GSTIN / Tax ID
                            </label>
                            <input
                                type="text"
                                value={formData.gstin || ''}
                                onChange={e => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
                                placeholder="e.g. 07AAAAA0000A1Z5"
                                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono focus:ring-2 focus:ring-green-500 focus:outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                PAN Number
                            </label>
                            <input
                                type="text"
                                value={formData.pan || ''}
                                onChange={e => setFormData({ ...formData, pan: e.target.value.toUpperCase() })}
                                placeholder="e.g. ABCDE1234F"
                                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono focus:ring-2 focus:ring-green-500 focus:outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                Contact Phone / Mobile
                            </label>
                            <input
                                type="text"
                                value={formData.phone || ''}
                                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                placeholder="e.g. +91 9876543210"
                                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                Official Email Address
                            </label>
                            <input
                                type="email"
                                value={formData.email || ''}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                placeholder="e.g. ankur@shorichemicals.com"
                                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                            />
                        </div>

                        <div className="sm:col-span-2">
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                Full Office Address
                            </label>
                            <textarea
                                rows={2}
                                value={formData.address || ''}
                                onChange={e => setFormData({ ...formData, address: e.target.value })}
                                placeholder="Street, Building No, Industrial Area"
                                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                City
                            </label>
                            <input
                                type="text"
                                value={formData.city || ''}
                                onChange={e => setFormData({ ...formData, city: e.target.value })}
                                placeholder="e.g. New Delhi"
                                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                State & PIN Code
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <input
                                    type="text"
                                    value={formData.state || ''}
                                    onChange={e => setFormData({ ...formData, state: e.target.value })}
                                    placeholder="State (e.g. Delhi)"
                                    className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                                />
                                <input
                                    type="text"
                                    value={formData.pincode || ''}
                                    onChange={e => setFormData({ ...formData, pincode: e.target.value })}
                                    placeholder="PIN Code"
                                    className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                                />
                            </div>
                        </div>

                        <div className="sm:col-span-2">
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                Banking Details / Payment Instructions (Optional)
                            </label>
                            <textarea
                                rows={2}
                                value={formData.bankDetails || ''}
                                onChange={e => setFormData({ ...formData, bankDetails: e.target.value })}
                                placeholder="Bank Name, A/C No, IFSC Code, UPI ID for customer remittance"
                                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono text-xs focus:ring-2 focus:ring-green-500 focus:outline-none"
                            />
                        </div>
                    </div>

                    {saveNotice && (
                        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 text-emerald-800 dark:text-emerald-200 text-xs font-bold rounded-xl text-center">
                            ✓ Company profile saved successfully!
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                         aria-label="Close">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-bold shadow-md hover:shadow-lg transition-all"
                        >
                            Save Company Profile
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CompanyProfileModal;
