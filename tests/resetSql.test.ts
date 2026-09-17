/**
 * reset_book() and restore_book_backup() (supabase/reset.sql), run inside a
 * throwaway Postgres in this process against the real schema.sql, with a
 * synthetic book: legacy ids, owners, collectors, cheques, activity threads.
 * Nothing here can reach the production project.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, actAs, addLogin, count } from './pglite';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const MANAGER = '22222222-2222-4222-8222-222222222222';
const CRM = '33333333-3333-4333-8333-333333333333';

const AGEING = { '1-45': 100, '46-90': 0, '91-135': 0, '>135': 0 };
const TEMPLATES = [{ id: 'template_default', name: 'Standard Reminder', content: 'Hello {{contactPerson}}' }];
const PROFILE = { companyName: 'Timely Payment' };
const SETTINGS = { data_source_mode: 'google', google_sheet_url: 'https://sheet.example/official', sheet_updated_till_date: '16-09-2026', last_sync_time: '2026-09-17T06:00:00.000Z' };

/** The book before the reset: what the old reset used to destroy. */
async function seed(db: PGlite) {
    await addLogin(db, ADMIN, 'ADMIN', 'The Admin', 'Admin');
    await addLogin(db, MANAGER, 'MANAGER', 'The Manager', 'Manager');
    await addLogin(db, CRM, 'VISHNU', 'Vishnu', 'CRM');
    await db.exec(`
        insert into public.customers (id, company, contact_person, contact_number, pan, category, payment_rank, total, total_type, ageing, over90, due_over45,
                                      crm_owner_id, assigned_collector_id, follow_up_date, forecast_amount, forecast_date, status, notes, is_urgent, last_follow_up_on, settled_at)
        values
          ('out_63_3_BROTHERS', '3 BROTHERS ( THUKRAL HOSIERY )', 'Ramesh', '9800000001', 'AAAAA0000A', 'Hosiery', 'Late', 393988, 'Dr', '{"1-45":189216,"46-90":88744,"91-135":200967,">135":84939}', 116028, 204772,
           'VISHNU', 'MUNSHI_RAM', '2026-11-20T00:00:00Z', 100000, '2026-10-07T00:00:00Z', 'Upcoming', '["[07 Sept - Vishnu] Promised 1L"]', true, '2026-09-07T12:38:02Z', null),
          ('cust_bhavyaprintoflex', 'BHAVYA PRINT-O-FLEX', 'Accounts', '9800000002', null, null, null, 50000, 'Dr', '{"1-45":50000,"46-90":0,"91-135":0,">135":0}', 0, 0,
           'PRIKSHIT', null, '2026-10-01T00:00:00Z', null, null, 'Upcoming', '[]', false, null, null),
          ('cust_gonetraders', 'GONE TRADERS', '', '', null, null, 'Bad', 12000, 'Dr', '{"1-45":0,"46-90":0,"91-135":0,">135":12000}', 12000, 12000,
           'VISHNU', null, null, null, null, 'Pending', '["old note"]', false, null, null),
          ('cust_oldsettledco', 'OLD SETTLED CO', '', '', null, null, null, 0, 'Dr', '{"1-45":0,"46-90":0,"91-135":0,">135":0}', 0, 0,
           'ANKUR', null, null, null, null, 'Completed', '[]', false, null, '2026-03-01T00:00:00.000Z');
        insert into public.pdc_cheques (id, customer_id, customer_name, cheque_number, bank_name, cheque_date, amount, status, crm_owner_id)
        values ('pdc_1', 'out_63_3_BROTHERS', '3 BROTHERS ( THUKRAL HOSIERY )', '000123', 'SBI', '2026-10-01T00:00:00Z', 25000, 'Pending', 'VISHNU'),
               ('pdc_2', 'cust_bhavyaprintoflex', 'BHAVYA PRINT-O-FLEX', '000456', 'HDFC', '2026-10-05T00:00:00Z', 8000, 'Cleared', 'PRIKSHIT');
        insert into public.customer_activity (customer_id, author_id, author_name, kind, body)
        values ('out_63_3_BROTHERS', '${CRM}', 'Vishnu', 'promise', 'Promised 1L by 7 Oct'),
               ('out_63_3_BROTHERS', '${CRM}', 'Vishnu', 'note', 'Spoke to Ramesh'),
               ('cust_gonetraders', '${CRM}', 'Vishnu', 'system', 'Payment rank changed from automatic to Bad.');
        insert into public.templates (id, name, content) values ('template_default', 'Standard Reminder', 'OLD CONTENT'), ('t_custom', 'Custom', 'hi');
        update public.company_profile set profile = '{"companyName":"Old Name"}' where id = 1;
        update public.app_settings set data_source_mode = 'excel', google_sheet_url = 'https://sheet.example/other', customer_master_sheet_url = 'https://sheet.example/master', sheet_updated_till_date = '01-01-2026', last_sync_time = 'never' where id = 1;
    `);
}

