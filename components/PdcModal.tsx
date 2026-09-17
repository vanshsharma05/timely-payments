import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Outstanding, PdcCheque, PdcStatus, PDC_STATUS_CHOICES, User, matchesSearch, findOwner } from '../types';
import { sentence, type SaveOutcome } from '../services/useSupabaseSync';
import { useModal } from './ui/useModal';
import { ChequeIcon } from './icons/Icons';
import { formatCompact, formatINR, chequeWhen, localIsoDate } from './ui/format';

interface PdcModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** May answer with the server's verdict; on a refusal the dialog stays open with everything typed. */
    onSave: (chequeData: Omit<PdcCheque, 'id'> & { id?: string }) => void | SaveOutcome | Promise<void | SaveOutcome>;
    chequeToEdit?: PdcCheque | null;
    preselectedCustomerId?: string;
    customers: Outstanding[];
    currentUser: User | null;
    /** For the bank suggestions and the "already recorded" warning. */
    existingCheques?: PdcCheque[];
    users?: User[];
}

const COMMON_BANKS = [
    'HDFC Bank',
    'State Bank of India (SBI)',
    'ICICI Bank',
    'Axis Bank',
    'Kotak Mahindra Bank',
    'Punjab National Bank (PNB)',
    'Bank of Baroda',
    'Canara Bank',
    'Union Bank of India',
    'IndusInd Bank',
    'Yes Bank',
    'IDFC First Bank',
    'Federal Bank',
    'Standard Chartered',
    'HSBC',
];

/** What each choice means, under the segmented control. */
const STATUS_HINT: Record<PdcStatus, string> = {
    [PdcStatus.Pending]: 'In hand — it will come up as due on its date.',
    [PdcStatus.Hold]: 'Deliberately not presented, usually at the customer\'s request.',
    [PdcStatus.Cleared]: 'The bank has paid it.',
    [PdcStatus.Bounced]: 'Returned unpaid by the bank.',
    [PdcStatus.DueToday]: 'In hand.',
};

const FIELD = 'w-full h-10 px-3 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-[13.5px] text-gray-900 dark:text-white focus:ring-2 focus:ring-accent/40 focus:outline-none max-md:h-11';
const LABEL = 'block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-1';

/**
 * Recording a cheque, or correcting one.
 *
 * The customer is found by typing — a select of four thousand accounts
 * defaulted, silently, to the first one alphabetically, and so did the bank
 * (HDFC) and the date (fifteen days out). Nothing here is guessed any more:
 * the customer is chosen, the bank is typed with suggestions from the
 * register, the date is the one written on the cheque. The status is a
 * segmented control with one line under it saying what the choice means,
 * and the button says what it does.
 */
