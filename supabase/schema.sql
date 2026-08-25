-- ============================================================================
-- Timely Payment — Supabase schema (phase 1)
--
-- Run this ONCE in the Supabase SQL Editor:
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Design notes
--  * Auth is Supabase Auth. `profiles.id` is the auth user id.
--  * `profiles.legacy_id` holds the CRM code that appears in the accounts sheet
--    ('ANKUR', 'PRIKSHIT', 'Admin', ...). Customer rows reference the CRM by
--    that text code, exactly as the sheet does, so the existing role-filtering
--    logic in getOutstandingForUser() keeps working with no changes.
--  * Supabase is the master record. The Google Sheet is an import source.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles: role + permission matrix, one row per auth user
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
    id               uuid primary key references auth.users(id) on delete cascade,
    legacy_id        text unique not null,
    name             text not null,
    email            text,
    role             text not null default 'CRM'
                     check (role in ('Admin','Manager','CRM','Collector','Viewer')),
    data_visibility  text not null default 'AssignedOnly'
                     check (data_visibility in ('All','AssignedOnly')),
    permissions      jsonb not null default '{}'::jsonb,
    assigned_crms    text[] not null default '{}',
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- customers: one row per outstanding account
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
    id                   text primary key,
    company              text not null,
    contact_person       text default '',
    contact_number       text default '',
    contact_post         text,
    additional_contacts  jsonb not null default '[]'::jsonb,
    email                text,
    city                 text,
    state                text,
    address              text,
    gstin                text,
    pan                  text,
    credit_limit         numeric,
    payment_terms_days   integer,
    payment_rank         text check (payment_rank in ('Good','Bad')),

    total                numeric not null default 0,
    total_type           text check (total_type in ('Dr','Cr')),
    ageing               jsonb not null default '{"1-45":0,"46-90":0,"91-135":0,">135":0}'::jsonb,
    ageing_types         jsonb not null default '{}'::jsonb,
    over90               numeric,
    over90_type          text check (over90_type in ('Dr','Cr')),
    due_over45           numeric,
    due_over45_type      text check (due_over45_type in ('Dr','Cr')),

    -- Text CRM code from the accounts sheet, matched against profiles.legacy_id
    crm_owner_id         text not null default '',
    assigned_collector_id text,

    follow_up_date       timestamptz,
    forecast_amount      numeric,
    forecast_date        timestamptz,
    status               text not null default 'Pending',
    notes                jsonb not null default '[]'::jsonb,
    is_urgent            boolean not null default false,
    is_new_customer      boolean not null default false,
    added_at             text,
    creation_date        timestamptz not null default now(),
    last_follow_up_on    timestamptz,

    updated_at           timestamptz not null default now(),
    updated_by           uuid references public.profiles(id) on delete set null
);

create index if not exists customers_crm_owner_idx on public.customers (upper(crm_owner_id));
create index if not exists customers_collector_idx on public.customers (upper(assigned_collector_id));
create index if not exists customers_follow_up_idx on public.customers (follow_up_date);

-- ---------------------------------------------------------------------------
-- pdc_cheques
-- ---------------------------------------------------------------------------
create table if not exists public.pdc_cheques (
    id             text primary key,
    customer_id    text references public.customers(id) on delete cascade,
    customer_name  text not null default '',
    cheque_number  text not null default '',
    bank_name      text default '',
    cheque_date    timestamptz,
    amount         numeric not null default 0,
    status         text not null default 'Pending'
                   check (status in ('Pending','DueToday','Cleared','Hold','Bounced')),
    received_date  timestamptz,
    cleared_date   timestamptz,
    remarks        text,
    crm_owner_id   text,
    added_by       text,
    updated_at     timestamptz not null default now()
);

create index if not exists pdc_customer_idx on public.pdc_cheques (customer_id);
create index if not exists pdc_date_idx on public.pdc_cheques (cheque_date);