/** What the browser's plan would say for this book against a sheet listing 3 BROTHERS (new figures), BHAVYA (at nil) and BRAND NEW FIRM. */
const updates = (settledAt = '2026-09-17T06:00:00.000Z') => [
    { id: 'out_63_3_BROTHERS', total: 777000, total_type: 'Dr', ageing: { '1-45': 777000, '46-90': 0, '91-135': 0, '>135': 0 }, ageing_types: { '1-45': 'Dr' }, over90: 0, over90_type: 'Dr', due_over45: 0, due_over45_type: 'Dr', settled_at: null },
    { id: 'cust_bhavyaprintoflex', total: 0, total_type: 'Dr', ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 }, ageing_types: {}, over90: 0, over90_type: 'Dr', due_over45: 0, due_over45_type: 'Dr', settled_at: settledAt },
    { id: 'cust_gonetraders', total: 0, total_type: 'Dr', ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 }, ageing_types: {}, over90: 0, over90_type: 'Dr', due_over45: 0, due_over45_type: 'Dr', settled_at: settledAt },
    { id: 'cust_oldsettledco', total: 0, total_type: 'Dr', ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 }, ageing_types: {}, over90: 0, over90_type: 'Dr', due_over45: 0, due_over45_type: 'Dr', settled_at: '2026-03-01T00:00:00.000Z' },
];
const inserts = () => [
    { id: 'cust_brandnewfirm', company: 'BRAND NEW FIRM', contact_person: '', contact_number: '', contact_post: null, additional_contacts: [], email: null, city: null, state: null, address: null, gstin: null, pan: null, credit_limit: null, payment_terms_days: null, payment_rank: null, category: null,
      total: 5000, total_type: 'Dr', ageing: AGEING, ageing_types: { '1-45': 'Dr' }, over90: 0, over90_type: 'Dr', due_over45: 0, due_over45_type: 'Dr', crm_owner_id: '', assigned_collector_id: null,
      follow_up_date: null, forecast_amount: null, forecast_date: null, status: 'Pending', notes: [], is_urgent: false, is_new_customer: false, added_at: '2026-09-17T06:00:00.000Z', settled_at: null, creation_date: '2026-09-17T06:00:00.000Z', last_follow_up_on: null },
];

async function reset(db: PGlite, over: Partial<{ updates: unknown; inserts: unknown; phrase: string; templates: unknown }> = {}) {
    const r = await db.query<{ reset_book: Record<string, unknown> }>(
        `select public.reset_book($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6) as reset_book`,
        [JSON.stringify(over.updates ?? updates()), JSON.stringify(over.inserts ?? inserts()), JSON.stringify(over.templates ?? TEMPLATES), JSON.stringify(PROFILE), JSON.stringify(SETTINGS), over.phrase ?? 'RESET'],
    );
    return r.rows[0].reset_book;
}

const row = async (db: PGlite, id: string) => (await db.query<any>(`select * from public.customers where id = $1`, [id])).rows[0];

