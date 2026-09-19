import { useState, useMemo } from 'react';
import { DialogShell } from './ui/DialogShell';
import { Button } from './ui/Primitives';
import { Outstanding, Template, User } from '../types';
import { recordWhatsAppOpened } from '../services/whatsappTrace';
import { WhatsAppIcon } from './icons/Icons';
import { renderTemplate } from '../services/messageTemplate';

interface WhatsAppReminderModalProps {
    customer: Outstanding;
    templates: Template[];
    onClose: () => void;
    /** Who is opening the reminder; the entry on the account is written in their name. */
    currentUser?: User | null;
}

export const WhatsAppReminderModal = ({ customer, templates, onClose, currentUser }: WhatsAppReminderModalProps) => {
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
        <DialogShell
            title="WhatsApp reminder"
            subtitle={customer.company}
            icon={<WhatsAppIcon className="w-5 h-5" />}
            size="md"
            onClose={onClose}
            footer={<>
                <Button type="button" variant="quiet" onClick={onClose}>Close</Button>
                <a
                    href={`https://wa.me/${cleanWhatsAppNumber}?text=${whatsAppMessage}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                        recordWhatsAppOpened(customer, { name: activeRecipient.name, number: cleanWhatsAppNumber }, templates.find(t => t.id === selectedTemplateId)?.name, currentUser);
                        onClose();
                    }}
                    className={`inline-flex items-center justify-center gap-2 h-10 px-4.5 rounded-full font-semibold text-[14px] transition-all whitespace-nowrap ${
                        cleanWhatsAppNumber
                            ? 'bg-green-600 hover:bg-green-700 text-white shadow-e1'
                            : 'bg-card-3 text-label-3 pointer-events-none'
                    }`}
                >
                    <WhatsAppIcon className="w-4 h-4" />
                    <span>Open WhatsApp to {activeRecipient.name} ({cleanWhatsAppNumber || 'Enter Number'})</span>
                </a>
            </>}
        >
                <div className="space-y-4 text-xs">
                    {/* Recipient Selection */}
                    <div>
                        <label className="block text-[12.5px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1.5">
                            Select Recipient / Mobile Number:
                        </label>
                        <div className="space-y-1.5">
                            {/* Primary Contact */}
                            <label className={`flex items-center justify-between p-2.5 max-md:min-h-[52px] rounded-lg border cursor-pointer transition-all ${
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
                                        className="w-5 h-5 text-green-600 dark:text-green-400 focus:ring-accent"
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
                                            className="w-5 h-5 text-green-600 dark:text-green-400 focus:ring-accent"
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
                            <label className={`flex items-center justify-between p-2.5 max-md:min-h-[52px] rounded-lg border cursor-pointer transition-all ${
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
                                        className="w-5 h-5 text-green-600 dark:text-green-400 focus:ring-accent"
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
                            className="w-full border rounded-lg shadow-xs bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 max-md:h-11 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-accent"
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

        </DialogShell>
    );
};

export default WhatsAppReminderModal;
