import React, { useState, useEffect, useRef } from 'react';
import { Template } from '../types';

interface TemplateModalProps {
    templateToEdit: Template | null;
    onSave: (template: Omit<Template, 'id'> & { id?: string }) => void;
    onClose: () => void;
}

/**
 * Every field a reminder can carry, with what it means in the sheet's own words.
 *
 * The two roll-ups at the end are the ones the escalation templates are written
 * around. ">90 days" in particular was missing here, so a follow-up template had
 * to print 91-135 and >135 as separate lines and leave the customer to add them
 * up — the one figure the collections call is actually about.
 */
const PLACEHOLDERS: { token: string; label: string }[] = [
    { token: '{{companyName}}', label: 'Customer / party name' },
    { token: '{{contactPerson}}', label: 'Name of the person being written to' },
    { token: '{{contactNumber}}', label: 'Their mobile number' },
    { token: '{{totalDue}}', label: 'Total outstanding balance' },
    { token: '{{ageing1_45}}', label: 'Ageing bucket: 1-45 days' },
    { token: '{{ageing46_90}}', label: 'Ageing bucket: 46-90 days' },
    { token: '{{ageing91_135}}', label: 'Ageing bucket: 91-135 days' },
    { token: '{{ageingOver135}}', label: 'Ageing bucket: over 135 days' },
    { token: '{{totalOver90}}', label: 'Total >90d overdue — 91-135 plus >135, added up' },
    { token: '{{dueOver45}}', label: 'Total overdue past 45 days — 46-90, 91-135 and >135' },
];

const TemplateModal = ({ templateToEdit, onSave, onClose }: TemplateModalProps) => {
    const [name, setName] = useState('');
    const [content, setContent] = useState('');
    const contentRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (templateToEdit) {
            setName(templateToEdit.name);
            setContent(templateToEdit.content);
        } else {
            setName('');
            setContent('');
        }
    }, [templateToEdit]);

    /**
     * Drops the field in where the caret is, rather than making somebody copy
     * the exact braces by hand — a template that misspells a placeholder sends
     * the literal "{{totalOver90}}" to the customer.
     */
    const insertPlaceholder = (token: string) => {
        const box = contentRef.current;
        if (!box) {
            setContent(prev => prev + token);
            return;
        }
        const start = box.selectionStart ?? content.length;
        const end = box.selectionEnd ?? content.length;
        const next = content.slice(0, start) + token + content.slice(end);
        setContent(next);
        // Put the caret after what was just inserted, once React has repainted.
        requestAnimationFrame(() => {
            box.focus();
            box.setSelectionRange(start + token.length, start + token.length);
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !content) {
            alert('Name and content cannot be empty.');
            return;
        }
        onSave({
            id: templateToEdit?.id,
            name,
            content,
        });
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex justify-center items-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                                {templateToEdit ? 'Edit Template' : 'Add New Template'}
                            </h2>
                            <button type="button" onClick={onClose} className="w-9 h-9 grid place-items-center rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-hover text-2xl leading-none" aria-label="Close">&times;</button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="templateName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Template Name</label>
                                <input aria-label="Template Name"
                                    id="templateName"
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="mt-1 block w-full border rounded-md shadow-sm bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 focus:ring-accent focus:border-green-500"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="templateContent" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Template Content</label>
                                <textarea
                                    id="templateContent"
                                    ref={contentRef}
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    rows={10}
                                    className="mt-1 block w-full border rounded-md shadow-sm bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 focus:ring-accent focus:border-green-500 font-mono text-sm"
                                    required
                                />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Available Placeholders: <span className="font-normal text-gray-500 dark:text-gray-400">click one to drop it in where the cursor is</span>
                                </p>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {PLACEHOLDERS.map(p => (
                                        <button
                                            key={p.token}
                                            type="button"
                                            onClick={() => insertPlaceholder(p.token)}
                                            title={p.label}
                                            className="font-mono text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                                        >
                                            {p.token}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800 px-6 py-3 flex justify-end space-x-3">
                        <button onClick={onClose} type="button" className="px-4 py-2 text-sm font-medium rounded-md bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600" aria-label="Close">Cancel</button>
                        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-700">Save Template</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TemplateModal;