describe('reset_book — one transaction, snapshot first, ids and history kept', () => {
    let db: PGlite;
    beforeAll(async () => { db = await freshDatabase(['supabase/reset.sql']); }, 60000);
    beforeEach(async () => {
        await db.exec(`delete from public.customer_activity; delete from public.pdc_cheques; delete from public.customers; delete from public.templates; delete from public.book_backups; delete from auth.users; delete from public.profiles;`);
        await seed(db);
        await actAs(db, ADMIN);
    });

    it('applies the plan and reports what it did', async () => {
        const r = await reset(db);
        expect(r).toMatchObject({ accounts_on_file: 4, accounts_updated: 4, accounts_settled: 2, accounts_added: 1, cheques_deleted: 2 });
        expect(typeof r.backup_id).toBe('string');
    });

    it('deletes every cheque', async () => {
        await reset(db);
        expect(await count(db, 'pdc_cheques')).toBe(0);
    });

    it('keeps every account under its own id — legacy out_* ids included — and adds the new name', async () => {
        await reset(db);
        const ids = (await db.query<{ id: string }>(`select id from public.customers order by id`)).rows.map(r => r.id);
        expect(ids).toEqual(['cust_bhavyaprintoflex', 'cust_brandnewfirm', 'cust_gonetraders', 'cust_oldsettledco', 'out_63_3_BROTHERS']);
    });

    it('keeps the activity threads, owners, collectors, contacts, rank, category and PAN', async () => {
        await reset(db);
        expect(await count(db, 'customer_activity')).toBe(3);
        expect(await count(db, 'customer_activity', `customer_id = 'out_63_3_BROTHERS'`)).toBe(2);
        const a = await row(db, 'out_63_3_BROTHERS');
        expect(a).toMatchObject({ crm_owner_id: 'VISHNU', assigned_collector_id: 'MUNSHI_RAM', contact_person: 'Ramesh', contact_number: '9800000001', pan: 'AAAAA0000A', category: 'Hosiery', payment_rank: 'Late' });
        expect((await row(db, 'cust_gonetraders')).payment_rank).toBe('Bad');
    });

    it('clears the follow-up work on every account', async () => {
        await reset(db);
        for (const id of ['out_63_3_BROTHERS', 'cust_bhavyaprintoflex', 'cust_gonetraders', 'cust_oldsettledco']) {
            const c = await row(db, id);
            expect({ id, notes: c.notes, follow_up_date: c.follow_up_date, status: c.status, forecast_amount: c.forecast_amount, forecast_date: c.forecast_date, last_follow_up_on: c.last_follow_up_on, is_urgent: c.is_urgent })
                .toEqual({ id, notes: [], follow_up_date: null, status: 'Pending', forecast_amount: null, forecast_date: null, last_follow_up_on: null, is_urgent: false });
        }
    });

    it('writes the money the plan carries and nothing else on the row', async () => {
        await reset(db);
        const a = await row(db, 'out_63_3_BROTHERS');
        expect(Number(a.total)).toBe(777000);
        expect(a.ageing).toEqual({ '1-45': 777000, '46-90': 0, '91-135': 0, '>135': 0 });
        expect(a.settled_at).toBeNull();
        const gone = await row(db, 'cust_gonetraders');
        expect(Number(gone.total)).toBe(0);
        expect(gone.settled_at).toBe('2026-09-17T06:00:00.000Z');
        expect((await row(db, 'cust_oldsettledco')).settled_at).toBe('2026-03-01T00:00:00.000Z');
    });

    it('the new account arrives unassigned with no follow-up work and the database\'s own timestamps', async () => {
        await reset(db);
        const n = await row(db, 'cust_brandnewfirm');
        expect(n).toMatchObject({ company: 'BRAND NEW FIRM', crm_owner_id: '', status: 'Pending', notes: [], follow_up_date: null, is_urgent: false });
        expect(Number(n.total)).toBe(5000);
        expect(n.updated_at).toBeTruthy();
    });

    it('puts templates, profile and settings back to the defaults handed in, keeping the master-sheet URL', async () => {
        await reset(db);
        const t = (await db.query<any>(`select id, name, content from public.templates order by id`)).rows;
        expect(t).toEqual([{ id: 'template_default', name: 'Standard Reminder', content: 'Hello {{contactPerson}}' }]);
        expect((await db.query<any>(`select profile from public.company_profile where id = 1`)).rows[0].profile).toEqual(PROFILE);
        const s = (await db.query<any>(`select * from public.app_settings where id = 1`)).rows[0];
        expect(s).toMatchObject({ data_source_mode: 'google', google_sheet_url: 'https://sheet.example/official', customer_master_sheet_url: 'https://sheet.example/master', sheet_updated_till_date: '16-09-2026', last_sync_time: '2026-09-17T06:00:00.000Z' });
    });

    it('saves a snapshot of everything it touched, with who ran it and the counts', async () => {
        const r = await reset(db);
        const b = (await db.query<any>(`select * from public.book_backups where id = $1`, [r.backup_id])).rows[0];
        expect(b.created_by).toBe(ADMIN);
        expect(b.created_by_name).toBe('The Admin');
        expect(b.reason).toBe('reset');
        expect(b.customers).toHaveLength(4);
        expect(b.customers.find((c: any) => c.id === 'out_63_3_BROTHERS').notes).toEqual(['[07 Sept - Vishnu] Promised 1L']);
        expect(b.pdc_cheques.map((q: any) => q.id).sort()).toEqual(['pdc_1', 'pdc_2']);
        expect(b.templates).toHaveLength(2);
        expect(b.company_profile).toEqual({ companyName: 'Old Name' });
        expect(b.app_settings.google_sheet_url).toBe('https://sheet.example/other');
        expect(b.counts).toEqual({ accounts_on_file: 4, accounts_updated: 4, accounts_settled: 2, accounts_added: 1, cheques_deleted: 2 });
    });

    it('is for Admins only: a Manager, a CRM and a stranger are refused, and nothing changes', async () => {
        for (const who of [MANAGER, CRM, null]) {
            await actAs(db, who);
            await expect(reset(db)).rejects.toThrow(/Only an Admin can reset/);
        }
        expect(await count(db, 'pdc_cheques')).toBe(2);
        expect(await count(db, 'book_backups')).toBe(0);
        expect((await row(db, 'out_63_3_BROTHERS')).notes).toEqual(['[07 Sept - Vishnu] Promised 1L']);
    });

    it('keeps every owner and collector exactly as they were, on every account', async () => {
        const before = (await db.query<any>(`select id, crm_owner_id, assigned_collector_id from public.customers order by id`)).rows;
        await reset(db);
        const after = (await db.query<any>(`select id, crm_owner_id, assigned_collector_id from public.customers where id <> 'cust_brandnewfirm' order by id`)).rows;
        expect(after).toEqual(before);
        expect(before.map((r: any) => r.crm_owner_id)).toEqual(['PRIKSHIT', 'VISHNU', 'ANKUR', 'VISHNU']);
    });

    it('keeps every activity entry exactly as it was', async () => {
        const before = (await db.query<any>(`select id, customer_id, author_name, kind, body from public.customer_activity order by created_at, id`)).rows;
        await reset(db);
        const after = (await db.query<any>(`select id, customer_id, author_name, kind, body from public.customer_activity order by created_at, id`)).rows;
        expect(after).toEqual(before);
        expect(before).toHaveLength(3);
    });

    it('the backup table is readable by an Admin only', async () => {
        const policy = (await db.query<any>(`select pg_get_expr(polqual, polrelid) as q from pg_policy where polname = 'book_backups_read'`)).rows[0].q;
        expect(policy).toBe('is_admin()');
    });

    it('refuses without the phrase, and changes nothing', async () => {
        await expect(reset(db, { phrase: 'reset' })).rejects.toThrow(/phrase did not match/);
        expect(await count(db, 'pdc_cheques')).toBe(2);
        expect(await count(db, 'book_backups')).toBe(0);
    });

    it('refuses an empty plan against a book that has accounts', async () => {
        await expect(reset(db, { updates: [] })).rejects.toThrow(/book has changed .*4 on file, 0 in the plan/);
        expect(await count(db, 'pdc_cheques')).toBe(2);
    });

    it('an empty book with an empty plan is allowed: the sheet simply arrives', async () => {
        await db.exec(`delete from public.customer_activity; delete from public.pdc_cheques; delete from public.customers;`);
        const r = await reset(db, { updates: [] });
        expect(r).toMatchObject({ accounts_on_file: 0, accounts_updated: 0, accounts_added: 1, cheques_deleted: 0 });
    });

    it('refuses a plan built from a book that has since changed: an account missing from the plan', async () => {
        await expect(reset(db, { updates: updates().slice(0, 3) })).rejects.toThrow(/book has changed/);
        expect(await count(db, 'pdc_cheques')).toBe(2);
    });

    it('refuses a plan naming an account that no longer exists', async () => {
        await expect(reset(db, { updates: [...updates(), { ...updates()[0], id: 'cust_deleted_meanwhile' }] })).rejects.toThrow(/no longer on file/);
    });

    it('refuses to add an account that already exists', async () => {
        await expect(reset(db, { inserts: [{ ...inserts()[0], id: 'cust_gonetraders' }] })).rejects.toThrow(/already exists/);
    });

    it('is one transaction: a failure in the last step leaves the cheques, the notes and the backup table untouched', async () => {
        // Two templates with one id violate the primary key in step 6, after the cheques were deleted and the notes cleared.
        await expect(reset(db, { templates: [{ id: 'x', name: 'A', content: 'a' }, { id: 'x', name: 'B', content: 'b' }] })).rejects.toThrow(/duplicate key|unique/i);
        expect(await count(db, 'pdc_cheques')).toBe(2);
        expect((await row(db, 'out_63_3_BROTHERS')).notes).toEqual(['[07 Sept - Vishnu] Promised 1L']);
        expect(await count(db, 'book_backups')).toBe(0);
        expect(await count(db, 'customers')).toBe(4);
    });
});

