-- ============================================================
--  Jones Family Calendar - Sam's fall 2026 flag football season
--  (KCC Panthers). Games from the GameChanger schedule, the weekly
--  practice from the 5th-grade season email.
--
--  Run AFTER schema.sql.
--
--  Safe to re-run: the delete on the next line clears only rows
--  this file created. Anything you add in the app is untouched.
--
--  The app can do this without the SQL editor: Settings -> Import
--  Sam's flag football games. Same rows, same tag, same
--  delete-then-insert, so the two never double up. They live in
--  ../football-seed.js as well - edit one, edit the other.
--
--  NO END TIMES ON THE GAMES: GameChanger lists a kick-off and
--  nothing else, so every game below has a null ends_at rather than
--  a guessed hour. The practice does have one; the email says 6:30.
--
--  NO VENUE ON THE GAMES: the season email gives the *practice*
--  field (The J, 5801 W. 115th St., Overland Park) and says nothing
--  about where games are played, so their location is left null.
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

-- The Wednesday practice, as one repeating row rather than eight, so a
-- cancelled week can be skipped in the app without disturbing the term.
--
-- recurrence_until is the one date here that is a judgement rather than
-- a quotation: the email gives a start and no end, so this stops on the
-- last Wednesday before the last game we know of. Change it below, or in
-- the app, if the season runs on.
insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, location,
   rrule, recurrence_until, created_by)
values
  ('Flag football practice',
   timestamp '2026-09-02 17:00' at time zone 'America/Chicago',
   timestamp '2026-09-02 18:30' at time zone 'America/Chicago',
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Sam')),
   'Baseball field 1 or 2, whichever is free when they arrive - southern edge of the Jewish Community Campus, near 115th and Nall, behind Andretti. The email gives no last date for practices, so this stops the Wednesday before the last game on the schedule. Extend it if the season runs on.',
   'The J - 5801 W. 115th St., Overland Park, KS 66211',
   'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
   date '2026-10-21',
   'flag football');

-- Expect: 7 (6 games + the practice series)
select count(*) as imported from calendar.events where created_by = 'flag football';
