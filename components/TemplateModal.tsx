import React, { useState, useEffect } from 'react';
import { Template } from '../types';

interface TemplateModalProps {
    templateToEdit: Template | null;
    onSave: (template: Omit<Template, 'id'> & { id?: string }) => void;
    onClose: () => void;
}

const PLACEHOLDERS = [
    '{{companyName}}', '{{contactPerson}}', '{{contactNumber}}', '{{totalDue}}',
    '{{ageing1_45}}', '{{ageing46_90}}', '{{ageing91_135}}', '{{ageingOver135}}'
];

const TemplateModal = ({ templateToEdit, onSave, onClose }: TemplateModalProps) => {
    const [name, setName] = useState('');
    const [content, setContent] = useState('');

    useEffect(() => {
        if (templateToEdit) {
            setName(templateToEdit.name);
            setContent(templateToEdit.content);
        } else {
            setName('');
            setContent('');
        }
    }, [templateToEdit]);

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
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    rows={10}
                                    className="mt-1 block w-full border rounded-md shadow-sm bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2 focus:ring-accent focus:border-green-500 font-mono text-sm"
                                    required
                                />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Available Placeholders:</p>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {PLACEHOLDERS.map(p => (
                                        <code key={p} className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1">{p}</code>
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