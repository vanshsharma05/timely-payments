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
    -- Good pays to terms, Late pays slowly, Bad is old money stuck — the
    -- last of which is what the recovery agency is given.
    payment_rank         text check (payment_rank is null or payment_rank in ('Good','Late','Bad')),
    -- Kind of business: Builder / Dealer / Dealer Offset / Retailer, or the
    -- trade the account is in. Seeded from the Customer Master's CATEGORY
    -- column, edited here afterwards. Deliberately unconstrained — the master
    -- carries spellings nobody has told us about yet, and losing one on import
    -- is worse than storing it.
    category             text,

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

-- `create table if not exists` above does nothing to a database that already
-- has the table, so every column added after the first deployment needs saying
-- again here. Running this file a second time is a no-op.
alter table public.customers add column if not exists category text;

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

-- Permission matrix, enforced in the database.
--
-- The app hides buttons a role may not use; this makes the same rules true for
-- anything talking to PostgREST directly. Mirrors DEFAULT_ROLE_PERMISSIONS in
-- types.ts, and falls back to the role's default when a profile's permissions
-- object does not carry the key.
create or replace function public.has_perm(right_name text)
returns boolean language sql stable security definer set search_path = public as $$
    select case
        when p.role = 'Admin' then true
        when p.permissions ? right_name then coalesce((p.permissions ->> right_name)::boolean, false)
        else case right_name
            when 'canViewAllCrms'    then p.role in ('Manager','Viewer')
            when 'canAddCustomer'    then p.role in ('Manager','CRM')
            when 'canEditCustomer'   then p.role in ('Manager','CRM','Collector')
            when 'canEditFinancials' then p.role = 'Manager'
            when 'canDeleteCustomer' then false
            when 'canEditFollowUp'   then p.role in ('Manager','CRM','Collector')
            when 'canReassignCrm'    then p.role = 'Manager'
            when 'canManagePdc'      then p.role in ('Manager','CRM','Collector')
            when 'canExportData'     then p.role in ('Manager','CRM')
            else false
        end
    end
    from public.profiles p
    where p.id = auth.uid();
$$;

-- profiles ------------------------------------------------------------------
drop policy if exists profiles_read     on public.profiles;
drop policy if exists profiles_self_upd on public.profiles;
drop policy if exists profiles_admin_all on public.profiles;

create policy profiles_read on public.profiles
    for select to authenticated using (true);

-- Deliberately NO self-update policy. RLS policies are permissive: a rule
-- letting you edit your own row would also let you set your own role to
-- 'Admin' straight from the browser with the anon key, which is a complete
-- bypass of everything below. Profiles are changed by an Admin, through
-- Team & access, which goes via /api/team on the server.
create policy profiles_admin_all on public.profiles
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- customers -----------------------------------------------------------------
drop policy if exists customers_read on public.customers;
drop policy if exists customers_write on public.customers;
drop policy if exists customers_delete on public.customers;

create policy customers_read on public.customers
    for select to authenticated using (true);

-- Adding an account is its own right; editing one that exists is not. The
-- change sync updates existing rows and only inserts genuinely new ones, so
-- this can be strict without blocking a note.
create policy customers_write on public.customers
    for insert to authenticated
    with check (public.can_write() and public.has_perm('canAddCustomer'));

create policy customers_update on public.customers
    for update to authenticated using (public.can_write()) with check (public.can_write());

-- customers_delete is defined further down, once has_perm() exists.

-- pdc_cheques ---------------------------------------------------------------
drop policy if exists pdc_read on public.pdc_cheques;

create policy pdc_read on public.pdc_cheques
    for select to authenticated using (true);


-- customers: deleting an account is the destructive one, so it needs the right
-- as well as the role. Inserts and updates stay on can_write(), because the
-- change sync upserts a whole row for something as ordinary as a note.
drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers
    for delete to authenticated
    using (public.current_role() in ('Admin','Manager') and public.has_perm('canDeleteCustomer'));

-- pdc_cheques: recording and clearing cheques is its own right.
drop policy if exists pdc_write on public.pdc_cheques;
create policy pdc_write on public.pdc_cheques
    for all to authenticated
    using (public.can_write() and public.has_perm('canManagePdc'))
    with check (public.can_write() and public.has_perm('canManagePdc'));


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

