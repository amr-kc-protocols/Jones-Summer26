-- ============================================================
--  Jones Family Calendar — Supabase schema
--  Safe to re-run: every statement is idempotent.
--  Paste into Supabase → SQL Editor → Run.
-- ============================================================

create extension if not exists pgcrypto;

-- ── people ────────────────────────────────────────────────
-- One row per family member. Drives the colour coding and the
-- "who is this for?" picker. Add/rename people here, no code change.
create table if not exists public.people (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text not null default '#4f9cf9',
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ── events ────────────────────────────────────────────────
-- person_ids empty = whole-family event.
-- Several people per event is normal here ("first day of school,
-- Sam and Lars"), hence an array rather than one column.
-- rrule null      = one-off event.
create table if not exists public.events (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  notes            text,
  location         text,
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  all_day          boolean not null default false,
  person_ids       uuid[] not null default '{}',
  color            text,                       -- optional override of person colour
  rrule            text,                       -- FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE
  recurrence_until date,                       -- null = forever
  created_by       text,                       -- which of you entered it
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Migration for anyone who ran the first version of this file, which
-- had a single person_id column. No-op on a fresh database.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'person_id'
  ) then
    alter table public.events add column if not exists person_ids uuid[] not null default '{}';
    update public.events set person_ids = array[person_id]
      where person_id is not null and person_ids = '{}';
    alter table public.events drop column person_id;
  end if;
end $$;

create index if not exists events_starts_at_idx  on public.events (starts_at);
create index if not exists events_person_ids_idx on public.events using gin (person_ids);
create index if not exists events_recurring_idx  on public.events (rrule) where rrule is not null;

-- ── recurrence exceptions ─────────────────────────────────
-- Lets you cancel or edit a single occurrence of a repeating
-- event without touching the rest of the series.
--   action 'skip'     → that date is hidden
--   action 'override' → overrides jsonb replaces those fields
create table if not exists public.event_exceptions (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  occurrence_date date not null,
  action          text not null check (action in ('skip', 'override')),
  overrides       jsonb,
  created_at      timestamptz not null default now(),
  unique (event_id, occurrence_date)
);

create index if not exists event_exceptions_event_idx on public.event_exceptions (event_id);

-- ── household settings ────────────────────────────────────
-- Single row. Keeps both phones agreeing on timezone / week start.
create table if not exists public.household_settings (
  id             int primary key default 1 check (id = 1),
  timezone       text,                          -- app fills from device on first run
  week_starts_on int not null default 0,        -- 0 = Sunday, 1 = Monday
  updated_at     timestamptz not null default now()
);

insert into public.household_settings (id) values (1)
on conflict (id) do nothing;

-- ── updated_at trigger ────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_updated_at();

drop trigger if exists settings_touch_updated_at on public.household_settings;
create trigger settings_touch_updated_at
  before update on public.household_settings
  for each row execute function public.touch_updated_at();

-- ── row level security ────────────────────────────────────
-- The site is public, so the anon key is public too. These policies
-- grant nothing to anon: you must be signed in as the household
-- account (see SETUP.md) before any row is readable or writable.
do $$
declare t text;
begin
  foreach t in array array['people', 'events', 'event_exceptions', 'household_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists household_all on public.%I', t);
    execute format(
      'create policy household_all on public.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- ── realtime ──────────────────────────────────────────────
-- So an edit on one phone appears on the other without a refresh.
do $$
declare t text;
begin
  foreach t in array array['people', 'events', 'event_exceptions', 'household_settings']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── seed people ───────────────────────────────────────────
-- Only fills an empty table, so re-running never duplicates.
-- People can also be added, renamed and recoloured in the app.
insert into public.people (name, color, sort_order)
select * from (values
  ('Hunter',  '#2563eb', 1),
  ('Marloes', '#db2777', 2),
  ('Lars',    '#16a34a', 3),
  ('Sam',     '#ea580c', 4),
  ('Silas',   '#7c3aed', 5)
) as seed(name, color, sort_order)
where not exists (select 1 from public.people);
