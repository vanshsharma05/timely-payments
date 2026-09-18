import { Template } from '../types';
import { Button, Card, EmptyState, SectionHeader } from './ui/Primitives';
import { EditIcon, TrashIcon } from './icons/Icons';

interface TemplatesViewProps {
    templates: Template[];
    onAdd: () => void;
    onEdit: (template: Template) => void;
    onRemove: (templateId: string) => void;
}

/** The first line of the wording, so a template can be told from its neighbour without opening it. */
const firstLine = (content: string) => {
    const line = content.split(/\r?\n/).map(l => l.trim()).find(Boolean) || '';
    return line.length > 110 ? `${line.slice(0, 110)}…` : line;
};

/**
 * Message templates: the wording offered when a WhatsApp reminder is opened.
 *
 * One card in the book's chrome, each template a row that opens on its
 * name, with delete shown on hover the way the book's is.
 */
export const TemplatesView = ({ templates, onAdd, onEdit, onRemove }: TemplatesViewProps) => (
    <Card className="overflow-hidden">
        <div className="px-5 py-4 max-md:px-4 border-b border-separator">
            <SectionHeader
                title="WhatsApp reminders"
                subtitle="The wording offered when a reminder is opened. Placeholders fill in from the account."
                actions={
                    <Button size="sm" variant="primary" onClick={onAdd} className="max-md:min-h-[44px]">
                        New template
                    </Button>
                }
            />
        </div>
        {templates.length === 0 ? (
            <EmptyState
                title="No templates yet"
                hint="A template is the wording offered when someone opens a WhatsApp reminder. Add one and the team can pick it."
                action={<Button size="sm" variant="primary" onClick={onAdd}>New template</Button>}
            />
        ) : (
            <ul className="divide-y divide-separator">
                {templates.map(template => (
                    <li key={template.id} className="group flex items-center gap-3 px-5 py-3 max-md:px-4 hover:bg-hover transition-colors">
                        <button
                            type="button"
                            onClick={() => onEdit(template)}
                            className="flex-1 min-w-0 text-left py-0.5"
                            title="Open this template"
                        >
                            <span className="block font-bold text-label text-[13.5px] truncate">{template.name}</span>
                            <span className="block text-[12.5px] text-label-3 truncate mt-0.5">{firstLine(template.content) || 'No wording yet'}</span>
                        </button>
                        <div className="flex items-center gap-1 flex-none">
                            <Button size="sm" variant="quiet" onClick={() => onEdit(template)} icon={<EditIcon className="w-3.5 h-3.5" />} className="max-md:hidden" aria-label={`Edit template ${template.name}`}>
                                Edit
                            </Button>
                            <button
                                type="button"
                                onClick={() => onRemove(template.id)}
                                className="w-8 h-8 max-md:w-11 max-md:h-11 grid place-items-center text-label-3 hover:text-dang hover:bg-dang-bg rounded-full transition-colors md:opacity-0 group-hover:opacity-100 focus:opacity-100 group-focus-within:opacity-100"
                                aria-label={`Delete template ${template.name}`}
                                title="Delete this template"
                            >
                                <TrashIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        )}
    </Card>
);

export default TemplatesView;
