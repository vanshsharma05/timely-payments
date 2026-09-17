-- ============================================================================
-- Timely Payment — "Complete fresh start" as one transaction, with a snapshot
--
-- Run this ONCE in the Supabase SQL Editor, after schema.sql (it needs the
-- tables and the role helpers defined there). Running it again is a no-op.
--
-- Why this exists
--   The reset used to run in the browser as hundreds of separate requests:
--   delete every cheque one by one, overwrite or delete every customer,
--   re-create the sheet's accounts under new ids. A network error halfway
--   left a half-reset book; a Manager's deletes were refused by RLS and left
--   duplicates; 672 accounts with legacy ids were deleted with their cheques
--   and their whole activity thread; and there was no backup and no record of
--   who pressed it. (docs/product-audit/11-SECURITY-RELIABILITY.md, Part 3.)
--
-- What reset_book() does, all inside one transaction — so either everything
-- below happens or nothing does:
--   1. Writes a snapshot of customers, cheques, templates, company profile
--      and settings into book_backups, with who ran it and the counts.
--   2. Deletes every post-dated cheque.
--   3. On EVERY account, clears the follow-up work: notes mirror, follow-up
--      date, status (back to Pending), forecast, last-follow-up stamp,
--      urgency. Who the customer is, who owns them, their collector,
--      contacts, rank, category and the activity thread are NOT touched, and
--      no account is deleted or given a new id.
--   4. Applies the figures the caller computed from the sheet (the same
--      merge the balance sync uses): money for the accounts the sheet lists,
--      nil + a settlement stamp for the ones it no longer lists.
--   5. Inserts the accounts the sheet names that the book has never seen.
--   6. Puts the templates, company profile and data-source settings back to
--      the defaults handed in.
--
-- The caller must be an Admin or Manager (the same two roles that see the
-- Data source tab) and must pass the phrase the confirmation dialog asked for.
-- ============================================================================

create table if not exists public.book_backups (
    id               uuid primary key default gen_random_uuid(),
    created_at       timestamptz not null default now(),
    created_by       uuid references public.profiles(id) on delete set null,
    created_by_name  text not null default '',
    -- 'reset' for the snapshot a reset takes first; 'before_restore' for the
    -- one a restore takes first, so a restore is itself reversible.
    reason           text not null default 'reset',
    counts           jsonb not null default '{}'::jsonb,
    customers        jsonb not null default '[]'::jsonb,
    pdc_cheques      jsonb not null default '[]'::jsonb,
    templates        jsonb not null default '[]'::jsonb,
    company_profile  jsonb not null default '{}'::jsonb,
    app_settings     jsonb not null default '{}'::jsonb,
    restored_at      timestamptz
);

alter table public.book_backups enable row level security;

drop policy if exists book_backups_read on public.book_backups;
create policy book_backups_read on public.book_backups
    for select to authenticated
    using (public.current_role() in ('Admin','Manager'));
-- No insert/update/delete policy on purpose: only the two functions below
-- write here, and they run as their owner.

