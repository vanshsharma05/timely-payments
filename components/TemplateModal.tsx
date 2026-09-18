import React, { useState, useEffect, useRef } from 'react';
import { Template } from '../types';
import { DialogShell } from './ui/DialogShell';
import { Button } from './ui/Primitives';
import { FIELD, LABEL } from './ui/fields';

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
        <DialogShell
            title={templateToEdit ? 'Edit template' : 'New template'}
            subtitle="The wording offered when someone opens a WhatsApp reminder. Placeholders fill in from the account."
            onClose={onClose}
            onSubmit={handleSubmit}
            footer={<>
                <Button type="button" variant="quiet" onClick={onClose}>Cancel</Button>
                <Button type="submit" variant="primary">Save template</Button>
            </>}
        >
            <div className="space-y-4">
                <div>
                    <label htmlFor="templateName" className={LABEL}>Template name</label>
                    <input aria-label="Template name"
                        id="templateName"
                        data-autofocus
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={FIELD}
                        required
                    />
                </div>
                <div>
                    <label htmlFor="templateContent" className={LABEL}>Message</label>
                    <textarea
                        id="templateContent"
                        ref={contentRef}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={10}
                        className={`${FIELD} h-auto py-2 leading-relaxed`}
                        required
                    />
                </div>
                <div>
                    <p className="text-[12.5px] font-semibold text-label-2">
                        Placeholders <span className="font-normal text-label-3">— press one to drop it in where the cursor is</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {PLACEHOLDERS.map(p => (
                            <button
                                key={p.token}
                                type="button"
                                onClick={() => insertPlaceholder(p.token)}
                                title={p.label}
                                className="font-mono text-[12px] bg-card-3 text-label rounded-full px-2.5 h-7 hover:bg-hover transition-colors"
                            >
                                {p.token}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </DialogShell>
    );
};

export default TemplateModal;