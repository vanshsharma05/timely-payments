import { useState, useRef, useEffect, useId } from 'react';
import { cx } from './Primitives';

export interface RowMenuItem {
    label: string;
    /** One line under the label, when the label alone could be misread. */
    hint?: string;
    onSelect: () => void;
    tone?: 'default' | 'danger';
}

/**
 * The "…" beside a row: the things worth doing to it that are not the one
 * obvious next step. Opens on press, closes on a choice, Esc, or a click
 * anywhere else; the arrow keys walk the items.
 */
export const RowMenu = ({ items, label, className, size = 'sm' }: { items: RowMenuItem[]; label: string; className?: string; size?: 'sm' | 'lg' }) => {
    const [open, setOpen] = useState(false);
    /** Opens upward when there is no room below — inside a scrolling table, or at the foot of the screen. */
    const [up, setUp] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const id = useId();
    const toggle = () => {
        if (!open && root.current) {
            const r = root.current.getBoundingClientRect();
            let limit = window.innerHeight;
            for (let el = root.current.parentElement; el; el = el.parentElement) {
                const o = getComputedStyle(el).overflowY;
                if (o === 'auto' || o === 'scroll') { limit = Math.min(limit, el.getBoundingClientRect().bottom); break; }
            }
            setUp(r.bottom + 260 > limit && r.top > 260);
        }
        setOpen(o => !o);
    };

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); (root.current?.querySelector('button') as HTMLButtonElement | null)?.focus(); }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const options = [...(root.current?.querySelectorAll('[role="menuitem"]') ?? [])] as HTMLElement[];
                if (!options.length) return;
                e.preventDefault();
                const i = options.indexOf(document.activeElement as HTMLElement);
                const next = e.key === 'ArrowDown' ? (i + 1) % options.length : (i - 1 + options.length) % options.length;
                options[next].focus();
            }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey, true);
        // the first item takes focus so the keyboard can carry on
        setTimeout(() => (root.current?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus(), 0);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
    }, [open]);

    return (
        <div ref={root} className={cx('relative inline-block', className)}>
            <button
                type="button"
                onClick={toggle}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={id}
                aria-label={label}
                title={label}
                className={cx(
                    'grid place-items-center rounded-full text-label-3 hover:text-label hover:bg-hover transition-colors',
                    size === 'lg' ? 'w-11 h-11' : 'w-8 h-8',
                    open && 'bg-hover text-label',
                )}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
            </button>
            {open && (
                <div id={id} role="menu" className={cx('absolute right-0 z-40 w-max min-w-[220px] max-w-[300px] bg-card rounded-[14px] shadow-e3 border border-separator py-1.5 whitespace-normal text-left', up ? 'bottom-[calc(100%+4px)]' : 'top-[calc(100%+4px)]')}>
                    {items.map(item => (
                        <button
                            key={item.label}
                            type="button"
                            role="menuitem"
                            onClick={() => { setOpen(false); item.onSelect(); }}
                            className={cx(
                                'w-full flex flex-col items-start text-left px-3.5 py-2 hover:bg-hover transition-colors',
                                item.tone === 'danger' ? 'text-dang' : 'text-label',
                            )}
                        >
                            <span className="block text-[13.5px] font-semibold leading-tight">{item.label}</span>
                            {item.hint && <span className="block text-[12px] text-label-3 mt-0.5 leading-snug">{item.hint}</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default RowMenu;
