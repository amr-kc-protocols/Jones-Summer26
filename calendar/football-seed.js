/* ══════════════════════════════════════════════════════════
   Sam's fall 2026 flag football season, as data.

   Read off the KCC Panthers GameChanger schedule (September and
   October 2026) and the 5th-grade season email. The same games as
   supabase/seed-football.sql, so the import can be run from a phone
   instead of the SQL editor. Both paths tag their rows `flag
   football` and both clear that tag before inserting, so running one
   after the other never doubles anything up.

   Keep the two in step. If you edit a game here, edit it there.

   Two things the schedule did not give, and which are therefore not
   invented here:

   - No end times. GameChanger lists a kick-off and nothing else, so
     these rows carry a start only, like most of the paper entries.
     Oct 25 has games at 3 and 4, which suggests hour-long slots, but
     suggests is not says.
   - No venue. The address below is where the team *practises*; the
     email says so, and says nothing about where games are played. So
     the games carry no location rather than a guessed one.
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

/* Where the team practises, from the season email. Not used on the
   game rows — see the note at the top — but kept here so it is
   written down once if the Wednesday practices are ever added. */
export const PRACTICE_FIELD =
  'The J, baseball field 1 or 2 — 5801 W. 115th St., Overland Park, KS 66211';

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

/* ── seed entries → rows ready for calendar.events ────────
   `people` is the app's people list. A name that isn't in it resolves
   to nobody, which mirrors the SQL: the game still lands, just
   uncoloured and unattributed. Rename Sam in the app before importing
   and this is what you get — the games, minus the player. */
export function gameRows(people = [], zone = GAMES_ZONE) {
  const ids = people.filter(p => p.name === PLAYER).map(p => p.id);

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
