import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityEntry,
    ACTIVITY_LABELS,
    AdditionalContact,
    CHEQUE_ACTIVE,
    ChequeState,
    FollowUpStatus,
    Outstanding,
    PaymentRank,
    PAYMENT_RANK_LABELS,
    PdcCheque,
    PdcStatus,
    Template,
    User,
    UserRole,
    can,
    chequeState,
    getCustomerPaymentRank,
    ownerKey,
} from '../../types';
import * as repo from '../../services/repository';
import { formatCurrencyValue } from '../BalanceAmount';
import { AgeingBar, Badge, Button, cx } from '../ui/Primitives';
import { formatCompact, formatDate, formatINR, relativeDays } from '../ui/format';
import CustomerActivityPanel from '../CustomerActivityPanel';
import { WhatsAppIcon, ChequeIcon, TrashIcon, UserPlusIcon } from '../icons/Icons';

/* ============================================================================
   One account, and what to do about it.

   This used to be a dialog stacked on top of the list, which meant the work of
   the day looked like: read a card, change tab, find the row, open a modal, do
   the thing, close it, lose your place, start again. An account is the unit of
   work in a collections book, so it gets somewhere to live: who they are, what
   they owe, who to ring, what is outstanding against them in cheques, the form
   that records what happened, and the thread of what everyone else has already
   tried — all on screen together, with the list still beside it.
   ========================================================================== */

interface Props {
    customer: Outstanding;
    currentUser: User;
    users: User[];
    templates: Template[];
    pdcCheques: PdcCheque[];
    onUpdate: (customer: Outstanding) => void;
    onAddPdc: (customerId: string) => void;
    onUpdatePdcStatus: (chequeId: string, status: PdcStatus) => void;
    onEditCustomer: (customer: Outstanding) => void;
    onWhatsApp: (customer: Outstanding) => void;
    /** Shown on narrow screens, where the list and the account cannot share the width. */
    onBack?: () => void;
}

