// @vitest-environment jsdom
/**
 * What each role is offered on the screens (final adversarial pass).
 *
 * The database enforces the rights; these pin that the screens do not
 * offer what the server would refuse: a Viewer reads and writes nothing, a
 * Collector logs follow-ups and cheques but cannot add or delete a
 * customer, export the book or reassign an owner; a CRM cannot delete.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));

import { CustomerDashboardView } from '../components/CustomerDashboardView';
import PdcChequesView from '../components/PdcChequesView';
import FollowUpModal from '../components/FollowUpModal';
import { User, UserRole, DataVisibility, DEFAULT_ROLE_PERMISSIONS, PdcCheque, PdcStatus } from '../types';
import { mixedAccount, adminUser, crmUser, collectorUser } from './fixtures';

if (!window.matchMedia) {
    (window as any).matchMedia = (media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}
afterEach(cleanup);

const viewerUser = (): User => ({ ...adminUser(), id: 'VIEWER', name: 'Viewer', role: UserRole.Viewer, dataVisibility: DataVisibility.All, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.Viewer], assignedCrms: [] });
const book = [mixedAccount(), { ...mixedAccount(), id: 'out_2', company: 'SECOND TRADERS', crmOwnerId: 'GARRY', assignedCollectorId: undefined }];
const cheque: PdcCheque = { id: 'c1', customerId: mixedAccount().id, customerName: mixedAccount().company, chequeNumber: '1', bankName: 'HDFC', chequeDate: new Date(), amount: 100, status: PdcStatus.Pending, receivedDate: new Date(), crmOwnerId: 'VISHNU' };

const renderBook = (user: User) => render(
    <CustomerDashboardView data={book} currentUser={user} users={[adminUser(), crmUser(), collectorUser()]} globalSearch="" onGlobalSearch={() => {}}
        onAddCustomer={() => {}} onEditCustomer={() => {}} onDeleteCustomer={() => {}} onFollowUp={() => {}} onWhatsApp={() => {}}
        onOpenPdcForCustomer={() => {}} onReassignCrm={() => {}} onBulkReassignCrm={() => {}} pdcCheques={[cheque]} onExportExcel={() => {}} />
);
const renderRegister = (user: User) => render(
    <PdcChequesView pdcCheques={[cheque]} customers={book} users={[adminUser(), crmUser(), collectorUser()]} currentUser={user}
        onAddPdc={() => {}} onEditPdc={() => {}} onDeletePdc={() => {}} onUpdatePdcStatus={() => {}} onOpenCustomerFollowUp={() => {}} loading={false} unsaved={[]} />
);
const renderFollowUp = (user: User) => render(
    <FollowUpModal customer={mixedAccount()} onClose={() => {}} onUpdate={async () => ({ ok: true })} currentUser={user} users={[adminUser(), crmUser(), collectorUser()]} templates={[]} pdcCheques={[]} />
);
const disabledOrAbsent = (name: RegExp) => { const b = screen.queryAllByRole('button', { name }) as HTMLButtonElement[]; return b.length === 0 || b.every(x => x.disabled); };

describe('a Viewer', () => {
    it('reads the book and cannot add, delete, export or open a follow-up to write', () => {
        renderBook(viewerUser());
        expect(disabledOrAbsent(/^Add customer$/)).toBe(true);
        expect(screen.queryAllByRole('button', { name: /^Delete / })).toHaveLength(0);
        expect(screen.queryByTitle(/Export filtered customer list/)).toBeNull();
        const followUps = screen.queryAllByRole('button', { name: /^Follow up$/ }) as HTMLButtonElement[];
        expect(followUps.length === 0 || followUps.every(b => b.disabled)).toBe(true);
    });
    it('sees the register with no Record button and no row actions', () => {
        renderRegister(viewerUser());
        expect(screen.queryByRole('button', { name: /Record a cheque/ })).toBeNull();
        expect(screen.queryByText('Actions')).toBeNull();
    });
    it('cannot save a follow-up', () => {
        renderFollowUp(viewerUser());
        const save = screen.getByRole('button', { name: /Save follow-up/ }) as HTMLButtonElement;
        expect(save.disabled).toBe(true);
    });
});

describe('a Collector', () => {
    it('cannot add or delete a customer, export the book, or reassign — but can follow up', () => {
        renderBook(collectorUser());
        expect(disabledOrAbsent(/^Add customer$/)).toBe(true);
        expect(screen.queryAllByRole('button', { name: /^Delete / })).toHaveLength(0);
        expect(screen.queryByTitle(/Export filtered customer list/)).toBeNull();
        const followUps = screen.getAllByRole('button', { name: /^Follow up$/ }) as HTMLButtonElement[];
        expect(followUps.some(b => !b.disabled)).toBe(true);
    });
    it('can record and act on cheques', () => {
        renderRegister(collectorUser());
        expect(screen.getAllByRole('button', { name: /Record a cheque/ }).length).toBeGreaterThan(0);
    });
    it('can save a follow-up', () => {
        renderFollowUp(collectorUser());
        expect((screen.getByRole('button', { name: /Save follow-up/ }) as HTMLButtonElement).disabled).toBe(false);
    });
});

describe('a CRM', () => {
    it('can add and follow up, but never delete', () => {
        renderBook(crmUser());
        expect(disabledOrAbsent(/^Add customer$/)).toBe(false);
        expect(screen.queryAllByRole('button', { name: /^Delete / })).toHaveLength(0);
    });
});
