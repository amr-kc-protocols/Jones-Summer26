-- ============================================================
--  Jones Family Calendar - entries from the paper calendar
--  (August and September 2026 pages).
--
--  Run AFTER schema.sql.
--
--  Safe to re-run: the delete on the next line clears only rows
--  this file created. Anything you add in the app is untouched.
--
--  The app can do this without the SQL editor: Settings -> Import
--  the August & September pages. Same 23 entries, same tag, same
--  delete-then-insert, so the two never double up. The entries live
--  in ../paper-seed.js as well - edit one, edit the other.
--
--  TIMEZONE: every time below says America/Chicago. If that is
--  wrong, replace all of them before running.
-- ============================================================

delete from calendar.events where created_by = 'paper calendar';

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('Silas kindergarten',
   timestamp '2026-08-03 09:00' at time zone 'America/Chicago',
   timestamp '2026-08-03 10:00' at time zone 'America/Chicago',
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Silas')),
   null,
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('Claire',
   timestamp '2026-08-05 00:00' at time zone 'America/Chicago',
   null,
   true,
   '{}'::uuid[],
   'Name only on the paper page, no time given.',
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('Hunter - KC',
   timestamp '2026-08-06 00:00' at time zone 'America/Chicago',
   null,
   true,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Hunter')),
   'Read as hunt-kc. Handwriting unclear.',
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('7.30am entry - could not read',
   timestamp '2026-08-07 07:30' at time zone 'America/Chicago',
   null,
   false,
   '{}'::uuid[],
   'Illegible on the paper page. Check and rename.',
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('K-playdate',
   timestamp '2026-08-07 10:00' at time zone 'America/Chicago',
   null,
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Silas')),
   null,
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('Race packet pickup',
   timestamp '2026-08-08 16:00' at time zone 'America/Chicago',
   timestamp '2026-08-08 17:00' at time zone 'America/Chicago',
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Hunter')),
   null,
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('Sam race',
   timestamp '2026-08-09 06:45' at time zone 'America/Chicago',
   null,
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Sam')),
   null,
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('KOMA',
   timestamp '2026-08-10 18:10' at time zone 'America/Chicago',
   null,
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Lars')),
   'Written once. Set it to repeat weekly if it does.',
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('First day of school',
   timestamp '2026-08-13 00:00' at time zone 'America/Chicago',
   null,
   true,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Sam', 'Lars')),
   null,
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('Kinder orientation',
   timestamp '2026-08-13 09:15' at time zone 'America/Chicago',
   null,
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Silas')),
   null,
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('Silas kinder',
   timestamp '2026-08-14 00:00' at time zone 'America/Chicago',
   null,
   true,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Silas')),
   null,
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('Marloes jong',
   timestamp '2026-08-14 00:00' at time zone 'America/Chicago',
   null,
   true,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Marloes')),
   'Read as jong. Handwriting unclear.',
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('North',
   timestamp '2026-08-15 17:30' at time zone 'America/Chicago',
   null,
   false,
   '{}'::uuid[],
   'Written as 5.30 North. No further detail.',
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('BRE Shark Park',
   timestamp '2026-08-18 16:30' at time zone 'America/Chicago',
   null,
   false,
   '{}'::uuid[],
   'Unclear. Possibly Snak Park.',
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('10.30am entry - could not read',
   timestamp '2026-08-21 10:30' at time zone 'America/Chicago',
   null,
   false,
   '{}'::uuid[],
   'Time only, no legible title. Check and rename.',
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('Ortho - boys',
   timestamp '2026-08-24 09:30' at time zone 'America/Chicago',
   timestamp '2026-08-24 11:00' at time zone 'America/Chicago',
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Lars', 'Sam')),
   'Two times on the page, 9.30 and 10.30. Split in the app if separate.',
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('Dr Travis',
   timestamp '2026-08-25 10:30' at time zone 'America/Chicago',
   null,
   false,
   (select coalesce(array_agg(id order by sort_order), '{}')
     from calendar.people where name in ('Marloes')),
   null,
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('Back to school night',
   timestamp '2026-08-27 18:00' at time zone 'America/Chicago',
   null,
   false,
   '{}'::uuid[],
   'No time written. 6pm is a guess.',
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('No school',
   timestamp '2026-08-28 00:00' at time zone 'America/Chicago',
   null,
   true,
   '{}'::uuid[],
   null,
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('Esther jong',
   timestamp '2026-08-28 00:00' at time zone 'America/Chicago',
   null,
   true,
   '{}'::uuid[],
   'Read as jong. Handwriting unclear.',
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('No school',
   timestamp '2026-09-14 00:00' at time zone 'America/Chicago',
   null,
   true,
   '{}'::uuid[],
   null,
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('No school',
   timestamp '2026-09-15 00:00' at time zone 'America/Chicago',
   null,
   true,
   '{}'::uuid[],
   null,
   'paper calendar');

insert into calendar.events
  (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
values
  ('No school',
   timestamp '2026-09-25 00:00' at time zone 'America/Chicago',
   null,
   true,
   '{}'::uuid[],
   null,
   'paper calendar');

-- Expect: 23
select count(*) as imported from calendar.events where created_by = 'paper calendar';
