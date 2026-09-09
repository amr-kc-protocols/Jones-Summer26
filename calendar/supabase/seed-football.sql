-- ============================================================
--  Jones Family Calendar - Sam's fall 2026 flag football season
--  (KCC Panthers, from the GameChanger schedule).
--
--  Run AFTER schema.sql.
--
--  Safe to re-run: the delete on the next line clears only rows
--  this file created. Anything you add in the app is untouched.
--
--  The app can do this without the SQL editor: Settings -> Import
--  Sam's flag football games. Same 6 games, same tag, same
--  delete-then-insert, so the two never double up. The games live
--  in ../football-seed.js as well - edit one, edit the other.
--
--  NO END TIMES: GameChanger lists a kick-off and nothing else, so
--  every row below has a null ends_at rather than a guessed hour.
--
--  NO VENUE: the season email gives the *practice* field (The J,
--  5801 W. 115th St., Overland Park) and says nothing about where
--  games are played, so location is left null.
--
--  TIMEZONE: every time below says America/Chicago, the schedule's
--  own clock. If that is wrong, replace all of them before running.
-- ============================================================

delete from calendar.events where created_by = 'flag football';

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, location, created_by)
values
  ('Flag football @ Bell',
   timestamp '2026-09-20 15:00' at time zone 'America/Chicago',
   null,
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Sam')),
   'First game of the season. Uniforms are handed out at this one.',
   null,
   'flag football');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, location, created_by)
values
  ('Flag football vs. Franke',
   timestamp '2026-10-04 15:00' at time zone 'America/Chicago',
   null,
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Sam')),
   null,
   null,
   'flag football');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, location, created_by)
values
  ('Flag football @ Jones',
   timestamp '2026-10-11 14:00' at time zone 'America/Chicago',
   null,
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Sam')),
   null,
   null,
   'flag football');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, location, created_by)
values
  ('Flag football vs. Martin',
   timestamp '2026-10-18 16:00' at time zone 'America/Chicago',
   null,
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Sam')),
   null,
   null,
   'flag football');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, location, created_by)
values
  ('Flag football @ Bell',
   timestamp '2026-10-25 15:00' at time zone 'America/Chicago',
   null,
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Sam')),
   'Two games this afternoon, back to back.',
   null,
   'flag football');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, location, created_by)
values
  ('Flag football vs. Jones',
   timestamp '2026-10-25 16:00' at time zone 'America/Chicago',
   null,
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Sam')),
   'Two games this afternoon, back to back.',
   null,
   'flag football');

-- Expect: 6
select count(*) as imported from calendar.events where created_by = 'flag football';