-- ---------------------------------------------------------------------------
-- reset_book
-- ---------------------------------------------------------------------------
create or replace function public.reset_book(
    p_updates   jsonb,   -- one entry per account on file: {id, total, total_type, ageing, ageing_types, over90, over90_type, due_over45, due_over45_type, settled_at}
    p_inserts   jsonb,   -- accounts the sheet names that are not on file, as full customer rows (snake_case)
    p_templates jsonb,   -- [{id, name, content}] — the defaults
    p_profile   jsonb,   -- the default company profile
    p_settings  jsonb,   -- {data_source_mode, google_sheet_url, sheet_updated_till_date, last_sync_time}
    p_phrase    text     -- must be 'RESET'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid        uuid := auth.uid();
    v_role       text;
    v_name       text;
    v_backup     uuid;
    v_on_file    integer;
    v_cheques    integer;
    v_updated    integer;
    v_inserted   integer;
    v_settled    integer;
    v_missing    integer;
begin
    select role, name into v_role, v_name from public.profiles where id = v_uid;
    if v_role is null or v_role not in ('Admin', 'Manager') then
        raise exception 'Only an Admin or Manager can reset the book.' using errcode = '42501';
    end if;
    if p_phrase is distinct from 'RESET' then
        raise exception 'The confirmation phrase did not match. Nothing was changed.';
    end if;
    if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
        raise exception 'The plan for the accounts on file was malformed. Nothing was changed.';
    end if;
    if p_inserts is null or jsonb_typeof(p_inserts) <> 'array' then
        raise exception 'The list of accounts to add was malformed. Nothing was changed.';
    end if;

    -- The plan was computed from the book as one tab saw it. If the book has
    -- changed since — an account added or removed by somebody else — the plan
    -- no longer describes it, and the safe answer is to stop and say so.
    select count(*) into v_on_file from public.customers;
    select count(*) into v_missing
      from jsonb_array_elements(p_updates) u
      left join public.customers c on c.id = u->>'id'
     where c.id is null;
    if v_missing > 0 then
        raise exception 'The plan names % account(s) that are no longer on file. Reload and try again; nothing was changed.', v_missing;
    end if;
    if (select count(distinct u->>'id') from jsonb_array_elements(p_updates) u) <> v_on_file then
        raise exception 'The book has changed since it was loaded (% on file, % in the plan). Reload and try again; nothing was changed.',
            v_on_file, (select count(distinct u->>'id') from jsonb_array_elements(p_updates) u);
    end if;
    if exists (select 1 from jsonb_array_elements(p_inserts) i join public.customers c on c.id = i->>'id') then
        raise exception 'The plan would add an account that already exists. Reload and try again; nothing was changed.';
    end if;

    -- 1. The snapshot, in the same transaction as everything it protects.
    select count(*) into v_cheques from public.pdc_cheques;
    insert into public.book_backups (created_by, created_by_name, reason, customers, pdc_cheques, templates, company_profile, app_settings)
    select v_uid,
           coalesce(v_name, ''),
           'reset',
           coalesce((select jsonb_agg(to_jsonb(c)) from public.customers c), '[]'::jsonb),
           coalesce((select jsonb_agg(to_jsonb(q)) from public.pdc_cheques q), '[]'::jsonb),
           coalesce((select jsonb_agg(to_jsonb(t)) from public.templates t), '[]'::jsonb),
           coalesce((select profile from public.company_profile where id = 1), '{}'::jsonb),
           coalesce((select to_jsonb(s) from public.app_settings s where id = 1), '{}'::jsonb)
    returning id into v_backup;

    -- 2. Cheques.
    delete from public.pdc_cheques;

    -- 3. Follow-up work, on every account. Nothing else on the row moves here.
    update public.customers
       set notes = '[]'::jsonb,
           follow_up_date = null,
           status = 'Pending',
           forecast_amount = null,
           forecast_date = null,
           last_follow_up_on = null,
           is_urgent = false;

    -- 4. Money, as the caller's merge computed it (sheet figures, or nil and
    --    a settlement stamp for an account the sheet no longer lists). Counted
    --    first: the accounts that owe something now and come out of this at nil.
    select count(*) into v_settled
      from jsonb_array_elements(p_updates) u
      join public.customers c on c.id = u->>'id'
     where u->>'settled_at' is not null
       and abs(coalesce(c.total, 0)) > 0
       and abs(coalesce((u->>'total')::numeric, 0)) = 0;
    update public.customers c
       set total = coalesce(u.total, 0),
           total_type = u.total_type,
           ageing = coalesce(u.ageing, '{"1-45":0,"46-90":0,"91-135":0,">135":0}'::jsonb),
           ageing_types = coalesce(u.ageing_types, '{}'::jsonb),
           over90 = u.over90,
           over90_type = u.over90_type,
           due_over45 = u.due_over45,
           due_over45_type = u.due_over45_type,
           settled_at = u.settled_at
      from jsonb_to_recordset(p_updates) as u(
               id text, total numeric, total_type text, ageing jsonb, ageing_types jsonb,
               over90 numeric, over90_type text, due_over45 numeric, due_over45_type text, settled_at text)
     where c.id = u.id;
    get diagnostics v_updated = row_count;

    -- 5. Names the book has never seen. Column by column, so the database's
    --    own defaults fill updated_at / updated_by.
    insert into public.customers (
        id, company, contact_person, contact_number, contact_post, additional_contacts, email, city, state, address,
        gstin, pan, credit_limit, payment_terms_days, payment_rank, category,
        total, total_type, ageing, ageing_types, over90, over90_type, due_over45, due_over45_type,
        crm_owner_id, assigned_collector_id, follow_up_date, forecast_amount, forecast_date, status, notes,
        is_urgent, is_new_customer, added_at, creation_date, last_follow_up_on, settled_at)
    select i.id, coalesce(i.company, ''), coalesce(i.contact_person, ''), coalesce(i.contact_number, ''), i.contact_post,
           coalesce(i.additional_contacts, '[]'::jsonb), i.email, i.city, i.state, i.address,
           i.gstin, i.pan, i.credit_limit, i.payment_terms_days, i.payment_rank, i.category,
           coalesce(i.total, 0), i.total_type, coalesce(i.ageing, '{"1-45":0,"46-90":0,"91-135":0,">135":0}'::jsonb), coalesce(i.ageing_types, '{}'::jsonb),
           i.over90, i.over90_type, i.due_over45, i.due_over45_type,
           coalesce(i.crm_owner_id, ''), i.assigned_collector_id, null, null, null, 'Pending', '[]'::jsonb,
           false, coalesce(i.is_new_customer, false), i.added_at, coalesce(i.creation_date, now()), null, i.settled_at
      from jsonb_populate_recordset(null::public.customers, p_inserts) i
     where i.id is not null and i.id <> '';
    get diagnostics v_inserted = row_count;

    -- 6. Templates, profile and settings back to the defaults handed in. The
    --    customer-master sheet URL is kept: it is configuration, not data.
    delete from public.templates;
    insert into public.templates (id, name, content)
    select t.id, t.name, coalesce(t.content, '')
      from jsonb_to_recordset(coalesce(p_templates, '[]'::jsonb)) as t(id text, name text, content text)
     where t.id is not null and t.name is not null;

    insert into public.company_profile (id, profile) values (1, coalesce(p_profile, '{}'::jsonb))
    on conflict (id) do update set profile = excluded.profile;

    insert into public.app_settings (id, data_source_mode, google_sheet_url, sheet_updated_till_date, last_sync_time)
    values (1,
            coalesce(p_settings->>'data_source_mode', 'google'),
            coalesce(p_settings->>'google_sheet_url', ''),
            coalesce(p_settings->>'sheet_updated_till_date', ''),
            coalesce(p_settings->>'last_sync_time', ''))
    on conflict (id) do update
        set data_source_mode = excluded.data_source_mode,
            google_sheet_url = excluded.google_sheet_url,
            sheet_updated_till_date = excluded.sheet_updated_till_date,
            last_sync_time = excluded.last_sync_time;

    -- 7. The record of what happened, on the snapshot itself.
    update public.book_backups
       set counts = jsonb_build_object(
               'accounts_on_file', v_on_file,
               'accounts_updated', v_updated,
               'accounts_settled', v_settled,
               'accounts_added', v_inserted,
               'cheques_deleted', v_cheques)
     where id = v_backup;

    return jsonb_build_object(
        'backup_id', v_backup,
        'accounts_on_file', v_on_file,
        'accounts_updated', v_updated,
        'accounts_settled', v_settled,
        'accounts_added', v_inserted,
        'cheques_deleted', v_cheques);