-- ---------------------------------------------------------------------------
-- Daily reminders
--
-- One row of settings, and a log of what actually went out. The log is what
-- makes the panel honest: it shows the last run and its result rather than
-- claiming the reminder is "on".
-- ---------------------------------------------------------------------------
create table if not exists public.alert_settings (
    id                smallint primary key default 1 check (id = 1),
    daily_email       boolean not null default false,
    -- which roles receive their own digest
    recipient_roles   text[] not null default array['Admin','Manager','CRM','Collector'],
    -- skip the send for someone with nothing to chase
    skip_when_empty   boolean not null default true,
    -- extra addresses that always get the company summary
    extra_recipients  text[] not null default '{}',
    updated_at        timestamptz not null default now()
);

insert into public.alert_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.alert_log (
    id          bigserial primary key,
    sent_at     timestamptz not null default now(),
    kind        text not null default 'daily_email',
    recipients  integer not null default 0,
    delivered   integer not null default 0,
    failed      integer not null default 0,
    provider    text,
    detail      text,
    triggered_by text
);

create index if not exists alert_log_sent_idx on public.alert_log (sent_at desc);

alter table public.alert_settings enable row level security;
alter table public.alert_log      enable row level security;

drop policy if exists alert_settings_read on public.alert_settings;
drop policy if exists alert_settings_write on public.alert_settings;
create policy alert_settings_read on public.alert_settings
    for select to authenticated using (true);
create policy alert_settings_write on public.alert_settings
    for all to authenticated
    using (public.current_role() in ('Admin','Manager'))
    with check (public.current_role() in ('Admin','Manager'));

drop policy if exists alert_log_read on public.alert_log;
create policy alert_log_read on public.alert_log
    for select to authenticated using (true);
-- Only the server writes the log, with the service role.

drop trigger if exists touch_alert_settings on public.alert_settings;
create trigger touch_alert_settings before update on public.alert_settings
    for each row execute function public.touch_updated_at();
-- ============================================================================
-- CUSTOMER ACTIVITY — the shared record of what was said, and when
--
-- The follow-up form captures what happens next: a date, a promised amount, an
-- outcome. It had nowhere to put what actually happened — the call nobody
-- answered, the one that was cut off, the accountant who asked to be rung after
-- the 5th. That went into a free-text notes array with the date and the
-- author's name glued into the string, so it could not be sorted, filtered or
-- attributed.
--
-- This table is that record, and it is append-only. Nobody edits what a
-- colleague wrote; a promise is settled by adding the entry that settles it,
-- pointing back with resolves_id, so the whole history stays legible.
-- ============================================================================
create table if not exists public.customer_activity (
    id              uuid primary key default gen_random_uuid(),
    customer_id     text not null references public.customers(id) on delete cascade,

    -- The name is kept alongside the id so a departed colleague's entries still
    -- say who wrote them after the profile is gone.
    author_id       uuid references public.profiles(id) on delete set null,
    author_name     text not null default '',

    kind            text not null default 'note'
                    check (kind in ('note','no_answer','declined','promise','payment','visit','dispute','system')),
    body            text not null default '',

    -- Set when kind = 'promise': what they committed to, and by when.
    promised_amount numeric,
    promised_on     date,

    -- Points at the promise this entry settles. A promise answered by a
    -- 'payment' entry was kept; answered by anything else, it was not.
    resolves_id     uuid references public.customer_activity(id) on delete set null,

    created_at      timestamptz not null default now()
);

create index if not exists customer_activity_customer_idx
    on public.customer_activity (customer_id, created_at);
create index if not exists customer_activity_promise_idx
    on public.customer_activity (promised_on)
    where kind = 'promise';
create index if not exists customer_activity_resolves_idx
    on public.customer_activity (resolves_id)
    where resolves_id is not null;

alter table public.customer_activity enable row level security;

drop policy if exists customer_activity_read on public.customer_activity;
drop policy if exists customer_activity_insert on public.customer_activity;
drop policy if exists customer_activity_delete on public.customer_activity;

-- Everyone signed in reads the thread. That it is shared is the whole point:
-- whoever picks the account up next needs to know what was already tried.
create policy customer_activity_read on public.customer_activity
    for select using (auth.uid() is not null);

-- Writing takes the same right as logging a follow-up, and you may only write
-- as yourself.
create policy customer_activity_insert on public.customer_activity
    for insert with check (
        public.has_perm('canEditFollowUp') and author_id = auth.uid()
    );

-- No update policy at all: entries are a record, not a draft. An author can
-- remove their own slip, and an Admin can remove anything.
create policy customer_activity_delete on public.customer_activity
    for delete using (author_id = auth.uid() or public.is_admin());
