-- ============================================================
--  Jones Family Calendar — the Money tab
--
--  Adds the want list and the spending log to a calendar that is
--  already installed. Safe to run more than once.
--
--  Supabase dashboard → SQL Editor → New query → paste → Run.
-- ============================================================

-- Fail with something readable rather than a policy error if this is
-- pointed at a database that has never had schema.sql run on it.
do $$
begin
  if to_regprocedure('calendar.is_household()') is null then
    raise exception
      'The calendar schema is not installed here — run supabase/schema.sql first.';
  end if;
end $$;

-- ── the want list ─────────────────────────────────────────
-- Instead of buying, you write it down and the app puts a decision on a
-- future day. `decide_on` is a date rather than a timestamp because it
-- belongs on a calendar square.
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

-- ── what actually went out ────────────────────────────────
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

-- ── the monthly budget ────────────────────────────────────
-- Editable afterwards in the app, under ⚙ Settings → Spending.
alter table calendar.household_settings
  add column if not exists spend_budget numeric(10,2) not null default 600;

-- ── grants ────────────────────────────────────────────────
-- Only `authenticated`; `anon` deliberately gets nothing, same as the
-- rest of the schema. Row-level security below does the real filtering.
grant select, insert, update, delete
  on calendar.spend_items, calendar.spends to authenticated;

-- ── row level security ────────────────────────────────────
-- "Is logged in" is not enough when the project hosts another app, so
-- these require the household account specifically, like every other
-- table here.
do $$
declare t text;
begin
  foreach t in array array['spend_items', 'spends']
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
-- So a purchase logged on one phone shows up on the other.
do $$
declare t text;
begin
  foreach t in array array['spend_items', 'spends']
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
