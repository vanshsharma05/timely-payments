import React, { useState, useEffect } from 'react';
import { Outstanding, User, UserRole, AdditionalContact, BalanceType, FollowUpStatus, PaymentRank } from '../types';

interface CustomerEditModalProps {
    customerToEdit: Outstanding | null; // null means Add New Customer
    onSave: (customer: Outstanding) => void;
    onClose: () => void;
    currentUser: User | null;
    users: User[];
}

export const CustomerEditModal: React.FC<CustomerEditModalProps> = ({
    customerToEdit,
    onSave,
    onClose,
    currentUser,
    users
}) => {
    const isNew = !customerToEdit;
    const permissions = currentUser?.permissions;
    const isAdmin = currentUser?.role === UserRole.Admin;
    const canEditFinancials = isAdmin || Boolean(permissions?.canEditFinancials);
    const canReassignCrm = isAdmin || Boolean(permissions?.canReassignCrm) || Boolean(permissions?.canViewAllCrms);

    const crmUsers = users.filter(u => u.role === UserRole.CRM);

    // Form state
    const [company, setCompany] = useState('');
    const [contactPerson, setContactPerson] = useState('');
    const [contactNumber, setContactNumber] = useState('');
    const [contactPost, setContactPost] = useState('');
    const [email, setEmail] = useState('');
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [address, setAddress] = useState('');
    const [gstin, setGstin] = useState('');
    const [creditLimit, setCreditLimit] = useState<number | undefined>(undefined);
    const [paymentTermsDays, setPaymentTermsDays] = useState<number | undefined>(undefined);
    const [paymentRank, setPaymentRank] = useState<PaymentRank | ''>('');
    const [crmOwnerId, setCrmOwnerId] = useState('');
    
    // Financials
    const [total, setTotal] = useState<number>(0);
    const [totalType, setTotalType] = useState<BalanceType>('Dr');
    const [a1_45, setA1_45] = useState<number>(0);
    const [a46_90, setA46_90] = useState<number>(0);
    const [a91_135, setA91_135] = useState<number>(0);
    const [aOver135, setAOver135] = useState<number>(0);

    // Follow-up
    const [followUpDate, setFollowUpDate] = useState('');
    const [initialNote, setInitialNote] = useState('');
    const [isUrgent, setIsUrgent] = useState(false);

    // Additional contacts
    const [additionalContacts, setAdditionalContacts] = useState<AdditionalContact[]>([]);
    const [newContactName, setNewContactName] = useState('');
    const [newContactMobile, setNewContactMobile] = useState('');
    const [newContactPost, setNewContactPost] = useState('');
    const [newContactEmail, setNewContactEmail] = useState('');

    useEffect(() => {
        if (customerToEdit) {
            setCompany(customerToEdit.company || '');
            setContactPerson(customerToEdit.contactPerson || '');
            setContactNumber(customerToEdit.contactNumber || '');
            setContactPost(customerToEdit.contactPost || '');
            setEmail(customerToEdit.email || '');
            setCity(customerToEdit.city || '');
            setState(customerToEdit.state || '');
            setAddress(customerToEdit.address || '');
            setGstin(customerToEdit.gstin || '');
            setCreditLimit(customerToEdit.creditLimit);
            setPaymentTermsDays(customerToEdit.paymentTermsDays);
            setPaymentRank(customerToEdit.paymentRank || '');
            setCrmOwnerId(customerToEdit.crmOwnerId || '');
            setTotal(customerToEdit.total || 0);
            setTotalType(customerToEdit.totalType || 'Dr');
            setA1_45(customerToEdit.ageing?.['1-45'] || 0);
            setA46_90(customerToEdit.ageing?.['46-90'] || 0);
            setA91_135(customerToEdit.ageing?.['91-135'] || 0);
            setAOver135(customerToEdit.ageing?.['>135'] || 0);
            setFollowUpDate(customerToEdit.followUpDate ? new Date(customerToEdit.followUpDate).toISOString().split('T')[0] : '');
            setIsUrgent(Boolean(customerToEdit.isUrgent));
            setAdditionalContacts(customerToEdit.additionalContacts || []);
            setInitialNote('');
        } else {
            setCompany('');
            setContactPerson('');
            setContactNumber('');
            setContactPost('');
            setEmail('');
            setCity('');
            setState('');
            setAddress('');
            setGstin('');
            setCreditLimit(undefined);
            setPaymentTermsDays(undefined);
            setPaymentRank('');
            // Default CRM to current user if CRM, or first CRM in list
            setCrmOwnerId(currentUser?.role === UserRole.CRM ? currentUser.name : (crmUsers[0]?.name || 'ANKUR'));
            setTotal(0);
            setTotalType('Dr');
            setA1_45(0);
            setA46_90(0);
            setA91_135(0);
            setAOver135(0);
            setFollowUpDate(new Date().toISOString().split('T')[0]);
            setIsUrgent(false);
            setAdditionalContacts([]);
            setInitialNote('');
        }
    }, [customerToEdit, currentUser]);

    // Handle recalculating total if ageing changes and total is sum
    const handleAgeingChange = (bracket: '1-45' | '46-90' | '91-135' | '>135', val: number) => {
        if (bracket === '1-45') setA1_45(val);
        if (bracket === '46-90') setA46_90(val);
        if (bracket === '91-135') setA91_135(val);
        if (bracket === '>135') setAOver135(val);
    };

    const handleAddContact = () => {
        if (!newContactName.trim() || !newContactMobile.trim()) {
            alert('Please provide contact name and phone number.');
            return;
        }
        const contact: AdditionalContact = {
            id: `c_${Date.now()}`,
            name: newContactName.trim(),
            mobile: newContactMobile.trim(),
            post: newContactPost.trim() || 'Staff',
            email: newContactEmail.trim() || undefined
        };
        setAdditionalContacts(prev => [...prev, contact]);
        setNewContactName('');
        setNewContactMobile('');
        setNewContactPost('');
        setNewContactEmail('');
    };

    const handleRemoveContact = (id: string) => {
        setAdditionalContacts(prev => prev.filter(c => c.id !== id));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!company.trim()) {
            alert('Company name is required.');
            return;
        }

        const calculatedOver90 = a91_135 + aOver135;
        const calculatedDueOver45 = a46_90 + calculatedOver90;
        const finalTotal = total > 0 ? total : (a1_45 + calculatedDueOver45);

        const existingNotes = customerToEdit?.notes || [];
        const updatedNotes = [...existingNotes];
        if (initialNote.trim()) {
            const author = currentUser?.name || 'User';
            const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            updatedNotes.unshift(`[${dateStr} - ${author}] ${initialNote.trim()}`);
        }

        const targetDate = followUpDate ? new Date(followUpDate) : undefined;
        let newStatus = customerToEdit?.status || FollowUpStatus.Pending;
        if (targetDate) {
            const today = new Date();
            today.setHours(0,0,0,0);
            const targetMidnight = new Date(targetDate);
            targetMidnight.setHours(0,0,0,0);

            if (targetMidnight.getTime() === today.getTime()) {
                newStatus = FollowUpStatus.Today;
            } else if (targetMidnight < today) {
                newStatus = FollowUpStatus.Overdue;
            } else {
                newStatus = FollowUpStatus.Upcoming;
            }
        }

        const savedRecord: Outstanding = {
            id: customerToEdit?.id || `cust_${Date.now()}_${encodeURIComponent(company.slice(0, 15).replace(/\s+/g, '_'))}`,
            company: company.trim(),
            contactPerson: contactPerson.trim() || 'Accounts Dept',
            contactNumber: contactNumber.trim(),
            contactPost: contactPost.trim() || undefined,
            email: email.trim() || undefined,
            city: city.trim() || undefined,
            state: state.trim() || undefined,
            address: address.trim() || undefined,
            gstin: gstin.trim() || undefined,
            creditLimit: creditLimit,
            paymentTermsDays: paymentTermsDays,
            paymentRank: (paymentRank === 'Good' || paymentRank === 'Bad') ? paymentRank : undefined,
            crmOwnerId: crmOwnerId.trim(),
            total: finalTotal,
            totalType: totalType,
            ageing: {
                '1-45': a1_45,
                '46-90': a46_90,
                '91-135': a91_135,
                '>135': aOver135,
            },
            ageingTypes: {
                '1-45': totalType,
                '46-90': totalType,
                '91-135': totalType,
                '>135': totalType,
            },
            over90: calculatedOver90,
            over90Type: totalType,
            dueOver45: calculatedDueOver45,
            dueOver45Type: totalType,
            additionalContacts: additionalContacts,
            followUpDate: targetDate,
            forecastAmount: customerToEdit?.forecastAmount,
            forecastDate: customerToEdit?.forecastDate,
            status: newStatus,
            notes: updatedNotes,
            isUrgent: isUrgent,
            isNewCustomer: isNew ? true : customerToEdit?.isNewCustomer,
            addedAt: isNew ? new Date().toISOString() : customerToEdit?.addedAt,
            creationDate: customerToEdit?.creationDate || new Date(),
            lastFollowUpOn: initialNote.trim() ? new Date() : customerToEdit?.lastFollowUpOn,
        };

        onSave(savedRecord);
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex justify-center items-center p-3 sm:p-4 overflow-y-auto">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col border border-gray-200 dark:border-gray-800 animate-in fade-in zoom-in-95 duration-150 my-auto">
                {/* Header */}
                <div className="p-5 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50 rounded-t-2xl">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <span>{isNew ? 'Add New Customer' : 'Edit Customer Master'}</span>
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {isNew ? 'Create a new customer account, assign CRM owner, and set outstanding ledger details.' : `Updating company details and contact directory for ${customerToEdit?.company}`}
                        </p>
                    </div>
                    <button 
                        type="button" 
                        onClick={onClose} 
                        className="w-10 h-10 grid place-items-center flex-none text-label-3 hover:text-label text-2xl font-bold rounded-full hover:bg-hover"
                     aria-label="Close">
                        &times;
                    </button>
                </div>

                {/* Body Form */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
                    {/* Company & CRM Owner */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="sm:col-span-2">
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                Company / Client Name <span className="text-red-600 dark:text-red-400" aria-hidden="true">*</span>
                            </label>
                            <input
                                type="text"
                                value={company}
                                onChange={e => setCompany(e.target.value)}
                                placeholder="e.g. SHREE RAM INDUSTRIES PVT LTD"
                                className="w-full border rounded-xl shadow-2xs bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2.5 text-sm font-bold focus:ring-2 focus:ring-accent text-gray-900 dark:text-white uppercase"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                CRM Owner <span className="text-red-600 dark:text-red-400" aria-hidden="true">*</span>
                            </label>
                            {canReassignCrm ? (
                                <select aria-label="CRM Owner"
                                    value={crmOwnerId}
                                    onChange={e => setCrmOwnerId(e.target.value)}
                                    className="w-full border rounded-xl shadow-2xs bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2.5 text-sm font-bold text-gray-900 dark:text-white focus:ring-2 focus:ring-accent"
                                >
                                    <option value="">Select CRM</option>
                                    {crmUsers.map(u => (
                                        <option key={u.id} value={u.name}>{u.name}</option>
                                    ))}
                                    {crmOwnerId && !crmUsers.some(u => u.name === crmOwnerId || u.id === crmOwnerId) && (
                                        <option value={crmOwnerId}>{crmOwnerId}</option>
                                    )}
                                </select>
                            ) : (
                                <input aria-label="CRM Owner"
                                    type="text"
                                    value={crmOwnerId}
                                    disabled
                                    className="w-full border rounded-xl bg-gray-100 dark:bg-gray-800/60 border-gray-300 dark:border-gray-700 p-2.5 text-sm font-bold text-gray-600 dark:text-gray-400 cursor-not-allowed"
                                />
                            )}
                        </div>
                    </div>

                    {/* Primary Contact Details */}
                    <div className="p-4 bg-slate-50 dark:bg-gray-800/40 rounded-xl border border-slate-200 dark:border-gray-700/80 space-y-3">
                        <div className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider flex items-center justify-between">
                            <span>Primary Contact Person</span>
                            <span className="text-[11.5px] text-gray-500 font-normal">Main point of contact for follow-up</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                                <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">Contact Name</label>
                                <input
                                    type="text"
                                    value={contactPerson}
                                    onChange={e => setContactPerson(e.target.value)}
                                    placeholder="e.g. Mr. Rajesh Sharma"
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-medium text-gray-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">Designation / Role</label>
                                <input
                                    type="text"
                                    value={contactPost}
                                    onChange={e => setContactPost(e.target.value)}
                                    placeholder="e.g. Finance Head / MD"
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-medium text-gray-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">Mobile / Phone Number</label>
                                <input
                                    type="text"
                                    value={contactNumber}
                                    onChange={e => setContactNumber(e.target.value)}
                                    placeholder="e.g. 9876543210"
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-medium text-gray-900 dark:text-white"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">Email Address</label>
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="e.g. accounts@shreeram.com"
                                className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-medium text-gray-900 dark:text-white"
                            />
                        </div>
                    </div>

                    {/* Customer Master Info: GSTIN, Location, Credit Limit */}
                    <div className="p-4 bg-slate-50 dark:bg-gray-800/40 rounded-xl border border-slate-200 dark:border-gray-700/80 space-y-3">
                        <div className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider flex items-center justify-between">
                            <span>Master Information (GSTIN, Address & Credit Terms)</span>
                            <span className="text-[11.5px] text-gray-500 font-normal">Master ledger profile</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                                <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">GSTIN Number</label>
                                <input
                                    type="text"
                                    value={gstin}
                                    onChange={e => setGstin(e.target.value.toUpperCase())}
                                    placeholder="e.g. 24AAACS1234K1Z5"
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-mono uppercase text-gray-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">City / Region</label>
                                <input
                                    type="text"
                                    value={city}
                                    onChange={e => setCity(e.target.value)}
                                    placeholder="e.g. Ahmedabad / Surat"
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs text-gray-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">State</label>
                                <input
                                    type="text"
                                    value={state}
                                    onChange={e => setState(e.target.value)}
                                    placeholder="e.g. Gujarat"
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs text-gray-900 dark:text-white"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            <div>
                                <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">Sanctioned Credit Limit (₹)</label>
                                <input
                                    type="number"
                                    value={creditLimit !== undefined ? creditLimit : ''}
                                    onChange={e => setCreditLimit(e.target.value ? parseFloat(e.target.value) : undefined)}
                                    placeholder="e.g. 5000000"
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-semibold text-gray-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">Credit Terms (Days)</label>
                                <input
                                    type="number"
                                    value={paymentTermsDays !== undefined ? paymentTermsDays : ''}
                                    onChange={e => setPaymentTermsDays(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                    placeholder="e.g. 45"
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-semibold text-gray-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                    Payment Rank (Rating)
                                </label>
                                <select aria-label="Payment Rank (Rating)"
                                    value={paymentRank}
                                    onChange={e => setPaymentRank(e.target.value as any)}
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-bold text-gray-900 dark:text-white"
                                >
                                    <option value="">Auto (from terms &amp; ageing)</option>
                                    <option value="Good">Good — pays to terms</option>
                                    <option value="Late">Late pay — pays, but slowly</option>
                                    <option value="Bad">Bad debt — old money stuck</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">Billing / Plant Address</label>
                                <input
                                    type="text"
                                    value={address}
                                    onChange={e => setAddress(e.target.value)}
                                    placeholder="e.g. Plot 12, GIDC"
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs text-gray-900 dark:text-white"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Additional Contacts Directory */}
                    <div className="p-4 bg-slate-50 dark:bg-gray-800/40 rounded-xl border border-slate-200 dark:border-gray-700/80 space-y-3">
                        <div className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider flex items-center justify-between">
                            <span>Additional Company Contacts ({additionalContacts.length})</span>
                            <span className="text-[11.5px] text-gray-500 font-normal">Add Purchase, Billing, Factory heads</span>
                        </div>

                        {additionalContacts.length > 0 && (
                            <div className="space-y-1.5">
                                {additionalContacts.map(c => (
                                    <div key={c.id} className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-gray-900 dark:text-white">{c.name}</span>
                                            {c.post && <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 text-[11.5px] font-semibold">{c.post}</span>}
                                            <span className="text-gray-500 dark:text-gray-400">{c.mobile}</span>
                                            {c.email && <span className="text-gray-400 text-[11.5px]">{c.email}</span>}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveContact(c.id)}
                                            className="w-9 h-9 grid place-items-center rounded-full text-red-500 hover:text-red-700 hover:bg-hover"
                                            title="Remove contact"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                            <input
                                type="text"
                                value={newContactName}
                                onChange={e => setNewContactName(e.target.value)}
                                placeholder="Name (e.g. Sunil)"
                                className="border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs text-gray-900 dark:text-white"
                            />
                            <input
                                type="text"
                                value={newContactPost}
                                onChange={e => setNewContactPost(e.target.value)}
                                placeholder="Role (e.g. Purchase)"
                                className="border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs text-gray-900 dark:text-white"
                            />
                            <input
                                type="text"
                                value={newContactMobile}
                                onChange={e => setNewContactMobile(e.target.value)}
                                placeholder="Mobile Number"
                                className="border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs text-gray-900 dark:text-white"
                            />
                            <div className="flex gap-1">
                                <input
                                    type="email"
                                    value={newContactEmail}
                                    onChange={e => setNewContactEmail(e.target.value)}
                                    placeholder="Email (optional)"
                                    className="border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs text-gray-900 dark:text-white flex-1"
                                />
                                <button
                                    type="button"
                                    onClick={handleAddContact}
                                    className="px-3 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg"
                                >
                                    + Add
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Financial Figures & Ageing */}
                    <div className="p-4 bg-slate-50 dark:bg-gray-800/40 rounded-xl border border-slate-200 dark:border-gray-700/80 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider">
                                Outstanding Balance & Ageing Breakdown
                            </div>
                            {!canEditFinancials && (
                                <span className="text-[11.5px] text-amber-600 dark:text-amber-400 font-semibold">
                                    Financials locked (Admin permission required)
                                </span>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">Total Outstanding (₹)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        value={total}
                                        onChange={e => setTotal(parseFloat(e.target.value) || 0)}
                                        disabled={!canEditFinancials}
                                        placeholder="0"
                                        className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-bold text-gray-900 dark:text-white disabled:bg-gray-100 disabled:text-gray-500"
                                    />
                                    <select aria-label="Total Outstanding (₹)"
                                        value={totalType}
                                        onChange={e => setTotalType(e.target.value as BalanceType)}
                                        disabled={!canEditFinancials}
                                        className="border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-bold text-gray-900 dark:text-white disabled:bg-gray-100"
                                    >
                                        <option value="Dr">Dr (Due)</option>
                                        <option value="Cr">Cr (Advance)</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex items-center pt-4">
                                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-red-600 dark:text-red-400">
                                    <input
                                        type="checkbox"
                                        checked={isUrgent}
                                        onChange={e => setIsUrgent(e.target.checked)}
                                        className="rounded text-red-600 dark:text-red-400 focus:ring-dang"
                                    />
                                    <span>Mark as Critical / High Priority Recovery</span>
                                </label>
                            </div>
                        </div>

                        {/* Ageing Brackets */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                            <div>
                                <label className="block text-[11.5px] font-bold text-gray-500 dark:text-gray-400 mb-0.5">1-45 Days (₹)</label>
                                <input aria-label="1-45 Days (₹)"
                                    type="number"
                                    value={a1_45}
                                    onChange={e => handleAgeingChange('1-45', parseFloat(e.target.value) || 0)}
                                    disabled={!canEditFinancials}
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-1.5 text-xs text-right font-semibold text-emerald-700 dark:text-emerald-400 disabled:bg-gray-100"
                                />
                            </div>
                            <div>
                                <label className="block text-[11.5px] font-bold text-gray-500 dark:text-gray-400 mb-0.5">46-90 Days (₹)</label>
                                <input aria-label="46-90 Days (₹)"
                                    type="number"
                                    value={a46_90}
                                    onChange={e => handleAgeingChange('46-90', parseFloat(e.target.value) || 0)}
                                    disabled={!canEditFinancials}
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-1.5 text-xs text-right font-semibold text-amber-700 dark:text-amber-400 disabled:bg-gray-100"
                                />
                            </div>
                            <div>
                                <label className="block text-[11.5px] font-bold text-gray-500 dark:text-gray-400 mb-0.5">91-135 Days (₹)</label>
                                <input aria-label="91-135 Days (₹)"
                                    type="number"
                                    value={a91_135}
                                    onChange={e => handleAgeingChange('91-135', parseFloat(e.target.value) || 0)}
                                    disabled={!canEditFinancials}
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-1.5 text-xs text-right font-bold text-orange-700 dark:text-orange-400 disabled:bg-gray-100"
                                />
                            </div>
                            <div>
                                <label className="block text-[11.5px] font-bold text-gray-500 dark:text-gray-400 mb-0.5">&gt;135 Days (₹)</label>
                                <input aria-label="&gt;135 Days (₹)"
                                    type="number"
                                    value={aOver135}
                                    onChange={e => handleAgeingChange('>135', parseFloat(e.target.value) || 0)}
                                    disabled={!canEditFinancials}
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-1.5 text-xs text-right font-extrabold text-red-700 dark:text-red-400 disabled:bg-gray-100"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Follow-up Planning & Remarks */}
                    <div className="p-4 bg-slate-50 dark:bg-gray-800/40 rounded-xl border border-slate-200 dark:border-gray-700/80 space-y-3">
                        <div className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider">
                            Next Follow-up Commitment & Notes
                        </div>
                        <div>
                            <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">Next Follow-up Date</label>
                            <input aria-label="Next Follow-up Date"
                                type="date"
                                value={followUpDate}
                                onChange={e => setFollowUpDate(e.target.value)}
                                className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-bold text-gray-900 dark:text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                {isNew ? 'Initial Customer Remarks / Notes' : 'Add New Interaction Note'}
                            </label>
                            <textarea
                                value={initialNote}
                                onChange={e => setInitialNote(e.target.value)}
                                placeholder="e.g. Spoke with Director. Promised RTGS of 3 Lakhs by Friday."
                                rows={2}
                                className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs text-gray-900 dark:text-white"
                            />
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="pt-4 border-t border-gray-200 dark:border-gray-800 flex justify-end space-x-3">
                        <button 
                            type="button"
                            onClick={onClose} 
                            className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                         aria-label="Close">
                            Cancel
                        </button>
                        <button 
                            type="submit" 
                            className="px-5 py-2.5 text-sm font-bold rounded-xl bg-green-600 text-white hover:bg-green-700 shadow-md shadow-green-600/20 transition-all flex items-center gap-1.5"
                        >
                            <span>{isNew ? 'Create Customer' : 'Save Changes'}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
