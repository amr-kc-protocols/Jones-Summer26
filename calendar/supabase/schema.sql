-- ============================================================
--  Jones Family Calendar — Supabase schema
--
--  Installs into its own `calendar` schema, so it can share a
--  Supabase project with something else without colliding.
--
--  Safe to re-run: every statement is idempotent.
--  Paste into Supabase → SQL Editor → Run.
-- ============================================================

create extension if not exists pgcrypto;

create schema if not exists calendar;

-- ── who is allowed in ─────────────────────────────────────
-- Auth is shared across a whole Supabase project, so "is logged in"
-- is NOT a sufficient test when the project also hosts another app:
-- any user of that app would pass it. Every policy below instead
-- requires this exact account.
--
-- To point the calendar at a different account later, change the
-- address here and re-run the file. Nothing else needs editing.
create or replace function calendar.is_household()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'family@jonescalendar.local';
$$;

-- ── people ────────────────────────────────────────────────
-- One row per family member. Drives the colour coding and the
-- "who is this for?" picker. Add/rename people here, no code change.
create table if not exists calendar.people (
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
-- rrule null = one-off event.
create table if not exists calendar.events (
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

create index if not exists events_starts_at_idx  on calendar.events (starts_at);
create index if not exists events_person_ids_idx on calendar.events using gin (person_ids);
create index if not exists events_recurring_idx  on calendar.events (rrule) where rrule is not null;

-- ── recurrence exceptions ─────────────────────────────────
-- Lets you cancel or edit a single occurrence of a repeating
-- event without touching the rest of the series.
--   action 'skip'     → that date is hidden
--   action 'override' → overrides jsonb replaces those fields
create table if not exists calendar.event_exceptions (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references calendar.events(id) on delete cascade,
  occurrence_date date not null,
  action          text not null check (action in ('skip', 'override')),
  overrides       jsonb,
  created_at      timestamptz not null default now(),
  unique (event_id, occurrence_date)
);

create index if not exists event_exceptions_event_idx on calendar.event_exceptions (event_id);

-- ── household settings ────────────────────────────────────
-- Single row. Keeps both phones agreeing on timezone / week start.
create table if not exists calendar.household_settings (
  id             int primary key default 1 check (id = 1),
  timezone       text,                          -- app fills from device on first run
  week_starts_on int not null default 0,        -- 0 = Sunday, 1 = Monday
  updated_at     timestamptz not null default now()
);

insert into calendar.household_settings (id) values (1)
on conflict (id) do nothing;

-- ── updated_at trigger ────────────────────────────────────
create or replace function calendar.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on calendar.events;
create trigger events_touch_updated_at
  before update on calendar.events
  for each row execute function calendar.touch_updated_at();

drop trigger if exists settings_touch_updated_at on calendar.household_settings;
create trigger settings_touch_updated_at
  before update on calendar.household_settings
  for each row execute function calendar.touch_updated_at();

-- ── grants ────────────────────────────────────────────────
-- Only `authenticated` gets anything; `anon` is deliberately left
-- with no access at all, since the app signs in before it reads.
-- Row-level security below is what actually filters the rows.
grant usage on schema calendar to authenticated;
grant select, insert, update, delete on all tables in schema calendar to authenticated;
alter default privileges in schema calendar
  grant select, insert, update, delete on tables to authenticated;

-- ── row level security ────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['people', 'events', 'event_exceptions', 'household_settings']
  loop
    execute format('alter table calendar.%I enable row level security', t);
    execute format('drop policy if exists household_all on calendar.%I', t);
    execute format(
      'create policy household_all on calendar.%I for all to authenticated '
      'using (calendar.is_household()) with check (calendar.is_household())',
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
        and schemaname = 'calendar'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table calendar.%I', t);
    end if;
  end loop;
end $$;

-- ── seed people ───────────────────────────────────────────
-- Only fills an empty table, so re-running never duplicates.
-- People can also be added, renamed and recoloured in the app.
insert into calendar.people (name, color, sort_order)
select * from (values
  ('Hunter',  '#2563eb', 1),
  ('Marloes', '#db2777', 2),
  ('Lars',    '#16a34a', 3),
  ('Sam',     '#ea580c', 4),
  ('Silas',   '#7c3aed', 5)
) as seed(name, color, sort_order)
where not exists (select 1 from calendar.people);
