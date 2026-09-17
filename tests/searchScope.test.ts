/** The app bar's one box edits the customer search everywhere except Live stock, which has its own. */
import { describe, it, expect } from 'vitest';
import { searchScopeFor } from '../services/search';

describe('searchScopeFor', () => {
    it.each(['overview', 'customers', 'reports', 'pdc', 'users', 'alerts', 'templates', 'source'])('%s edits the customer search', (tab) => {
        expect(searchScopeFor(tab)).toBe('customers');
    });
    it('live stock edits its own', () => {
        expect(searchScopeFor('stock')).toBe('stock');
    });
});
