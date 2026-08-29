import React, { useState, useEffect } from 'react';
import { Outstanding, PdcCheque, PdcStatus, PDC_STATUS_CHOICES, User } from '../types';
import { ChequeIcon } from './icons/Icons';

interface PdcModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (chequeData: Omit<PdcCheque, 'id'> & { id?: string }) => void;
    chequeToEdit?: PdcCheque | null;
    preselectedCustomerId?: string;
    customers: Outstanding[];
    currentUser: User | null;
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
    'Other Bank'
];

const PdcModal: React.FC<PdcModalProps> = ({
    isOpen,
    onClose,
    onSave,
    chequeToEdit,
    preselectedCustomerId,
    customers,
    currentUser,
}) => {
    const [customerId, setCustomerId] = useState('');
    const [chequeNumber, setChequeNumber] = useState('');
    const [bankName, setBankName] = useState('HDFC Bank');
    const [customBankName, setCustomBankName] = useState('');
    const [chequeDate, setChequeDate] = useState('');
    const [amount, setAmount] = useState<number | ''>('');
    const [status, setStatus] = useState<PdcStatus>(PdcStatus.Pending);
    const [receivedDate, setReceivedDate] = useState(new Date().toISOString().split('T')[0]);
    const [remarks, setRemarks] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (chequeToEdit) {
            setCustomerId(chequeToEdit.customerId);
            setChequeNumber(chequeToEdit.chequeNumber);
            if (COMMON_BANKS.includes(chequeToEdit.bankName)) {
                setBankName(chequeToEdit.bankName);
                setCustomBankName('');
            } else {
                setBankName('Other Bank');
                setCustomBankName(chequeToEdit.bankName);
            }
            const cDate = chequeToEdit.chequeDate instanceof Date 
                ? chequeToEdit.chequeDate 
                : new Date(chequeToEdit.chequeDate);
            setChequeDate(cDate.toISOString().split('T')[0]);
            setAmount(chequeToEdit.amount);
            setStatus(chequeToEdit.status);
            const rDate = chequeToEdit.receivedDate instanceof Date
                ? chequeToEdit.receivedDate
                : new Date(chequeToEdit.receivedDate);
            setReceivedDate(rDate.toISOString().split('T')[0]);
            setRemarks(chequeToEdit.remarks || '');
        } else {
            // New PDC Cheque
            if (preselectedCustomerId) {
                setCustomerId(preselectedCustomerId);
            } else if (customers.length > 0) {
                setCustomerId(customers[0].id);
            }
            setChequeNumber('');
            setBankName('HDFC Bank');
            setCustomBankName('');
            // Default cheque date to 15 days ahead as a typical PDC
            const defaultPdcDate = new Date();
            defaultPdcDate.setDate(defaultPdcDate.getDate() + 15);
            setChequeDate(defaultPdcDate.toISOString().split('T')[0]);
            setAmount('');
            setStatus(PdcStatus.Pending);
            setReceivedDate(new Date().toISOString().split('T')[0]);
            setRemarks('');
        }
        setError(null);
    }, [chequeToEdit, preselectedCustomerId, customers, isOpen]);

    if (!isOpen) return null;

    const selectedCustomer = customers.find(c => c.id === customerId);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!customerId) {
            setError('Please select a customer.');
            return;
        }

        if (!chequeNumber.trim()) {
            setError('Please enter the 6-digit cheque number.');
            return;
        }

        const finalBank = bankName === 'Other Bank' ? customBankName.trim() : bankName;
        if (!finalBank) {
            setError('Please provide a bank name.');
            return;
        }

        if (!chequeDate) {
            setError('Please select the Cheque / PDC date.');
            return;
        }

        const numAmount = typeof amount === 'number' ? amount : parseFloat(String(amount));
        if (isNaN(numAmount) || numAmount <= 0) {
            setError('Please enter a valid positive amount.');
            return;
        }

        const finalCustomerName = selectedCustomer ? selectedCustomer.company : 'Unknown Customer';
        const finalCrmOwnerId = selectedCustomer ? selectedCustomer.crmOwnerId : (currentUser?.id || '');

        onSave({
            id: chequeToEdit?.id,
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
            addedBy: currentUser?.name || 'System'
        });

        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-xl w-full border border-gray-100 dark:border-gray-700 overflow-hidden transform transition-all">
                {/* Modal Header */}
                <div className="px-6 py-5 bg-accent text-on-accent flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <div className="p-2 bg-white/10 rounded-xl">
                            <ChequeIcon className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">
                                {chequeToEdit ? 'Edit Post Dated Cheque (PDC)' : 'Add Post Dated Cheque (PDC)'}
                            </h3>
                            <p className="text-xs text-emerald-100">
                                Record customer cheque details for bank presentation tracking
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                     aria-label="Close">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Modal Body */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg text-sm flex items-center space-x-2">
                            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Customer Selection */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 uppercase tracking-wider">
                            Customer Account *
                        </label>
                        <select aria-label="Customer Account"
                            value={customerId}
                            onChange={(e) => setCustomerId(e.target.value)}
                            disabled={!!preselectedCustomerId && !chequeToEdit}
                            className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                            required
                        >
                            <option value="" disabled>Select Customer</option>
                            {customers.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.company} (Total O/S: ₹{c.total.toLocaleString('en-IN')})
                                </option>
                            ))}
                        </select>
                        {selectedCustomer && (
                            <div className="mt-1.5 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/30 p-2 rounded-lg">
                                <span>Contact: {selectedCustomer.contactPerson || 'N/A'} ({selectedCustomer.contactNumber || 'N/A'})</span>
                                <span className="font-semibold text-gray-700 dark:text-gray-200">
                                    Total O/S: ₹{selectedCustomer.total.toLocaleString('en-IN')}
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Cheque Number */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 uppercase tracking-wider">
                                Cheque No. *
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. 004821"
                                value={chequeNumber}
                                onChange={(e) => setChequeNumber(e.target.value)}
                                className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-mono focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                                required
                            />
                        </div>

                        {/* Amount */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 uppercase tracking-wider">
                                Cheque Amount (₹) *
                            </label>
                            <input
                                type="number"
                                step="any"
                                min="1"
                                placeholder="e.g. 50000"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                                className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-semibold text-emerald-600 dark:text-emerald-400 focus:ring-2 focus:ring-accent focus:outline-none"
                                required
                            />
                        </div>
                    </div>

                    {/* Bank Selection */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 uppercase tracking-wider">
                                Bank Name *
                            </label>
                            <select aria-label="Bank Name"
                                value={bankName}
                                onChange={(e) => setBankName(e.target.value)}
                                className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                            >
                                {COMMON_BANKS.map((b) => (
                                    <option key={b} value={b}>{b}</option>
                                ))}
                            </select>
                        </div>
                        {bankName === 'Other Bank' ? (
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 uppercase tracking-wider">
                                    Specify Bank Name *
                                </label>
                                <input
                                    type="text"
                                    placeholder="Enter bank name"
                                    value={customBankName}
                                    onChange={(e) => setCustomBankName(e.target.value)}
                                    className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                                    required
                                />
                            </div>
                        ) : (
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 uppercase tracking-wider">
                                    Cheque Date (PDC Date) *
                                </label>
                                <input aria-label="Cheque Date (PDC Date)"
                                    type="date"
                                    value={chequeDate}
                                    onChange={(e) => setChequeDate(e.target.value)}
                                    className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                                    required
                                />
                            </div>
                        )}
                    </div>

                    {bankName === 'Other Bank' && (
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 uppercase tracking-wider">
                                Cheque Date (PDC Date) *
                            </label>
                            <input aria-label="Cheque Date (PDC Date)"
                                type="date"
                                value={chequeDate}
                                onChange={(e) => setChequeDate(e.target.value)}
                                className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                                required
                            />
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Status */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 uppercase tracking-wider">
                                Cheque Status *
                            </label>
                            <select aria-label="Cheque Status"
                                value={status}
                                onChange={(e) => setStatus(e.target.value as PdcStatus)}
                                className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                            >
                                {/* No "due today" here on purpose: whether a cheque is due
                                    is decided by its date, every morning. Storing it as a
                                    status froze it, so a cheque entered as due today was
                                    still claiming it a week later. */}
                                {PDC_STATUS_CHOICES.map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Received Date */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 uppercase tracking-wider">
                                Cheque Received Date
                            </label>
                            <input aria-label="Cheque Received Date"
                                type="date"
                                value={receivedDate}
                                onChange={(e) => setReceivedDate(e.target.value)}
                                className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                            />
                        </div>
                    </div>

                    {/* Remarks */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 uppercase tracking-wider">
                            Remarks / Notes (Optional)
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. Given by director against Invoice #1042, promised clear on 25th"
                            value={remarks}
                            onChange={(e) => setRemarks(e.target.value)}
                            className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-accent focus:outline-none dark:text-white"
                        />
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-4 flex items-center justify-end space-x-3 border-t border-gray-100 dark:border-gray-700">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                         aria-label="Close">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold shadow-md shadow-emerald-600/20 transition-colors flex items-center space-x-2"
                        >
                            <span>{chequeToEdit ? 'Save Changes' : 'Add PDC Cheque'}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PdcModal;
