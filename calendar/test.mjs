/* Tests for the date / holiday / recurrence logic.
   Run with:  node calendar/test.mjs                                */

import {
  ymd, fromYmd, addDays, startOfWeek, daysBetween, fmtTime,
  holidays, easter, parseAnnual, annualDate, celebrations,
  proposalOptions, fmtOption, proposalRole, inbox, proposalMarkers, eventFromProposal,
  parseRRule, occurrenceDays, makeOccurrence,
  coolOffDays, decideOn, money, sumSpends, weeklyAllowance, burnDown,
  bankedMonths, totalSaved, dueItems, waitingItems, spendMarkers
} from './lib.js';
import { PAPER_SEED, seedRows, zonedTimeToUtc } from './paper-seed.js';

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
check('Memorial Day 2026 (last Mon)', holName('2026-05-25').split(' · ')[0], 'Memorial Day');
check('MLK Day 2026', holName('2026-01-19'), 'MLK Day');
check("Mother's Day 2026", holName('2026-05-10'), "Mother's Day");
check('no holiday on a plain day', h26.get('2026-08-13'), undefined);
check('every holiday has a short label that fits a grid cell',
  [...h26.values()].every(v => v.short && v.short.length <= 11), true);

/* ── Easter, against published dates ─────────────────── */
check('Easter 2024', ymd(easter(2024)), '2024-03-31');
check('Easter 2025', ymd(easter(2025)), '2025-04-20');
check('Easter 2026', ymd(easter(2026)), '2026-04-05');
check('Easter 2027', ymd(easter(2027)), '2027-03-28');
check('Easter 2038 (late)', ymd(easter(2038)), '2038-04-25');

/* ── Dutch holidays ──────────────────────────────────── */
check('Goede Vrijdag 2026', holName('2026-04-03'), 'Goede Vrijdag');
check('Tweede Paasdag 2026', holName('2026-04-06'), 'Tweede Paasdag');
check('Hemelvaartsdag 2026 (Easter +39)', holName('2026-05-14'), 'Hemelvaartsdag');
check('Eerste Pinksterdag 2026 (Easter +49)', holName('2026-05-24'), 'Eerste Pinksterdag');
/* 2026 puts Tweede Pinksterdag on Memorial Day — a moving US holiday and a
   moving Dutch one landing together, which is exactly what merging is for. */
check('Tweede Pinksterdag 2026 merges with Memorial Day',
  holName('2026-05-25'), 'Memorial Day · Tweede Pinksterdag');
check('Bevrijdingsdag 2026', holName('2026-05-05'), 'Bevrijdingsdag');
check('Sinterklaas 2026', holName('2026-12-05'), 'Sinterklaas');
check('Tweede Kerstdag 2026', holName('2026-12-26'), 'Tweede Kerstdag');

/* Koningsdag is April 27 unless that is a Sunday, when it moves back. */
check('Koningsdag 2026 (Mon, stays put)', holName('2026-04-27'), 'Koningsdag');
check('Koningsdag 2025 (27th is a Sunday, moves to 26th)',
  holidays(2025).get('2025-04-26')?.name, 'Koningsdag');
check('Koningsdag 2025 leaves the 27th empty',
  holidays(2025).get('2025-04-27'), undefined);

/* Shared dates merge rather than overwrite. */
check('Nov 11 carries both names', holName('2026-11-11'), 'Veterans Day · Sint-Maarten');
check('Nov 11 keeps the US short label for the grid', h26.get('2026-11-11').short, 'Veterans');
check('Christmas carries both names', holName('2026-12-25'), 'Christmas · Eerste Kerstdag');
check('Easter Sunday carries both names', holName('2026-04-05'), 'Easter · Eerste Paasdag');

/* Either set can be turned off in config. */
const usOnly = holidays(2026, ['us']), nlOnly = holidays(2026, ['nl']);
check('us-only set drops Sinterklaas', usOnly.get('2026-12-05'), undefined);
check('us-only set keeps Thanksgiving', usOnly.get('2026-11-26')?.name, 'Thanksgiving');
check('nl-only set drops Thanksgiving', nlOnly.get('2026-11-26'), undefined);
check('nl-only set keeps Koningsdag', nlOnly.get('2026-04-27')?.name, 'Koningsdag');
check('nl-only Nov 11 is Sint-Maarten alone', nlOnly.get('2026-11-11')?.name, 'Sint-Maarten');
check('nl-only May 25 is Tweede Pinksterdag alone',
  nlOnly.get('2026-05-25')?.name, 'Tweede Pinksterdag');
check('both sets are cached separately',
  holidays(2026, ['us']).size === usOnly.size && usOnly.size < h26.size, true);

