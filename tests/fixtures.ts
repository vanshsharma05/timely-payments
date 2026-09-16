import { Outstanding, FollowUpStatus, User, UserRole, DataVisibility, DEFAULT_ROLE_PERMISSIONS } from '../types';

/**
 * A synthetic account carrying every value the edit dialog was found to
 * corrupt (docs/product-audit/11-SECURITY-RELIABILITY.md §1.4): a collector
 * distinct from the owner, a credit bucket among debit ones, roll-ups the
 * sheet netted (which absolute sums would get wrong), a settlement stamp, a
 * declared rank, a category, a forecast and a follow-up. The figures are made
 * up; the shape is the production one.
 *
 * Netting check built into the numbers: 91–135 owes 2,00,967 and >135 is a
 * credit of 84,939, so the sheet's "over 90" is 1,16,028 — an absolute sum
 * would say 2,85,906.
 */
export const mixedAccount = (): Outstanding => ({
    id: 'out_86_TEST_MIXED',
    company: 'TEST MIXED UDYOG',
    contactPerson: 'Ramesh (Accounts)',
    contactNumber: '9800000001',
    contactPost: 'Accounts Head',
    additionalContacts: [{ id: 'c_1', name: 'Suresh', mobile: '9800000002', post: 'Purchase', email: 'suresh@example.com' }],
    email: 'accounts@example.com',
    city: 'Ludhiana',
    state: 'Punjab',
    address: 'Plot 12, Focal Point',
    gstin: '03AAAAA0000A1Z5',
    pan: 'AAAAA0000A',
    creditLimit: 500000,
    paymentTermsDays: 60,
    paymentRank: 'Late',
    category: 'Screen Printing',
    total: 393988,
    totalType: 'Dr',
    ageing: { '1-45': 189216, '46-90': 88744, '91-135': 200967, '>135': 84939 },
    ageingTypes: { '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Cr' },
    over90: 116028,
    over90Type: 'Dr',
    dueOver45: 204772,
    dueOver45Type: 'Dr',
    crmOwnerId: 'VISHNU',
    assignedCollectorId: 'MUNSHI_RAM',
    followUpDate: new Date('2026-11-20T00:00:00.000Z'),
    forecastAmount: 100000,
    forecastDate: new Date('2026-10-07T00:00:00.000Z'),
    status: FollowUpStatus.Upcoming,
    notes: ['[07 Sept, 12:38 pm - Vishnu] Promised to pay: ₹1,00,000 by 07 Oct. Spoke to Ramesh.'],
    isUrgent: false,
    isNewCustomer: false,
    addedAt: undefined,
    settledAt: '2026-08-01T10:00:00.000Z',
    creationDate: new Date('2026-08-27T17:42:11.807Z'),
    lastFollowUpOn: new Date('2026-09-07T12:38:02.067Z'),
});

/** An account in credit overall: nothing is overdue whatever the buckets say. */
export const creditAccount = (): Outstanding => ({
    ...mixedAccount(),
    id: 'cust_testcredit',
    company: 'TEST CREDIT TRADERS',
    total: 25000,
    totalType: 'Cr',
    ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 25000 },
    ageingTypes: { '>135': 'Cr' },
    over90: 25000,
    over90Type: 'Cr',
    dueOver45: 25000,
    dueOver45Type: 'Cr',
    paymentRank: undefined,
    assignedCollectorId: undefined,
    settledAt: undefined,
});

export const adminUser = (): User => ({
    id: 'ADMIN',
    authId: '00000000-0000-0000-0000-000000000001',
    name: 'Test Admin',
    role: UserRole.Admin,
    email: 'admin@example.com',
    dataVisibility: DataVisibility.All,
    permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.Admin],
    assignedCrms: [],
});

export const crmUser = (): User => ({
    id: 'VISHNU',
    authId: '00000000-0000-0000-0000-000000000002',
    name: 'Vishnu',
    role: UserRole.CRM,
    email: 'vishnu@example.com',
    dataVisibility: DataVisibility.AssignedOnly,
    permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.CRM],
    assignedCrms: ['VISHNU'],
});

export const collectorUser = (): User => ({
    id: 'MUNSHI_RAM',
    authId: '00000000-0000-0000-0000-000000000003',
    name: 'Munshi Ram',
    role: UserRole.Collector,
    email: 'munshi@example.com',
    dataVisibility: DataVisibility.AssignedOnly,
    permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.Collector],
    assignedCrms: [],
});
