import React, { useState, useMemo, useEffect } from 'react';
import { Outstanding, FollowUpStatus, User, UserRole, Template, PdcCheque, PdcStatus, AdditionalContact, can, ActivityEntry, ACTIVITY_LABELS, PaymentRank, PAYMENT_RANK_LABELS, getCustomerPaymentRank, CUSTOMER_CATEGORIES, normaliseCategory, findOwner, overdueAgeing } from '../types';
import * as repo from '../services/repository';
import { recordWhatsAppOpened } from '../services/whatsappTrace';
import { sentence, type SaveOutcome } from '../services/useSupabaseSync';
import { WhatsAppIcon, UserPlusIcon, ChequeIcon, TrashIcon, BuildingOfficeIcon } from './icons/Icons';
import { BalanceAmount, formatCurrencyValue } from './BalanceAmount';
import { renderTemplate } from '../services/messageTemplate';
import CustomerActivityPanel from './CustomerActivityPanel';
import { useIsPhone } from './ui/usePhone';
import { Disclosure } from './ui/Disclosure';
import { useModal } from './ui/useModal';
import { ChequeStateBadge, stateOf } from './ui/ChequeState';
import StatusBadge from './StatusBadge';
import { followUpStatusOf } from '../types';

interface FollowUpModalProps {
    customer: Outstanding;
    currentUser: User;
    onClose: () => void;
    /**
     * Saves the account. May answer with the server's verdict: on a refusal
     * the dialog stays open, says why, and keeps everything typed.
     */
    onUpdate: (customer: Outstanding) => void | SaveOutcome | Promise<void | SaveOutcome>;
    users: User[];
    templates: Template[];
    pdcCheques?: PdcCheque[];
    onAddPdc?: (customerId: string) => void;
    onUpdatePdcStatus?: (chequeId: string, status: PdcStatus) => void;
    onEditCustomer?: (customer: Outstanding) => void;
    /**
     * Where this account sits in the list it was opened from, and how to step
     * to its neighbours without closing — the morning is worked account by
     * account, and closing and re-finding each one was the slowest part of it.
     */
    position?: { index: number; total: number };
    onNavigate?: (direction: -1 | 1) => void;
}

