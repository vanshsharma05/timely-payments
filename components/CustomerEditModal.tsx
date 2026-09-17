import React, { useState, useEffect, useRef } from 'react';
import { sentence, type SaveOutcome } from '../services/useSupabaseSync';
import { useModal } from './ui/useModal';
import { Outstanding, User, UserRole, AdditionalContact, BalanceType, FollowUpStatus, PaymentRank, can, CUSTOMER_CATEGORIES, normaliseCategory, findOwner } from '../types';

interface CustomerEditModalProps {
    customerToEdit: Outstanding | null; // null means Add New Customer
    /** May answer with the server's verdict; on a refusal the dialog stays open with everything typed. */
    onSave: (customer: Outstanding) => void | SaveOutcome | Promise<void | SaveOutcome>;
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
    // One reading of the matrix — can() falls back to the role's defaults where
    // a profile has none, and lets an Admin through unconditionally.
    const canEditFinancials = can(currentUser, 'canEditFinancials');
    // Reading every CRM's accounts is not permission to move one between them.
    // "View all CRMs" used to be accepted here as well, which handed a Viewer —
    // who may change nothing at all — the owner dropdown.
    //
    // Choosing the owner while creating a customer is a different act from
    // moving an existing account between colleagues, and anyone trusted to add
    // a customer has to be able to answer it — otherwise the form asks for
    // something it will not let them give.
    const canReassignCrm = can(currentUser, 'canReassignCrm');
    const canChooseOwner = canReassignCrm || (isNew && can(currentUser, 'canAddCustomer'));

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
    const [category, setCategory] = useState('');
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
    /** Waiting for the server to accept the save; the reason if it did not. */
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const panel = useModal(true, onClose, { closeOnEscape: !saving });
    const [isUrgent, setIsUrgent] = useState(false);

    /**
     * The form as it was when it opened, for the fields whose Save has a
     * side effect beyond the value itself: the owner (a resolved spelling
     * must not be written back as a change), the follow-up date (its status
     * is derived only when the date is actually moved) and the money block
     * (recomputed only when somebody with the right typed a new figure).
     */
    const opened = useRef({ crmOwnerId: '', followUpDate: '', total: 0, totalType: 'Dr' as BalanceType, a1_45: 0, a46_90: 0, a91_135: 0, aOver135: 0 });
    /** A new account's id, fixed the first time it is saved from this dialog so a retry saves the same account, not a second one. */
    const newId = useRef<string | null>(null);

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
            setCategory(customerToEdit.category || '');
            // An owner saved under an older spelling still has to select its own
            // option, or opening the form would quietly reset it to blank.
            const owner = findOwner(crmUsers, customerToEdit.crmOwnerId)?.id || customerToEdit.crmOwnerId || '';
            const followUp = customerToEdit.followUpDate ? new Date(customerToEdit.followUpDate).toISOString().split('T')[0] : '';
            const money = {
                total: customerToEdit.total || 0,
                totalType: customerToEdit.totalType || 'Dr',
                a1_45: customerToEdit.ageing?.['1-45'] || 0,
                a46_90: customerToEdit.ageing?.['46-90'] || 0,
                a91_135: customerToEdit.ageing?.['91-135'] || 0,
                aOver135: customerToEdit.ageing?.['>135'] || 0,
            };
            opened.current = { crmOwnerId: owner, followUpDate: followUp, ...money };
            setCrmOwnerId(owner);
            setTotal(money.total);
            setTotalType(money.totalType);
            setA1_45(money.a1_45);
            setA46_90(money.a46_90);
            setA91_135(money.a91_135);
            setAOver135(money.aOver135);
            setFollowUpDate(followUp);
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
            setCategory('');
            // A CRM adding a customer is obviously its owner. For anybody else
            // it is left blank on purpose and the form will not save without an
            // answer: the customer database lives here now, so "who chases this
            // account" is asked when the account is created. It used to default
            // to whoever happened to be first in the list — which is how
            // thousands of accounts ended up on one person's name without
            // anyone deciding it.
            setCrmOwnerId(currentUser?.role === UserRole.CRM ? currentUser.id : '');
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (saving) return;
        if (!company.trim()) {
            alert('Company name is required.');
            return;
        }
        if (!crmOwnerId.trim()) {
            alert('Choose the CRM who will own this customer.');
            return;
        }

        const existingNotes = customerToEdit?.notes || [];
        const updatedNotes = [...existingNotes];
        if (initialNote.trim()) {
            const author = currentUser?.name || 'User';
            const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            updatedNotes.unshift(`[${dateStr} - ${author}] ${initialNote.trim()}`);
        }

