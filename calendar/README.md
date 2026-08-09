# Jones Family Calendar

A shared family calendar for phones — a Skylight-style replacement for the
paper wall calendar. Installable as a PWA, backed by Supabase so both phones
see the same events.

## Getting it running

1. Follow [`supabase/SETUP.md`](./supabase/SETUP.md) — run `supabase/schema.sql`
   in any Supabase project, expose the `calendar` schema, create the household
   account with your PIN.
2. Paste the project URL and anon key into [`config.js`](./config.js).
3. Merge to `main`. GitHub Pages serves it at `/calendar/`.
4. On each phone: open the page → **Share** → **Add to Home Screen**.

Until step 2 is done the page shows a short "not configured yet" notice
instead of the calendar.

## How it works

| File | What it does |
|---|---|
| `index.html` | Markup and all styling |
| `app.js` | Views, editor, auth, sync |
| `lib.js` | Dates, holidays, recurrence — pure functions, no DOM |
| `config.js` | Your Supabase keys and the PIN salt |
| `test.mjs` | Tests for `lib.js` |
| `sw.js` | Offline shell |

Run the tests with:

```sh
node calendar/test.mjs
```

## Using it

**Three views.** *Month* is a Sunday-first grid with a coloured dot per event,
and the selected day's schedule listed underneath — tap any date to see it.
*Week* lists all seven days in full. *Agenda* is a rolling list of what's
coming up.

**Colour is per person.** Everyone gets a colour, set in ⚙ Settings. An event
can belong to several people at once ("first day of school — Sam and Lars"),
or to nobody, which makes it a whole-family event. The chips along the top
filter the calendar down to one person; whole-family events always stay
visible.

**Repeating events** cover daily, weekly, fortnightly, weekdays, chosen days
of the week, monthly and yearly, with an optional end date. Editing or
deleting one asks whether you mean that single day or the whole series, so
one cancelled karate class doesn't wipe out the term.

**All-day events** are for the things written across the top of a square —
"no school", first day of school, back-to-school night. They can span several
days.

**Holidays** are drawn in automatically: the US ones a paper calendar prints,
plus the Dutch ones this house keeps — Koningsdag, Bevrijdingsdag, Sint-Maarten,
Sinterklaas, Tweede Kerstdag, and the days reckoned from Easter (Goede Vrijdag,
Tweede Paasdag, Hemelvaart, Pinksteren).

The two sets overlap more than you'd think, so where both fall on one date the
names join: Nov 11 reads *Veterans Day · Sint-Maarten*, and in 2026 Memorial Day
lands on Tweede Pinksterdag. The agenda shows the full joined name; the month
grid only has room for one label, so it keeps the shorter US one.

Either set can be switched off with `HOLIDAY_SETS` in `config.js` — `['us']` or
`['nl']` — and `SHOW_HOLIDAYS` still turns the lot off.

**Birthdays and the anniversary** are set in ⚙ Settings — a birthday on each
person, the anniversary on the household. The year is optional; add it and the
calendar shows an age, leave it off and it just marks the day.

They aren't stored as events. They're generated from those records the same way
holidays are generated from the year, which means there's nothing to keep in
sync, nothing to delete by accident, and renaming a person renames theirs.
Tapping one opens Settings, since that's where it's actually changed. A Feb 29
birthday is marked on Mar 1 in common years rather than skipped.

> Adding these needs two new columns, so **re-run `supabase/schema.sql`** once
> after deploying — SQL Editor → New query → paste → Run. It's idempotent, and
> it seeds the family's dates without overwriting anything already set.

## The look

Taken from the house rather than invented: Delft blue and white, a parchment
ground instead of grey, crimson and old gold off the picture frames, and the
folk-art palette from the beetle paintings for the per-person colours. The
lock screen is a Delft tile with the four corner flourishes. A woven striped
tape — the mats on the framed prints — runs under the header and along the top
of each sheet, and the day list has a scalloped edge like the scalloped frames.
Serif for anything you read, sans for the small print.

At night it shifts to a deep Delft navy rather than a neutral charcoal. Person
colours are stored as single hex values and have to work on both grounds, so
they're lifted slightly in dark mode to keep cobalt and crimson from going
muddy.

All of it is in the one `<style>` block in `index.html`; no web fonts, so it
still renders with no signal.

The app icon is the same tile — cobalt on tin glaze, corner flourishes, and a
calendar painted with a light hand. It exists in three cuts, because each
platform crops it differently: `icon.svg` square, `icon-rounded.svg` pulled in
for the iOS squircle, and `icon-maskable.svg` pulled in further so nothing
important leaves the centre 80% that Android may crop to. The PNGs beside them
are rendered from those files; edit the SVG, not the PNG.

## Syncing and offline

Changes appear on the other phone within a second or so over Supabase
realtime, and the calendar also refreshes whenever you bring it back to the
foreground. The last sync is cached, so opening it with no signal shows the
most recent state — read-only until you're back online. The header shows when
it last synced, and turns red if it can't reach Supabase.

## Security

One shared login for the household, unlocked with a PIN. The PIN is the
password to that account (plus a fixed salt in `config.js`), so the public
anon key on its own gives no access to your data.

The calendar lives in its own `calendar` Postgres schema and does not need a
Supabase project to itself. Because auth is shared across a whole project,
the row-level security policies require one specific account rather than
merely "logged in" — otherwise a user of any other app in the same project
would qualify. Anon holds no grant on the schema at all.

The honest limit: a 4–6 digit PIN is short, and what stands between it and a
determined guesser is Supabase's auth rate-limiting. That's a reasonable trade
for a family calendar — but don't put anything genuinely sensitive in the
notes field.

To change the PIN, reset the account's password in the Supabase dashboard to
the new PIN plus the same salt. No code change needed.
