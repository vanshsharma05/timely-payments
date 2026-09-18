// @vitest-environment jsdom
/**
 * What every dialog owes the keyboard: focus lands inside on open, Tab and
 * Shift+Tab stay inside, Esc closes unless told not to, a stacked dialog
 * takes the keys, and focus goes back to the opener on close.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useModal } from '../components/ui/useModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

afterEach(cleanup);

const Dialog = ({ onClose, esc = true, children, title = 'A dialog' }: { onClose: () => void; esc?: boolean; children?: React.ReactNode; title?: string }) => {
    const panel = useModal(true, onClose, { closeOnEscape: esc });
    return (
        <div ref={panel} role="dialog" aria-modal="true" aria-label={title}>
            <button>First</button>
            <input aria-label="Middle" />
            <button>Last</button>
            {children}
        </div>
    );
};

const Page = ({ esc = true }: { esc?: boolean }) => {
    const [open, setOpen] = useState(false);
    const [inner, setInner] = useState(false);
    return (
        <div>
            <button onClick={() => setOpen(true)}>Open</button>
            <button>Elsewhere</button>
            {open && (
                <Dialog onClose={() => setOpen(false)} esc={esc}>
                    <button onClick={() => setInner(true)}>Open inner</button>
                    {inner && <Dialog title="Inner" onClose={() => setInner(false)} />}
                </Dialog>
            )}
        </div>
    );
};

describe('useModal', () => {
    it('focuses the first control on open, keeps Tab inside, and returns focus to the opener on close', () => {
        render(<Page />);
        const opener = screen.getByRole('button', { name: 'Open' });
        opener.focus();
        fireEvent.click(opener);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
        // Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last
        screen.getByRole('button', { name: 'Open inner' }).focus();
        fireEvent.keyDown(window, { key: 'Tab' });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
        fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open inner' }));
        // focus pushed outside by a click is brought back
        screen.getByRole('button', { name: 'Elsewhere' }).focus();
        expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(opener);
    });

    it('does not close on Esc when told not to (a dialog with its own keys, or a save in flight)', () => {
        render(<Page esc={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Open' }));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('a dialog on top of a dialog takes the keys; Esc closes only the inner one', () => {
        render(<Page />);
        fireEvent.click(screen.getByRole('button', { name: 'Open' }));
        const innerOpener = screen.getByRole('button', { name: 'Open inner' });
        innerOpener.focus();                       // a real click focuses the button first
        fireEvent.click(innerOpener);
        expect(screen.getAllByRole('dialog').length).toBe(2);
        const inner = screen.getByRole('dialog', { name: 'Inner' });
        expect(inner.contains(document.activeElement)).toBe(true);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.getAllByRole('dialog').length).toBe(1);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open inner' }));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('the confirm dialog starts on Cancel, so Enter never deletes by accident', () => {
        const onConfirm = vi.fn(); const onCancel = vi.fn();
        render(<ConfirmDialog open title="Delete?" confirmLabel="Delete it" onConfirm={onConfirm} onCancel={onCancel}>Body</ConfirmDialog>);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
        const d = screen.getByRole('alertdialog');
        expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Delete?');   // labelled by its title
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
