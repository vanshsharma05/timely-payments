// @vitest-environment jsdom
/**
 * The day a dialog shows for a stored date (T37).
 *
 * A follow-up set by the bulk tool, an Excel import or anything else that
 * builds a local midnight is stored as 18:30 UTC the day before (IST is
 * UTC+5:30). The dialogs used to seed their date fields with the UTC day,
 * so those accounts opened showing the previous day — and a follow-up saved
 * untouched moved the date back a day. 101 accounts held such dates when
 * this was found. The fields must show the local calendar day, whatever
 * clock the date was stored at.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));

import FollowUpModal from '../components/FollowUpModal';
import { CustomerEditModal } from '../components/CustomerEditModal';
import PdcModal from '../components/PdcModal';
import { localIsoDate } from '../components/ui/format';
import { PdcCheque, PdcStatus } from '../types';
import { mixedAccount, adminUser } from './fixtures';

if (!window.matchMedia) {
    (window as any).matchMedia = (media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}
afterEach(cleanup);

/** Local midnight of a day next week — what dateFromLocalIso() and an Excel cell produce. */
const localMidnight = (() => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(0, 0, 0, 0); return d; })();
const expected = localIsoDate(localMidnight);
const utcDay = localMidnight.toISOString().slice(0, 10);

describe('date fields show the local calendar day', () => {
    it('the test itself runs where the two days differ (IST), or it proves nothing', () => {
        // In any zone east of UTC a local midnight is the previous day in UTC.
        if (new Date().getTimezoneOffset() >= 0) return;
        expect(utcDay).not.toBe(expected);
    });

    it('the follow-up dialog seeds the next follow-up and the forecast date with the local day', () => {
        const customer = { ...mixedAccount(), followUpDate: localMidnight, forecastDate: localMidnight, forecastAmount: 1000 };
        render(<FollowUpModal customer={customer} onClose={() => {}} onUpdate={async () => ({ ok: true })} currentUser={adminUser()} users={[adminUser()]} templates={[]} pdcCheques={[]} />);
        const dates = [...document.querySelectorAll('input[type="date"]')] as HTMLInputElement[];
        expect(dates.length).toBeGreaterThan(0);
        for (const d of dates) expect(d.value).toBe(expected);
    });

    it('the edit dialog seeds the follow-up date with the local day', () => {
        const customer = { ...mixedAccount(), followUpDate: localMidnight };
        render(<CustomerEditModal customerToEdit={customer} onClose={() => {}} onSave={async () => ({ ok: true })} currentUser={adminUser()} users={[adminUser()]} />);
        const d = screen.getByLabelText('Next Follow-up Date') as HTMLInputElement;
        expect(d.value).toBe(expected);
    });

    it('the cheque dialog seeds the cheque date and the received date with the local day', () => {
        const cheque: PdcCheque = { id: 'c1', customerId: mixedAccount().id, customerName: 'X', chequeNumber: '1', bankName: 'HDFC', chequeDate: localMidnight, amount: 100, status: PdcStatus.Pending, receivedDate: localMidnight };
        render(<PdcModal isOpen onClose={() => {}} onSave={async () => ({ ok: true })} customers={[mixedAccount()]} currentUser={adminUser()} chequeToEdit={cheque} existingCheques={[cheque]} users={[adminUser()]} />);
        const dates = [...document.querySelectorAll('input[type="date"]')] as HTMLInputElement[];
        expect(dates.length).toBeGreaterThan(0);
        for (const d of dates) expect(d.value).toBe(expected);
    });
});
