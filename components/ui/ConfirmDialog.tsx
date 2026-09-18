import React from 'react';
import { Button } from './Primitives';
import { DialogShell } from './DialogShell';

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
 * Built on the same shell as every other dialog, one layer above them so
 * it can be asked on top of one.
 */
export const ConfirmDialog = ({ open, title, children, confirmLabel, tone = 'danger', busy = false, onConfirm, onCancel }: ConfirmDialogProps) => {
    if (!open) return null;
    return (
        <DialogShell
            title={title}
            size="sm"
            role="alertdialog"
            z={60}
            onClose={onCancel}
            closeOnEscape={!busy}
            footer={<>
                <Button type="button" variant="quiet" onClick={onCancel} disabled={busy} data-autofocus>Cancel</Button>
                <Button type="button" variant={tone === 'danger' ? 'destructive' : 'primary'} onClick={onConfirm} disabled={busy}>
                    {busy ? 'Working…' : confirmLabel}
                </Button>
            </>}
        >
            <div className="text-[13.5px] text-label-2 leading-relaxed">{children}</div>
        </DialogShell>
    );
};