-- ---------------------------------------------------------------------------
-- templates: WhatsApp / reminder message templates
-- ---------------------------------------------------------------------------
create table if not exists public.templates (
    id         text primary key,
    name       text not null,
    content    text not null default '',
    updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Singleton tables. `id` is pinned to 1 so there can only ever be one row.
-- ---------------------------------------------------------------------------
create table if not exists public.company_profile (
    id           smallint primary key default 1 check (id = 1),
    profile      jsonb not null default '{}'::jsonb,
    updated_at   timestamptz not null default now()
);

create table if not exists public.app_settings (
    id                        smallint primary key default 1 check (id = 1),
    data_source_mode          text not null default 'google',
    google_sheet_url          text default '',
    customer_master_sheet_url text default '',
    sheet_updated_till_date   text default '',
    last_sync_time            text default '',
    updated_at                timestamptz not null default now()
);

insert into public.company_profile (id, profile) values (1, '{}'::jsonb)
    on conflict (id) do nothing;
insert into public.app_settings (id) values (1)
    on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

do $$
declare t text;
begin
    foreach t in array array['profiles','customers','pdc_cheques','templates','company_profile','app_settings']
    loop
        execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
        execute format(
            'create trigger touch_%1$s before update on public.%1$s
             for each row execute function public.touch_updated_at()', t);
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Auth hook: every new auth user automatically gets a profile.
-- Role/legacy_id can be passed at sign-up time via user metadata; the very
-- first account to sign up becomes Admin so you are never locked out.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    is_first  boolean;
    new_role  text;
    new_legacy text;
begin
    select count(*) = 0 into is_first from public.profiles;

    new_role := coalesce(new.raw_user_meta_data->>'role', case when is_first then 'Admin' else 'CRM' end);
    new_legacy := coalesce(
        nullif(new.raw_user_meta_data->>'legacy_id', ''),
        upper(split_part(new.email, '@', 1))
    );

    -- Guarantee uniqueness of legacy_id
    while exists (select 1 from public.profiles p where p.legacy_id = new_legacy) loop
        new_legacy := new_legacy || '_' || substr(md5(random()::text), 1, 4);
    end loop;

    insert into public.profiles (id, legacy_id, name, email, role, data_visibility, assigned_crms)
    values (
        new.id,
        new_legacy,
        coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
        new.email,
        new_role,
        case when new_role in ('Admin','Manager','Viewer') then 'All' else 'AssignedOnly' end,
        case when new_role = 'CRM' then array[new_legacy] else '{}' end
    );
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Every signed-in user can READ the shared dataset (the app does its own
-- per-CRM view filtering). WRITES are gated on role, enforced in the database
-- so a modified client cannot bypass them.
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.customers      enable row level security;
alter table public.pdc_cheques    enable row level security;
alter table public.templates      enable row level security;
alter table public.company_profile enable row level security;
alter table public.app_settings   enable row level security;

-- Helper: current user's role, without recursive RLS on profiles.
create or replace function public.current_role()
returns text language sql stable security definer set search_path = public as $$
    select role from public.profiles where id = auth.uid();
$$;

create or replace function public.can_write()
returns boolean language sql stable security definer set search_path = public as $$
    select coalesce(public.current_role() in ('Admin','Manager','CRM','Collector'), false);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
    select coalesce(public.current_role() = 'Admin', false);
$$;

-- profiles ------------------------------------------------------------------
drop policy if exists profiles_read     on public.profiles;
drop policy if exists profiles_self_upd on public.profiles;
drop policy if exists profiles_admin_all on public.profiles;

create policy profiles_read on public.profiles
    for select to authenticated using (true);

create policy profiles_self_upd on public.profiles
    for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_admin_all on public.profiles
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- customers -----------------------------------------------------------------
drop policy if exists customers_read on public.customers;
drop policy if exists customers_write on public.customers;
drop policy if exists customers_delete on public.customers;

create policy customers_read on public.customers
    for select to authenticated using (true);

create policy customers_write on public.customers
    for insert to authenticated with check (public.can_write());

create policy customers_update on public.customers
    for update to authenticated using (public.can_write()) with check (public.can_write());

create policy customers_delete on public.customers
    for delete to authenticated using (public.current_role() in ('Admin','Manager'));

-- pdc_cheques ---------------------------------------------------------------
drop policy if exists pdc_read on public.pdc_cheques;
drop policy if exists pdc_write on public.pdc_cheques;

create policy pdc_read on public.pdc_cheques
    for select to authenticated using (true);

create policy pdc_write on public.pdc_cheques
    for all to authenticated using (public.can_write()) with check (public.can_write());

-- templates / company_profile / app_settings --------------------------------
drop policy if exists templates_read on public.templates;
drop policy if exists templates_write on public.templates;
create policy templates_read on public.templates
    for select to authenticated using (true);
create policy templates_write on public.templates
    for all to authenticated
    using (public.current_role() in ('Admin','Manager'))
    with check (public.current_role() in ('Admin','Manager'));

drop policy if exists company_read on public.company_profile;
drop policy if exists company_write on public.company_profile;
create policy company_read on public.company_profile
    for select to authenticated using (true);
create policy company_write on public.company_profile
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_read on public.app_settings;
drop policy if exists settings_write on public.app_settings;
create policy settings_read on public.app_settings
    for select to authenticated using (true);
create policy settings_write on public.app_settings
    for all to authenticated
    using (public.current_role() in ('Admin','Manager'))
    with check (public.current_role() in ('Admin','Manager'));