const FollowUpModal = ({ 
    customer, 
    currentUser, 
    onClose, 
    onUpdate, 
    users, 
    templates,
    pdcCheques = [],
    onAddPdc,
    onUpdatePdcStatus,
    onEditCustomer,
    position,
    onNavigate,
}: FollowUpModalProps) => {
    // Focus stays inside; Esc and the arrows are handled by this dialog's own key handler below.
    const panel = useModal(true, undefined, { closeOnEscape: false });

    const [nextFollowUpDate, setNextFollowUpDate] = useState(() => {
        if (customer.followUpDate) {
            try {
                const d = new Date(customer.followUpDate);
                return d.toISOString().split('T')[0];
            } catch {
                return '';
            }
        }
        return '';
    });
    const [assignedCollectorId, setAssignedCollectorId] = useState(customer.assignedCollectorId || '');
    // Resolved to the CRM code, because the options below are keyed by code. An
    // account saved under a display name matched no option, so this dialog
    // showed "Unassigned" for a customer that plainly had an owner.
    const [assignedCrmOwnerId, setAssignedCrmOwnerId] = useState(
        findOwner(users, customer.crmOwnerId)?.id || customer.crmOwnerId || '',
    );
    const [paymentRank, setPaymentRank] = useState<PaymentRank | ''>(customer.paymentRank || '');
    const [category, setCategory] = useState(customer.category || '');
    /**
     * What Save means by default. A collected account opens on "no follow-up"
     * and Save leaves it collected; it used to open on "follow up again" with
     * the collection date pre-filled, so fixing a phone number reopened it.
     */
    const wasCollected = customer.status === FollowUpStatus.Completed;
    const [outcome, setOutcome] = useState<'follow_up' | 'collected' | 'no_follow_up'>(wasCollected ? 'no_follow_up' : 'follow_up');
    const [isUrgent, setIsUrgent] = useState(customer.isUrgent || false);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id || '');
    /** Waiting for the server to accept the save; the reason if it did not. */
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Cash Flow Forecast state
    const [forecastAmount, setForecastAmount] = useState<string>(
        customer.forecastAmount !== undefined && customer.forecastAmount > 0 ? String(customer.forecastAmount) : ''
    );
    const [forecastDate, setForecastDate] = useState<string>(() => {
        if (customer.forecastDate) {
            try {
                const d = new Date(customer.forecastDate);
                return d.toISOString().split('T')[0];
            } catch {
                return '';
            }
        }
        if (customer.followUpDate) {
            try {
                return new Date(customer.followUpDate).toISOString().split('T')[0];
            } catch {
                return '';
            }
        }
        return '';
    });

    // CRM / Sales Contacts state
    const [primaryPerson] = useState(customer.contactPerson || '');
    const [primaryNumber] = useState(customer.contactNumber || '');
    const [primaryPost, setPrimaryPost] = useState(customer.contactPost || 'Accounts Head');
    const [additionalContacts, setAdditionalContacts] = useState<AdditionalContact[]>(
        customer.additionalContacts ? [...customer.additionalContacts] : []
    );

    // New Contact Form state
    const [showAddContactForm, setShowAddContactForm] = useState(false);
    const [newContactName, setNewContactName] = useState('');
    const [newContactMobile, setNewContactMobile] = useState('');
    const [newContactPost, setNewContactPost] = useState('Accounts Manager');
    const [newContactEmail, setNewContactEmail] = useState('');

    // WhatsApp Recipient Picker state: 'primary' | contactId | 'custom'
    const [recipientType, setRecipientType] = useState<'primary' | string>('primary');
    const [customRecipientNumber, setCustomRecipientNumber] = useState('');
    const [customRecipientName, setCustomRecipientName] = useState('');

    const collectors = users.filter(u => u.role === UserRole.Collector);
    /** Cheques still to be presented for this account — the Cheques section's one-line summary. */
    const pdcInHand = pdcCheques.filter(p => p.customerId === customer.id && p.status !== PdcStatus.Cleared && p.status !== PdcStatus.Bounced);
    const lastFollowUpText = (() => {
        if (!customer.lastFollowUpOn) return 'No follow-up recorded yet';
        const days = Math.round((Date.now() - new Date(customer.lastFollowUpOn).getTime()) / 86_400_000);
        return days <= 0 ? 'Last follow-up today' : days === 1 ? 'Last follow-up yesterday' : `Last follow-up ${days} days ago`;
    })();
    const crmUsers = users.filter(u => u.role === UserRole.CRM);

    /**
     * On a phone the form and the shared record cannot share the screen: with
     * the record pinned under the form, the form was left about a hundred and
     * eighty pixels to scroll in. So the sheet has two segments — Follow-up,
     * Activity — and shows one at a time, each with the whole height.
     */
    const isPhone = useIsPhone();
    const [phoneTab, setPhoneTab] = useState<'form' | 'activity'>('form');

    // Rights, not job titles: a Manager reassigns accounts too, and a Viewer
    // may read this panel but not record anything on it.
    const canEditFollowUp = can(currentUser, 'canEditFollowUp');
    const canReassignCrm = can(currentUser, 'canReassignCrm');
    const canEditCustomer = can(currentUser, 'canEditCustomer');
    const canAssignCollector = canReassignCrm || currentUser.role === UserRole.CRM;

    /**
     * A CRM may put their own name on an account, and may pick up one nobody
     * owns — the team's own instructions walk them through doing exactly that.
     * What they cannot do is move a colleague's account to a third person;
     * that stays with a Manager.
     */
    const mayClaimForSelf =
        !canReassignCrm &&
        currentUser.role === UserRole.CRM &&
        (!customer.crmOwnerId?.trim() ||
            [currentUser.id, currentUser.name].some(
                v => v.trim().toUpperCase() === customer.crmOwnerId.trim().toUpperCase(),
            ));

    // Add new contact to list
    const handleAddContact = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = newContactName.trim();
        const trimmedMobile = newContactMobile.trim();
        if (!trimmedName || !trimmedMobile) {
            alert('Please enter both person name and mobile number.');
            return;
        }

        const newContact: AdditionalContact = {
            id: `cont_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name: trimmedName,
            mobile: trimmedMobile,
            post: newContactPost.trim() || 'Staff',
            email: newContactEmail.trim() || undefined,
        };

        setAdditionalContacts(prev => [...prev, newContact]);
        setNewContactName('');
        setNewContactMobile('');
        setNewContactEmail('');
        setShowAddContactForm(false);
    };

    const handleRemoveContact = (id: string) => {
        if (window.confirm('Remove this contact person from the company records?')) {
            setAdditionalContacts(prev => prev.filter(c => c.id !== id));
            if (recipientType === id) {
                setRecipientType('primary');
            }
        }
    };

    // Calculate active recipient info for WhatsApp
    const activeRecipient = useMemo(() => {
        if (recipientType === 'primary') {
            return {
                name: primaryPerson || customer.contactPerson || 'Customer',
                number: primaryNumber || customer.contactNumber,
                post: primaryPost || 'Primary Contact'
            };
        }
        if (recipientType === 'custom') {
            return {
                name: customRecipientName.trim() || 'Customer Team',
                number: customRecipientNumber.trim(),
                post: 'Other Contact'
            };
        }
        const found = additionalContacts.find(c => c.id === recipientType);
        if (found) {
            return {
                name: found.name,
                number: found.mobile,
                post: found.post || 'Company Contact'
            };
        }
        return {
            name: customer.contactPerson || 'Customer',
            number: customer.contactNumber,
            post: 'Contact'
        };
    }, [recipientType, primaryPerson, primaryNumber, primaryPost, customRecipientName, customRecipientNumber, additionalContacts, customer]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
    };

    // Preset handler for forecast amount
    const handleSetPresetForecast = (amt: number) => {
        setForecastAmount(String(amt));
    };

    /**
     * What is past 90 days, as a preset beside Full Due and 50% Due.
     *
     * A call about an overdue account is usually a call about this figure —
     * the oldest money, the part the customer is asked to clear first — and
     * it was on the summary above but had to be retyped into the amount box.
     * Held in credit it is not a receivable, so it is not offered.
     */
    const over90Due = useMemo(() => Math.round(overdueAgeing(customer).over90), [customer]);

    /**
     * Mirrors a new activity entry into the customer's flat notes list.
     *
     * The thread is the record, but search, the Excel export, the AI report and
     * the "last note" column all read customer.notes. Writing one line per entry
     * there keeps every one of them working, and means logging a call still
     * counts as contact.
     */
    const handleActivityLogged = (entry: ActivityEntry) => {
        const when = new Date(entry.createdAt).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
        });
        const label = entry.kind === 'note' ? '' : `${ACTIVITY_LABELS[entry.kind]}: `;
        const promised = entry.kind === 'promise' && entry.promisedOn
            ? `${entry.promisedAmount ? formatCurrencyValue(entry.promisedAmount) + ' ' : ''}by ${new Date(entry.promisedOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}. `
            : '';
        const line = `[${when} - ${entry.authorName}] ${label}${promised}${entry.body}`.trim();

        onUpdate({
            ...customer,
            notes: [...(customer.notes || []), line],
            lastFollowUpOn: new Date(),
        });
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !saving) { e.preventDefault(); onClose(); return; }
            if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && onNavigate && !saving) {
                e.preventDefault();
                onNavigate(e.key === 'ArrowRight' ? 1 : -1);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, onNavigate, saving]);

    const handleSave = async () => {
        if (saving) return;
        let updatedCustomer: Outstanding = { ...customer };
        updatedCustomer.isUrgent = isUrgent;
        updatedCustomer.lastFollowUpOn = new Date();

        // Contact info update
        updatedCustomer.contactPerson = primaryPerson.trim() || customer.contactPerson;
        updatedCustomer.contactNumber = primaryNumber.trim() || customer.contactNumber;
        updatedCustomer.contactPost = primaryPost.trim() || customer.contactPost;
        updatedCustomer.additionalContacts = additionalContacts;

        // Cash flow forecast update
        const numForecast = parseFloat(forecastAmount);
        if (!isNaN(numForecast) && numForecast > 0) {
            updatedCustomer.forecastAmount = numForecast;
            updatedCustomer.forecastDate = forecastDate ? new Date(forecastDate) : (nextFollowUpDate ? new Date(nextFollowUpDate) : new Date());
        } else {
            updatedCustomer.forecastAmount = undefined;
            updatedCustomer.forecastDate = undefined;
        }

        // The stored status only records whether the money was collected.
        // Planning a follow-up (or dropping one) on an account closed as
        // collected opens it again — that is the one other thing written
        // here. Where the follow-up stands (today, upcoming, overdue) is read
        // from the date every time, so no word for it is stored: this dialog
        // used to write one, which made a plain Save after midnight carry a
        // status column that only restated the date.
        const reopen = () => {
            if (customer.status === FollowUpStatus.Completed) updatedCustomer.status = FollowUpStatus.Pending;
        };
        switch (outcome) {
            case 'collected':
                updatedCustomer.status = FollowUpStatus.Completed;
                updatedCustomer.followUpDate = new Date();
                break;
            case 'follow_up':
                updatedCustomer.followUpDate = nextFollowUpDate ? new Date(nextFollowUpDate) : undefined;
                reopen();
                break;
            case 'no_follow_up':
                // On a collected account this means "leave it as it is": the
                // collection date and the Completed status stay. On an open
                // account it clears the date.
                if (!wasCollected) updatedCustomer.followUpDate = undefined;
                break;
        }

        if (canAssignCollector) {
            updatedCustomer.assignedCollectorId = assignedCollectorId || undefined;
        }
        if ((canReassignCrm || mayClaimForSelf) && assignedCrmOwnerId) {
            updatedCustomer.crmOwnerId = assignedCrmOwnerId;
        }

        // Regrading an account is a judgement about a customer, so it belongs in
        // the shared record with a name against it, not silently in a column.
        if (canEditCustomer && (paymentRank || '') !== (customer.paymentRank || '')) {
            updatedCustomer.paymentRank = paymentRank || undefined;
            const before = customer.paymentRank ? PAYMENT_RANK_LABELS[customer.paymentRank] : 'automatic';
            const after = paymentRank ? PAYMENT_RANK_LABELS[paymentRank] : 'automatic';
            repo.addActivity({
                customerId: customer.id,
                kind: 'system',
                body: `Payment rank changed from ${before} to ${after}.`,
            }, currentUser).catch(() => { /* the rank still saves; the note is a courtesy */ });
        }

        // Same reasoning for the category: it decides how an account is grouped
        // in every report, so a change to it is worth a line in the thread.
        if (canEditCustomer && normaliseCategory(category) !== (customer.category || '')) {
            const next = normaliseCategory(category);
            updatedCustomer.category = next || undefined;
            repo.addActivity({
                customerId: customer.id,
                kind: 'system',
                body: `Category changed from ${customer.category || 'not set'} to ${next || 'not set'}.`,
            }, currentUser).catch(() => { /* the category still saves; the note is a courtesy */ });
        }


        setSaving(true);
        setSaveError(null);
        try {
            const verdict = await onUpdate(updatedCustomer);
            if (verdict && verdict.ok === false) {
                // Not saved. The change is kept in this tab and retried; the
                // person sees it here and can try again or come back later.
                setSaveError(verdict.message);
                return;
            }
        } catch (e: any) {
            setSaveError(e?.message || 'The save was not accepted. Nothing has been lost; try again.');
            return;
        } finally {
            setSaving(false);
        }
        onClose();
    };

    const whatsAppMessage = useMemo(() => {
        const template = templates.find(t => t.id === selectedTemplateId);
        if (!template) return '';

        return encodeURIComponent(renderTemplate(template.content, customer, activeRecipient));
    }, [customer, selectedTemplateId, templates, activeRecipient]);

    // Cleaned recipient number for WhatsApp link
    const cleanWhatsAppNumber = useMemo(() => {
        const raw = activeRecipient.number || '';
        const digits = raw.replace(/\D/g, '');
        if (!digits) return '';
        if (digits.length === 10) return `91${digits}`;
        return digits;
    }, [activeRecipient.number]);

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex justify-center items-center p-3 sm:p-4 overflow-y-auto backdrop-blur-xs max-md:p-0">
            <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="follow-up-title" className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl lg:max-w-6xl max-h-[92vh] flex flex-col border border-gray-200 dark:border-gray-800 my-auto animate-in fade-in zoom-in-95 duration-150 max-md:max-h-none max-md:h-[100dvh] max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:my-0">
                {/* Modal Header */}
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-start bg-slate-50 dark:bg-gray-800/50 rounded-t-2xl max-md:px-4 max-md:py-3 max-md:rounded-none">
                    <div>
                        <div className="flex items-center gap-2">
                            <BuildingOfficeIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
                            <h2 id="follow-up-title" className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white leading-tight">
                                {customer.company}
                            </h2>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                            <StatusBadge status={followUpStatusOf(customer)} />
                            {customer.followUpDate && (
                                <span>Next <strong className="text-gray-800 dark:text-gray-200">{new Date(customer.followUpDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</strong>{customer.forecastAmount ? <> · <strong className="text-gray-800 dark:text-gray-200">{formatCurrencyValue(customer.forecastAmount)}</strong> expected</> : null}</span>
                            )}
                            <span>{lastFollowUpText}</span>
                            <span>Owner <strong className="text-gray-800 dark:text-gray-200">{findOwner(users, customer.crmOwnerId)?.name || customer.crmOwnerId || 'Unassigned'}</strong></span>
                            {customer.email && customer.email.includes('@') && <span>{customer.email}</span>}
                            {onEditCustomer && (
                                <button
                                    type="button"
                                    onClick={() => onEditCustomer(customer)}
                                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 font-semibold underline flex items-center gap-1"
                                >
                                    Edit details
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 flex-none">
                        {position && onNavigate && position.total > 1 && (
                            <div className="hidden sm:flex items-center gap-1 mr-2 text-[12.5px] text-label-3" aria-label="Move through the list">
                                <button type="button" onClick={() => onNavigate(-1)} disabled={saving || position.index <= 0} className="h-8 w-8 grid place-items-center rounded-full hover:bg-hover disabled:opacity-30 text-label-2" title="Previous account (Alt+←)" aria-label="Previous account">‹</button>
                                <span className="num tabular-nums">{position.index + 1} / {position.total}</span>
                                <button type="button" onClick={() => onNavigate(1)} disabled={saving || position.index >= position.total - 1} className="h-8 w-8 grid place-items-center rounded-full hover:bg-hover disabled:opacity-30 text-label-2" title="Next account (Alt+→)" aria-label="Next account">›</button>
                            </div>
                        )}
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl font-bold p-1 leading-none rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            title="Close (Esc)"
                            aria-label="Close">
                            &times;
                        </button>
                    </div>
                </div>

                {isPhone && (
                    <div className="flex-none px-4 py-2 border-b border-separator bg-card">
                        <div className="flex rounded-xl bg-card-2 p-1 gap-1" role="tablist" aria-label="Follow-up or account activity">
                            {([['form', 'Follow-up'], ['activity', 'Activity']] as const).map(([key, label]) => (
                                <button
                                    key={key}
                                    type="button"
                                    role="tab"
                                    aria-selected={phoneTab === key}
                                    onClick={() => setPhoneTab(key)}
                                    className={`flex-1 h-10 rounded-lg text-[14px] font-bold transition-colors ${
                                        phoneTab === key ? 'bg-accent text-on-accent shadow-e1' : 'text-label-2'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Body: the form on the left, the shared record on the right.
                    Narrow screens have no room for two columns, so the record
                    drops underneath the form instead. */}
                <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
                  <div className={`flex flex-col min-h-0 lg:flex-1 lg:border-r border-separator max-md:flex-1 ${isPhone && phoneTab !== 'form' ? 'hidden' : ''}`}>
                <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1 max-md:p-4">
                    
                    {/* Financial & Ageing Summary Card */}
                    <div className="p-3.5 bg-slate-50 dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-700 text-xs shadow-xs">
                        <div className="flex justify-between items-baseline mb-2">
                            <span className="text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider text-[12.5px]">Total Outstanding Balance:</span>
                            <BalanceAmount
                                amount={customer.total}
                                type={customer.totalType || 'Dr'}
                                defaultClass="text-lg font-extrabold text-gray-900 dark:text-white"
                                showDrLabel={true}
                            />
                        </div>
                        {customer.dueOver45 !== undefined && (
                            <div className="flex justify-between items-baseline mb-2 text-xs">
                                <span className="text-amber-700 dark:text-amber-400 font-semibold">Due &gt; 45 Days Overdue:</span>
                                <BalanceAmount
                                    amount={customer.dueOver45}
                                    type={customer.dueOver45Type || 'Dr'}
                                    defaultClass="font-bold text-amber-700 dark:text-amber-400"
                                    showDrLabel={true}
                                />
                            </div>
                        )}
                        <div className="grid grid-cols-4 gap-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-center">
                            <div className="p-1.5 rounded bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                                <div className="text-[11.5px] font-bold text-gray-400 uppercase">1-45d</div>
                                <BalanceAmount
                                    amount={customer.ageing['1-45']}
                                    type={customer.ageingTypes?.['1-45'] || 'Dr'}
                                    defaultClass="font-semibold text-gray-700 dark:text-gray-300"
                                    size="sm"
                                />
                            </div>
                            <div className="p-1.5 rounded bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                                <div className="text-[11.5px] font-bold text-gray-400 uppercase">46-90d</div>
                                <BalanceAmount
                                    amount={customer.ageing['46-90']}
                                    type={customer.ageingTypes?.['46-90'] || 'Dr'}
                                    defaultClass="font-semibold text-amber-700 dark:text-amber-300"
                                    size="sm"
                                />
                            </div>
                            <div className="p-1.5 rounded bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900">
                                <div className="text-[11.5px] font-bold text-amber-700 dark:text-amber-300 uppercase">91-135d</div>
                                <BalanceAmount
                                    amount={customer.ageing['91-135']}
                                    type={customer.ageingTypes?.['91-135'] || 'Dr'}
                                    defaultClass="font-bold text-amber-800 dark:text-amber-300"
                                    size="sm"
                                />
                            </div>
                            <div className="p-1.5 rounded bg-red-50/80 dark:bg-red-950/40 border border-red-200 dark:border-red-900">
                                <div className="text-[11.5px] font-extrabold text-red-700 dark:text-red-300 uppercase">&gt;135d </div>
                                <BalanceAmount
                                    amount={customer.ageing['>135']}
                                    type={customer.ageingTypes?.['>135'] || 'Dr'}
                                    defaultClass="font-extrabold text-red-700 dark:text-red-400"
                                    size="sm"
                                />
                            </div>
                        </div>
                    </div>

                    {/* The one thing a call ends with: what happened next. First, not
                        last — it used to sit under contacts, the WhatsApp picker and
                        the cheques, a screen and a half down. */}
                    <section className="rounded-xl border border-accent/30 bg-card p-4 space-y-4" aria-labelledby="this-follow-up">
                        <div className="flex items-baseline justify-between gap-3 max-md:flex-col max-md:gap-0.5">
                            <h3 id="this-follow-up" className="text-[13.5px] font-bold text-label whitespace-nowrap">This follow-up</h3>
                            <span className="text-[12px] text-label-3 lg:hidden">What happened on the call goes in Activity.</span>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">What next?</label>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                                <label className={`flex items-center p-2.5 rounded-xl border cursor-pointer transition-all ${
                                    outcome === 'follow_up' ? 'bg-green-50 dark:bg-green-950/40 border-green-500 font-bold text-green-900 dark:text-green-200 ring-2 ring-green-500/20' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                                }`}>
                                    <input type="radio" name="outcome" value="follow_up" checked={outcome === 'follow_up'} onChange={() => setOutcome('follow_up')} data-autofocus className="mr-2 text-green-600 dark:text-green-400"/>
                                    <span>Follow up again</span>
                                </label>
                                <label className={`flex items-center p-2.5 rounded-xl border cursor-pointer transition-all ${
                                    outcome === 'collected' ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 font-bold text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/20' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                                }`}>
                                    <input type="radio" name="outcome" value="collected" checked={outcome === 'collected'} onChange={() => setOutcome('collected')} className="mr-2 text-emerald-600 dark:text-emerald-400"/>
                                    <span>Payment collected</span>
                                </label>
                                <label className={`flex items-center p-2.5 rounded-xl border cursor-pointer transition-all ${
                                    outcome === 'no_follow_up' ? 'bg-gray-100 dark:bg-gray-800 border-gray-400 font-bold' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                                }`}>
                                    <input type="radio" name="outcome" value="no_follow_up" checked={outcome === 'no_follow_up'} onChange={() => setOutcome('no_follow_up')} className="mr-2"/>
                                    <span>{wasCollected ? 'Keep as collected' : 'No follow-up needed'}</span>
                                </label>
                            </div>
                        </div>

                        {/* Forecast and Next Follow-up Date (Directly in Follow-up Outcome block) */}
                        {outcome === 'follow_up' && (
                            <div className="space-y-3 animate-in fade-in duration-150">

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="followUpDate" className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                            Next follow-up date
                                        </label>
                                        <input aria-label="Next Follow-up Date"
                                            type="date"
                                            id="followUpDate"
                                            value={nextFollowUpDate}
                                            onChange={(e) => {
                                                setNextFollowUpDate(e.target.value);
                                                if (!forecastDate) setForecastDate(e.target.value);
                                            }}
                                            className="block w-full border rounded-lg shadow-xs bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-accent"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                            Amount expected (₹)
                                        </label>
                                        <div className="relative">
                                            <span className="absolute inset-y-0 left-0 pl-3 flex items-center font-bold text-gray-500 text-sm">₹</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="1000"
                                                value={forecastAmount}
                                                onChange={e => setForecastAmount(e.target.value)}
                                                placeholder="e.g. 500000"
                                                className="w-full pl-8 pr-3 py-2 text-sm font-bold border rounded-lg bg-white dark:bg-gray-800 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 focus:ring-2 focus:ring-accent shadow-2xs"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Quick Presets for Amount */}
                                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                    <span className="text-[11.5px] font-bold text-gray-500 dark:text-gray-400 uppercase mr-1">Quick Presets:</span>
                                    <button
                                        type="button"
                                        onClick={() => handleSetPresetForecast(customer.total)}
                                        className="px-2 py-0.5 rounded text-[12.5px] font-semibold bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 transition-colors"
                                    >
                                        Full Due (₹{formatCurrency(customer.total)})
                                    </button>
                                    {over90Due > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => handleSetPresetForecast(over90Due)}
                                            className="px-2 py-0.5 rounded text-[12.5px] font-semibold bg-rose-100 hover:bg-rose-200 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200 transition-colors"
                                            title="Everything past 90 days: the 91-135 and >135 day buckets together"
                                        >
                                            &gt;90d Due (₹{formatCurrency(over90Due)})
                                        </button>
                                    )}
                                    {customer.total > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => handleSetPresetForecast(Math.round(customer.total / 2))}
                                            className="px-2 py-0.5 rounded text-[12.5px] font-semibold bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 transition-colors"
                                        >
                                            50% Due (₹{formatCurrency(Math.round(customer.total / 2))})
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleSetPresetForecast(100000)}
                                        className="px-2 py-0.5 rounded text-[12.5px] font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100"
                                    >
                                        ₹1 Lakh
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleSetPresetForecast(500000)}
                                        className="px-2 py-0.5 rounded text-[12.5px] font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100"
                                    >
                                        ₹5 Lakh
                                    </button>
                                    {forecastAmount && (
                                        <button
                                            type="button"
                                            onClick={() => setForecastAmount('')}
                                            className="px-2 py-0.5 rounded text-[12.5px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {canAssignCollector && (
                                <div className="flex items-center pt-1">
                                    <label htmlFor="isUrgent" className="flex items-center cursor-pointer">
                                        <input 
                                            type="checkbox" 
                                            id="isUrgent" 
                                            checked={isUrgent} 
                                            onChange={() => setIsUrgent(!isUrgent)}
                                            className="rounded text-red-600 dark:text-red-400 focus:ring-dang w-4 h-4 mr-2"
                                        />
                                        <span className="text-xs font-bold text-red-600 dark:text-red-400">
                                            Urgent — keep this account at the top
                                        </span>
                                    </label>
                                </div>
                        )}
                    </section>

                    <Disclosure
                        title="Contacts"
                        summary={`${1 + additionalContacts.length} ${1 + additionalContacts.length === 1 ? 'person' : 'people'} · ${customer.contactPerson || 'no name'}${customer.contactNumber ? ' · ' + customer.contactNumber : ''}`}
                        icon={<UserPlusIcon className="w-4 h-4" />}
                    >
                    {/* REQUIREMENT 3: Company Contacts & Additional Persons Section */}
                    <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-800/60 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 font-bold text-xs text-blue-900 dark:text-blue-200 uppercase tracking-wide">
                                <UserPlusIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                <span>Company Contacts Directory ({1 + additionalContacts.length} Persons)</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowAddContactForm(!showAddContactForm)}
                                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors shadow-2xs"
                            >
                                <span>{showAddContactForm ? '− Hide Form' : '+ Add Person'}</span>
                            </button>
                        </div>

                        {/* List of Contacts */}
                        <div className="space-y-2">
                            {/* Primary Contact */}
                            <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-blue-100 dark:border-blue-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                        <span className="px-1.5 py-0.5 rounded text-[11.5px] font-bold bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">Primary</span>
                                        <span className="font-bold text-gray-900 dark:text-gray-100">{primaryPerson || 'Primary Contact'}</span>
                                        <span className="text-gray-500 dark:text-gray-400">({primaryPost || 'Accounts Head'})</span>
                                    </div>
                                    <div className="text-gray-600 dark:text-gray-300 font-medium">
                                        {primaryNumber || 'No phone'}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={primaryPost}
                                        onChange={e => setPrimaryPost(e.target.value)}
                                        placeholder="Post / Designation"
                                        className="px-2 py-1 text-xs border rounded bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 max-w-[140px]"
                                        title="Primary Contact Post/Designation"
                                    />
                                </div>
                            </div>

                            {/* Additional Contacts */}
                            {additionalContacts.map((contact) => (
                                <div key={contact.id} className="p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2 text-xs">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="px-1.5 py-0.5 rounded text-[11.5px] font-bold bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200">
                                                {contact.post || 'Contact'}
                                            </span>
                                            <span className="font-bold text-gray-900 dark:text-gray-100">{contact.name}</span>
                                        </div>
                                        <div className="text-gray-600 dark:text-gray-300 font-medium flex items-center gap-2">
                                            <span>{contact.mobile}</span>
                                            {contact.email && <span className="text-gray-400">{contact.email}</span>}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveContact(contact.id)}
                                        className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors"
                                        title="Remove Person"
                                    >
                                        <TrashIcon />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Add New Contact Form */}
                        {showAddContactForm && (
                            <form onSubmit={handleAddContact} className="p-3 bg-white dark:bg-gray-800 rounded-xl border border-blue-300 dark:border-blue-700 space-y-2 text-xs animate-in fade-in duration-150">
                                <div className="font-bold text-gray-800 dark:text-gray-200">Add Person Related to {customer.company}</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 mb-0.5">Person Name *</label>
                                        <input
                                            type="text"
                                            value={newContactName}
                                            onChange={e => setNewContactName(e.target.value)}
                                            placeholder="e.g. Rajesh Verma"
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-accent"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 mb-0.5">Mobile Number *</label>
                                        <input
                                            type="tel"
                                            value={newContactMobile}
                                            onChange={e => setNewContactMobile(e.target.value)}
                                            placeholder="e.g. 9876543210"
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-accent"
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 mb-0.5">Post / Designation *</label>
                                        <select aria-label="Post / Designation"
                                            value={newContactPost}
                                            onChange={e => setNewContactPost(e.target.value)}
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-accent"
                                        >
                                            <option value="Accounts Manager">Accounts Manager</option>
                                            <option value="Finance Director">Finance Director</option>
                                            <option value="Managing Director / Owner">Managing Director / Owner</option>
                                            <option value="Purchase Head">Purchase Head</option>
                                            <option value="Billing / Cashier">Billing / Cashier</option>
                                            <option value="Store Manager">Store Manager</option>
                                            <option value="Payment Officer">Payment Officer</option>
                                            <option value="Other Staff">Other Staff</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 mb-0.5">Email (Optional)</label>
                                        <input
                                            type="email"
                                            value={newContactEmail}
                                            onChange={e => setNewContactEmail(e.target.value)}
                                            placeholder="e.g. contact@company.com"
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-accent"
                                        />
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => setShowAddContactForm(false)}
                                        className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-semibold"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors"
                                    >
                                        Save Contact Person
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                    </Disclosure>

                    <Disclosure
                        title="WhatsApp reminder"
                        summary={`to ${activeRecipient.name}${activeRecipient.number ? ' · ' + activeRecipient.number : ' · no number'}`}
                        icon={<WhatsAppIcon className="w-4 h-4 text-pos" />}
                    >
                    {/* REQUIREMENT 1: WhatsApp Reminder with option to send to Other / Additional Numbers */}
                    <div className="p-4 bg-green-50/60 dark:bg-green-950/20 rounded-xl border border-green-200 dark:border-green-800/60 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 font-bold text-xs text-green-900 dark:text-green-200 uppercase tracking-wide">
                                <WhatsAppIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                                <span>Send WhatsApp Reminder (Recipient Picker)</span>
                            </div>
                        </div>

                        {/* Recipient Selector */}
                        <div className="space-y-1.5">
                            <label className="block text-[12.5px] font-bold text-gray-700 dark:text-gray-300">
                                Send Reminder To:
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                {/* Option: Primary Contact */}
                                <label className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
                                    recipientType === 'primary' 
                                        ? 'bg-green-100/70 dark:bg-green-900/40 border-green-500 font-semibold text-green-950 dark:text-green-100' 
                                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'
                                }`}>
                                    <input
                                        type="radio"
                                        name="recipientType"
                                        value="primary"
                                        checked={recipientType === 'primary'}
                                        onChange={() => setRecipientType('primary')}
                                        className="mt-0.5 text-green-600 dark:text-green-400 focus:ring-accent"
                                    />
                                    <div className="truncate">
                                        <div className="truncate font-bold">{primaryPerson || 'Primary Contact'} ({primaryPost})</div>
                                        <div className="text-[12.5px] text-gray-500 dark:text-gray-400">{primaryNumber || 'No phone set'}</div>
                                    </div>
                                </label>

                                {/* Options: Additional Contacts */}
                                {additionalContacts.map(c => (
                                    <label key={c.id} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
                                        recipientType === c.id 
                                            ? 'bg-green-100/70 dark:bg-green-900/40 border-green-500 font-semibold text-green-950 dark:text-green-100' 
                                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'
                                    }`}>
                                        <input
                                            type="radio"
                                            name="recipientType"
                                            value={c.id}
                                            checked={recipientType === c.id}
                                            onChange={() => setRecipientType(c.id)}
                                            className="mt-0.5 text-green-600 dark:text-green-400 focus:ring-accent"
                                        />
                                        <div className="truncate">
                                            <div className="truncate font-bold">{c.name} ({c.post || 'Staff'})</div>
                                            <div className="text-[12.5px] text-gray-500 dark:text-gray-400">{c.mobile}</div>
                                        </div>
                                    </label>
                                ))}

                                {/* Option: Other / Custom Number */}
                                <label className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
                                    recipientType === 'custom' 
                                        ? 'bg-green-100/70 dark:bg-green-900/40 border-green-500 font-semibold text-green-950 dark:text-green-100' 
                                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'
                                }`}>
                                    <input
                                        type="radio"
                                        name="recipientType"
                                        value="custom"
                                        checked={recipientType === 'custom'}
                                        onChange={() => setRecipientType('custom')}
                                        className="mt-0.5 text-green-600 dark:text-green-400 focus:ring-accent"
                                    />
                                    <div>
                                        <div className="font-bold">Other / New Number</div>
                                        <div className="text-[12.5px] text-gray-500 dark:text-gray-400">Specify alternative number</div>
                                    </div>
                                </label>
                            </div>

                            {/* Custom Number Inputs when selected */}
                            {recipientType === 'custom' && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 p-2.5 bg-white dark:bg-gray-800 rounded-lg border border-green-300 dark:border-green-700 text-xs">
                                    <div>
                                        <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 mb-0.5">Person Name</label>
                                        <input
                                            type="text"
                                            value={customRecipientName}
                                            onChange={e => setCustomRecipientName(e.target.value)}
                                            placeholder="e.g. Accounts Incharge"
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 mb-0.5">Mobile Number *</label>
                                        <input
                                            type="tel"
                                            value={customRecipientNumber}
                                            onChange={e => setCustomRecipientNumber(e.target.value)}
                                            placeholder="10-digit mobile number"
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-bold"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Template Selection & Send Button */}
                        <div className="space-y-2 pt-1">
                            <label htmlFor="templateSelect" className="block text-[12.5px] font-bold text-gray-700 dark:text-gray-300">
                                Reminder Template:
                            </label>
                            <select aria-label="Reminder Template"
                                id="templateSelect"
                                value={selectedTemplateId}
                                onChange={e => setSelectedTemplateId(e.target.value)}
                                className="w-full border rounded-lg shadow-xs bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-accent"
                            >
                                {templates.map(template => (
                                    <option key={template.id} value={template.id}>{template.name}</option>
                                ))}
                            </select>

                            <a
                                href={`https://wa.me/${cleanWhatsAppNumber}?text=${whatsAppMessage}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => recordWhatsAppOpened(customer, { name: activeRecipient.name, number: cleanWhatsAppNumber }, templates.find(t => t.id === selectedTemplateId)?.name, currentUser)}
                                className={`inline-flex items-center justify-center w-full px-4 py-2.5 text-xs font-bold rounded-lg transition-all shadow-sm ${
                                    cleanWhatsAppNumber 
                                        ? 'bg-green-600 hover:bg-green-700 text-white active:scale-[0.99]' 
                                        : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed pointer-events-none'
                                }`}
                            >
                                <WhatsAppIcon className="w-4 h-4 mr-1.5" />
                                <span>Open WhatsApp to {activeRecipient.name} ({activeRecipient.number || 'No Number'})</span>
                            </a>
                        </div>
                    </div>
                    </Disclosure>

                    <Disclosure
                        title="Cheques"
                        summary={pdcInHand.length ? `${pdcInHand.length} in hand · ${formatCurrencyValue(pdcInHand.reduce((s, q) => s + q.amount, 0))}` : 'none in hand'}
                        icon={<ChequeIcon className="w-4 h-4" />}
                        action={onAddPdc && (
                            <button type="button" onClick={() => onAddPdc(customer.id)} className="h-8 px-3 rounded-full bg-accent-tint text-accent text-[12.5px] font-bold hover:bg-accent-tint-2">
                                + Add cheque
                            </button>
                        )}
                    >
                    {/* Post Dated Cheques (PDC) Section */}
                    {(() => {
                        const customerPdcs = pdcCheques.filter(p => p.customerId === customer.id);
                        const activePdcs = customerPdcs.filter(p => p.status !== PdcStatus.Cleared && p.status !== PdcStatus.Bounced);
                        const totalPdcAmount = activePdcs.reduce((sum, p) => sum + p.amount, 0);
                        const netBalance = Math.max(0, customer.total - totalPdcAmount);

                        return (
                            <div className="p-3.5 bg-slate-50 dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-700">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-1.5 font-bold text-xs text-gray-800 dark:text-gray-200 uppercase tracking-wide">
                                        <ChequeIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                        <span>Post Dated Cheques (PDCs)</span>
                                    </div>
                                    {onAddPdc && (
                                        <button
                                            type="button"
                                            onClick={() => onAddPdc(customer.id)}
                                            className="h-7 px-2.5 bg-accent hover:bg-accent-press text-on-accent rounded-full text-[12px] font-semibold flex items-center gap-1 transition-colors shadow-2xs"
                                        >
                                            <span>+ Add cheque</span>
                                        </button>
                                    )}
                                </div>

                                <div className="flex items-center justify-between text-xs py-1 border-b border-gray-200 dark:border-gray-700 mb-2">
                                    <span className="text-gray-600 dark:text-gray-300">
                                        PDCs in Hand: <strong className="text-emerald-600 dark:text-emerald-400">₹{formatCurrency(totalPdcAmount)}</strong> ({activePdcs.length} active)
                                    </span>
                                    <span className="text-gray-600 dark:text-gray-300">
                                        Uncovered Dues: <strong className="text-gray-900 dark:text-white">₹{formatCurrency(netBalance)}</strong>
                                    </span>
                                </div>

                                {customerPdcs.length === 0 ? (
                                    <div className="text-center py-2 text-xs text-gray-400 italic">
                                        No PDC cheques registered for this customer yet.
                                    </div>
                                ) : (
                                    <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                                        {customerPdcs.map(pdc => {
                                            const pDate = pdc.chequeDate instanceof Date ? pdc.chequeDate : new Date(pdc.chequeDate);
                                            return (
                                                <div key={pdc.id} className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs">
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-200">
                                                            <span>#{pdc.chequeNumber}</span>
                                                            <span className="text-[12.5px] font-normal text-gray-500 dark:text-gray-400">({pdc.bankName})</span>
                                                        </div>
                                                        <span className="text-[12.5px] text-gray-500 dark:text-gray-400">
                                                            Date: {pDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                                                            ₹{formatCurrency(pdc.amount)}
                                                        </span>
                                                        {/* The same words as the register: Due today, Date passed, Upcoming… */}
                                                        <ChequeStateBadge state={stateOf(pdc)} />
                                                        {onUpdatePdcStatus && pdc.status !== PdcStatus.Cleared && (
                                                            <button
                                                                type="button"
                                                                onClick={() => onUpdatePdcStatus(pdc.id, PdcStatus.Cleared)}
                                                                className="px-1.5 py-0.5 text-[11.5px] bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded font-semibold transition-colors"
                                                                title="Mark Cleared"
                                                            >
                                                                ✓ Clear
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                    </Disclosure>

                    {(canEditCustomer || canReassignCrm || mayClaimForSelf || canAssignCollector) && (
                        <Disclosure
                            title="Account settings"
                            summary={[
                                paymentRank ? PAYMENT_RANK_LABELS[paymentRank] : 'rank automatic',
                                category || 'no category',
                                findOwner(users, assignedCrmOwnerId)?.name || assignedCrmOwnerId || 'unassigned',
                                assignedCollectorId ? (collectors.find(c => c.id === assignedCollectorId)?.name || assignedCollectorId) : 'no collector',
                            ].join(' · ')}
                        >
                            <div className="space-y-4">
                        {canEditCustomer && (
                            <div className="relative">
                                <label htmlFor="paymentRank" className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    Payment rank
                                </label>
                                <select
                                    id="paymentRank"
                                    aria-label="Payment rank"
                                    value={paymentRank}
                                    onChange={e => setPaymentRank(e.target.value as PaymentRank | '')}
                                    className="block w-full border rounded-lg shadow-xs bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-accent"
                                >
                                    <option value="">Automatic — {PAYMENT_RANK_LABELS[getCustomerPaymentRank({ ...customer, paymentRank: undefined })]} from ageing</option>
                                    <option value="Good">Good — pays to terms</option>
                                    <option value="Late">Late pay — slow but paying</option>
                                    <option value="Bad">Bad debt — a defaulter</option>
                                </select>
                            </div>
                        )}

                        {canEditCustomer && (
                            <div className="relative">
                                <label htmlFor="customerCategoryFollowUp" className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    Category
                                </label>
                                <input
                                    id="customerCategoryFollowUp"
                                    type="text"
                                    list="customer-category-options-followup"
                                    value={category}
                                    onChange={e => setCategory(e.target.value)}
                                    onBlur={e => setCategory(normaliseCategory(e.target.value))}
                                    placeholder="Not set — e.g. Dealer / Screen Printing"
                                    className="block w-full border rounded-lg shadow-xs bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-accent"
                                />
                                <datalist id="customer-category-options-followup">
                                    {CUSTOMER_CATEGORIES.map(c => <option key={c} value={c} />)}
                                </datalist>
                            </div>
                        )}

                        {(canReassignCrm || mayClaimForSelf) && (
                            <div className="relative">
                                <label htmlFor="assignCrm" className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    {canReassignCrm ? 'Assigned CRM Owner' : 'CRM Owner (you can put your own name on it)'}
                                </label>
                                <select aria-label="Assigned CRM Owner"
                                    id="assignCrm"
                                    value={assignedCrmOwnerId}
                                    onChange={(e) => setAssignedCrmOwnerId(e.target.value)}
                                    className="block w-full border rounded-lg shadow-xs bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-accent"
                                >
                                    <option value="">Unassigned</option>
                                    {assignedCrmOwnerId && !findOwner(crmUsers, assignedCrmOwnerId) && (
                                        <option value={assignedCrmOwnerId}>{assignedCrmOwnerId}</option>
                                    )}
                                    {(canReassignCrm ? crmUsers : crmUsers.filter(c => c.id === currentUser.id)).map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                                {canAssignCollector && (
                                <div className="relative">
                                    <label htmlFor="assignCollector" className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Assign Collector (Optional)</label>
                                    <select aria-label="Assign Collector (Optional)"
                                        id="assignCollector"
                                        value={assignedCollectorId}
                                        onChange={(e) => setAssignedCollectorId(e.target.value)}
                                        className="block w-full border rounded-lg shadow-xs bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-accent"
                                    >
                                        <option value="">None</option>
                                        {collectors.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                                )}
                            </div>
                        </Disclosure>
                    )}
                </div>

                {saveError && (
                    <div role="alert" className="mx-6 mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-semibold">
                        Not saved: {sentence(saveError)} Everything you entered is still here — try again, or close and it will be retried from this tab.
                    </div>
                )}
                {/* Modal Footer */}
                <div className="bg-gray-50 dark:bg-gray-800/80 px-6 py-3.5 flex justify-end space-x-3 border-t border-gray-200 dark:border-gray-800 rounded-b-2xl max-md:px-4 max-md:py-3 max-md:rounded-none max-md:pb-[calc(12px+env(safe-area-inset-bottom))] max-md:[&>button]:flex-1 max-md:[&>button]:h-11 max-md:[&>button]:text-[14px]">
                    <button 
                        onClick={onClose} 
                        type="button" 
                        className="h-9 px-4 rounded-full text-[13px] font-semibold bg-card border border-separator-strong text-label-2 hover:bg-hover hover:text-label disabled:opacity-40"
                     aria-label="Close">
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        type="button"
                        disabled={!canEditFollowUp || saving}
                        title={canEditFollowUp ? 'Save this follow-up' : 'Your role can read follow-ups but not record them'}
                        className="h-9 px-5 rounded-full text-[13px] font-semibold bg-accent text-on-accent hover:bg-accent-press shadow-e1 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                    >
                        {saving ? 'Saving…' : 'Save follow-up'}
                    </button>
                </div>
                  </div>

                  <div className={`lg:w-[380px] xl:w-[420px] flex-none min-h-0 h-[46vh] lg:h-auto border-t lg:border-t-0 border-separator max-md:h-auto max-md:flex-1 max-md:border-t-0 ${isPhone && phoneTab !== 'activity' ? 'hidden' : ''}`}>
                    <CustomerActivityPanel
                        customer={customer}
                        currentUser={currentUser}
                        onLogged={handleActivityLogged}
                    />
                  </div>
                </div>
            </div>
        </div>
    );
};

export default FollowUpModal;