/* ── birthdays and the anniversary ───────────────────── */
check('parse MM-DD', parseAnnual('08-14'), { year: null, month: 8, day: 14 });
check('parse YYYY-MM-DD', parseAnnual('1985-08-14'), { year: 1985, month: 8, day: 14 });
check('parse tolerates surrounding space', parseAnnual('  03-03 '), { year: null, month: 3, day: 3 });
check('parse rejects empty', parseAnnual(''), null);
check('parse rejects null', parseAnnual(null), null);
check('parse rejects a bad month', parseAnnual('13-01'), null);
check('parse rejects Feb 30', parseAnnual('02-30'), null);
check('parse rejects Apr 31', parseAnnual('04-31'), null);
check('parse allows Feb 29', parseAnnual('02-29'), { year: null, month: 2, day: 29 });
check('parse rejects a 2-digit year', parseAnnual('85-08-14'), null);

check('Feb 29 in a leap year stays put',
  ymd(annualDate(parseAnnual('02-29'), 2028)), '2028-02-29');
check('Feb 29 falls back to Mar 1 otherwise',
  ymd(annualDate(parseAnnual('02-29'), 2026)), '2026-03-01');
check('2100 is not a leap year',
  ymd(annualDate(parseAnnual('02-29'), 2100)), '2100-03-01');

const fam = [
  { id: 'p1', name: 'Marloes', color: '#a3242c', birthday: '08-14' },
  { id: 'p2', name: 'Sam', color: '#c98a2b', birthday: '1930-04-27' },
  { id: 'p3', name: 'Nobody', color: '#000', birthday: null }
];
const celebs = (from, to, anniv = '08-07') =>
  celebrations(fam, anniv, fromYmd(from), fromYmd(to));

const aug = celebs('2026-08-01', '2026-08-31');
check('birthday lands on its date', aug.find(c => c.dateKey === '2026-08-14')?.title,
  "Marloes's birthday");
check('anniversary lands on its date', aug.find(c => c.dateKey === '2026-08-07')?.title,
  'Anniversary');
check('birthday carries the person', aug.find(c => c.dateKey === '2026-08-14')?.personIds, ['p1']);
check('birthday carries their colour', aug.find(c => c.dateKey === '2026-08-14')?.color, '#a3242c');
check('anniversary belongs to nobody in particular',
  aug.find(c => c.dateKey === '2026-08-07')?.personIds, []);
check('celebrations are all-day', aug.every(c => c.allDay), true);
check('a person with no birthday produces nothing',
  celebs('2026-01-01', '2026-12-31').some(c => c.title.includes('Nobody')), false);

check('a known birth year shows an age',
  celebs('2026-04-01', '2026-04-30').find(c => c.dateKey === '2026-04-27')?.title,
  "Sam's birthday (96)");
check('anniversary with a year counts years',
  celebs('2026-08-01', '2026-08-31', '2014-08-07').find(c => c.dateKey === '2026-08-07')?.title,
  'Anniversary (12 years)');
check('one year reads singular',
  celebs('2015-08-01', '2015-08-31', '2014-08-07').find(c => c.dateKey === '2015-08-07')?.title,
  'Anniversary (1 year)');

check('nothing outside the window', celebs('2026-09-01', '2026-09-30').length, 0);
check('a window spanning new year covers both years',
  celebs('2025-12-15', '2026-01-15', '01-02').map(c => c.dateKey).sort(),
  ['2026-01-02']);
check('a range covering two Augusts yields two birthdays',
  celebs('2025-01-01', '2026-12-31').filter(c => c.title.startsWith("Marloes")).length, 2);

/* ── proposals ───────────────────────────────────────── */
const iso = s => fromYmdHm(s).toISOString();
const prop = (o = {}) => ({
  id: o.id || 'q1',
  title: o.title || 'Date night',
  notes: o.notes || null, location: o.location || null,
  asked_by: o.asked_by || 'Marloes',
  person_ids: o.person_ids || [],
  options: o.options || [
    { start: iso('2026-08-14 19:00'), end: iso('2026-08-14 21:00'), all_day: false },
    { start: iso('2026-08-15 18:00'), end: iso('2026-08-15 20:00'), all_day: false }
  ],
  status: o.status || 'pending',
  answered_by: o.answered_by || null, chosen_index: o.chosen_index ?? null,
  reply_note: o.reply_note || null, seen_by_asker: !!o.seen_by_asker,
  created_at: o.created_at || '2026-08-01T12:00:00.000Z'
});

check('options parse out of jsonb', proposalOptions(prop()).length, 2);
check('options parse out of a json string',
  proposalOptions({ options: JSON.stringify(prop().options) }).length, 2);
