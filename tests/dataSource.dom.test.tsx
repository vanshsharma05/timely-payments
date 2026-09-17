// @vitest-environment jsdom
/**
 * The Data source page and the sync review: health in plain words, what the
 * next sync will do before it does it, the everyday action apart from the
 * recovery one, and a fresh start that is Admin-only, red, last, and asks.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

vi.mock('../services/supabaseClient', () => ({ supabase: null, requireSupabase: () => { throw new Error('no client in tests'); }, isSupabaseConfigured: true }));

import DataSourceView from '../components/DataSourceView';
import SyncReconciliationModal from '../components/SyncReconciliationModal';
import { previewSync, describePreview, syncAge } from '../services/syncPreview';
import { mergeWithExistingFollowUps } from '../services/googleSheetService';
import { Outstanding } from '../types';
import { mixedAccount } from './fixtures';

afterEach(cleanup);

const account = (id: string, company: string, over: Partial<Outstanding> = {}): Outstanding => ({ ...mixedAccount(), id, company, notes: [], settledAt: undefined, ...over });
/** A row as the sheet parser produces it: figures only, everything else blank. */
const sheetRow = (company: string, total: number, ageing = { '1-45': total, '46-90': 0, '91-135': 0, '>135': 0 }): Outstanding => ({
    ...mixedAccount(), id: `out_${company.replace(/\s+/g, '_')}`, company, total, ageing, ageingTypes: { '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Dr' },
    over90: 0, over90Type: 'Dr', dueOver45: 0, dueOver45Type: 'Dr', totalType: 'Dr', crmOwnerId: '', contactPerson: '', contactNumber: '', notes: [],
    followUpDate: undefined, forecastAmount: undefined, forecastDate: undefined, paymentRank: undefined, category: undefined,
});

const book = (): Outstanding[] => [
    account('a', 'ALPHA', { total: 10000, ageing: { '1-45': 10000, '46-90': 0, '91-135': 0, '>135': 0 }, ageingTypes: { '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Dr' }, over90: 0, over90Type: 'Dr', dueOver45: 0, dueOver45Type: 'Dr', totalType: 'Dr' }),
    account('b', 'BETA', { total: 5000, ageing: { '1-45': 5000, '46-90': 0, '91-135': 0, '>135': 0 }, ageingTypes: { '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Dr' }, over90: 0, over90Type: 'Dr', dueOver45: 0, dueOver45Type: 'Dr', totalType: 'Dr' }),
    account('c', 'GAMMA', { total: 7000, ageing: { '1-45': 7000, '46-90': 0, '91-135': 0, '>135': 0 }, ageingTypes: { '1-45': 'Dr', '46-90': 'Dr', '91-135': 'Dr', '>135': 'Dr' }, over90: 0, over90Type: 'Dr', dueOver45: 0, dueOver45Type: 'Dr', totalType: 'Dr' }),
    account('z', 'ZETA', { total: 0, ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 }, ageingTypes: {}, over90: 0, dueOver45: 0, totalType: 'Dr' }),
];
const sheet = (): Outstanding[] => [
    sheetRow('ALPHA', 10000),                                                       // same figures
    sheetRow('BETA', 8000),                                                         // balance moves
    sheetRow('GAMMA', 7000, { '1-45': 0, '46-90': 7000, '91-135': 0, '>135': 0 }),  // same balance, aged
    sheetRow('NEWCO', 1500),                                                        // never seen
];

describe('what the next sync does, worked out before it does it', () => {
    it('counts exactly the rows the save would write: changed, re-aged, new, settled, unchanged', () => {
        const p = previewSync(book(), sheet());
        expect(p.incoming).toBe(4);
        expect(p.changed).toBe(2);
        expect(p.balancesMoved).toBe(1);
        expect(p.unchanged).toBe(1);
        expect(p.added).toBe(1);
        expect(p.settled).toBe(0);            // ZETA is unlisted but already at zero
        expect(p.untouched).toBe(1);
        expect(p.netChange).toBe(3000);
        expect(p.rows.map(r => `${r.company}:${r.effect}${r.effect === 'changed' ? (r.balanceMoves ? ':balance' : ':ageing') : ''}`))
            .toEqual(['BETA:changed:balance', 'GAMMA:changed:ageing', 'NEWCO:added', 'ALPHA:unchanged']);
        expect(describePreview(p)).toBe('2 accounts change (1 balance, 1 ageing only) · 1 new customer · 1 unchanged');
    });

    it('an account the sheet stops listing is settled to zero, with its amount', () => {
        const p = previewSync(book(), sheet().filter(r => r.company !== 'ALPHA'));
        expect(p.settled).toBe(1);
        expect(p.settledAmount).toBe(10000);
        expect(p.rows.find(r => r.company === 'ALPHA')).toMatchObject({ effect: 'settled', before: 10000, after: 0 });
    });

    it('agrees with the merge the sync actually runs', () => {
        const merged = mergeWithExistingFollowUps(book(), sheet());
        const beta = merged.find(r => r.company === 'BETA')!;
        expect(beta.total).toBe(8000);
        expect(beta.crmOwnerId).toBe('VISHNU');      // the owner is the app's, whatever the sheet says
        expect(merged.find(r => r.company === 'NEWCO')!.crmOwnerId).toBe('');
    });

    it('says how old the last sync is in words a manager can act on', () => {
        const now = new Date('2026-09-18T10:00:00');
        expect(syncAge('', now).label).toBe('Never synced');
        expect(syncAge('2026-09-18T08:00:00', now)).toMatchObject({ tone: 'fresh', label: 'Up to date' });
        expect(syncAge('2026-09-15T08:00:00', now)).toMatchObject({ tone: 'ageing', label: 'Getting old' });
        expect(syncAge('2026-09-01T08:00:00', now)).toMatchObject({ tone: 'stale', label: 'Stale' });
        expect(syncAge('2026-09-15T08:00:00', now).detail).toMatch(/3d ago/);
    });
});

