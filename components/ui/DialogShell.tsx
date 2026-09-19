import React, { useId } from 'react';
import { cx } from './Primitives';
import { useModal } from './useModal';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'wide';

const SIZE: Record<DialogSize, string> = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    wide: 'max-w-2xl lg:max-w-6xl',
};

export interface DialogShellProps {
    title: React.ReactNode;
    /** One line under the title: what the dialog is for, or whose record it is. */
    subtitle?: React.ReactNode;
    icon?: React.ReactNode;
    /** Controls beside the close button: a position counter, a tab strip. */
    headerExtra?: React.ReactNode;
    /** A row under the header, full width: a phone tab strip, a stat band. */
    subheader?: React.ReactNode;
    size?: DialogSize;
    role?: 'dialog' | 'alertdialog';
    /** The footer's buttons, on the right; on a phone they share the width. */
    footer?: React.ReactNode;
    /** Something to say on the footer's left: a note, a count. */
    footerNote?: React.ReactNode;
    onClose: () => void;
    /** Esc closes unless a save is in flight or the dialog keeps its own keys. */
    closeOnEscape?: boolean;
    /** When set, the body and footer sit inside a form and the footer's submit button submits it. */
    onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
    /** Body padding off, for a dialog that lays out its own bands (a review table, a two-column form). */
    flush?: boolean;
    /** Extra classes for the body. */
    bodyClassName?: string;
    /** false when the body lays out its own scrolling panes (the follow-up dialog's two columns). */
    scroll?: boolean;
    /** A higher layer, for a question asked on top of another dialog. */
    z?: 50 | 60;
    children: React.ReactNode;
}

/**
 * The one shell every dialog is built on.
 *
 * Twelve dialogs had twelve copies of the same overlay, panel, header and
 * footer, each drifting a little: three header colours, four cancel-button
 * shapes, paddings from 4 to 6. This is the shape all of them share now —
 * the overlay, a panel that is a full-screen sheet on a phone, a header with
 * the title (which labels the dialog for assistive tech), one line under
 * it, the close button, a scrolling body and a footer whose buttons share
 * the width on a phone — with useModal for the keyboard.
 */
export const DialogShell = ({
    title,
    subtitle,
    icon,
    headerExtra,
    subheader,
    size = 'lg',
    role = 'dialog',
    footer,
    footerNote,
    onClose,
    closeOnEscape = true,
    onSubmit,
    flush = false,
    bodyClassName,
    scroll = true,
    z = 50,
    children,
}: DialogShellProps) => {
    const panel = useModal(true, onClose, { closeOnEscape });
    const titleId = useId();
    /* A form fills a phone's screen; a one-paragraph question stays a small card, with its answers beside the words. */
    const sheet = size !== 'sm';
    const Inner: any = onSubmit ? 'form' : 'div';
    return (
        <div className={cx('fixed inset-0 bg-black/60 backdrop-blur-xs flex justify-center items-center p-3 sm:p-4 overflow-y-auto', sheet && 'max-md:p-0 max-md:items-start', z === 60 ? 'z-[60]' : 'z-50')}>
            <div
                ref={panel}
                role={role}
                aria-modal="true"
                aria-labelledby={titleId}
                className={cx(
                    'bg-card rounded-2xl shadow-2xl w-full max-h-[92vh] flex flex-col border border-separator my-auto animate-in fade-in zoom-in-95 duration-150',
                    sheet && 'max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:my-0',
                    SIZE[size],
                )}
            >
                <div className={cx('flex-none px-6 py-4 border-b border-separator bg-card-2 rounded-t-2xl flex justify-between items-start gap-3 max-md:px-4 max-md:py-3', sheet && 'max-md:rounded-none')}>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                            {icon && <span className="flex-none text-pos" aria-hidden="true">{icon}</span>}
                            <h2 id={titleId} className="text-[18px] font-bold text-label leading-tight truncate">{title}</h2>
                        </div>
                        {subtitle && <div className="text-[12.5px] text-label-3 mt-1 leading-snug">{subtitle}</div>}
                    </div>
                    <div className="flex items-center gap-1 flex-none">
                        {headerExtra}
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-9 h-9 max-md:w-11 max-md:h-11 grid place-items-center rounded-full text-label-3 hover:text-label hover:bg-hover text-2xl font-bold leading-none transition-colors"
                            title="Close (Esc)"
                            aria-label="Close"
                        >
                            &times;
                        </button>
                    </div>
                </div>
                {subheader && <div className="flex-none border-b border-separator">{subheader}</div>}
                <Inner className="flex-1 min-h-0 flex flex-col" onSubmit={onSubmit}>
                    <div className={cx('flex-1 min-h-0', scroll ? 'overflow-y-auto' : 'overflow-hidden', !flush && 'px-6 py-5 max-md:px-4', bodyClassName)}>
                        {children}
                    </div>
                    {(footer || footerNote) && (
                        <div className={cx('flex-none px-6 py-3.5 border-t border-separator bg-card-2 rounded-b-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 max-md:px-4', sheet && 'max-md:rounded-none max-md:pb-[max(0.875rem,env(safe-area-inset-bottom))]')}>
                            <div className="text-[12.5px] text-label-2 min-w-0">{footerNote}</div>
                            {footer && <div className="flex items-center justify-end gap-2 flex-none max-md:[&>button]:flex-1 max-md:[&>button]:min-h-[44px]">{footer}</div>}
                        </div>
                    )}
                </Inner>
            </div>
        </div>
    );
};

export default DialogShell;