        /** The money block as this form computes it — for a new customer, or an intentional edit by someone with the right. */
        const moneyFromForm = () => {
            const calculatedOver90 = a91_135 + aOver135;
            const calculatedDueOver45 = a46_90 + calculatedOver90;
            return {
                total: total > 0 ? total : (a1_45 + calculatedDueOver45),
                totalType,
                ageing: { '1-45': a1_45, '46-90': a46_90, '91-135': a91_135, '>135': aOver135 },
                ageingTypes: { '1-45': totalType, '46-90': totalType, '91-135': totalType, '>135': totalType },
                over90: calculatedOver90,
                over90Type: totalType,
                dueOver45: calculatedDueOver45,
                dueOver45Type: totalType,
            };
        };

        // What this dialog owns: the customer's details and directory, its
        // classification, urgency, and the note typed here.
        const details = {
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
            paymentRank: (paymentRank === 'Good' || paymentRank === 'Late' || paymentRank === 'Bad') ? paymentRank : undefined,
            category: normaliseCategory(category) || undefined,
            additionalContacts: additionalContacts,
            notes: updatedNotes,
            isUrgent: isUrgent,
        };

        let savedRecord: Outstanding;
        if (!customerToEdit) {
            const targetDate = followUpDate ? new Date(followUpDate) : undefined;
            if (!newId.current) newId.current = `cust_${Date.now()}_${encodeURIComponent(company.slice(0, 15).replace(/\s+/g, '_'))}`;
            savedRecord = {
                id: newId.current,
                ...details,
                crmOwnerId: crmOwnerId.trim(),
                ...moneyFromForm(),
                followUpDate: targetDate,
                // Where the follow-up stands is read from the date; the stored
                // status only ever says "collected", which a new account is not.
                status: FollowUpStatus.Pending,
                isNewCustomer: true,
                addedAt: new Date().toISOString(),
                creationDate: new Date(),
                lastFollowUpOn: initialNote.trim() ? new Date() : undefined,
            };
        } else {
            /**
             * An existing account keeps everything this form does not own —
             * its collector, its settlement stamp, its PAN, its forecast, and
             * above all the money the sheet gave it, Dr/Cr types and netted
             * roll-ups included. This dialog used to rebuild the whole record
             * from its fields, so a Save that changed nothing dropped the
             * collector, turned a credit bucket into a debit and replaced the
             * sheet's ₹1,16,028 past 90 days with a ₹2,85,906 sum of absolute
             * values — on every account anyone edited a phone number on.
             */
            const before = opened.current;
            const ownerChanged = crmOwnerId.trim() !== before.crmOwnerId;
            const followUpChanged = followUpDate !== before.followUpDate;
            const moneyChanged = canEditFinancials && (
                total !== before.total || totalType !== before.totalType ||
                a1_45 !== before.a1_45 || a46_90 !== before.a46_90 || a91_135 !== before.a91_135 || aOver135 !== before.aOver135
            );

            savedRecord = {
                ...customerToEdit,
                ...details,
                lastFollowUpOn: initialNote.trim() ? new Date() : customerToEdit.lastFollowUpOn,
            };
            // A resolved spelling of the same owner is not a change; only a
            // different choice writes the owner.
            if (ownerChanged) savedRecord.crmOwnerId = crmOwnerId.trim();
            if (followUpChanged) {
                const targetDate = followUpDate ? new Date(followUpDate) : undefined;
                savedRecord.followUpDate = targetDate;
                // A new date on an account closed as collected opens it again;
                // clearing the date leaves a collected account collected. No
                // word for where the follow-up stands is stored (the date decides).
                if (targetDate && customerToEdit.status === FollowUpStatus.Completed) savedRecord.status = FollowUpStatus.Pending;
            }
            if (moneyChanged) Object.assign(savedRecord, moneyFromForm());
        }

