/* Tests for the date / holiday / recurrence logic.
   Run with:  node calendar/test.mjs                                */

import {
  ymd, fromYmd, addDays, startOfWeek, daysBetween, fmtTime,
  holidays, parseRRule, occurrenceDays, makeOccurrence
} from './lib.js';

let pass = 0, fail = 0;
const results = [];

function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; results.push(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/* Build an event the way the app stores one. */
const ev = (startLocal, opts = {}) => ({
  id: opts.id || 'e1',
  title: opts.title || 'Test',
  starts_at: fromYmdHm(startLocal).toISOString(),
  ends_at: opts.end ? fromYmdHm(opts.end).toISOString() : null,
  all_day: !!opts.allDay,
  person_ids: opts.people || [],
  rrule: opts.rrule || null,
  recurrence_until: opts.until || null
});

function fromYmdHm(s) {
  const [date, time] = s.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, mi);
}

const days = (e, from, to) => occurrenceDays(e, fromYmd(from), fromYmd(to)).map(ymd);

/* ── basic date helpers ──────────────────────────────── */
check('ymd round-trip', ymd(fromYmd('2026-08-13')), '2026-08-13');
check('addDays across month', ymd(addDays(fromYmd('2026-08-31'), 1)), '2026-09-01');
check('addDays across year', ymd(addDays(fromYmd('2026-12-31'), 1)), '2027-01-01');
check('startOfWeek Sunday', ymd(startOfWeek(fromYmd('2026-08-13'), 0)), '2026-08-09');
check('startOfWeek Monday', ymd(startOfWeek(fromYmd('2026-08-13'), 1)), '2026-08-10');
check('startOfWeek on the boundary', ymd(startOfWeek(fromYmd('2026-08-09'), 0)), '2026-08-09');
check('daysBetween', daysBetween(fromYmd('2026-08-01'), fromYmd('2026-08-13')), 12);
check('daysBetween backwards', daysBetween(fromYmd('2026-08-13'), fromYmd('2026-08-01')), -12);

/* DST: the US spring-forward is 2026-03-08. A naive +24h would slip a day. */
check('addDays over spring forward', ymd(addDays(fromYmd('2026-03-07'), 1)), '2026-03-08');
check('addDays over fall back', ymd(addDays(fromYmd('2026-11-01'), 1)), '2026-11-02');
check('daysBetween spanning DST', daysBetween(fromYmd('2026-03-01'), fromYmd('2026-03-31')), 30);

/* ── time formatting ─────────────────────────────────── */
check('fmtTime morning', fmtTime(fromYmdHm('2026-08-13 09:15')), '9:15 am');
check('fmtTime on the hour', fmtTime(fromYmdHm('2026-08-13 10:00')), '10 am');
check('fmtTime afternoon', fmtTime(fromYmdHm('2026-08-13 16:30')), '4:30 pm');
check('fmtTime noon', fmtTime(fromYmdHm('2026-08-13 12:00')), '12 pm');
check('fmtTime midnight', fmtTime(fromYmdHm('2026-08-13 00:00')), '12 am');

/* ── holidays, checked against the printed calendar ──── */
const h26 = holidays(2026);
const holName = k => h26.get(k)?.name;
check('Labor Day 2026', holName('2026-09-07'), 'Labor Day');
check('Columbus Day 2026', holName('2026-10-12'), 'Columbus Day');
check('Halloween 2026', holName('2026-10-31'), 'Halloween');
check('Thanksgiving 2026', holName('2026-11-26'), 'Thanksgiving');
check('Memorial Day 2026 (last Mon)', holName('2026-05-25'), 'Memorial Day');
check('MLK Day 2026', holName('2026-01-19'), 'MLK Day');
check("Mother's Day 2026", holName('2026-05-10'), "Mother's Day");
check('no holiday on a plain day', h26.get('2026-08-13'), undefined);
check('every holiday has a short label that fits a grid cell',
  [...h26.values()].every(v => v.short && v.short.length <= 11), true);

/* ── rrule parsing ───────────────────────────────────── */
check('parse weekly byday', parseRRule('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE'),
  { freq: 'WEEKLY', interval: 1, byday: [1, 3] });
check('parse fortnightly', parseRRule('FREQ=WEEKLY;INTERVAL=2'),
  { freq: 'WEEKLY', interval: 2, byday: null });
check('parse empty', parseRRule(null), null);

/* ── one-off events ──────────────────────────────────── */
check('one-off inside range',
  days(ev('2026-08-13 09:15'), '2026-08-01', '2026-08-31'), ['2026-08-13']);
check('one-off outside range',
  days(ev('2026-07-04 09:15'), '2026-08-01', '2026-08-31'), []);
check('one-off on the range edge',
  days(ev('2026-08-01 09:15'), '2026-08-01', '2026-08-31'), ['2026-08-01']);

/* ── daily ───────────────────────────────────────────── */
check('daily',
  days(ev('2026-08-10 07:00', { rrule: 'FREQ=DAILY;INTERVAL=1' }), '2026-08-10', '2026-08-14'),
  ['2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14']);
check('every 3 days keeps its phase mid-range',
  days(ev('2026-08-01 07:00', { rrule: 'FREQ=DAILY;INTERVAL=3' }), '2026-08-10', '2026-08-20'),
  ['2026-08-10','2026-08-13','2026-08-16','2026-08-19']);