const dialable = (raw?: string) => (raw || '').replace(/\D/g, '').length >= 7;
const waNumber = (raw?: string) => {
    const digits = (raw || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length === 10 ? `91${digits}` : digits;
};

const CHEQUE_TONE: Record<ChequeState, { tone: 'pos' | 'warn' | 'dang' | 'neutral' | 'brand'; label: string }> = {
    due: { tone: 'warn', label: 'Due today' },
    overdue: { tone: 'dang', label: 'Date passed' },
    upcoming: { tone: 'brand', label: 'Upcoming' },
    hold: { tone: 'neutral', label: 'On hold' },
    cleared: { tone: 'pos', label: 'Cleared' },
    bounced: { tone: 'dang', label: 'Bounced' },
};

const RANK_TONE: Record<PaymentRank, 'pos' | 'warn' | 'dang'> = {
    Good: 'pos',
    Late: 'warn',
    Bad: 'dang',
};

/** A labelled block in the left column. */
const Section = ({
    title,
    action,
    children,
}: {
    title: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}) => (
    <section className="px-5 py-4 border-b border-separator">
        <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="label">{title}</h3>
            {action}
        </div>
        {children}
    </section>
);

const Field = ({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) => (
    <label className="block" htmlFor={htmlFor}>
        <span className="block text-[12px] font-semibold text-label-2 mb-1">{label}</span>
        {children}
    </label>
);

const INPUT =
    'w-full h-10 px-3 rounded-[10px] bg-card-2 border border-separator text-[14px] text-label ' +
    'outline-none focus:border-accent transition-colors';

const AccountPanel = ({
    customer,
    currentUser,
    users,
    templates,
    pdcCheques,
    onUpdate,
    onAddPdc,
    onUpdatePdcStatus,
    onEditCustomer,
    onWhatsApp,
    onBack,
}: Props) => {
    const canEditFollowUp = can(currentUser, 'canEditFollowUp');
    const canEditCustomer = can(currentUser, 'canEditCustomer');
    const canReassignCrm = can(currentUser, 'canReassignCrm');
    const canManagePdc = can(currentUser, 'canManagePdc');
    const canAssignCollector = canReassignCrm || currentUser.role === UserRole.CRM;

    /**
     * A CRM may put their own name on an account, and may pick up one nobody
     * owns — the team's own instructions walk them through doing exactly that.
     * Moving a colleague's account to a third person stays with a Manager.
     */
    const mayClaimForSelf =
        !canReassignCrm &&
        currentUser.role === UserRole.CRM &&
        (!customer.crmOwnerId?.trim() ||
            [currentUser.id, currentUser.name].some(v => ownerKey(v) === ownerKey(customer.crmOwnerId)));

    const asDateInput = (value?: Date | string) => {
        if (!value) return '';
        const d = new Date(value);
        return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
    };

    /* ----------------------------- the action form ----------------------- */
    const [outcome, setOutcome] = useState<'follow_up' | 'collected' | 'no_follow_up'>('follow_up');
    const [nextDate, setNextDate] = useState(asDateInput(customer.followUpDate));
    const [forecastAmount, setForecastAmount] = useState(
        customer.forecastAmount && customer.forecastAmount > 0 ? String(customer.forecastAmount) : '',
    );
    const [forecastDate, setForecastDate] = useState(
        asDateInput(customer.forecastDate || customer.followUpDate),
    );
    const [rank, setRank] = useState<PaymentRank | ''>(customer.paymentRank || '');
    const [crmOwnerId, setCrmOwnerId] = useState(customer.crmOwnerId || '');
    const [collectorId, setCollectorId] = useState(customer.assignedCollectorId || '');
    const [isUrgent, setIsUrgent] = useState(Boolean(customer.isUrgent));
    const [saved, setSaved] = useState(false);

    // Moving to another account must not carry the previous one's half-typed plan.
    useEffect(() => {
        setOutcome('follow_up');
        setNextDate(asDateInput(customer.followUpDate));
        setForecastAmount(customer.forecastAmount && customer.forecastAmount > 0 ? String(customer.forecastAmount) : '');
        setForecastDate(asDateInput(customer.forecastDate || customer.followUpDate));
        setRank(customer.paymentRank || '');
        setCrmOwnerId(customer.crmOwnerId || '');
        setCollectorId(customer.assignedCollectorId || '');
        setIsUrgent(Boolean(customer.isUrgent));
        setSaved(false);
        setAddingContact(false);
    }, [customer.id]);

    /* ------------------------------- contacts ---------------------------- */
    const [addingContact, setAddingContact] = useState(false);
    const [newName, setNewName] = useState('');
    const [newMobile, setNewMobile] = useState('');
    const [newPost, setNewPost] = useState('Accounts');

    const contacts = useMemo(() => {
        const list: (AdditionalContact & { primary?: boolean })[] = [];
        if (customer.contactPerson || customer.contactNumber) {
            list.push({
                id: '__primary__',
                name: customer.contactPerson || 'Accounts Dept',
                mobile: customer.contactNumber || '',
                post: customer.contactPost || 'Primary contact',
                primary: true,
            });
        }
        return list.concat(customer.additionalContacts || []);
    }, [customer]);

    const addContact = () => {
        if (!newName.trim() || !newMobile.trim()) return;
        onUpdate({
            ...customer,
            additionalContacts: [
                ...(customer.additionalContacts || []),
                {
                    id: `cont_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    name: newName.trim(),
                    mobile: newMobile.trim(),
                    post: newPost.trim() || 'Staff',
                },
            ],
        });
        setNewName('');
        setNewMobile('');
        setAddingContact(false);
    };

    const removeContact = (id: string) => {
        if (!window.confirm('Remove this person from the account?')) return;
        onUpdate({
            ...customer,
            additionalContacts: (customer.additionalContacts || []).filter(c => c.id !== id),
        });
    };

    /* -------------------------------- cheques ---------------------------- */
    const cheques = useMemo(
        () =>
            pdcCheques
                .filter(p => p.customerId === customer.id)
                .map(p => ({ ...p, state: chequeState(p) }))
                .sort((a, b) => new Date(a.chequeDate).getTime() - new Date(b.chequeDate).getTime()),
        [pdcCheques, customer.id],
    );
    const chequesHeld = cheques.filter(c => CHEQUE_ACTIVE.includes(c.state));
    const heldValue = chequesHeld.reduce((s, c) => s + c.amount, 0);

    /* ------------------------------- activity ---------------------------- */
    /**
     * Every entry is mirrored as one line into the flat notes array, because
     * search, the Excel export, the AI report and the "last note" column all
     * read that. Logging a call therefore still counts as contact.
     */
    const handleActivityLogged = (entry: ActivityEntry) => {
        const when = new Date(entry.createdAt).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
        });
        const label = entry.kind === 'note' ? '' : `${ACTIVITY_LABELS[entry.kind]}: `;
        const promised =
            entry.kind === 'promise' && entry.promisedOn
                ? `${entry.promisedAmount ? formatCurrencyValue(entry.promisedAmount) + ' ' : ''}by ${new Date(
                      entry.promisedOn,
                  ).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}. `
                : '';
        onUpdate({
            ...customer,
            notes: [...(customer.notes || []), `[${when} - ${entry.authorName}] ${label}${promised}${entry.body}`.trim()],
            lastFollowUpOn: new Date(),
        });
    };

    /* --------------------------------- save ------------------------------ */
    const save = () => {
        const next: Outstanding = { ...customer, isUrgent, lastFollowUpOn: new Date() };

        const forecast = parseFloat(forecastAmount);
        if (!isNaN(forecast) && forecast > 0) {
            next.forecastAmount = forecast;
            next.forecastDate = forecastDate ? new Date(forecastDate) : nextDate ? new Date(nextDate) : new Date();
        } else {
            next.forecastAmount = undefined;
            next.forecastDate = undefined;
        }

        if (outcome === 'collected') {
            next.status = FollowUpStatus.Completed;
            next.followUpDate = new Date();
        } else if (outcome === 'no_follow_up' || !nextDate) {
            next.followUpDate = undefined;
            next.status = FollowUpStatus.Pending;
        } else {
            const target = new Date(nextDate);
            next.followUpDate = target;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const at = new Date(target);
            at.setHours(0, 0, 0, 0);
            next.status =
                at.getTime() === today.getTime()
                    ? FollowUpStatus.Today
                    : at.getTime() < today.getTime()
                    ? FollowUpStatus.Overdue
                    : FollowUpStatus.Upcoming;
        }

        if (canAssignCollector) next.assignedCollectorId = collectorId || undefined;
        if ((canReassignCrm || mayClaimForSelf) && crmOwnerId) next.crmOwnerId = crmOwnerId;

        // Regrading an account is a judgement about a customer, so it belongs in
        // the shared record with a name against it, not silently in a column.
        if (canEditCustomer && (rank || '') !== (customer.paymentRank || '')) {
            next.paymentRank = rank || undefined;
            const before = customer.paymentRank ? PAYMENT_RANK_LABELS[customer.paymentRank] : 'automatic';
            const after = rank ? PAYMENT_RANK_LABELS[rank] : 'automatic';
            repo
                .addActivity(
                    { customerId: customer.id, kind: 'system', body: `Payment rank changed from ${before} to ${after}.` },
                    currentUser,
                )
                .catch(() => { /* the rank still saves; the note is a courtesy */ });
        }

        onUpdate(next);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2500);
    };

    /* --------------------------------- view ------------------------------ */
    const ageing = {
        a1: customer.ageing?.['1-45'] || 0,
        a2: customer.ageing?.['46-90'] || 0,
        a3: customer.ageing?.['91-135'] || 0,
        a4: customer.ageing?.['>135'] || 0,
    };
    const effectiveRank = getCustomerPaymentRank(customer);
    const due = relativeDays(customer.followUpDate);
    const collectors = users.filter(u => u.role === UserRole.Collector);

    /**
     * Who may own this account. Built from the CRMs, plus whoever owns it now
     * and whoever is looking at it — an account owned by an Admin showed
     * "Unassigned" here next to a header naming them, because the list was
     * built only from people whose role happens to be CRM.
     */
    const ownerOptions = useMemo(() => {
        const seen = new Map<string, { value: string; label: string }>();
        const add = (value: string, label: string) => {
            const key = ownerKey(value);
            if (key && !seen.has(key)) seen.set(key, { value, label });
        };
        users.filter(u => u.role === UserRole.CRM).forEach(u => add(u.id, u.name));
        if (customer.crmOwnerId) {
            const known = users.find(u => ownerKey(u.id) === ownerKey(customer.crmOwnerId));
            add(customer.crmOwnerId, known ? known.name : customer.crmOwnerId);
        }
        if (mayClaimForSelf) add(currentUser.id, `${currentUser.name} (me)`);
        return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
    }, [users, customer.crmOwnerId, mayClaimForSelf, currentUser]);

    return (
        <div className="flex flex-col lg:h-full min-h-0 bg-card">
            {/* ----------------------------- identity ------------------------- */}
            <header className="px-5 pt-4 pb-3.5 border-b border-separator flex-none">
                <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
                    {onBack && (
                        <button
                            onClick={onBack}
                            aria-label="Back to the list"
                            className="lg:hidden w-9 h-9 -ml-1 grid place-items-center rounded-full text-label-2 hover:bg-hover flex-none"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m15 6-6 6 6 6" />
                            </svg>
                        </button>
                    )}
                    <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                        <h2 className="text-[21px] font-extrabold text-label tracking-[-0.02em] leading-tight [overflow-wrap:break-word]">
                            {customer.company}
                        </h2>
                        <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap mt-1.5 text-[13px] text-label-3">
                            <span>{customer.crmOwnerId || 'No owner'}</span>
                            {customer.assignedCollectorId && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span>collector {customer.assignedCollectorId}</span>
                                </>
                            )}
                            {customer.city && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span>{customer.city}</span>
                                </>
                            )}
                            {customer.paymentTermsDays && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span>{customer.paymentTermsDays} day terms</span>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-none">
                        <Badge tone={RANK_TONE[effectiveRank]}>{PAYMENT_RANK_LABELS[effectiveRank]}</Badge>
                        {customer.isUrgent && <Badge tone="dang">Urgent</Badge>}
                        {canEditCustomer && (
                            <Button size="sm" variant="ghost" onClick={() => onEditCustomer(customer)}>
                                Edit
                            </Button>
                        )}
                    </div>
                </div>

                {/* ------------------------- money at a glance ---------------- */}
                <div className="flex items-end gap-x-7 gap-y-2 flex-wrap mt-4">
                    <div>
                        <p className="label">Outstanding</p>
                        <p
                            className="num text-[27px] font-semibold text-label leading-none mt-1.5 tracking-[-0.03em]"
                            title={formatINR(customer.total)}
                        >
                            {formatCompact(customer.total)}
                            {customer.totalType === 'Cr' && (
                                <span className="ml-1.5 text-[12px] font-bold text-pos align-middle">CR</span>
                            )}
                        </p>
                    </div>
                    {(customer.dueOver45 || 0) > 0 && (
                        <div>
                            <p className="label">Past 45 days</p>
                            <p className="num text-[17px] font-semibold leading-none mt-1.5" style={{ color: 'var(--age-2-ink)' }}>
                                {formatCompact(customer.dueOver45)}
                            </p>
                        </div>
                    )}
                    {(customer.over90 || 0) > 0 && (
                        <div>
                            <p className="label">Past 90 days</p>
                            <p className="num text-[17px] font-semibold leading-none mt-1.5" style={{ color: 'var(--age-3-ink)' }}>
                                {formatCompact(customer.over90)}
                            </p>
                        </div>
                    )}
                    {due && (
                        <div>
                            <p className="label">Follow-up</p>
                            <p className={cx('text-[17px] font-semibold leading-none mt-1.5', due.days < 0 ? 'text-dang' : 'text-label')}>
                                {due.text}
                            </p>
                        </div>
                    )}
                </div>
                <AgeingBar parts={ageing} height={7} className="mt-3.5" />
            </header>

            {/* ------------------------- work and record ---------------------- */}
            <div className="lg:flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
                <div className="min-h-0 lg:overflow-y-auto xl:border-r border-separator">
                    {/* -------------------------- what now ---------------------- */}
                    {canEditFollowUp ? (
                        <Section
                            title="What happens next"
                            action={
                                saved ? (
                                    <span className="text-[12.5px] font-semibold text-pos">Saved</span>
                                ) : undefined
                            }
                        >
                            <div className="flex flex-wrap gap-2 mb-4" role="radiogroup" aria-label="Outcome">
                                {([
                                    ['follow_up', 'Follow up again'],
                                    ['collected', 'Payment collected'],
                                    ['no_follow_up', 'No follow-up'],
                                ] as const).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        role="radio"
                                        aria-checked={outcome === value}
                                        onClick={() => setOutcome(value)}
                                        className={cx(
                                            'h-9 px-4 rounded-full text-[13.5px] font-semibold transition-colors',
                                            outcome === value
                                                ? 'bg-accent text-on-accent'
                                                : 'bg-card-2 text-label-2 hover:bg-hover',
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {outcome === 'follow_up' && (
                                    <Field label="Next follow-up" htmlFor="ap-next">
                                        <input id="ap-next" type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} className={INPUT} />
                                    </Field>
                                )}
                                <Field label="Expect to collect" htmlFor="ap-forecast">
                                    <input
                                        id="ap-forecast"
                                        type="number"
                                        min="0"
                                        inputMode="numeric"
                                        placeholder="Amount"
                                        value={forecastAmount}
                                        onChange={e => setForecastAmount(e.target.value)}
                                        className={cx(INPUT, 'num')}
                                    />
                                </Field>
                                {forecastAmount && (
                                    <Field label="Expected by" htmlFor="ap-forecast-date">
                                        <input id="ap-forecast-date" type="date" value={forecastDate} onChange={e => setForecastDate(e.target.value)} className={INPUT} />
                                    </Field>
                                )}
                                {canEditCustomer && (
                                    <Field label="Payment grade" htmlFor="ap-rank">
                                        <select id="ap-rank" value={rank} onChange={e => setRank(e.target.value as PaymentRank | '')} className={INPUT}>
                                            <option value="">Work it out from ageing</option>
                                            <option value="Good">{PAYMENT_RANK_LABELS.Good}</option>
                                            <option value="Late">{PAYMENT_RANK_LABELS.Late}</option>
                                            <option value="Bad">{PAYMENT_RANK_LABELS.Bad}</option>
                                        </select>
                                    </Field>
                                )}
                                {(canReassignCrm || mayClaimForSelf) && (
                                    <Field label="CRM owner" htmlFor="ap-crm">
                                        <select id="ap-crm" value={crmOwnerId} onChange={e => setCrmOwnerId(e.target.value)} className={INPUT}>
                                            <option value="">Unassigned</option>
                                            {ownerOptions.map(o => (
                                                <option key={o.value} value={o.value}>{o.label}</option>
                                            ))}
                                        </select>
                                    </Field>
                                )}
                                {canAssignCollector && (
                                    <Field label="Collector" htmlFor="ap-collector">
                                        <select id="ap-collector" value={collectorId} onChange={e => setCollectorId(e.target.value)} className={INPUT}>
                                            <option value="">Nobody</option>
                                            {collectors.map(u => (
                                                <option key={u.id} value={u.id}>{u.name}</option>
                                            ))}
                                        </select>
                                    </Field>
                                )}
                            </div>

                            <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
                                {/* A 16px checkbox is a poor target on a laptop and a
                                    hopeless one on a phone, and this screen already
                                    speaks in toggles. */}
                                <button
                                    type="button"
                                    aria-pressed={isUrgent}
                                    onClick={() => setIsUrgent(v => !v)}
                                    className={cx(
                                        'h-9 px-4 rounded-full text-[13.5px] font-semibold transition-colors',
                                        isUrgent ? 'bg-dang-bg text-dang' : 'bg-card-2 text-label-2 hover:bg-hover',
                                    )}
                                >
                                    {isUrgent ? 'Urgent' : 'Flag as urgent'}
                                </button>
                                <Button variant="primary" onClick={save}>Save</Button>
                            </div>
                        </Section>
                    ) : (
                        <Section title="What happens next">
                            <p className="text-[13.5px] text-label-3">You can read this account but not record against it.</p>
                        </Section>
                    )}

                    {/* -------------------------- contacts ---------------------- */}
                    <Section
                        title={`Who to call${contacts.length > 1 ? ` · ${contacts.length}` : ''}`}
                        action={
                            canEditCustomer && (
                                <Button size="sm" variant="ghost" icon={<UserPlusIcon />} onClick={() => setAddingContact(v => !v)}>
                                    {addingContact ? 'Cancel' : 'Add'}
                                </Button>
                            )
                        }
                    >
                        {contacts.length === 0 && (
                            <p className="text-[13.5px] text-label-3">No phone number on this account yet.</p>
                        )}

                        <ul className="flex flex-col gap-2">
                            {contacts.map(c => (
                                <li key={c.id} className="flex items-center gap-3 bg-card-2 rounded-[12px] px-3.5 py-2.5">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[14px] font-semibold text-label truncate">{c.name}</p>
                                        <p className="text-[12.5px] text-label-3 truncate">
                                            {c.post}
                                            {c.mobile && <span className="num"> · {c.mobile}</span>}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1 flex-none">
                                        {dialable(c.mobile) && (
                                            <>
                                                <a
                                                    href={`tel:${c.mobile}`}
                                                    aria-label={`Call ${c.name}`}
                                                    title={`Call ${c.name}`}
                                                    className="w-9 h-9 grid place-items-center rounded-full text-label-2 hover:text-accent hover:bg-hover"
                                                >
                                                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                        <path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a1.5 1.5 0 0 1-1.7 1.5A16.5 16.5 0 0 1 4 6.7 1.5 1.5 0 0 1 5.5 5z" />
                                                    </svg>
                                                </a>
                                                <a
                                                    href={`https://wa.me/${waNumber(c.mobile)}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    aria-label={`WhatsApp ${c.name}`}
                                                    title={`WhatsApp ${c.name}`}
                                                    className="w-9 h-9 grid place-items-center rounded-full text-label-2 hover:text-pos hover:bg-hover"
                                                >
                                                    <WhatsAppIcon className="w-[17px] h-[17px]" />
                                                </a>
                                            </>
                                        )}
                                        {canEditCustomer && !c.primary && (
                                            <button
                                                onClick={() => removeContact(c.id)}
                                                aria-label={`Remove ${c.name}`}
                                                title={`Remove ${c.name}`}
                                                className="w-9 h-9 grid place-items-center rounded-full text-label-3 hover:text-dang hover:bg-hover"
                                            >
                                                <TrashIcon />
                                            </button>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>

                        {addingContact && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                                <input aria-label="Name" placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} className={INPUT} />
                                <input aria-label="Mobile" placeholder="Mobile" value={newMobile} onChange={e => setNewMobile(e.target.value)} className={cx(INPUT, 'num')} />
                                <div className="flex gap-2">
                                    <input aria-label="Designation" placeholder="Designation" value={newPost} onChange={e => setNewPost(e.target.value)} className={INPUT} />
                                    <Button variant="secondary" onClick={addContact} disabled={!newName.trim() || !newMobile.trim()}>Add</Button>
                                </div>
                            </div>
                        )}

                        {templates.length > 0 && contacts.some(c => dialable(c.mobile)) && (
                            <Button
                                size="sm"
                                variant="secondary"
                                className="mt-3"
                                icon={<WhatsAppIcon className="w-4 h-4" />}
                                onClick={() => onWhatsApp(customer)}
                            >
                                Send a reminder with the balance
                            </Button>
                        )}
                    </Section>

                    {/* --------------------------- cheques ---------------------- */}
                    <Section
                        title={
                            chequesHeld.length
                                ? `Cheques held · ${chequesHeld.length} · ${formatCompact(heldValue)}`
                                : 'Cheques'
                        }
                        action={
                            canManagePdc && (
                                <Button size="sm" variant="ghost" icon={<ChequeIcon className="w-4 h-4" />} onClick={() => onAddPdc(customer.id)}>
                                    Add
                                </Button>
                            )
                        }
                    >
                        {cheques.length === 0 ? (
                            <p className="text-[13.5px] text-label-3">No cheques recorded against this account.</p>
                        ) : (
                            <ul className="flex flex-col gap-2">
                                {cheques.map(c => (
                                    <li key={c.id} className="flex items-center gap-3 bg-card-2 rounded-[12px] px-3.5 py-2.5 flex-wrap">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[14px] font-semibold text-label">
                                                <span className="num">{c.chequeNumber}</span>
                                                <span className="text-label-3 font-normal"> · {c.bankName}</span>
                                            </p>
                                            <p className="text-[12.5px] text-label-3">dated {formatDate(c.chequeDate)}</p>
                                        </div>
                                        <span className="num text-[14px] font-semibold text-label flex-none" title={formatINR(c.amount)}>
                                            {formatCompact(c.amount)}
                                        </span>
                                        <Badge tone={CHEQUE_TONE[c.state].tone}>{CHEQUE_TONE[c.state].label}</Badge>
                                        {canManagePdc && CHEQUE_ACTIVE.includes(c.state) && (
                                            <span className="flex gap-1 flex-none">
                                                <Button size="sm" variant="ghost" onClick={() => onUpdatePdcStatus(c.id, PdcStatus.Cleared)}>Cleared</Button>
                                                <Button size="sm" variant="ghost" onClick={() => onUpdatePdcStatus(c.id, PdcStatus.Bounced)}>Bounced</Button>
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>
                </div>

                {/* ---------------------------- the thread --------------------- */}
                <div className="min-h-0 border-t xl:border-t-0 border-separator h-[70vh] xl:h-auto">
                    <CustomerActivityPanel customer={customer} currentUser={currentUser} onLogged={handleActivityLogged} />
                </div>
            </div>
        </div>
    );
};

export default AccountPanel;
