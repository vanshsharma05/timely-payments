// @vitest-environment jsdom
/**
 * The CRM's daily workflow after the polish: the follow-up dialog leads with
 * the outcome and folds the rest, steps through the list, closes on Esc; the
 * book says when a follow-up is due in plain words; the folding sections
 * keep their summary.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));
vi.mock('../services/repository', async (importOriginal) => {
    const real = await importOriginal<typeof import('../services/repository')>();
    return { ...real, fetchActivity: vi.fn(async () => []), addActivity: vi.fn(async () => undefined), deleteActivity: vi.fn(async () => undefined) };
});

import FollowUpModal from '../components/FollowUpModal';
import { CustomerEditModal } from '../components/CustomerEditModal';
import PdcModal from '../components/PdcModal';
import { WhatsAppReminderModal } from '../components/WhatsAppReminderModal';
import { Disclosure } from '../components/ui/Disclosure';
import { followUpWhen } from '../components/CustomerDashboardView';
import { Outstanding, FollowUpStatus } from '../types';
import { mixedAccount, adminUser, crmUser, collectorUser } from './fixtures';

if (!window.matchMedia) {
    (window as any).matchMedia = (media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);

const users = () => [adminUser(), crmUser(), collectorUser()];
const openDialog = (over: Partial<React.ComponentProps<typeof FollowUpModal>> = {}) => {
    const onClose = vi.fn(); const onNavigate = vi.fn();
    render(<FollowUpModal customer={mixedAccount()} currentUser={crmUser()} onClose={onClose} onUpdate={vi.fn()} users={users()} templates={[]} onNavigate={onNavigate} position={{ index: 2, total: 61 }} {...over} />);
    return { onClose, onNavigate };
};

describe('the follow-up dialog leads with the call outcome', () => {
    it('shows the account state in the header and the outcome block before anything else', () => {
        openDialog();
        const text = document.body.textContent || '';
        expect(text).toMatch(/Upcoming/);
        expect(text).toMatch(/Next 20 Nov/);
        expect(text).toMatch(/1,00,000 expected/);
        expect(text).toMatch(/Last follow-up \d+ days ago/);
        expect(text).toMatch(/Owner Vishnu/);
        expect(text.indexOf('What next?')).toBeLessThan(text.indexOf('Contacts'));
        expect(text.indexOf('What next?')).toBeLessThan(text.indexOf('WhatsApp reminder'));
        expect(screen.getByRole('button', { name: /save follow-up/i })).toBeTruthy();
    });

    it('folds contacts, WhatsApp, cheques and settings to one summary line each until opened', () => {
        openDialog();
        expect(screen.getByRole('button', { name: /Contacts 2 people · Ramesh/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /WhatsApp reminder to Ramesh/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Cheques none in hand/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Account settings Late pay · Screen Printing · Vishnu · Munshi Ram/ })).toBeTruthy();
        expect(screen.queryByLabelText('Payment rank')).toBeNull();          // folded
        fireEvent.click(screen.getByRole('button', { name: /Account settings/ }));
        expect(screen.getByLabelText('Payment rank')).toBeTruthy();          // opened
    });

    it('steps through the list it was opened from, by button and by Alt+arrows, and shows where it is', () => {
        const { onNavigate } = openDialog();
        expect(document.body.textContent).toContain('3 / 61');
        fireEvent.click(screen.getByRole('button', { name: /next account/i }));
        expect(onNavigate).toHaveBeenLastCalledWith(1);
        fireEvent.click(screen.getByRole('button', { name: /previous account/i }));
        expect(onNavigate).toHaveBeenLastCalledWith(-1);
        fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
        expect(onNavigate).toHaveBeenCalledTimes(3);
        fireEvent.keyDown(window, { key: 'ArrowRight' });                   // a plain arrow does nothing
        expect(onNavigate).toHaveBeenCalledTimes(3);
    });

    it('greys the arrow at either end of the list', () => {
        openDialog({ position: { index: 0, total: 5 } });
        expect((screen.getByRole('button', { name: /previous account/i }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: /next account/i }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('Esc closes it', () => {
        const { onClose } = openDialog();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('every dialog in the workflow closes on Esc', () => {
    it('customer edit', () => {
        const onClose = vi.fn();
        render(<CustomerEditModal customerToEdit={mixedAccount()} onSave={vi.fn()} onClose={onClose} currentUser={crmUser()} users={users()} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
    it('cheque', () => {
        const onClose = vi.fn();
        render(<PdcModal isOpen customers={[mixedAccount()]} currentUser={crmUser()} onClose={onClose} onSave={vi.fn()} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
    it('WhatsApp', () => {
        const onClose = vi.fn();
        render(<WhatsAppReminderModal customer={mixedAccount()} templates={[]} onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('Disclosure', () => {
    it('shows its summary when closed, its content when opened, and its action always', () => {
        const action = vi.fn();
        render(<Disclosure title="Cheques" summary="2 in hand" action={<button onClick={action}>Add</button>}><p>the list</p></Disclosure>);
        expect(screen.getByRole('button', { name: /Cheques 2 in hand/ })).toBeTruthy();
        expect(screen.queryByText('the list')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Cheques/ }));
        expect(screen.getByText('the list')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Cheques/ }).getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        expect(action).toHaveBeenCalledTimes(1);
    });
});

describe('the book says when a follow-up is due, in plain words', () => {
    const today = new Date('2026-09-17T09:00:00');
    const at = (d: number) => { const x = new Date(today); x.setDate(x.getDate() + d); return x; };
    const row = (over: Partial<Outstanding>): Outstanding => ({ ...mixedAccount(), ...over });
    it.each([
        ['no date', row({ followUpDate: undefined }), 'No date'],
        ['today', row({ followUpDate: at(0) }), 'Today'],
        ['tomorrow', row({ followUpDate: at(1) }), 'Tomorrow · 18 Sept'],
        ['in a week', row({ followUpDate: at(7) }), 'in 7d · 24 Sept'],
        ['far ahead', row({ followUpDate: at(40) }), '27 Oct'],
        ['overdue', row({ followUpDate: at(-3) }), '3d overdue · 14 Sept'],
        ['collected', row({ followUpDate: at(-3), status: FollowUpStatus.Completed }), '14 Sept'],
    ])('%s', (_name, item, expected) => {
        expect(followUpWhen(item, today)).toBe(expected);
    });
});