check('daily never precedes its start',
  days(ev('2026-08-20 07:00', { rrule: 'FREQ=DAILY;INTERVAL=1' }), '2026-08-01', '2026-08-22'),
  ['2026-08-20','2026-08-21','2026-08-22']);

/* ── weekly ──────────────────────────────────────────── */
// Karate every Monday, starting Mon 2026-08-10.
check('weekly implied weekday',
  days(ev('2026-08-10 18:10', { rrule: 'FREQ=WEEKLY;INTERVAL=1' }), '2026-08-01', '2026-08-31'),
  ['2026-08-10','2026-08-17','2026-08-24','2026-08-31']);
// Flag football Tue + Thu.
check('weekly with BYDAY',
  days(ev('2026-08-11 16:30', { rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU,TH' }),
       '2026-08-09', '2026-08-22'),
  ['2026-08-11','2026-08-13','2026-08-18','2026-08-20']);
check('BYDAY results come out in date order',
  days(ev('2026-08-10 08:00', { rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR' }),
       '2026-08-09', '2026-08-15'),
  ['2026-08-10','2026-08-12','2026-08-14']);
check('weekdays only skips the weekend',
  days(ev('2026-08-10 08:00', { rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR' }),
       '2026-08-14', '2026-08-18'),
  ['2026-08-14','2026-08-17','2026-08-18']);
check('fortnightly holds its phase',
  days(ev('2026-08-10 18:00', { rrule: 'FREQ=WEEKLY;INTERVAL=2' }), '2026-08-01', '2026-09-30'),
  ['2026-08-10','2026-08-24','2026-09-07','2026-09-21']);
check('fortnightly phase is right when the window starts late',
  days(ev('2026-08-10 18:00', { rrule: 'FREQ=WEEKLY;INTERVAL=2' }), '2026-09-01', '2026-09-30'),
  ['2026-09-07','2026-09-21']);
check('weekly BYDAY does not fire before the series starts',
  days(ev('2026-08-13 08:00', { rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH' }),
       '2026-08-09', '2026-08-18'),
  ['2026-08-13','2026-08-17']);

/* ── monthly / yearly ────────────────────────────────── */
check('monthly',
  days(ev('2026-08-15 10:00', { rrule: 'FREQ=MONTHLY;INTERVAL=1' }), '2026-08-01', '2026-11-30'),
  ['2026-08-15','2026-09-15','2026-10-15','2026-11-15']);
check('monthly on the 31st skips short months',
  days(ev('2026-01-31 10:00', { rrule: 'FREQ=MONTHLY;INTERVAL=1' }), '2026-01-01', '2026-06-30'),
  ['2026-01-31','2026-03-31','2026-05-31']);
check('yearly',
  days(ev('2026-08-13 10:00', { rrule: 'FREQ=YEARLY;INTERVAL=1' }), '2026-01-01', '2029-12-31'),
  ['2026-08-13','2027-08-13','2028-08-13','2029-08-13']);
check('yearly on Feb 29 only lands on leap years',
  days(ev('2024-02-29 10:00', { rrule: 'FREQ=YEARLY;INTERVAL=1' }), '2024-01-01', '2029-12-31'),
  ['2024-02-29','2028-02-29']);

/* ── until ───────────────────────────────────────────── */
check('recurrence_until stops the series',
  days(ev('2026-08-10 08:00',
       { rrule: 'FREQ=WEEKLY;INTERVAL=1', until: '2026-08-24' }), '2026-08-01', '2026-09-30'),
  ['2026-08-10','2026-08-17','2026-08-24']);
check('until is inclusive of its own day',
  days(ev('2026-08-10 08:00',
       { rrule: 'FREQ=DAILY;INTERVAL=1', until: '2026-08-12' }), '2026-08-01', '2026-08-31'),
  ['2026-08-10','2026-08-11','2026-08-12']);

/* ── occurrence construction ─────────────────────────── */
{
  // A weekly 4:30pm practice, rendered on a later week.
  const e = ev('2026-08-11 16:30', { rrule: 'FREQ=WEEKLY;INTERVAL=1', end: '2026-08-11 17:30' });
  const o = makeOccurrence(e, fromYmd('2026-08-25'), null);
  check('occurrence keeps its time of day', fmtTime(o.start), '4:30 pm');
  check('occurrence lands on the right day', ymd(o.start), '2026-08-25');
  check('occurrence keeps its duration', (o.end - o.start) / 60000, 60);
  check('occurrence is flagged repeating', o.repeating, true);
}
{
  // "No school" spanning Mon–Fri as an all-day block.
  const e = ev('2026-09-14 00:00', { allDay: true, end: '2026-09-15 00:00' });
  const o = makeOccurrence(e, fromYmd('2026-09-14'), null);
  check('all-day span end', ymd(o.end), '2026-09-15');
  check('all-day starts at midnight', o.start.getHours(), 0);
}
{
  // Cancel one week of karate, and move another.
  const e = ev('2026-08-10 18:10', { rrule: 'FREQ=WEEKLY;INTERVAL=1' });
  const o = makeOccurrence(e, fromYmd('2026-08-24'), {
    action: 'override',
    overrides: {
      title: 'Karate — makeup class',
      starts_at: fromYmdHm('2026-08-24 19:00').toISOString(),
      ends_at: null
    }
  });
  check('override replaces the title', o.title, 'Karate — makeup class');
  check('override replaces the time', fmtTime(o.start), '7 pm');
  check('override marks the occurrence', o.isOverride, true);
}

/* ── report ──────────────────────────────────────────── */
console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
