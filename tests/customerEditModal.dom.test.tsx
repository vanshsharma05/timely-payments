// @vitest-environment jsdom
/**
 * C1 regression (docs/product-audit/11-SECURITY-RELIABILITY.md §1.4): the
 * customer edit dialog used to rebuild the whole record from its form, so a
 * Save that changed nothing dropped the collector, flattened Dr/Cr ageing
 * types, replaced the sheet's netted roll-ups with absolute sums and cleared
 * the settlement stamp. These tests render the real dialog with a synthetic
 * account and look at exactly what it hands to onSave.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CustomerEditModal } from '../components/CustomerEditModal';
import { Outstanding, FollowUpStatus, followUpStatusOf } from '../types';
import { mixedAccount, adminUser, crmUser, collectorUser } from './fixtures';

afterEach(cleanup);

/** Renders the dialog for an existing account and returns what Save produced. */
function saveWith(customer: Outstanding, user = crmUser(), edit?: () => void): Outstanding {
    const onSave = vi.fn();
    render(
        <CustomerEditModal
            customerToEdit={customer}
            onSave={onSave}
            onClose={() => {}}
            currentUser={user}
            users={[adminUser(), crmUser(), collectorUser()]}
        />,
    );
    edit?.();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    return onSave.mock.calls[0][0] as Outstanding;
}

/** The fields the dialog has no business touching on an edit. */
const untouched = (c: Outstanding) => ({
    id: c.id,
    pan: c.pan,
    assignedCollectorId: c.assignedCollectorId,
    settledAt: c.settledAt,
    total: c.total,
    totalType: c.totalType,
    ageing: c.ageing,
    ageingTypes: c.ageingTypes,
    over90: c.over90,
    over90Type: c.over90Type,
    dueOver45: c.dueOver45,
    dueOver45Type: c.dueOver45Type,
    forecastAmount: c.forecastAmount,
    forecastDate: c.forecastDate,
    status: c.status,
    followUpDate: c.followUpDate?.toISOString(),
    lastFollowUpOn: c.lastFollowUpOn,
    notes: c.notes,
    isNewCustomer: c.isNewCustomer,
    addedAt: c.addedAt,
    creationDate: c.creationDate,
    crmOwnerId: c.crmOwnerId,
    paymentRank: c.paymentRank,
    category: c.category,
    isUrgent: c.isUrgent,
});

describe('Case A — a Save that changes nothing changes nothing', () => {
    it('as a CRM (money inputs disabled)', () => {
        const before = mixedAccount();
        const after = saveWith(before, crmUser());
        expect(untouched(after)).toEqual(untouched(before));
    });

    it('as an Admin (money inputs enabled but not touched)', () => {
        const before = mixedAccount();
        const after = saveWith(before, adminUser());
        expect(untouched(after)).toEqual(untouched(before));
    });

    it('keeps the collector, the Cr bucket, the netted roll-ups and the settlement stamp — the four confirmed corruption modes', () => {
        const after = saveWith(mixedAccount());
        expect(after.assignedCollectorId).toBe('MUNSHI_RAM');
        expect(after.ageingTypes).toEqual({ '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Cr' });
        expect(after.over90).toBe(116028);          // not 200967 + 84939 = 285906
        expect(after.dueOver45).toBe(204772);       // not 88744 + 285906 = 374650
        expect(after.settledAt).toBe('2026-08-01T10:00:00.000Z');
    });

    it('does not reopen an account closed as collected', () => {
        const closed = { ...mixedAccount(), status: FollowUpStatus.Completed, followUpDate: new Date() };
        const after = saveWith(closed);
        expect(after.status).toBe(FollowUpStatus.Completed);
    });

    it('keeps the contact directory as it was', () => {
        const before = mixedAccount();
        const after = saveWith(before);
        expect(after.contactPerson).toBe(before.contactPerson);
        expect(after.contactNumber).toBe(before.contactNumber);
        expect(after.contactPost).toBe(before.contactPost);
        expect(after.email).toBe(before.email);
        expect(after.additionalContacts).toEqual(before.additionalContacts);
        expect(after.city).toBe(before.city);
        expect(after.gstin).toBe(before.gstin);
        expect(after.creditLimit).toBe(before.creditLimit);
        expect(after.paymentTermsDays).toBe(before.paymentTermsDays);
    });
});