check('a malformed option is dropped',
  proposalOptions({ options: [{ start: 'not a date' }, { start: iso('2026-08-14 19:00') }] }).length, 1);
check('empty options are fine', proposalOptions({ options: [] }).length, 0);

check('option reads as a day and a time range',
  fmtOption(proposalOptions(prop())[0]), 'Fri Aug 14 · 7 pm–9 pm');
check('an all-day option says so',
  fmtOption(proposalOptions({ options: [{ start: iso('2026-08-14 00:00'), all_day: true }] })[0]),
  'Fri Aug 14 · all day');

check('the asker is the asker', proposalRole(prop(), 'Marloes'), 'asker');
check('the other phone answers', proposalRole(prop(), 'Hunter'), 'answerer');
check('an unset device owner is unknown', proposalRole(prop(), ''), 'unknown');

/* Inbox: what each phone is shown. */
const pending = prop();
const acceptedUnseen = prop({ id: 'q2', status: 'accepted', answered_by: 'Hunter', chosen_index: 0 });
const acceptedSeen = prop({ id: 'q3', status: 'accepted', answered_by: 'Hunter', seen_by_asker: true });
const all = [pending, acceptedUnseen, acceptedSeen];

check('the answerer is asked to answer', inbox(all, 'Hunter').toAnswer.map(p => p.id), ['q1']);
check('the answerer is not told about their own replies', inbox(all, 'Hunter').answered, []);
check('the asker is not asked to answer their own ask', inbox(all, 'Marloes').toAnswer, []);
check('the asker hears back once', inbox(all, 'Marloes').answered.map(p => p.id), ['q2']);
check('an unset owner sees pending rather than nothing',
  inbox(all, '').toAnswer.map(p => p.id), ['q1']);
check('a superseded ask asks nobody',
  inbox([prop({ status: 'superseded' })], 'Hunter').toAnswer, []);

/* Markers: pending times show tentatively, answered ones do not. */
const marks = (list, from, to) => proposalMarkers(list, fromYmd(from), fromYmd(to));
check('each pending option gets a marker',
  marks([pending], '2026-08-01', '2026-08-31').map(m => m.dateKey), ['2026-08-14', '2026-08-15']);
check('markers are flagged as proposed',
  marks([pending], '2026-08-01', '2026-08-31').every(m => m.proposed === true), true);
check('an accepted ask leaves no markers', marks([acceptedUnseen], '2026-08-01', '2026-08-31'), []);
check('a declined ask leaves no markers',
  marks([prop({ status: 'declined' })], '2026-08-01', '2026-08-31'), []);
check('markers outside the window are skipped',
  marks([pending], '2026-09-01', '2026-09-30'), []);
check('a marker carries who asked',
  marks([pending], '2026-08-01', '2026-08-31')[0].askedBy, 'Marloes');

/* Accepting builds the event. */
const built = eventFromProposal(prop({ location: 'Ça Va', person_ids: ['p1'] }), 1, 'Hunter');
check('accepted event takes the chosen time', built.starts_at, iso('2026-08-15 18:00'));
check('accepted event takes the chosen end', built.ends_at, iso('2026-08-15 20:00'));
check('accepted event keeps the title', built.title, 'Date night');
check('accepted event keeps the place', built.location, 'Ça Va');
check('accepted event keeps who it is for', built.person_ids, ['p1']);
check('accepted event does not repeat', built.rrule, null);
check('accepted event records who said yes', built.created_by, 'Hunter');
check('an out-of-range option builds nothing', eventFromProposal(prop(), 9, 'Hunter'), null);

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

