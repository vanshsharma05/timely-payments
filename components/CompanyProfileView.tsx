import React, { useState } from 'react';
import { CompanyProfile } from '../types';
import { AppLogo } from './icons/AppLogo';
import { Button, cx } from './ui/Primitives';
import { FIELD, LABEL } from './ui/fields';

interface CompanyProfileViewProps {
    profile: CompanyProfile;
    onSave: (updatedProfile: CompanyProfile) => void;
}

type Key = keyof CompanyProfile;

/** One field of the profile: label, input, and how it is written. */
const FIELDS: { key: Key; label: string; placeholder: string; wide?: boolean; mono?: boolean; upper?: boolean; type?: string }[] = [
    { key: 'name', label: 'Company name', placeholder: 'e.g. Shori Chemicals Pvt. Ltd.', wide: true },
    { key: 'tagline', label: 'Tagline', placeholder: 'e.g. Chemical distribution & specialty solutions', wide: true },
    { key: 'gstin', label: 'GSTIN', placeholder: 'e.g. 07AAAAA0000A1Z5', mono: true, upper: true },
    { key: 'pan', label: 'PAN', placeholder: 'e.g. ABCDE1234F', mono: true, upper: true },
    { key: 'phone', label: 'Phone', placeholder: 'e.g. +91 98765 43210' },
    { key: 'email', label: 'Email', placeholder: 'e.g. accounts@company.com', type: 'email' },
];

/**
 * The company's own details: its name and tagline on the dashboards, its
 * address, tax numbers and bank details on exported statements.
 *
 * Rendered inside the Team card, so it is the form and its footer only, in
 * the same fields and buttons every dialog uses.
 */
export const CompanyProfileView: React.FC<CompanyProfileViewProps> = ({ profile, onSave }) => {
    const [formData, setFormData] = useState<CompanyProfile>({ ...profile });
    const [savedNotice, setSavedNotice] = useState(false);

    const set = (key: Key, value: string) => setFormData(d => ({ ...d, [key]: value }));

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 4000);
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="px-5 py-5 max-md:px-4 space-y-5">
                <div className="flex items-center gap-4 p-4 rounded-[12px] bg-card-2">
                    <div className="p-2.5 bg-card rounded-xl shadow-e1 flex-none">
                        <AppLogo className="w-9 h-9" variant="full-color" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[15px] font-bold text-label truncate">{formData.name || 'Your company name'}</p>
                        <p className="text-[12.5px] text-label-3 truncate">{formData.tagline || 'Shown on dashboards and exported statements.'}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {FIELDS.map(f => (
                        <div key={f.key} className={f.wide ? 'md:col-span-2' : undefined}>
                            <label htmlFor={`company-${f.key}`} className={LABEL}>
                                {f.label}
                                {f.key === 'name' && <span className="text-dang ml-0.5" aria-hidden="true">*</span>}
                            </label>
                            <input
                                id={`company-${f.key}`}
                                type={f.type || 'text'}
                                required={f.key === 'name'}
                                value={formData[f.key] || ''}
                                onChange={e => set(f.key, f.upper ? e.target.value.toUpperCase() : e.target.value)}
                                placeholder={f.placeholder}
                                className={cx(FIELD, f.mono && 'font-mono')}
                            />
                        </div>
                    ))}

                    <div className="md:col-span-2">
                        <label htmlFor="company-address" className={LABEL}>Office address</label>
                        <textarea
                            id="company-address"
                            rows={2}
                            value={formData.address || ''}
                            onChange={e => set('address', e.target.value)}
                            placeholder="Street, office, industrial area"
                            className={cx(FIELD, 'h-auto py-2')}
                        />
                    </div>

                    <div>
                        <label htmlFor="company-city" className={LABEL}>City</label>
                        <input id="company-city" type="text" value={formData.city || ''} onChange={e => set('city', e.target.value)} placeholder="e.g. New Delhi" className={FIELD} />
                    </div>

                    <div>
                        <span className={LABEL} id="company-state-label">State &amp; PIN</span>
                        <div className="grid grid-cols-2 gap-2">
                            <input type="text" aria-label="State" value={formData.state || ''} onChange={e => set('state', e.target.value)} placeholder="State" className={FIELD} />
                            <input type="text" aria-label="PIN code" value={formData.pincode || ''} onChange={e => set('pincode', e.target.value)} placeholder="PIN code" className={cx(FIELD, 'font-mono')} />
                        </div>
                    </div>

                    <div className="md:col-span-2">
                        <label htmlFor="company-bank" className={LABEL}>Bank account &amp; payment instructions</label>
                        <textarea
                            id="company-bank"
                            rows={3}
                            value={formData.bankDetails || ''}
                            onChange={e => set('bankDetails', e.target.value)}
                            placeholder="Bank, account holder, account number, IFSC, branch"
                            className={cx(FIELD, 'h-auto py-2 font-mono text-[12.5px]')}
                        />
                        <p className="text-[12px] text-label-3 mt-1">Printed on statements so a customer knows where to pay.</p>
                    </div>
                </div>
            </div>

            <div className="px-5 py-3.5 max-md:px-4 border-t border-separator bg-card-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-[12.5px] text-label-2 min-w-0" role="status" aria-live="polite">
                    {savedNotice ? <span className="text-pos font-semibold">Saved. The dashboards pick it up straight away.</span> : 'Changes apply for everyone once saved.'}
                </p>
                <div className="flex items-center justify-end gap-2 max-md:[&>button]:flex-1 max-md:[&>button]:min-h-[44px]">
                    <Button type="submit" variant="primary">Save company profile</Button>
                </div>
            </div>
        </form>
    );
};

export default CompanyProfileView;
