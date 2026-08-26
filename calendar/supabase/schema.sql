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
  color       text not null default '#27478f',
  birthday    text,                          -- 'MM-DD', or 'YYYY-MM-DD' to get an age
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

-- ── proposals ─────────────────────────────────────────────
-- "Can we go on a date Friday?" — an ask that carries one or more
-- suggested times, waits for the other phone to answer, and becomes a
-- real event only once someone accepts.
--
-- Both phones share one login, so who-asked-whom is the device owner
-- name from Settings, not an auth user.
--
-- options is [{ "start": ISO, "end": ISO|null, "all_day": bool }, …]
-- kept in order; chosen_index points at the one that was accepted.
--
-- A decline can carry a counter-offer, which is stored as a *new* row
-- pointing back through counter_of, so the exchange stays readable
-- rather than one row being rewritten each time.
create table if not exists calendar.proposals (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  notes        text,
  location     text,
  asked_by     text not null,                  -- device owner name
  person_ids   uuid[] not null default '{}',   -- who it's for; empty = the two of you
  options      jsonb not null,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'declined', 'superseded')),
  answered_by  text,
  answered_at  timestamptz,
  reply_note   text,
  chosen_index int,
  event_id     uuid references calendar.events(id) on delete set null,
  counter_of   uuid references calendar.proposals(id) on delete set null,
  seen_by_asker boolean not null default false, -- so an answer can stop nagging
  created_at   timestamptz not null default now()
);

create index if not exists proposals_status_idx on calendar.proposals (status, created_at desc);

-- ── spending ──────────────────────────────────────────────
-- A want list with a cooling-off period, plus the purchases that
-- burn down the monthly budget.
--
-- The want list is the point of the thing: instead of buying, you write
-- it down and the app puts a decision on a future day. `decide_on` is a
-- date rather than a timestamp because it belongs on a calendar square.
--
--   waiting → the cooling-off period is running
--   let_go  → talked yourself out of it; `price` is banked as saved
--   bought  → decided yes, which is a considered purchase and fine;
--             the actual charge lands in `spends` as a 'wanted' row
create table if not exists calendar.spend_items (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  price       numeric(10,2) not null default 0,
  place       text,
  notes       text,
  owner       text,                            -- device owner name
  status      text not null default 'waiting'
              check (status in ('waiting', 'let_go', 'bought')),
  decide_on   date not null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists spend_items_open_idx
  on calendar.spend_items (decide_on) where status = 'waiting';

-- One logged purchase.
--   needed → gas, groceries, a haircut. Comes out of the budget, but
--            isn't what this is trying to change.
--   wanted → the thing this exists for.
-- item_id is set when the purchase came off the want list, so a bought
-- item and its charge stay tied together.
create table if not exists calendar.spends (
  id         uuid primary key default gen_random_uuid(),
  spent_on   date not null default current_date,
  amount     numeric(10,2) not null,
  kind       text not null default 'wanted' check (kind in ('needed', 'wanted')),
  note       text,
  owner      text,
  item_id    uuid references calendar.spend_items(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists spends_spent_on_idx on calendar.spends (spent_on);

-- ── household settings ────────────────────────────────────
-- Single row. Keeps both phones agreeing on timezone / week start.
create table if not exists calendar.household_settings (
  id             int primary key default 1 check (id = 1),
  timezone       text,                          -- app fills from device on first run
  week_starts_on int not null default 0,        -- 0 = Sunday, 1 = Monday
  anniversary    text,                          -- same format as people.birthday
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
  foreach t in array array['people', 'events', 'event_exceptions', 'household_settings',
                          'proposals', 'spend_items', 'spends']
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
  foreach t in array array['people', 'events', 'event_exceptions', 'household_settings',
                          'proposals', 'spend_items', 'spends']
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

-- ── migrations for an install that predates a column ──────
-- The create-table statements above only fire on an empty database, so
-- anything added later needs an explicit alter as well. Both are no-ops
-- on a fresh install.
alter table calendar.people
  add column if not exists birthday text;
alter table calendar.household_settings
  add column if not exists anniversary text;

-- The personal monthly spending budget the burn-down runs against.
-- Editable in the app under ⚙ Settings → Spending.
alter table calendar.household_settings
  add column if not exists spend_budget numeric(10,2) not null default 600;

-- Format guard: 'MM-DD', or 'YYYY-MM-DD' when the year is known.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'people_birthday_format') then
    alter table calendar.people add constraint people_birthday_format
      check (birthday is null or birthday ~ '^(\d{4}-)?\d{2}-\d{2}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_anniversary_format') then
    alter table calendar.household_settings add constraint settings_anniversary_format
      check (anniversary is null or anniversary ~ '^(\d{4}-)?\d{2}-\d{2}$');
  end if;
end $$;

-- ── seed people ───────────────────────────────────────────
-- Only fills an empty table, so re-running never duplicates.
-- People can also be added, renamed and recoloured in the app.
insert into calendar.people (name, color, sort_order)
select * from (values
  ('Hunter',  '#27478f', 1),   -- Delft cobalt
  ('Marloes', '#a3242c', 2),   -- crimson
  ('Lars',    '#3f7350', 3),   -- deep green
  ('Sam',     '#c98a2b', 4),   -- ochre
  ('Silas',   '#7b4b8a', 5)    -- plum
) as seed(name, color, sort_order)
where not exists (select 1 from calendar.people);

-- ── seed birthdays and the anniversary ────────────────────
-- Only fills a blank one, so re-running never overwrites a date you
-- have since corrected in the app. Add a year in front of any of these
-- ('1985-03-03') and the calendar starts showing an age.
update calendar.people p
   set birthday = seed.b
  from (values
    ('Hunter',  '03-03'),
    ('Marloes', '08-14'),
    ('Sam',     '04-27'),   -- Koningsdag, as it happens
    ('Lars',    '09-29'),
    ('Silas',   '01-05')
  ) as seed(n, b)
 where p.name = seed.n
   and p.birthday is null;

update calendar.household_settings
   set anniversary = '08-07'
 where id = 1
   and anniversary is null;
