import { useState, useMemo } from 'react';
import { Outstanding, Template } from '../types';
import { WhatsAppIcon } from './icons/Icons';
import { renderTemplate } from '../services/messageTemplate';

interface WhatsAppReminderModalProps {
    customer: Outstanding;
    templates: Template[];
    onClose: () => void;
}

export const WhatsAppReminderModal = ({ customer, templates, onClose }: WhatsAppReminderModalProps) => {
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id || '');
    const [recipientType, setRecipientType] = useState<'primary' | string>('primary');
    const [customRecipientNumber, setCustomRecipientNumber] = useState('');
    const [customRecipientName, setCustomRecipientName] = useState('');

    const additionalContacts = customer.additionalContacts || [];

    const activeRecipient = useMemo(() => {
        if (recipientType === 'primary') {
            return {
                name: customer.contactPerson || 'Customer',
                number: customer.contactNumber,
                post: customer.contactPost || 'Primary Contact'
            };
        }
        if (recipientType === 'custom') {
            return {
                name: customRecipientName.trim() || 'Accounts Team',
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
    }, [recipientType, customRecipientName, customRecipientNumber, additionalContacts, customer]);

    const whatsAppMessage = useMemo(() => {
        const template = templates.find(t => t.id === selectedTemplateId);
        if (!template) return '';

        return encodeURIComponent(renderTemplate(template.content, customer, activeRecipient));
    }, [customer, selectedTemplateId, templates, activeRecipient]);

    const cleanWhatsAppNumber = useMemo(() => {
        const raw = activeRecipient.number || '';
        const digits = raw.replace(/\D/g, '');
        if (!digits) return '';
        if (digits.length === 10) return `91${digits}`;
        return digits;
    }, [activeRecipient.number]);

    const decodedPreviewMessage = useMemo(() => {
        try {
            return decodeURIComponent(whatsAppMessage);
        } catch {
            return '';
        }
    }, [whatsAppMessage]);

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex justify-center items-center p-3 sm:p-4 overflow-y-auto backdrop-blur-xs">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col border border-gray-200 dark:border-gray-800 my-auto animate-in fade-in zoom-in-95 duration-150">
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-green-50/50 dark:bg-green-950/20 rounded-t-2xl">
                    <div className="flex items-center gap-2">
                        <WhatsAppIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
                        <div>
                            <h3 className="font-bold text-gray-900 dark:text-white text-base leading-tight">
                                Send WhatsApp Reminder
                            </h3>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {customer.company}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl font-bold p-1 leading-none rounded-lg"
                     aria-label="Close">
                        &times;
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4 text-xs">
                    {/* Recipient Selection */}
                    <div>
                        <label className="block text-[12.5px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1.5">
                            Select Recipient / Mobile Number:
                        </label>
                        <div className="space-y-1.5">
                            {/* Primary Contact */}
                            <label className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                                recipientType === 'primary' 
                                    ? 'bg-green-50 dark:bg-green-950/40 border-green-500 font-bold text-green-950 dark:text-green-100 shadow-2xs' 
                                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50'
                            }`}>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="waRecipient"
                                        checked={recipientType === 'primary'}
                                        onChange={() => setRecipientType('primary')}
                                        className="text-green-600 dark:text-green-400 focus:ring-green-500"
                                    />
                                    <div>
                                        <div>{customer.contactPerson || 'Primary Contact'} <span className="font-normal text-gray-500">({customer.contactPost || 'Primary'})</span></div>
                                        <div className="text-[12.5px] text-gray-500 font-medium">{customer.contactNumber || 'No number'}</div>
                                    </div>
                                </div>
                                <span className="px-1.5 py-0.5 rounded text-[11.5px] bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-semibold">Primary</span>
                            </label>

                            {/* Additional Contacts */}
                            {additionalContacts.map(c => (
                                <label key={c.id} className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                                    recipientType === c.id 
                                        ? 'bg-green-50 dark:bg-green-950/40 border-green-500 font-bold text-green-950 dark:text-green-100 shadow-2xs' 
                                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50'
                                }`}>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="waRecipient"
                                            checked={recipientType === c.id}
                                            onChange={() => setRecipientType(c.id)}
                                            className="text-green-600 dark:text-green-400 focus:ring-green-500"
                                        />
                                        <div>
                                            <div>{c.name} <span className="font-normal text-gray-500">({c.post || 'Company Contact'})</span></div>
                                            <div className="text-[12.5px] text-gray-500 font-medium">{c.mobile}</div>
                                        </div>
                                    </div>
                                    <span className="px-1.5 py-0.5 rounded text-[11.5px] bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 font-semibold">{c.post || 'Contact'}</span>
                                </label>
                            ))}

                            {/* Custom / Other Number */}
                            <label className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                                recipientType === 'custom' 
                                    ? 'bg-green-50 dark:bg-green-950/40 border-green-500 font-bold text-green-950 dark:text-green-100 shadow-2xs' 
                                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50'
                            }`}>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="waRecipient"
                                        checked={recipientType === 'custom'}
                                        onChange={() => setRecipientType('custom')}
                                        className="text-green-600 dark:text-green-400 focus:ring-green-500"
                                    />
                                    <div>
                                        <div>Send to Other Number</div>
                                        <div className="text-[12.5px] text-gray-500 font-normal">Specify another person in same company</div>
                                    </div>
                                </div>
                            </label>
                        </div>

                        {recipientType === 'custom' && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 p-2.5 bg-gray-50 dark:bg-gray-800 rounded-lg border border-green-300 dark:border-green-700">
                                <div>
                                    <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 mb-0.5">Person Name (Optional)</label>
                                    <input
                                        type="text"
                                        value={customRecipientName}
                                        onChange={e => setCustomRecipientName(e.target.value)}
                                        placeholder="e.g. Accounts Incharge"
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 mb-0.5">Mobile Number *</label>
                                    <input
                                        type="tel"
                                        value={customRecipientNumber}
                                        onChange={e => setCustomRecipientNumber(e.target.value)}
                                        placeholder="10-digit mobile number"
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-bold"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Template Picker */}
                    <div>
                        <label className="block text-[12.5px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1">
                            Message Template:
                        </label>
                        <select aria-label="Message Template"
                            value={selectedTemplateId}
                            onChange={e => setSelectedTemplateId(e.target.value)}
                            className="w-full border rounded-lg shadow-xs bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-green-500"
                        >
                            {templates.map(template => (
                                <option key={template.id} value={template.id}>{template.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Message Preview */}
                    <div>
                        <label className="block text-[12.5px] font-bold text-gray-500 dark:text-gray-400 mb-1">
                            Message Preview:
                        </label>
                        {/* Tall enough to read a whole reminder without scrolling
                            it a few lines at a time. */}
                        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-[12.5px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
                            {decodedPreviewMessage}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-3.5 bg-gray-50 dark:bg-gray-800/80 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2 rounded-b-2xl">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs hover:bg-gray-300 transition-colors"
                     aria-label="Close">
                        Close
                    </button>
                    <a
                        href={`https://wa.me/${cleanWhatsAppNumber}?text=${whatsAppMessage}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onClose}
                        className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-lg font-bold text-xs transition-all shadow-sm ${
                            cleanWhatsAppNumber
                                ? 'bg-green-600 hover:bg-green-700 text-white'
                                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 pointer-events-none'
                        }`}
                    >
                        <WhatsAppIcon className="w-4 h-4" />
                        <span>Send WhatsApp to {activeRecipient.name} ({cleanWhatsAppNumber || 'Enter Number'})</span>
                    </a>
                </div>
            </div>
        </div>
    );
};

export default WhatsAppReminderModal;