describe('Case B — a contact-only edit changes the contact and nothing else', () => {
    it('phone number', () => {
        const before = mixedAccount();
        const after = saveWith(before, crmUser(), () => {
            fireEvent.change(screen.getByPlaceholderText('e.g. 9876543210'), { target: { value: '9811111111' } });
        });
        expect(after.contactNumber).toBe('9811111111');
        expect(untouched(after)).toEqual(untouched(before));
    });

    it('email', () => {
        const before = mixedAccount();
        const after = saveWith(before, crmUser(), () => {
            fireEvent.change(screen.getByPlaceholderText('e.g. accounts@shreeram.com'), { target: { value: 'new@example.com' } });
        });
        expect(after.email).toBe('new@example.com');
        expect(untouched(after)).toEqual(untouched(before));
    });

    it('contact person', () => {
        const before = mixedAccount();
        const after = saveWith(before, crmUser(), () => {
            fireEvent.change(screen.getByPlaceholderText('e.g. Mr. Rajesh Sharma'), { target: { value: 'Mahesh' } });
        });
        expect(after.contactPerson).toBe('Mahesh');
        expect(untouched(after)).toEqual(untouched(before));
    });
});

describe('Case C — a field the dialog legitimately owns', () => {
    it('Urgent toggles and nothing else moves', () => {
        const before = mixedAccount();
        const after = saveWith(before, crmUser(), () => {
            fireEvent.click(screen.getByRole('checkbox', { name: /mark as critical/i }));
        });
        expect(after.isUrgent).toBe(true);
        const { isUrgent: _a, ...restAfter } = untouched(after);
        const { isUrgent: _b, ...restBefore } = untouched(before);
        expect(restAfter).toEqual(restBefore);
    });

    it('payment rank changes and the money block does not', () => {
        const before = mixedAccount();
        const after = saveWith(before, crmUser(), () => {
            fireEvent.change(screen.getByRole('combobox', { name: /payment rank/i }), { target: { value: 'Bad' } });
        });
        expect(after.paymentRank).toBe('Bad');
        const { paymentRank: _a, ...restAfter } = untouched(after);
        const { paymentRank: _b, ...restBefore } = untouched(before);
        expect(restAfter).toEqual(restBefore);
    });

    it('a note is added in front of the existing notes and stamps lastFollowUpOn', () => {
        const before = mixedAccount();
        const after = saveWith(before, crmUser(), () => {
            fireEvent.change(screen.getByPlaceholderText(/spoke with director/i), { target: { value: 'Rang, will pay Friday' } });
        });
        expect(after.notes).toHaveLength(2);
        expect(after.notes[0]).toMatch(/Rang, will pay Friday$/);
        expect(after.notes[1]).toBe(before.notes[0]);
        expect(after.lastFollowUpOn).not.toEqual(before.lastFollowUpOn);
    });

    it('a changed follow-up date is applied on its own — no status word is written for it (two days out, so any timezone reads it as upcoming)', () => {
        const before = mixedAccount();
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 2);
        const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
        const after = saveWith(before, crmUser(), () => {
            fireEvent.change(screen.getByLabelText('Next Follow-up Date'), { target: { value: iso } });
        });
        expect(after.followUpDate?.toISOString().slice(0, 10)).toBe(iso);
        expect(after.status).toBe(before.status);
        expect(followUpStatusOf(after)).toBe(FollowUpStatus.Upcoming);
        expect(after.over90).toBe(116028);
        expect(after.assignedCollectorId).toBe('MUNSHI_RAM');
    });
});

describe('an Admin who really edits the money', () => {
    it('gets the dialog\'s own recomputation, as before this fix', () => {
        const before = mixedAccount();
        const after = saveWith(before, adminUser(), () => {
            fireEvent.change(screen.getByLabelText('>135 Days (₹)'), { target: { value: '0' } });
        });
        // The pre-existing rule for an intentional money edit: buckets as typed,
        // roll-ups summed from them, every bucket typed like the total. Pinned,
        // not endorsed — see Q10.
        expect(after.ageing['>135']).toBe(0);
        expect(after.over90).toBe(200967);
        expect(after.dueOver45).toBe(88744 + 200967);
        expect(after.ageingTypes).toEqual({ '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Dr' });
        // and still nothing else moves
        expect(after.assignedCollectorId).toBe('MUNSHI_RAM');
        expect(after.settledAt).toBe(before.settledAt);
    });
});
