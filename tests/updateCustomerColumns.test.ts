/**
 * What updateCustomerColumns() actually hands to PostgREST, against a fake
 * Supabase client: only the columns given, `null` kept, the id never in the
 * body, nothing sent for an empty change, and a database error surfaced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: { table: string; body: unknown; filter: [string, string] }[] = [];
let nextError: { message: string } | null = null;

vi.mock('../services/supabaseClient', () => {
    const client = {
        from: (table: string) => ({
            update: (body: unknown) => ({
                eq: async (col: string, val: string) => {
                    calls.push({ table, body, filter: [col, val] });
                    return { error: nextError };
                },
            }),
        }),
    };
    return { supabase: client, requireSupabase: () => client, isSupabaseConfigured: true };
});

import { updateCustomerColumns } from '../services/repository';

beforeEach(() => { calls.length = 0; nextError = null; });

describe('updateCustomerColumns', () => {
    it('sends exactly the columns given, keyed by id', async () => {
        await updateCustomerColumns('cust_x', { is_urgent: true, contact_number: '9811111111' });
        expect(calls).toHaveLength(1);
        expect(calls[0].table).toBe('customers');
        expect(calls[0].body).toEqual({ is_urgent: true, contact_number: '9811111111' });
        expect(calls[0].filter).toEqual(['id', 'cust_x']);
    });

    it('keeps a deliberate null so the column is cleared', async () => {
        await updateCustomerColumns('cust_x', { assigned_collector_id: null });
        expect(calls[0].body).toEqual({ assigned_collector_id: null });
    });

    it('sends nothing when there is nothing to change', async () => {
        await updateCustomerColumns('cust_x', {});
        expect(calls).toHaveLength(0);
    });

    it('drops a stray id rather than trusting it', async () => {
        await updateCustomerColumns('cust_x', { id: 'somebody_else', city: 'Surat' } as never);
        expect(calls[0].body).toEqual({ city: 'Surat' });
        expect(calls[0].filter).toEqual(['id', 'cust_x']);
    });

    it('raises the database error with the account named', async () => {
        nextError = { message: 'permission denied' };
        await expect(updateCustomerColumns('cust_x', { city: 'Surat' })).rejects.toThrow(/cust_x.*permission denied/);
    });
});
