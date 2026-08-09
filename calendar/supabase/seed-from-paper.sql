-- ============================================================
--  Everything written on the August and September 2026 pages
--  of the paper calendar.
--
--  Run AFTER schema.sql. Safe to re-run — it does nothing if
--  these entries are already in.
--
--  Some of the handwriting was genuinely ambiguous. Those rows
--  carry a note saying so, and are listed in the chat message
--  that came with this file. Fix any of them by tapping the
--  event in the app.
-- ============================================================

-- ⚠ Set this to your timezone before running. Everything below is
--    written as local wall-clock time and converted using it.
set timezone = 'America/Chicago';

insert into calendar.events (title, starts_at, ends_at, all_day, person_ids, notes, created_by)
select
  e.title,
  case when e.all_day then e.d::timestamp else e.d + e.t end,
  case when e.t_end is not null then e.d + e.t_end else null end,
  e.all_day,
  coalesce(
    (select array_agg(p.id order by p.sort_order)
       from calendar.people p
      where p.name = any(e.who)),
    '{}'
  ),
  e.note,
  'paper calendar'
from (values
  -- ── August 2026 ──────────────────────────────────────────
  (date '2026-08-03', time '09:00', time '10:00', false,
   'Silas kindergarten', array['Silas'], null::text),

  (date '2026-08-05', null::time, null::time, true,
   'Claire', array[]::text[], 'Just a name on the paper calendar — no time given.'),

  (date '2026-08-06', null::time, null::time, true,
   'Hunter — KC', array['Hunter'], 'Read as “hunt-kc”. Handwriting unclear.'),

  (date '2026-08-07', time '07:30', null::time, false,
   '7:30 — couldn''t read', array[]::text[],
   'Something written at 7:30 that I could not make out. Check the paper page.'),

  (date '2026-08-07', time '10:00', null::time, false,
   'K-playdate', array['Silas'], null),

  (date '2026-08-08', time '16:00', time '17:00', false,
   'Race packet pickup', array['Hunter'], null),

  (date '2026-08-09', time '06:45', null::time, false,
   'Sam race', array['Sam'], null),

  (date '2026-08-10', time '18:10', null::time, false,
   'KOMA', array['Lars'],
   'Written once. If it repeats weekly, set that on the event.'),

  (date '2026-08-13', null::time, null::time, true,
   'First day of school', array['Sam','Lars'], null),

  (date '2026-08-13', time '09:15', null::time, false,
   'Kinder orientation', array['Silas'], null),

  (date '2026-08-14', null::time, null::time, true,
   'Silas kinder', array['Silas'], null),

  (date '2026-08-14', null::time, null::time, true,
   'Marloes jong', array['Marloes'], 'Read as “jong”. Handwriting unclear.'),

  (date '2026-08-15', time '17:30', null::time, false,
   'North', array[]::text[], 'Written as “5:30 North”. No further detail on the page.'),

  (date '2026-08-18', time '16:30', null::time, false,
   'BRE Shark Park', array[]::text[], 'Handwriting unclear — possibly “Snak Park”.'),

  (date '2026-08-21', time '10:30', null::time, false,
   '10:30 — couldn''t read', array[]::text[],
   'A 10:30 entry with no legible title. Check the paper page.'),

  (date '2026-08-24', time '09:30', time '11:00', false,
   'Ortho — boys', array['Lars','Sam'],
   'Two times written, 9:30 and 10:30. Split into two events if they are separate appointments.'),

  (date '2026-08-25', time '10:30', null::time, false,
   'Dr Travis', array['Marloes'], null),

  (date '2026-08-27', time '18:00', null::time, false,
   'Back to school night', array[]::text[], 'No time on the page — 6pm is a guess.'),

  (date '2026-08-28', null::time, null::time, true,
   'No school', array[]::text[], null),

  (date '2026-08-28', null::time, null::time, true,
   'Esther jong', array[]::text[], 'Read as “jong”. Handwriting unclear.'),

  -- ── September 2026 ───────────────────────────────────────
  -- Labor Day, Columbus Day and Halloween are printed on the paper
  -- calendar but are not entered here — the app draws holidays itself.
  (date '2026-09-14', null::time, null::time, true,
   'No school', array[]::text[], null),

  (date '2026-09-15', null::time, null::time, true,
   'No school', array[]::text[], null),

  (date '2026-09-25', null::time, null::time, true,
   'No school', array[]::text[], null)

) as e(d, t, t_end, all_day, title, who, note)
where not exists (
  select 1 from calendar.events where created_by = 'paper calendar'
);