/* ── the paper calendar seed ─────────────────────────── */
{
  check('the seed is the 23 entries off the pages', PAPER_SEED.length, 23);

  const rows = seedRows([
    { id: 'p-hunter',  name: 'Hunter',  sort_order: 1 },
    { id: 'p-marloes', name: 'Marloes', sort_order: 2 },
    { id: 'p-lars',    name: 'Lars',    sort_order: 3 },
    { id: 'p-sam',     name: 'Sam',     sort_order: 4 },
    { id: 'p-silas',   name: 'Silas',   sort_order: 5 }
  ]);
  const byTitle = t => rows.find(r => r.title === t);

  // 9am Chicago in August is CDT, UTC-5, so 14:00Z. This is the check that
  // fails if the seed ever starts reading the importing device's clock.
  check('a timed entry lands at its Chicago hour',
    byTitle('Silas kindergarten').starts_at, '2026-08-03T14:00:00.000Z');
  check('an end time comes across too',
    byTitle('Silas kindergarten').ends_at, '2026-08-03T15:00:00.000Z');
  check('a timed entry is not all-day', byTitle('Silas kindergarten').all_day, false);

  // Midnight Chicago, not midnight UTC — an all-day entry stored at 00:00Z
  // would show up on the 4th for anyone west of Greenwich.
  check('an all-day entry starts at Chicago midnight',
    byTitle('Claire').starts_at, '2026-08-05T05:00:00.000Z');
  check('an all-day entry is flagged', byTitle('Claire').all_day, true);
  check('an all-day entry has no end', byTitle('Claire').ends_at, null);

  // Written 'Sam', 'Lars' in the seed; stored in sort_order, like the SQL's
  // array_agg — the app colours an event after whoever is first.
  check('people are stored in sort order',
    byTitle('First day of school').person_ids, ['p-lars', 'p-sam']);
  check('a family entry belongs to nobody', byTitle('No school').person_ids, []);

  check('what was unclear is carried over, not resolved',
    byTitle('BRE Shark Park').notes, 'Unclear. Possibly Snak Park.');
  check('every row is tagged for re-import',
    rows.every(r => r.created_by === 'paper calendar'), true);

  // Renaming someone in the app before importing: the entry still lands.
  const orphaned = seedRows([{ id: 'p-silas', name: 'Silas', sort_order: 5 }]);
  check('an entry whose person is gone still imports',
    orphaned.find(r => r.title === 'Sam race').person_ids, []);
  check('and the rest keep their people',
    orphaned.find(r => r.title === 'K-playdate').person_ids, ['p-silas']);

  // Both months are CDT; DST is what the second pass in zonedTimeToUtc is for.
  check('winter reads CST', zonedTimeToUtc('2026-01-15', '09:00', 'America/Chicago')
    .toISOString(), '2026-01-15T15:00:00.000Z');
  check('summer reads CDT', zonedTimeToUtc('2026-07-15', '09:00', 'America/Chicago')
    .toISOString(), '2026-07-15T14:00:00.000Z');
}

/* ── spending: cooling off ───────────────────────────── */
check('a small buy needs no thinking', coolOffDays(18), 0);
check('the threshold itself waits', coolOffDays(25), 3);
check('mid range waits three days', coolOffDays(64.99), 3);
check('a hundred waits a week', coolOffDays(100), 7);
check('a big one waits a week', coolOffDays(340), 7);
check('a junk price is treated as free', coolOffDays(null), 0);

check('a cheap thing decides today', ymd(decideOn(18, fromYmd('2026-08-26'))), '2026-08-26');
check('a mid one decides in three days', ymd(decideOn(60, fromYmd('2026-08-26'))), '2026-08-29');
check('a big one decides in a week', ymd(decideOn(140, fromYmd('2026-08-26'))), '2026-09-02');
check('the wait crosses a month end', ymd(decideOn(140, fromYmd('2026-08-30'))), '2026-09-06');

/* ── money formatting ────────────────────────────────── */
check('thousands are grouped', money(1240), '$1,240');
check('a big total is grouped twice', money(1234567), '$1,234,567');
check('the hero number drops cents', money(138.62), '$139');
check('cents when asked for', money(138.08000000000001, true), '$138.08');
check('negative reads as a debt', money(-42), '-$42');
check('zero is zero', money(0), '$0');

/* ── spend rows ──────────────────────────────────────── */
const sp = (on, amount, kind = 'wanted') => ({ spent_on: on, amount, kind });
const august = [
  sp('2026-08-01', 60, 'needed'),      // gas
  sp('2026-08-03', 140),               // boots
  sp('2026-08-24', 45, 'needed'),      // groceries
  sp('2026-08-26', 30)                 // today
];

check('the split is kept',
  sumSpends(august, fromYmd('2026-08-01'), fromYmd('2026-08-31')),
  { needed: 105, wanted: 170, total: 275 });
check('a range excludes what falls outside it',
  sumSpends(august, fromYmd('2026-08-02'), fromYmd('2026-08-04')).total, 140);
check('an empty range is zero, not NaN',
  sumSpends(august, fromYmd('2026-09-01'), fromYmd('2026-09-30')).total, 0);
check('a row with no date is skipped',
  sumSpends([...august, { amount: 999, kind: 'wanted' }], fromYmd('2026-08-01'), fromYmd('2026-08-31')).total, 275);

/* ── the weekly allowance and pace ───────────────────── */
check('$600 a month is about $138 a week',
  Math.round(weeklyAllowance(600) * 100) / 100, 138.08);

