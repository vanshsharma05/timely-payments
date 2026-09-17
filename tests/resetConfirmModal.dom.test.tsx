// @vitest-environment jsdom
/**
 * The fresh-start confirmation: counts shown, nothing runs until a backup
 * has been taken and the phrase typed, a refusal is shown in place.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ResetConfirmModal, RESET_PHRASE } from '../components/ResetConfirmModal';
import type { ResetPlan } from '../services/reset';

afterEach(cleanup);

const plan = (): ResetPlan => ({
    updates: [], inserts: [], updatedTillDate: '16-09-2026',
    counts: { onFile: 4027, listed: 684, settled: 12, untouched: 3300, added: 5, cheques: 144, withFollowUpWork: 662 },
});

function open(onConfirm = vi.fn(async () => {}), onDownloadBackup = vi.fn(), onCancel = vi.fn()) {
    render(<ResetConfirmModal plan={plan()} onConfirm={onConfirm} onDownloadBackup={onDownloadBackup} onCancel={onCancel} />);
    return { onConfirm, onDownloadBackup, onCancel, button: () => screen.getByRole('button', { name: /reset the book/i }) as HTMLButtonElement };
}

describe('ResetConfirmModal', () => {
    it('shows what will happen as counts from the plan, and what will not', () => {
        open();
        const text = document.body.textContent || '';
        expect(text).toContain('144 post-dated cheques');
        expect(text).toContain('662 accounts carry a date');
        expect(text).toContain('684 listed accounts');
        expect(text).toContain('12 accounts');
        expect(text).toContain('3300 accounts already at nil');
        expect(text).toContain('5 new accounts');
        expect(text).toContain('4027 accounts on file stay the same accounts');
        expect(text).toContain('updated till 16-09-2026');
        expect(text).toMatch(/owners, collectors, contacts, category, rank, GSTIN\/PAN and the activity history .* are kept/);
    });

    it('the red button stays disabled until the backup is taken AND the phrase is typed exactly', () => {
        const { button, onConfirm } = open();
        expect(button().disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: RESET_PHRASE } });
        expect(button().disabled).toBe(true);            // no backup yet
        fireEvent.click(screen.getByRole('button', { name: /download backup file/i }));
        expect(button().disabled).toBe(false);
        fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: 'reset' } });
        expect(button().disabled).toBe(true);            // case matters
        fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: RESET_PHRASE } });
        fireEvent.click(screen.getByLabelText(/I have the backup file/i));   // unticking withdraws it
        expect(button().disabled).toBe(true);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('downloading calls the backup handler and ticks the box', () => {
        const { onDownloadBackup } = open();
        fireEvent.click(screen.getByRole('button', { name: /download backup file/i }));
        expect(onDownloadBackup).toHaveBeenCalledTimes(1);
        expect((screen.getByLabelText(/I have the backup file/i) as HTMLInputElement).checked).toBe(true);
    });

    it('confirms with the phrase once both conditions hold', async () => {
        const { button, onConfirm } = open();
        fireEvent.click(screen.getByRole('button', { name: /download backup file/i }));
        fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: ` ${RESET_PHRASE} ` } });
        fireEvent.click(button());
        await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(RESET_PHRASE));
    });

    it('shows a refusal in place and lets the person try again or cancel', async () => {
        const onConfirm = vi.fn(async () => { throw new Error('The book has changed since it was loaded. Reload and try again; nothing was changed.'); });
        const { button, onCancel } = open(onConfirm);
        fireEvent.click(screen.getByRole('button', { name: /download backup file/i }));
        fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: RESET_PHRASE } });
        fireEvent.click(button());
        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/book has changed/));
        expect(button().disabled).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('cancel and close never run anything', () => {
        const { onConfirm, onCancel } = open();
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
