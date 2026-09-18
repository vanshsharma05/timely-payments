// @vitest-environment jsdom
/**
 * Signing out while the book and the cheques are still loaded (T65).
 *
 * The render right after sign-out has `currentUser = null` and every
 * collection still in state; every figure computed on that render has to
 * cope with nobody signed in. The cheque summary did not: it asserted a
 * user and read `.id` off null, so pressing Sign out blanked the page.
 * This mounts the whole app with the server mocked, waits for the book,
 * presses Sign out, and expects the login screen — and it pins the
 * figures themselves for a null user.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));

import { PdcCheque, PdcStatus, Outstanding } from '../types';
import { mixedAccount, adminUser, crmUser } from './fixtures';

const cheque = (id: string, customerId: string, crmOwnerId: string): PdcCheque => ({
    id, customerId, customerName: customerId, chequeNumber: id, bankName: 'HDFC', chequeDate: new Date(), amount: 1000,
    status: PdcStatus.Pending, receivedDate: new Date(), crmOwnerId,
});
const book: Outstanding[] = [mixedAccount(), { ...mixedAccount(), id: 'out_2', company: 'SECOND TRADERS', crmOwnerId: 'GARRY' }];
const cheques = [cheque('c1', 'out_86_TEST_MIXED', 'VISHNU'), cheque('c2', 'out_2', 'GARRY')];

const signOut = vi.fn(async () => {});
vi.mock('../services/repository', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/repository')>();
    return {
        ...actual,
        fetchCurrentProfile: async () => adminUser(),
        loadAll: async () => ({ customers: book, pdcCheques: cheques, users: [adminUser(), crmUser()], templates: [], companyProfile: null, settings: {} }),
        fetchCustomers: async () => book,
        signOut: () => signOut(),
    };
});

import App from '../App';
import { chequeSummary } from '../services/metrics';

if (!window.matchMedia) {
    (window as any).matchMedia = (media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}

beforeEach(() => { signOut.mockClear(); window.location.hash = ''; });
afterEach(cleanup);

describe('Sign out with the book loaded', () => {
    it('shows the login screen at once, with no blank page and no render error', async () => {
        const errors: string[] = [];
        const orig = console.error;
        console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
        try {
            render(<App />);
            // the session is restored and the book arrives: Today for the Admin, cheques counted on the nav badge
            await screen.findByText('Collections overview', {}, { timeout: 10000 });
            await waitFor(() => expect(screen.getAllByText(/Cheques to present today/).length).toBeGreaterThan(0));

            // the account menu, then Sign out
            const menuButtons = screen.getAllByRole('button').filter(b => b.getAttribute('aria-haspopup') === 'menu');
            fireEvent.click(menuButtons[0]);
            fireEvent.click(await screen.findByRole('menuitem', { name: /Sign out/ }));

            await waitFor(() => expect(signOut).toHaveBeenCalled());
            // the login screen, not an empty body
            await screen.findByLabelText(/email/i, {}, { timeout: 5000 });
            expect(document.body.textContent).toMatch(/Sign in/);
            expect(errors.filter(e => /Cannot read properties of null|The above error occurred/.test(e))).toEqual([]);
        } finally {
            console.error = orig;
        }
    }, 20000);
});

describe('the figures with nobody signed in', () => {
    it('the cheque summary is empty for a null user, never a throw', () => {
        expect(() => chequeSummary(cheques, null, book, new Date())).not.toThrow();
        expect(chequeSummary(cheques, null, book, new Date())).toEqual({ todayCount: 0, todayAmount: 0, overdueCount: 0, overdueAmount: 0, activeCount: 0, activeAmount: 0 });
        // and still counts for whoever is signed in
        expect(chequeSummary(cheques, adminUser(), book, new Date()).activeCount).toBe(2);
        expect(chequeSummary(cheques, crmUser(), book, new Date()).activeCount).toBe(1);
    });
});