const PdcModal: React.FC<PdcModalProps> = ({
    isOpen,
    onClose,
    onSave,
    chequeToEdit,
    preselectedCustomerId,
    customers,
    currentUser,
    existingCheques = [],
    users = [],
}) => {
    const [customerId, setCustomerId] = useState('');
    const [customerQuery, setCustomerQuery] = useState('');
    const [chequeNumber, setChequeNumber] = useState('');
    const [bankName, setBankName] = useState('');
    const [chequeDate, setChequeDate] = useState('');
    const [amount, setAmount] = useState<number | ''>('');
    const [status, setStatus] = useState<PdcStatus>(PdcStatus.Pending);
    const [receivedDate, setReceivedDate] = useState(localIsoDate());
    const [remarks, setRemarks] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const panel = useModal(isOpen, onClose, { closeOnEscape: !saving });
    /** A new cheque's id, fixed for this open of the dialog so a retry saves the same cheque, not a second one. */
    const newId = useRef<string | null>(null);
    useEffect(() => { if (isOpen) newId.current = null; }, [isOpen]);
    const customerInput = useRef<HTMLInputElement>(null);
    const numberInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (chequeToEdit) {
            setCustomerId(chequeToEdit.customerId);
            setChequeNumber(chequeToEdit.chequeNumber);
            setBankName(chequeToEdit.bankName);
            const cDate = chequeToEdit.chequeDate instanceof Date
                ? chequeToEdit.chequeDate
                : new Date(chequeToEdit.chequeDate);
            setChequeDate(isNaN(cDate.getTime()) ? '' : cDate.toISOString().split('T')[0]);
            setAmount(chequeToEdit.amount);
            setStatus(chequeToEdit.status === PdcStatus.DueToday ? PdcStatus.Pending : chequeToEdit.status);
            const rDate = chequeToEdit.receivedDate instanceof Date
                ? chequeToEdit.receivedDate
                : new Date(chequeToEdit.receivedDate);
            setReceivedDate(isNaN(rDate.getTime()) ? localIsoDate() : rDate.toISOString().split('T')[0]);
            setRemarks(chequeToEdit.remarks || '');
        } else {
            // A new cheque: the customer it came from, if we were opened from
            // their account; otherwise nobody until somebody is chosen.
            setCustomerId(preselectedCustomerId || '');
            setChequeNumber('');
            setBankName('');
            setChequeDate('');
            setAmount('');
            setStatus(PdcStatus.Pending);
            setReceivedDate(localIsoDate());
            setRemarks('');
        }
        setCustomerQuery('');
        setError(null);
    }, [chequeToEdit, preselectedCustomerId, isOpen]);

    const selectedCustomer = useMemo(() => customers.find(c => c.id === customerId), [customers, customerId]);
    /** Opened from a customer's account: the cheque is theirs, no picking. */
    const customerLocked = !!preselectedCustomerId && !chequeToEdit;

    // The first eight accounts matching what has been typed, by name, contact or phone.
    const matches = useMemo(() => {
        const q = customerQuery.trim();
        if (!q) return [];
        const out: Outstanding[] = [];
        for (const c of customers) {
            if (matchesSearch([c.company, c.contactPerson, c.contactNumber, c.city], q)) {
                out.push(c);
                if (out.length >= 8) break;
            }
        }
        return out;
    }, [customers, customerQuery]);

    // Banks: the ones already in the register first, then the common list.
    const bankSuggestions = useMemo(() => {
        const seen = new Set<string>();
        const out: string[] = [];
        const add = (b?: string) => { const k = (b || '').trim(); if (k && !seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); out.push(k); } };
        existingCheques.forEach(c => add(c.bankName));
        out.sort((a, b) => a.localeCompare(b));
        COMMON_BANKS.forEach(add);
        return out;
    }, [existingCheques]);

    /** The same number from the same bank for the same customer is almost always the same cheque typed twice. */
    const duplicate = useMemo(() => {
        const n = chequeNumber.trim().toLowerCase();
        if (!n || !customerId) return undefined;
        return existingCheques.find(c => c.id !== chequeToEdit?.id && c.customerId === customerId && c.chequeNumber.trim().toLowerCase() === n && c.bankName.trim().toLowerCase() === bankName.trim().toLowerCase());
    }, [existingCheques, chequeNumber, bankName, customerId, chequeToEdit]);

    if (!isOpen) return null;

    const today = new Date();
    const dated = chequeDate ? new Date(chequeDate + 'T00:00:00') : null;
    const datedText = dated && !isNaN(dated.getTime()) ? chequeWhen(dated, today) : '';
    const datePassed = !!dated && !isNaN(dated.getTime()) && dated.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const numAmount = typeof amount === 'number' ? amount : parseFloat(String(amount));

    const chooseCustomer = (c: Outstanding) => {
        setCustomerId(c.id);
        setCustomerQuery('');
        setTimeout(() => numberInput.current?.focus(), 0);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (saving) return;
        setError(null);

        if (!customerId || !selectedCustomer) {
            setError('Choose the customer the cheque came from.');
            customerInput.current?.focus();
            return;
        }
        if (!chequeNumber.trim()) {
            setError('Enter the cheque number — it is printed on the cheque.');
            return;
        }
        const finalBank = bankName.trim();
        if (!finalBank) {
            setError('Enter the bank the cheque is drawn on.');
            return;
        }
        if (!chequeDate) {
            setError('Enter the date written on the cheque.');
            return;
        }
        if (isNaN(numAmount) || numAmount <= 0) {
            setError('Enter the amount — more than zero.');
            return;
        }

        const finalCustomerName = selectedCustomer.company;
        const finalCrmOwnerId = selectedCustomer.crmOwnerId || (currentUser?.id || '');

        setSaving(true);
        let verdict: void | SaveOutcome;
        try {
            if (!chequeToEdit && !newId.current) newId.current = `pdc_${Date.now()}`;
            verdict = await onSave({
                id: chequeToEdit?.id ?? newId.current ?? undefined,
                customerId,
                customerName: finalCustomerName,
                chequeNumber: chequeNumber.trim(),
                bankName: finalBank,
                chequeDate: new Date(chequeDate),
                amount: numAmount,
                status,
                receivedDate: new Date(receivedDate),
                remarks: remarks.trim(),
                crmOwnerId: finalCrmOwnerId,
                addedBy: chequeToEdit?.addedBy || currentUser?.name || 'System',
            });
        } catch (e: any) {
            setSaving(false);
            setError(`Not saved: ${e?.message || 'the save was not accepted'}. The cheque is still here — try again.`);
            return;
        }
        setSaving(false);
        if (verdict && verdict.ok === false) {
            setError(`Not saved: ${sentence(verdict.message)} The cheque is kept in this tab and will be retried; you can also try again now.`);
            return;
        }
        onClose();
    };

    const ownerOf = (c: Outstanding) => findOwner(users, c.crmOwnerId)?.name || c.crmOwnerId || '';
    const customerLine = (c: Outstanding) => [
        `O/S ${formatCompact(c.total)}`,
        c.contactPerson,
        ownerOf(c),
    ].filter(Boolean).join(' · ');

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex justify-center items-center p-3 sm:p-4 overflow-y-auto max-md:p-0 max-md:items-start">
            <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="pdc-title" className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col border border-gray-200 dark:border-gray-800 my-auto animate-in fade-in zoom-in-95 duration-150 max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:my-0">
                {/* Header: what this is, and whose cheque it is */}
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-start bg-slate-50 dark:bg-gray-800/50 rounded-t-2xl max-md:px-4 max-md:py-3 max-md:rounded-none">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <ChequeIcon className="w-5 h-5 text-pos flex-none" />
                            <h2 id="pdc-title" className="text-lg font-bold text-gray-900 dark:text-white leading-tight truncate">
                                {chequeToEdit ? `Edit cheque #${chequeToEdit.chequeNumber}` : 'Record a cheque'}
                            </h2>
                        </div>
                        <p className="text-[12.5px] text-gray-500 dark:text-gray-400 mt-1">
                            {chequeToEdit
                                ? 'Correct what was recorded; the register updates for everyone.'
                                : 'A post-dated cheque a customer has given. It comes up in the register on its date.'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl font-bold p-1 leading-none rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex-none"
                        title="Close (Esc)"
                        aria-label="Close"
                    >
                        &times;
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
                    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4 max-md:px-4">
                        {error && (
                            <div role="alert" className="p-3 bg-dang-bg text-dang rounded-lg text-[13px] font-semibold">
                                {error}
                            </div>
                        )}

                        {/* Customer: chosen by typing, never guessed */}
                        <div>
                            <label htmlFor="pdcCustomer" className={LABEL}>Customer</label>
                            {selectedCustomer ? (
                                <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-accent-tint">
                                    <div className="min-w-0">
                                        <span className="block text-[13.5px] font-bold text-label truncate">{selectedCustomer.company}</span>
                                        <span className="block text-[12px] text-label-2 truncate">{customerLine(selectedCustomer)}</span>
                                    </div>
                                    {!customerLocked && (
                                        <button
                                            type="button"
                                            onClick={() => { setCustomerId(''); setTimeout(() => customerInput.current?.focus(), 0); }}
                                            className="flex-none text-[12.5px] font-bold text-accent hover:underline min-h-[30px] px-1"
                                        >
                                            Change
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="relative">
                                    <input
                                        ref={customerInput}
                                        id="pdcCustomer"
                                        type="text"
                                        autoFocus
                                        autoComplete="off"
                                        placeholder="Type the customer's name, contact or phone…"
                                        value={customerQuery}
                                        onChange={(e) => setCustomerQuery(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) chooseCustomer(matches[0]); } }}
                                        aria-label="Customer"
                                        aria-autocomplete="list"
                                        aria-controls="pdcCustomerMatches"
                                        className={FIELD}
                                    />
                                    {customerQuery.trim() && (
                                        <ul id="pdcCustomerMatches" role="listbox" aria-label="Matching customers" className="mt-1 rounded-lg border border-separator bg-card shadow-e1 divide-y divide-separator max-h-64 overflow-y-auto">
                                            {matches.length === 0 && (
                                                <li className="px-3 py-2.5 text-[13px] text-label-3">No customer matches “{customerQuery.trim()}”. Add them to the customer book first.</li>
                                            )}
                                            {matches.map(c => (
                                                <li key={c.id} role="none">
                                                    <button
                                                        type="button"
                                                        role="option"
                                                        aria-selected={false}
                                                        onClick={() => chooseCustomer(c)}
                                                        className="w-full text-left px-3 py-2 hover:bg-hover min-h-[40px]"
                                                    >
                                                        <span className="block text-[13.5px] font-bold text-label">{c.company}</span>
                                                        <span className="block text-[12px] text-label-3">{customerLine(c)}{c.contactNumber ? ` · ${c.contactNumber}` : ''}</span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="pdcNumber" className={LABEL}>Cheque number</label>
                                <input
                                    ref={numberInput}
                                    id="pdcNumber"
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="e.g. 004821"
                                    value={chequeNumber}
                                    onChange={(e) => setChequeNumber(e.target.value)}
                                    className={`${FIELD} font-mono`}
                                    required
                                />
                                {duplicate && (
                                    <p className="text-[12px] text-warn font-semibold mt-1" role="status">
                                        Already recorded: #{duplicate.chequeNumber} from {duplicate.bankName}, {formatINR(duplicate.amount)}, dated {new Date(duplicate.chequeDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}. Save anyway if it really is a second cheque.
                                    </p>
                                )}
                            </div>
                            <div>
                                <label htmlFor="pdcAmount" className={LABEL}>Amount (₹)</label>
                                <input
                                    id="pdcAmount"
                                    type="number"
                                    step="any"
                                    min="1"
                                    inputMode="decimal"
                                    placeholder="e.g. 50000"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                                    className={`${FIELD} num font-semibold`}
                                    required
                                />
                                {typeof amount === 'number' && amount > 0 && (
                                    <p className="num text-[12px] text-label-3 mt-1">{formatINR(amount)}</p>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="pdcBank" className={LABEL}>Bank</label>
                                <input
                                    id="pdcBank"
                                    type="text"
                                    list="pdcBankList"
                                    autoComplete="off"
                                    placeholder="Bank the cheque is drawn on"
                                    value={bankName}
                                    onChange={(e) => setBankName(e.target.value)}
                                    className={FIELD}
                                    required
                                />
                                <datalist id="pdcBankList">
                                    {bankSuggestions.map(b => <option key={b} value={b} />)}
                                </datalist>
                            </div>
                            <div>
                                <label htmlFor="pdcDate" className={LABEL}>Dated</label>
                                <input
                                    id="pdcDate"
                                    aria-label="Dated"
                                    type="date"
                                    value={chequeDate}
                                    onChange={(e) => setChequeDate(e.target.value)}
                                    className={FIELD}
                                    required
                                />
                                <p className={`text-[12px] mt-1 ${datePassed && status === PdcStatus.Pending ? 'text-dang font-semibold' : 'text-label-3'}`}>
                                    {datedText
                                        ? (datePassed && status === PdcStatus.Pending ? `${datedText} — it will show as “Date passed” until it is cleared` : datedText)
                                        : 'The date written on the cheque'}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <span className={LABEL} id="pdcStatusLabel">Where it stands</span>
                                <div className="grid grid-cols-4 rounded-xl bg-card-2 p-1 gap-1" role="radiogroup" aria-labelledby="pdcStatusLabel">
                                    {PDC_STATUS_CHOICES.map(o => (
                                        <button
                                            key={o.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={status === o.value}
                                            onClick={() => setStatus(o.value)}
                                            title={STATUS_HINT[o.value]}
                                            className={`h-8 rounded-lg text-[12px] font-bold whitespace-nowrap transition-colors max-md:h-10 ${
                                                status === o.value ? 'bg-accent text-on-accent shadow-e1' : 'text-label-2 hover:bg-hover hover:text-label'
                                            }`}
                                        >
                                            {o.value === PdcStatus.Pending ? 'Pending' : o.value === PdcStatus.Hold ? 'On hold' : o.value === PdcStatus.Cleared ? 'Cleared' : 'Bounced'}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[12px] text-label-3 mt-1">{STATUS_HINT[status]}</p>
                            </div>
                            <div>
                                <label htmlFor="pdcReceived" className={LABEL}>Received on</label>
                                <input
                                    id="pdcReceived"
                                    aria-label="Received on"
                                    type="date"
                                    value={receivedDate}
                                    onChange={(e) => setReceivedDate(e.target.value)}
                                    className={FIELD}
                                />
                                <p className="text-[12px] text-label-3 mt-1">The day the cheque came into our hands</p>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="pdcNote" className={LABEL}>Note <span className="normal-case font-semibold text-label-3">(optional)</span></label>
                            <input
                                id="pdcNote"
                                type="text"
                                placeholder="e.g. Against invoice 1042 · given by the director"
                                value={remarks}
                                onChange={(e) => setRemarks(e.target.value)}
                                className={FIELD}
                            />
                        </div>
                    </div>

                    <div className="flex-none px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2 bg-white dark:bg-gray-900 rounded-b-2xl max-md:px-4 max-md:pb-[max(1rem,env(safe-area-inset-bottom))] max-md:rounded-none max-md:[&>button]:flex-1 max-md:[&>button]:min-h-[44px]">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            className="h-9 px-4 rounded-full text-[13px] font-semibold bg-card border border-separator-strong text-label-2 hover:bg-hover hover:text-label disabled:opacity-40"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="h-9 px-5 rounded-full text-[13px] font-semibold bg-accent text-on-accent hover:bg-accent-press shadow-e1 disabled:opacity-40"
                        >
                            {saving ? 'Saving…' : chequeToEdit ? 'Save changes' : 'Record cheque'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PdcModal;
