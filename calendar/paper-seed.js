/* ══════════════════════════════════════════════════════════
   The August and September 2026 paper calendar pages, as data.

   The same 23 entries as supabase/seed-from-paper.sql, so the
   import can be run from a phone instead of the SQL editor. Both
   paths tag their rows `paper calendar` and both clear that tag
   before inserting, so running one after the other never doubles
   anything up.

   Keep the two in step. If you edit an entry here, edit it there.
   ══════════════════════════════════════════════════════════ */

/* Every row this file writes carries the tag, and the import clears
   the tag before inserting. That is what makes it safe to re-run:
   it only ever removes its own rows, never one you typed in. */
export const SEED_TAG = 'paper calendar';

/* The paper pages printed US holidays, so the times on them are
   Chicago wall-clock. Stored as an instant, so a phone in another
   timezone still shows the appointment at the hour it was written. */
export const SEED_ZONE = 'America/Chicago';

/* date  — YYYY-MM-DD
   at    — HH:MM wall-clock, or omitted for an all-day entry
   until — HH:MM end time, where the page gave one
   who   — people by name; [] is a family entry, or one the page
           did not attribute
   note  — what was unclear on the page, so the doubt is visible in
           the app rather than settled silently here */
export const PAPER_SEED = [
  { date: '2026-08-03', at: '09:00', until: '10:00', title: 'Silas kindergarten', who: ['Silas'] },
  { date: '2026-08-05', title: 'Claire', who: [],
    note: 'Name only on the paper page, no time given.' },
  { date: '2026-08-06', title: 'Hunter - KC', who: ['Hunter'],
    note: 'Read as hunt-kc. Handwriting unclear.' },
  { date: '2026-08-07', at: '07:30', title: '7.30am entry - could not read', who: [],
    note: 'Illegible on the paper page. Check and rename.' },
  { date: '2026-08-07', at: '10:00', title: 'K-playdate', who: ['Silas'] },
  { date: '2026-08-08', at: '16:00', until: '17:00', title: 'Race packet pickup', who: ['Hunter'] },
  { date: '2026-08-09', at: '06:45', title: 'Sam race', who: ['Sam'] },
  { date: '2026-08-10', at: '18:10', title: 'KOMA', who: ['Lars'],
    note: 'Written once. Set it to repeat weekly if it does.' },
  { date: '2026-08-13', title: 'First day of school', who: ['Sam', 'Lars'] },
  { date: '2026-08-13', at: '09:15', title: 'Kinder orientation', who: ['Silas'] },
  { date: '2026-08-14', title: 'Silas kinder', who: ['Silas'] },
  { date: '2026-08-14', title: 'Marloes jong', who: ['Marloes'],
    note: 'Read as jong. Handwriting unclear.' },
  { date: '2026-08-15', at: '17:30', title: 'North', who: [],
    note: 'Written as 5.30 North. No further detail.' },
  { date: '2026-08-18', at: '16:30', title: 'BRE Shark Park', who: [],
    note: 'Unclear. Possibly Snak Park.' },
  { date: '2026-08-21', at: '10:30', title: '10.30am entry - could not read', who: [],
    note: 'Time only, no legible title. Check and rename.' },
  { date: '2026-08-24', at: '09:30', until: '11:00', title: 'Ortho - boys', who: ['Lars', 'Sam'],
    note: 'Two times on the page, 9.30 and 10.30. Split in the app if separate.' },
  { date: '2026-08-25', at: '10:30', title: 'Dr Travis', who: ['Marloes'] },
  { date: '2026-08-27', at: '18:00', title: 'Back to school night', who: [],
    note: 'No time written. 6pm is a guess.' },
  { date: '2026-08-28', title: 'No school', who: [] },
  { date: '2026-08-28', title: 'Esther jong', who: [],
    note: 'Read as jong. Handwriting unclear.' },
  { date: '2026-09-14', title: 'No school', who: [] },
  { date: '2026-09-15', title: 'No school', who: [] },
  { date: '2026-09-25', title: 'No school', who: [] }
];

/* ── wall-clock in a named zone → the instant it names ────
   `new Date(y, m, d, h, mi)` reads the *device's* zone, which is the
   right thing when you type a time into the app on your own phone and
   the wrong thing here: these times came off a paper page in Chicago.
   Importing from a laptop on Amsterdam time would otherwise land every
   appointment seven hours out.

   Two passes because the offset depends on the instant we are still
   solving for: guess that the wall-clock is UTC, ask what Chicago's
   offset was around then, then re-ask at the corrected instant. The
   second pass is what gets the hours either side of a DST change
   right — both these months sit in CDT, but the seed outlives them. */
export function zonedTimeToUtc(date, time, zone) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return new Date(guess - zoneOffset(guess - zoneOffset(guess, zone), zone));
}

/* How far ahead of UTC `zone` is at this instant, in ms. */
function zoneOffset(utcMs, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(utcMs));

  const p = {};
  for (const { type, value } of parts) p[type] = value;
  // Some engines render midnight as hour 24 rather than 00.
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
                         hour, Number(p.minute), Number(p.second));
  return asUtc - utcMs;
}

/* ── seed entries → rows ready for calendar.events ────────
   `people` is the app's people list. Names that aren't in it resolve
   to nobody, which mirrors the SQL: the entry still lands, just
   uncoloured and unattributed. Rename someone in the app before
   importing and this is what you get — the event, minus the person. */
export function seedRows(people = [], zone = SEED_ZONE) {
  /* Sorted the way the SQL sorts it — `array_agg(id order by sort_order)`
     — not the order the names happen to be written above. The app colours
     an event after the first person in this list, so "Ortho - boys" comes
     out Lars-green either way round. */
  const idsFor = names => people
    .filter(p => names.includes(p.name))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map(p => p.id);

  return PAPER_SEED.map(e => ({
    title: e.title,
    starts_at: zonedTimeToUtc(e.date, e.at, zone).toISOString(),
    ends_at: e.until ? zonedTimeToUtc(e.date, e.until, zone).toISOString() : null,
    all_day: !e.at,
    person_ids: idsFor(e.who),
    notes: e.note || null,
    location: null,
    rrule: null,
    recurrence_until: null,
    created_by: SEED_TAG
  }));
}