describe('the review before the balances are updated', () => {
    const openReview = () => {
        const onConfirm = vi.fn(); const onCancel = vi.fn();
        render(<SyncReconciliationModal existingRecords={book()} incomingRecords={sheet()} updatedTillDate="17-Sep-2026" sourceName="Transactions Google Sheet" onConfirm={onConfirm} onCancel={onCancel} />);
        return { onConfirm, onCancel };
    };

    it('leads with the four numbers, the changed rows first, and labels a re-aged row honestly', () => {
        openReview();
        expect(screen.getByText(/4 rows read from Transactions Google Sheet/)).toBeTruthy();
        const tiles = screen.getAllByRole('button', { name: /^(Figures change|New customers|Settled to zero|Unchanged)/ }).filter(b => b.getAttribute('aria-pressed') !== null).slice(0, 4);
        expect(tiles.map(t => [...t.querySelectorAll('span')].map(x => x.textContent).join(' | '))).toEqual([
            'Figures change | 2 | 1 balance move (+₹3,000) · 1 ageing only',
            'New customers | 1 | will need a CRM owner',
            'Settled to zero | 0 | none this time',
            'Unchanged | 1 | same figures as before',
        ]);
        const rows = screen.getAllByRole('row').slice(1).map(r => r.textContent!.replace(/\s+/g, ' '));
        expect(rows[0]).toMatch(/BETA.*₹5,000.*₹8,000.*\+₹3,000.*Balance changes/);
        expect(rows[1]).toMatch(/GAMMA.*Ageing changes · same balance/);
        expect(rows[2]).toMatch(/NEWCO.*—.*New customer — needs a CRM/);
        expect(rows[3]).toMatch(/ALPHA.*Same as before/);
    });

    it('a tile narrows the list; the button names the rows; confirming hands over the merged book; Esc cancels', () => {
        const { onConfirm, onCancel } = openReview();
        fireEvent.click(screen.getByRole('button', { name: /^Figures change2/ }));
        expect(screen.getAllByRole('row').slice(1).length).toBe(2);
        fireEvent.click(screen.getByRole('button', { name: /^Unchanged \(1\)/ }));
        expect(screen.getAllByRole('row').slice(1).map(r => r.textContent)).toEqual([expect.stringContaining('ALPHA')]);
        const update = screen.getByRole('button', { name: /Update balances\s*4 rows/ });
        fireEvent.click(update);
        expect(onConfirm).toHaveBeenCalledTimes(1);
        const merged = onConfirm.mock.calls[0][0] as Outstanding[];
        expect(merged.find(r => r.company === 'BETA')!.total).toBe(8000);
        expect(merged.length).toBe(5);                                    // 4 from the sheet + ZETA retained
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('says so when nothing changes', () => {
        render(<SyncReconciliationModal existingRecords={book()} incomingRecords={[sheetRow('ALPHA', 10000), sheetRow('BETA', 5000), sheetRow('GAMMA', 7000)]} onConfirm={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByText(/Nothing changes — the book already matches the sheet/)).toBeTruthy();
    });
});

describe('the Data source page', () => {
    const openPage = (over: Partial<React.ComponentProps<typeof DataSourceView>> = {}) => {
        const fns = { onDataSourceMode: vi.fn(), onGoogleSheetUrl: vi.fn(), onCustomerMasterSheetUrl: vi.fn(), onSync: vi.fn(), onCheckSheet: vi.fn(), onReviewCheck: vi.fn(), onFileChange: vi.fn(), onDownloadTemplate: vi.fn(), onCopyHeaders: vi.fn(), onImportCustomers: vi.fn(), onExportCrmAssignments: vi.fn(), onFreshStart: vi.fn() };
        render(<DataSourceView
            isAdmin dataSourceMode="google" googleSheetUrl="https://official" officialSheetUrl="https://official" customerMasterSheetUrl="https://master" officialMasterUrl="https://master" liveStockSheetUrl="https://stock"
            lastSyncTime={new Date(Date.now() - 4 * 86_400_000).toISOString()} sheetUpdatedTillDate="13-Sep-2026" accountsWithDues={642} isSyncing={false} sheetCheck={null} expectedHeaders={['ID', 'Company']} crmConflicts={[]}
            {...fns} {...over} />);
        return fns;
    };

    it('opens on the source, its age in plain words, what the sheet controls and what the app controls', () => {
        openPage();
        expect(screen.getByText('Balances come from the Google Sheet')).toBeTruthy();
        expect(screen.getByTestId('sync-age').textContent).toBe('Getting old');
        expect(screen.getByText(/updated till/).textContent).toMatch(/13-Sep-2026/);
        expect(screen.getByText('The sheet controls')).toBeTruthy();
        expect(screen.getByText('The app controls — a sync never touches these')).toBeTruthy();
        expect(screen.getByText(/Nothing is written until you confirm the review/)).toBeTruthy();
    });

    it('the everyday actions are at the top; the fresh start is Admin-only, red, last, and says what it clears and keeps', () => {
        const { onSync, onCheckSheet, onFreshStart } = openPage();
        fireEvent.click(screen.getByRole('button', { name: 'Sync balances' }));
        expect(onSync).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Check the sheet' }));
        expect(onCheckSheet).toHaveBeenCalledTimes(1);
        const headings = screen.getAllByRole('heading').map(h => h.textContent);
        expect(headings[headings.length - 1]).toBe('Fresh start — recovery only');
        const danger = screen.getByRole('region', { name: 'Fresh start — recovery only' });
        expect(danger.textContent).toMatch(/Not a sync/);
        expect(danger.textContent).toMatch(/It clears, for everyone/);
        expect(danger.textContent).toMatch(/It keeps/);
        expect(danger.textContent).toMatch(/needs the word RESET typed/);
        fireEvent.click(within(danger).getByRole('button', { name: /Start a fresh start/ }));
        expect(onFreshStart).toHaveBeenCalledTimes(1);
        cleanup();
        openPage({ isAdmin: false });
        expect(screen.queryByText('Fresh start — recovery only')).toBeNull();
    });

    it('after a check, the page says whether the sheet is reachable and what the next sync will do, and offers the review', () => {
        const { onReviewCheck } = openPage({ sheetCheck: { at: new Date().toISOString(), url: 'https://official', rows: 684, updatedTillDate: '17-Sep-2026', preview: previewSync(book(), sheet()) } });
        const status = screen.getByRole('status');
        expect(status.textContent).toMatch(/Sheet reachable · 684 rows · updated till 17-Sep-2026/);
        expect(status.textContent).toMatch(/Next sync: 2 accounts change \(1 balance, 1 ageing only\) · 1 new customer · 1 unchanged/);
        fireEvent.click(screen.getByRole('button', { name: 'Review and update' }));
        expect(onReviewCheck).toHaveBeenCalledTimes(1);
    });

    it('when the sheet cannot be read it says so, what to check, and that nothing changed', () => {
        openPage({ sheetCheck: { at: new Date().toISOString(), url: 'https://official', error: 'Share it as "Anyone with the link can view"' } });
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toMatch(/The sheet could not be read/);
        expect(alert.textContent).toMatch(/Nothing was changed/);
        expect(screen.queryByRole('button', { name: 'Review and update' })).toBeNull();
    });

    it('a link that is not the official sheet is said, with a way back', () => {
        const { onGoogleSheetUrl } = openPage({ googleSheetUrl: 'https://somebody-elses' });
        expect(screen.getByText(/Not the official sheet/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Use the official sheet' }));
        expect(onGoogleSheetUrl).toHaveBeenCalledWith('https://official');
    });

    it('Excel mode shows the upload and folds the column table away', () => {
        openPage({ dataSourceMode: 'excel' });
        expect(document.querySelector('#file-upload')).toBeTruthy();
        const fold = screen.getByRole('button', { name: /Columns the file must have/ });
        expect(fold.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText('Acme Corp')).toBeNull();
        fireEvent.click(fold);
        expect(screen.getByText('Acme Corp')).toBeTruthy();
    });

    it('the one-time import is folded, asks in the app with what it does, and runs only on the named button', () => {
        const { onImportCustomers } = openPage();
        fireEvent.click(screen.getByRole('button', { name: /One-time customer import/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Import customers…' }));
        const q = screen.getByRole('alertdialog');
        expect(q.textContent).toMatch(/nothing is overwritten/);
        expect(q.textContent).toMatch(/No balances change/);
        fireEvent.click(within(q).getByRole('button', { name: 'Cancel' }));
        expect(onImportCustomers).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Import customers…' }));
        fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import customers' }));
        expect(onImportCustomers).toHaveBeenCalledTimes(1);
    });
});