        setSaving(true);
        setSaveError(null);
        try {
            const verdict = await onSave(savedRecord);
            if (verdict && verdict.ok === false) setSaveError(verdict.message);
        } catch (err: any) {
            setSaveError(err?.message || 'The save was not accepted. Nothing has been lost; try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex justify-center items-center p-3 sm:p-4 overflow-y-auto max-md:p-0">
            <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="customer-edit-title" className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col border border-gray-200 dark:border-gray-800 animate-in fade-in zoom-in-95 duration-150 my-auto max-md:max-h-none max-md:h-[100dvh] max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:my-0">
                {/* Header */}
                <div className="p-5 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50 rounded-t-2xl">
                    <div>
                        <h2 id="customer-edit-title" className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <span>{isNew ? 'Add a customer' : 'Edit customer details'}</span>
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
                                data-autofocus
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
                            {canChooseOwner ? (
                                <select aria-label="CRM Owner"
                                    value={crmOwnerId}
                                    onChange={e => setCrmOwnerId(e.target.value)}
                                    required
                                    className={`w-full border rounded-xl shadow-2xs bg-gray-50 dark:bg-gray-800 p-2.5 text-sm font-bold text-gray-900 dark:text-white focus:ring-2 focus:ring-accent ${
                                        crmOwnerId ? 'border-gray-300 dark:border-gray-700' : 'border-amber-400 dark:border-amber-600'
                                    }`}
                                >
                                    <option value="">Select CRM</option>
                                    {/* The value is the CRM code, never the display name: the code is
                                        what a customer row carries and what the accounts sheet uses.
                                        Saving the name instead put "Vansh Sharma" where VANSH_SHARMA
                                        belonged, and the account then read as unassigned. */}
                                    {crmUsers.map(u => (
                                        <option key={u.id} value={u.id}>{u.name}</option>
                                    ))}
                                    {crmOwnerId && !findOwner(crmUsers, crmOwnerId) && (
                                        <option value={crmOwnerId}>{crmOwnerId}</option>
                                    )}
                                </select>
                            ) : (
                                <input aria-label="CRM Owner"
                                    type="text"
                                    value={crmOwnerId || 'Unassigned'}
                                    disabled
                                    title="Your role cannot change who owns an account."
                                    className="w-full border rounded-xl bg-gray-100 dark:bg-gray-800/60 border-gray-300 dark:border-gray-700 p-2.5 text-sm font-bold text-gray-600 dark:text-gray-400 cursor-not-allowed"
                                />
                            )}
                            {canChooseOwner && !crmOwnerId && (
                                <p className="text-[11.5px] text-amber-700 dark:text-amber-400 font-semibold mt-1">
                                    Pick who will chase this customer — it cannot be saved without one.
                                </p>
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                            <div>
                                <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1 whitespace-nowrap">Credit Limit (₹)</label>
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
                                    <option value="Bad">Bad debt — a defaulter</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="customerCategory" className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                    Category
                                </label>
                                {/* A list to pick from, but still typable: the master
                                    carries spellings this list has never seen, and a
                                    closed dropdown would have no way to hold them. */}
                                <input
                                    id="customerCategory"
                                    type="text"
                                    list="customer-category-options"
                                    value={category}
                                    onChange={e => setCategory(e.target.value)}
                                    onBlur={e => setCategory(normaliseCategory(e.target.value))}
                                    placeholder="e.g. Dealer / Screen Printing"
                                    className="w-full border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-semibold text-gray-900 dark:text-white"
                                />
                                <datalist id="customer-category-options">
                                    {CUSTOMER_CATEGORIES.map(c => <option key={c} value={c} />)}
                                </datalist>
                            </div>
                            <div className="sm:col-span-2 lg:col-span-4">
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

                        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                            <input
                                type="text"
                                value={newContactName}
                                onChange={e => setNewContactName(e.target.value)}
                                placeholder="Name (e.g. Sunil)"
                                className="border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs text-gray-900 dark:text-white flex-1 min-w-[140px]"
                            />
                            <input
                                type="text"
                                value={newContactPost}
                                onChange={e => setNewContactPost(e.target.value)}
                                placeholder="Role (e.g. Purchase)"
                                className="border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs text-gray-900 dark:text-white flex-1 min-w-[140px]"
                            />
                            <input
                                type="text"
                                value={newContactMobile}
                                onChange={e => setNewContactMobile(e.target.value)}
                                placeholder="Mobile Number"
                                className="border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs text-gray-900 dark:text-white flex-1 min-w-[140px]"
                            />
                            <input
                                type="email"
                                value={newContactEmail}
                                onChange={e => setNewContactEmail(e.target.value)}
                                placeholder="Email (optional)"
                                className="border rounded-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs text-gray-900 dark:text-white flex-1 min-w-[140px]"
                            />
                            <button
                                type="button"
                                onClick={handleAddContact}
                                className="flex-none h-9 px-3.5 bg-accent hover:bg-accent-press text-on-accent text-[12.5px] font-semibold rounded-full whitespace-nowrap"
                            >
                                + Add
                            </button>
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

                    {saveError && (
                        <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-semibold">
                            Not saved: {sentence(saveError)} Your changes are still here — try again, or close and they will be retried from this tab.
                        </div>
                    )}
                    {/* Footer */}
                    <div className="pt-4 border-t border-gray-200 dark:border-gray-800 flex justify-end space-x-3 max-md:pb-[env(safe-area-inset-bottom)] max-md:[&>button]:flex-1 max-md:[&>button]:min-h-[44px]">
                        <button 
                            type="button"
                            onClick={onClose} 
                            className="h-9 px-4 rounded-full text-[13px] font-semibold bg-card border border-separator-strong text-label-2 hover:bg-hover hover:text-label disabled:opacity-40"
                         aria-label="Close">
                            Cancel
                        </button>
                        <button 
                            type="submit" 
                            disabled={saving}
                            className="h-9 px-5 rounded-full text-[13px] font-semibold bg-accent text-on-accent hover:bg-accent-press shadow-e1 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                        >
                            <span>{saving ? 'Saving…' : isNew ? 'Add customer' : 'Save changes'}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