end;
$$;

revoke all on function public.reset_book(jsonb, jsonb, jsonb, jsonb, jsonb, text) from public;
revoke all on function public.reset_book(jsonb, jsonb, jsonb, jsonb, jsonb, text) from anon;
grant execute on function public.reset_book(jsonb, jsonb, jsonb, jsonb, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- restore_book_backup: the way back.
--
-- Puts every customer row in the snapshot back exactly as it was (an account
-- created after the snapshot is left alone — nothing here deletes a customer,
-- so no thread or cheque is ever cascaded away), puts the cheques, templates,
-- profile and settings back, and first takes a snapshot of the current state
-- so that the restore can itself be undone. Admin only.
-- ---------------------------------------------------------------------------
create or replace function public.restore_book_backup(p_backup uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid       uuid := auth.uid();
    v_role      text;
    v_name      text;
    b           public.book_backups%rowtype;
    v_before    uuid;
    v_customers integer;
    v_cheques   integer;
begin
    select role, name into v_role, v_name from public.profiles where id = v_uid;
    if v_role is null or v_role <> 'Admin' then
        raise exception 'Only an Admin can restore a backup.' using errcode = '42501';
    end if;
    select * into b from public.book_backups where id = p_backup;
    if not found then
        raise exception 'No backup with that id.';
    end if;

    -- The state being replaced, kept so the restore is reversible.
    insert into public.book_backups (created_by, created_by_name, reason, customers, pdc_cheques, templates, company_profile, app_settings, counts)
    select v_uid, coalesce(v_name, ''), 'before_restore',
           coalesce((select jsonb_agg(to_jsonb(c)) from public.customers c), '[]'::jsonb),
           coalesce((select jsonb_agg(to_jsonb(q)) from public.pdc_cheques q), '[]'::jsonb),
           coalesce((select jsonb_agg(to_jsonb(t)) from public.templates t), '[]'::jsonb),
           coalesce((select profile from public.company_profile where id = 1), '{}'::jsonb),
           coalesce((select to_jsonb(s) from public.app_settings s where id = 1), '{}'::jsonb),
           jsonb_build_object('restoring', p_backup)
    returning id into v_before;

    insert into public.customers (
        id, company, contact_person, contact_number, contact_post, additional_contacts, email, city, state, address,
        gstin, pan, credit_limit, payment_terms_days, payment_rank, category,
        total, total_type, ageing, ageing_types, over90, over90_type, due_over45, due_over45_type,
        crm_owner_id, assigned_collector_id, follow_up_date, forecast_amount, forecast_date, status, notes,
        is_urgent, is_new_customer, added_at, creation_date, last_follow_up_on, settled_at)
    select c.id, c.company, c.contact_person, c.contact_number, c.contact_post, c.additional_contacts, c.email, c.city, c.state, c.address,
           c.gstin, c.pan, c.credit_limit, c.payment_terms_days, c.payment_rank, c.category,
           c.total, c.total_type, c.ageing, c.ageing_types, c.over90, c.over90_type, c.due_over45, c.due_over45_type,
           c.crm_owner_id, c.assigned_collector_id, c.follow_up_date, c.forecast_amount, c.forecast_date, c.status, c.notes,
           c.is_urgent, c.is_new_customer, c.added_at, c.creation_date, c.last_follow_up_on, c.settled_at
      from jsonb_populate_recordset(null::public.customers, b.customers) c
     where c.id is not null
    on conflict (id) do update set
        company = excluded.company, contact_person = excluded.contact_person, contact_number = excluded.contact_number,
        contact_post = excluded.contact_post, additional_contacts = excluded.additional_contacts, email = excluded.email,
        city = excluded.city, state = excluded.state, address = excluded.address, gstin = excluded.gstin, pan = excluded.pan,
        credit_limit = excluded.credit_limit, payment_terms_days = excluded.payment_terms_days, payment_rank = excluded.payment_rank,
        category = excluded.category, total = excluded.total, total_type = excluded.total_type, ageing = excluded.ageing,
        ageing_types = excluded.ageing_types, over90 = excluded.over90, over90_type = excluded.over90_type,
        due_over45 = excluded.due_over45, due_over45_type = excluded.due_over45_type, crm_owner_id = excluded.crm_owner_id,
        assigned_collector_id = excluded.assigned_collector_id, follow_up_date = excluded.follow_up_date,
        forecast_amount = excluded.forecast_amount, forecast_date = excluded.forecast_date, status = excluded.status,
        notes = excluded.notes, is_urgent = excluded.is_urgent, is_new_customer = excluded.is_new_customer,
        added_at = excluded.added_at, creation_date = excluded.creation_date, last_follow_up_on = excluded.last_follow_up_on,
        settled_at = excluded.settled_at;
    get diagnostics v_customers = row_count;

    delete from public.pdc_cheques;
    insert into public.pdc_cheques (id, customer_id, customer_name, cheque_number, bank_name, cheque_date, amount, status,
                                    received_date, cleared_date, remarks, crm_owner_id, added_by)
    select q.id, q.customer_id, coalesce(q.customer_name, ''), coalesce(q.cheque_number, ''), q.bank_name, q.cheque_date,
           coalesce(q.amount, 0), coalesce(q.status, 'Pending'), q.received_date, q.cleared_date, q.remarks, q.crm_owner_id, q.added_by
      from jsonb_populate_recordset(null::public.pdc_cheques, b.pdc_cheques) q
     where q.id is not null;
    get diagnostics v_cheques = row_count;

    delete from public.templates;
    insert into public.templates (id, name, content)
    select t.id, t.name, coalesce(t.content, '')
      from jsonb_populate_recordset(null::public.templates, b.templates) t
     where t.id is not null;

    insert into public.company_profile (id, profile) values (1, coalesce(b.company_profile, '{}'::jsonb))
    on conflict (id) do update set profile = excluded.profile;

    if b.app_settings <> '{}'::jsonb then
        insert into public.app_settings (id, data_source_mode, google_sheet_url, customer_master_sheet_url, sheet_updated_till_date, last_sync_time)
        values (1,
                coalesce(b.app_settings->>'data_source_mode', 'google'),
                coalesce(b.app_settings->>'google_sheet_url', ''),
                coalesce(b.app_settings->>'customer_master_sheet_url', ''),
                coalesce(b.app_settings->>'sheet_updated_till_date', ''),
                coalesce(b.app_settings->>'last_sync_time', ''))
        on conflict (id) do update
            set data_source_mode = excluded.data_source_mode,
                google_sheet_url = excluded.google_sheet_url,
                customer_master_sheet_url = excluded.customer_master_sheet_url,
                sheet_updated_till_date = excluded.sheet_updated_till_date,
                last_sync_time = excluded.last_sync_time;
    end if;

    update public.book_backups set restored_at = now() where id = p_backup;

    return jsonb_build_object('restored', p_backup, 'snapshot_before', v_before, 'customers', v_customers, 'cheques', v_cheques);
end;
$$;

revoke all on function public.restore_book_backup(uuid) from public;
revoke all on function public.restore_book_backup(uuid) from anon;
grant execute on function public.restore_book_backup(uuid) to authenticated;