{
  // Wed 2026-08-26, week starting Sunday 2026-08-23. In range: the 24th
  // ($45) and the 26th ($30). Four days elapsed of seven.
  const b = burnDown(august, 600, fromYmd('2026-08-26'), 0);
  check('the week starts on Sunday', ymd(b.weekFrom), '2026-08-23');
  check('and ends on Saturday', ymd(b.weekTo), '2026-08-29');
  check('only this week counts', b.week.total, 75);
  check('today counts as elapsed', b.elapsed, 4);
  check('pace is four sevenths of the allowance', Math.round(b.pace), 79);
  check('under pace reads positive', Math.round(b.ahead), 4);
  check('the month is the whole month', b.month.total, 275);
  check('and the month has budget left', b.monthLeft, 325);
  check('August has 31 days', b.monthDays, 31);
}
{
  // A week that straddles the month end still sums both sides of it.
  const straddle = [sp('2026-08-30', 20), sp('2026-09-01', 35)];
  const b = burnDown(straddle, 600, fromYmd('2026-09-02'), 0);
  check('a week spanning a month end sums both halves', b.week.total, 55);
  check('but the month only counts its own days', b.month.total, 35);
}

/* ── banking a finished month ────────────────────────── */
{
  const spends = [
    sp('2026-06-10', 400, 'needed'),   // June: closed, under
    sp('2026-07-11', 720, 'needed'),   // July: closed, over
    sp('2026-08-03', 140)              // August: the current month
  ];
  const banked = bankedMonths(spends, 600, fromYmd('2026-08-26'));
  check('only closed months are banked', banked.map(m => m.month), ['2026-06', '2026-07']);
  check('an under month banks the difference', banked[0].saved, 200);
  check('an over month banks nothing, never a debt', banked[1].saved, 0);
  check('a month with nothing logged is not credited',
    bankedMonths([sp('2026-08-03', 140)], 600, fromYmd('2026-08-26')), []);
}

/* ── the headline number ─────────────────────────────── */
{
  const items = [
    { id: 'i1', title: 'Boots', price: 140, status: 'let_go' },
    { id: 'i2', title: 'Jacket', price: 90, status: 'let_go' },
    { id: 'i3', title: 'Runners', price: 120, status: 'bought' },
    { id: 'i4', title: 'Watch', price: 300, status: 'waiting', decide_on: '2026-09-02' }
  ];
  const spends = [sp('2026-06-10', 400, 'needed'), sp('2026-08-03', 140)];
  const t = totalSaved(items, spends, 600, fromYmd('2026-08-26'));
  check('only what was let go is declined', t.declined, 230);
  check('closed months are banked alongside it', t.banked, 200);
  check('the hero number is the two together', t.total, 430);
  check('nothing logged at all is a clean zero',
    totalSaved([], [], 600, fromYmd('2026-08-26')), { declined: 0, banked: 0, total: 0 });
}

/* ── the want list ───────────────────────────────────── */
{
  const items = [
    { id: 'a', title: 'Watch', price: 300, status: 'waiting', decide_on: '2026-08-29' },
    { id: 'b', title: 'Boots', price: 140, status: 'waiting', decide_on: '2026-08-24' },
    { id: 'c', title: 'Belt',  price: 40,  status: 'waiting', decide_on: '2026-08-26' },
    { id: 'd', title: 'Jeans', price: 80,  status: 'let_go',  decide_on: '2026-08-20' }
  ];
  check('a decision due today counts as due',
    dueItems(items, fromYmd('2026-08-26')).map(i => i.id), ['b', 'c']);
  check('the longest wait is answered first',
    dueItems(items, fromYmd('2026-08-30')).map(i => i.id), ['b', 'c', 'a']);
  check('an answered item never comes back',
    dueItems(items, fromYmd('2026-08-30')).some(i => i.id === 'd'), false);
  check('nothing is due before its day',
    dueItems(items, fromYmd('2026-08-23')), []);
  check('the waiting list runs next-decision-first',
    waitingItems(items).map(i => i.id), ['b', 'c', 'a']);

  const marks = spendMarkers(items, fromYmd('2026-08-24'), fromYmd('2026-08-27'));
  check('only waiting items are marked on the grid',
    marks.map(m => m.title), ['Decide: Boots', 'Decide: Belt']);
  check('a marker lands on its decision day', marks[0].dateKey, '2026-08-24');
  check('and is shaped like an all-day occurrence',
    [marks[0].allDay, marks[0].personIds, marks[0].repeating], [true, [], false]);
  check('a decision outside the window is left out',
    spendMarkers(items, fromYmd('2026-09-01'), fromYmd('2026-09-30')), []);
}

/* ── report ──────────────────────────────────────────── */
console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
