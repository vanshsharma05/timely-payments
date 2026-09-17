import React, { useState } from 'react';
import { cx } from './Primitives';

export interface DisclosureProps {
    title: string;
    /** What is inside, in a few words, so a closed section still answers the question. */
    summary?: React.ReactNode;
    defaultOpen?: boolean;
    icon?: React.ReactNode;
    /** Something to do without opening: "Add", "Send". */
    action?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}

/**
 * A section that is one line until it is needed.
 *
 * The follow-up dialog used to be one long scroll: contacts, the WhatsApp
 * picker, cheques and account settings all open at once above the one thing
 * a call ends with — the outcome and the next date. Everything secondary now
 * folds to its summary line, and a person who needs it opens it.
 */
export const Disclosure = ({ title, summary, defaultOpen = false, icon, action, className, children }: DisclosureProps) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className={cx('rounded-xl border border-separator bg-card', className)}>
            <div className="flex items-center gap-3 px-4 min-h-[48px]">
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    aria-expanded={open}
                    className="flex-1 min-w-0 flex items-center gap-2.5 py-3 text-left"
                >
                    <span className={cx('flex-none text-label-3 transition-transform', open && 'rotate-90')} aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 2.5 7.5 6 4 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    {icon && <span className="flex-none text-label-2" aria-hidden="true">{icon}</span>}
                    <span className="text-[13.5px] font-bold text-label">{title}</span>
                    {summary && !open && <>{' '}<span className="text-[12.5px] text-label-3 truncate">{summary}</span></>}
                </button>
                {action && <div className="flex-none">{action}</div>}
            </div>
            {open && <div className="px-4 pb-4 border-t border-separator pt-4">{children}</div>}
        </section>
    );
};

export default Disclosure;
