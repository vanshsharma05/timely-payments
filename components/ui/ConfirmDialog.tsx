import React from 'react';
import { cx } from './Primitives';
import { useModal } from './useModal';

export interface ConfirmDialogProps {
    open: boolean;
    title: string;
    /** What exactly will happen, to what, and whether it can be undone. */
    children: React.ReactNode;
    /** The verb on the red button: "Delete cheque", never "OK". */
    confirmLabel: string;
    tone?: 'danger' | 'primary';
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * A question with the thing named in it.
 *
 * The browser's confirm() shows a sentence in a box the app cannot style,
 * with "OK" as the destructive answer and no way to show what is about to
 * go. This names the record (number, amount, customer, date), says the
 * action cannot be undone when it cannot, puts the safe answer first and
 * makes the person press a button that says what it does. Esc is "no".
 */
export const ConfirmDialog = ({ open, title, children, confirmLabel, tone = 'danger', busy = false, onConfirm, onCancel }: ConfirmDialogProps) => {
    const panel = useModal(open, onCancel, { closeOnEscape: !busy });
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
            <div ref={panel} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="bg-card rounded-[16px] shadow-e2 w-full max-w-md p-6 animate-in fade-in zoom-in-95 duration-150">
                <h2 id="confirm-title" className="text-[17px] font-extrabold text-label tracking-[-0.02em]">{title}</h2>
                <div className="text-[13.5px] text-label-2 mt-2.5 leading-relaxed">{children}</div>
                <div className="flex items-center justify-end gap-2 mt-6 max-md:[&>button]:flex-1 max-md:[&>button]:min-h-[44px]">
                    <button data-autofocus type="button" onClick={onCancel} disabled={busy} className="inline-flex items-center justify-center h-9 px-4 rounded-full text-[13px] font-semibold bg-card border border-separator-strong text-label-2 hover:bg-hover hover:text-label disabled:opacity-40">
                        Cancel
                    </button>
                    <button type="button" onClick={onConfirm} disabled={busy} className={cx('inline-flex items-center justify-center h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-40', tone === 'danger' ? 'bg-dang text-card hover:brightness-95' : 'bg-accent text-on-accent hover:bg-accent-press')}>
                        {busy ? 'Working…' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
