/* ══════════════════════════════════════════════════════════
   Sam's fall 2026 flag football season, as data.

   The games are off the KCC Panthers GameChanger schedule (September
   and October 2026); the Wednesday practice is out of the 5th-grade
   season email. The same rows as supabase/seed-football.sql, so the
   import can be run from a phone instead of the SQL editor. Both
   paths tag their rows `flag football` and both clear that tag before
   inserting, so running one after the other never doubles anything up.

   Keep the two in step. If you edit something here, edit it there.

   Two things the GAME schedule did not give, and which are therefore
   not invented here. The practice has both, because the email states
   them outright.

   - No end times. GameChanger lists a kick-off and nothing else, so
     the game rows carry a start only, like most of the paper entries.
     Oct 25 has games at 3 and 4, which suggests hour-long slots, but
     suggests is not says.
   - No venue. The address below is where the team *practises*; the
     email says so, and says nothing about where games are played. So
     it goes on the practice row and the games carry no location
     rather than a guessed one.
   ══════════════════════════════════════════════════════════ */

import { zonedTimeToUtc } from './lib.js';

/* Every row this file writes carries the tag, and the import clears
   the tag before inserting. That is what makes it safe to re-run:
   it only ever removes its own rows, never one you typed in.

   A different tag from the paper seed, so the two imports cannot
   reach each other's rows. */
export const GAMES_TAG = 'flag football';

/* Leawood, KS. Stored as an instant, so a phone in another timezone
   still shows kick-off at the hour the schedule printed. */
export const GAMES_ZONE = 'America/Chicago';

/* Where the team practises, from the season email. It goes on the
   practice rows only: the email says nothing about where games are
   played, and a practice field is not a claim about a game venue. */
export const PRACTICE_FIELD = 'The J - 5801 W. 115th St., Overland Park, KS 66211';

/* date — YYYY-MM-DD, every one a Sunday
   at   — HH:MM kick-off, Chicago wall-clock
   vs   — the opponent as GameChanger writes it
   away — true for an away game (@), false for home (vs.)
   note — anything the schedule left open, so the doubt is visible in
          the app rather than settled silently here */
export const FOOTBALL_SEED = [
  { date: '2026-09-20', at: '15:00', vs: 'Bell',   away: true,
    note: 'First game of the season. Uniforms are handed out at this one.' },
  { date: '2026-10-04', at: '15:00', vs: 'Franke', away: false },
  { date: '2026-10-11', at: '14:00', vs: 'Jones',  away: true },
  { date: '2026-10-18', at: '16:00', vs: 'Martin', away: false },
  { date: '2026-10-25', at: '15:00', vs: 'Bell',   away: true,
    note: 'Two games this afternoon, back to back.' },
  { date: '2026-10-25', at: '16:00', vs: 'Jones',  away: false,
    note: 'Two games this afternoon, back to back.' }
];

/* Whose season it is. A name, not an id, because ids differ between
   the SQL editor and the app — both resolve it the same way. */
export const PLAYER = 'Sam';

/* "Flag football @ Bell" / "Flag football vs. Franke" — the away marker
   is the first thing you want off a glance at the day list. */
export const gameTitle = g => `Flag football ${g.away ? '@' : 'vs.'} ${g.vs}`;

/* Practice, from the season email: Wednesdays 5:00-6:30, from Sep 2.
   One repeating row rather than eight, so a cancelled week can be
   skipped in the app without disturbing the rest of the term — which
   is what the app's edit-one-or-the-series prompt is for.

   `until` is the one date here that is a judgement rather than a
   quotation. The email gives a start and no end, so this stops on the
   last Wednesday before the last game we know of. The note says so, so
   it can be argued with in the app instead of being taken as read. */
export const PRACTICES = [
  { from: '2026-09-02', at: '17:00', until_time: '18:30', byday: 'WE',
    until: '2026-10-21',
    title: 'Flag football practice',
    where: PRACTICE_FIELD,
    note: 'Baseball field 1 or 2, whichever is free when they arrive - southern '
        + 'edge of the Jewish Community Campus, near 115th and Nall, behind '
        + 'Andretti. The email gives no last date for practices, so this stops '
        + 'the Wednesday before the last game on the schedule. Extend it if the '
        + 'season runs on.' }
];

/* ── seed entries → rows ready for calendar.events ────────
   `people` is the app's people list. A name that isn't in it resolves
   to nobody, which mirrors the SQL: the row still lands, just
   uncoloured and unattributed. Rename Sam in the app before importing
   and this is what you get — the season, minus the player. */
const idsFor = people => people.filter(p => p.name === PLAYER).map(p => p.id);

export function gameRows(people = [], zone = GAMES_ZONE) {
  const ids = idsFor(people);

  return FOOTBALL_SEED.map(g => ({
    title: gameTitle(g),
    starts_at: zonedTimeToUtc(g.date, g.at, zone).toISOString(),
    ends_at: null,
    all_day: false,
    person_ids: ids,
    notes: g.note || null,
    location: null,
    rrule: null,
    recurrence_until: null,
    created_by: GAMES_TAG
  }));
}

/* The first Wednesday carries the time of day and the length; the
   rrule repeats both. `recurrence_until` is a plain date, which the
   app reads as an inclusive last day. */
export function practiceRows(people = [], zone = GAMES_ZONE) {
  const ids = idsFor(people);

  return PRACTICES.map(p => ({
    title: p.title,
    starts_at: zonedTimeToUtc(p.from, p.at, zone).toISOString(),
    ends_at: zonedTimeToUtc(p.from, p.until_time, zone).toISOString(),
    all_day: false,
    person_ids: ids,
    notes: p.note || null,
    location: p.where || null,
    rrule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=${p.byday}`,
    recurrence_until: p.until,
    created_by: GAMES_TAG
  }));
}

/* What the import writes: the whole season in one go, under one tag,
   so a re-run replaces the lot. */
export function seasonRows(people = [], zone = GAMES_ZONE) {
  return [...gameRows(people, zone), ...practiceRows(people, zone)];
}
