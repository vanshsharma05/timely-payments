import { useState } from 'react';
import { Template } from '../types';
import type { Question } from './useDataSource';

interface TemplatesInputs {
    templates: Template[];
    setTemplates: React.Dispatch<React.SetStateAction<Template[]>>;
    ask: (q: Question) => void;
}

/**
 * Message templates: the dialog (a template to edit, or none for a new
 * one), saving, and deleting after the question is answered in the app.
 * The list stays in App, where the sync reads it.
 */
export function useTemplates({ templates, setTemplates, ask }: TemplatesInputs) {
    const [templateDialog, setTemplateDialog] = useState<{ template: Template | null } | null>(null);

    const handleOpenTemplateModal = (template: Template | null) => {
        setTemplateDialog({ template });
    };

    const handleCloseTemplateModal = () => {
        setTemplateDialog(null);
    };

    const handleSaveTemplate = (templateToSave: Omit<Template, 'id'> & { id?: string }) => {
        setTemplates(currentTemplates => {
            if (templateToSave.id) {
                return currentTemplates.map(t => t.id === templateToSave.id ? { ...t, name: templateToSave.name, content: templateToSave.content } : t);
            } else {
                const newTemplate: Template = {
                    ...templateToSave,
                    id: `template_${Date.now()}`,
                };
                return [...currentTemplates, newTemplate];
            }
        });
        handleCloseTemplateModal();
    };

    const handleDeleteTemplate = (templateId: string) => {
        if (templates.length <= 1) {
            alert("You cannot delete the last template.");
            return;
        }
        const t = templates.find(x => x.id === templateId);
        ask({
            title: 'Delete this template?',
            confirmLabel: 'Delete template',
            body: <>
                <p><strong className="text-label">{t?.name || 'This template'}</strong> will no longer be offered when a WhatsApp reminder is opened. Reminders already sent are not affected. This cannot be undone.</p>
            </>,
            run: () => setTemplates(currentTemplates => currentTemplates.filter(x => x.id !== templateId)),
        });
    };

    return { templateDialog, handleOpenTemplateModal, handleCloseTemplateModal, handleSaveTemplate, handleDeleteTemplate };
}