describe('restore_book_backup — the way back', () => {
    let db: PGlite;
    beforeAll(async () => { db = await freshDatabase(['supabase/reset.sql']); }, 60000);
    beforeEach(async () => {
        await db.exec(`delete from public.customer_activity; delete from public.pdc_cheques; delete from public.customers; delete from public.templates; delete from public.book_backups; delete from auth.users; delete from public.profiles;`);
        await seed(db);
        await actAs(db, ADMIN);
    });

    it('puts the book back as it was before the reset, without deleting the account the reset added', async () => {
        const r = await reset(db);
        const back = (await db.query<{ restore_book_backup: any }>(`select public.restore_book_backup($1::uuid) as restore_book_backup`, [r.backup_id])).rows[0].restore_book_backup;
        expect(back).toMatchObject({ restored: r.backup_id, customers: 4, cheques: 2 });
        const a = await row(db, 'out_63_3_BROTHERS');
        expect(a).toMatchObject({ notes: ['[07 Sept - Vishnu] Promised 1L'], status: 'Upcoming', is_urgent: true, crm_owner_id: 'VISHNU' });
        expect(Number(a.total)).toBe(393988);
        expect(a.follow_up_date).toBeTruthy();
        expect((await db.query<any>(`select id from public.pdc_cheques order by id`)).rows.map(q => q.id)).toEqual(['pdc_1', 'pdc_2']);
        expect((await db.query<any>(`select id from public.templates order by id`)).rows.map(t => t.id)).toEqual(['t_custom', 'template_default']);
        expect((await db.query<any>(`select profile from public.company_profile`)).rows[0].profile).toEqual({ companyName: 'Old Name' });
        expect((await db.query<any>(`select google_sheet_url, data_source_mode from public.app_settings`)).rows[0]).toEqual({ google_sheet_url: 'https://sheet.example/other', data_source_mode: 'excel' });
        expect(await count(db, 'customers')).toBe(5);              // BRAND NEW FIRM stays; nothing is ever deleted
        expect(await count(db, 'customer_activity')).toBe(3);      // threads were never touched
        expect((await db.query<any>(`select restored_at from public.book_backups where id = $1`, [r.backup_id])).rows[0].restored_at).toBeTruthy();
    });

    it('first snapshots the state it is replacing, so the restore can itself be undone', async () => {
        const r = await reset(db);
        const back = (await db.query<{ restore_book_backup: any }>(`select public.restore_book_backup($1::uuid) as restore_book_backup`, [r.backup_id])).rows[0].restore_book_backup;
        const before = (await db.query<any>(`select reason, counts, customers from public.book_backups where id = $1`, [back.snapshot_before])).rows[0];
        expect(before.reason).toBe('before_restore');
        expect(before.counts).toEqual({ restoring: r.backup_id });
        expect(before.customers.find((c: any) => c.id === 'out_63_3_BROTHERS').notes).toEqual([]);   // the post-reset state
    });

    it('is for Admins only', async () => {
        const r = await reset(db);
        await actAs(db, MANAGER);
        await expect(db.query(`select public.restore_book_backup($1::uuid)`, [r.backup_id])).rejects.toThrow(/Only an Admin/);
    });

    it('refuses an unknown backup id', async () => {
        await expect(db.query(`select public.restore_book_backup('99999999-9999-4999-8999-999999999999'::uuid)`)).rejects.toThrow(/No backup/);
    });
});
