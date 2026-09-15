# Gen S&C II — Full Body

An installable PWA for Barbell Medicine's **General Strength and Conditioning II**,
4-day template (Jordan Feigenbaum, MD, MS — published March 2024), restructured so
that **every training day is full body and opens with a multi-joint lower body lift**.

Sibling app to `../app` (Hypertrophy II). Same visual language, different program;
the blue accent and barbell-over-trace icon keep the two apart on a home screen.

## What changed from the source template

The original runs upper / lower / upper / lower. This deals the same **20 weekly
movement-pattern slots** into four full-body days. Nothing is added, dropped or
duplicated, so weekly volume per movement pattern is identical to the source.

Each day is one multi-joint lower body lead + a second lower slot + one press +
one pull + one arm/trunk slot.

| Day | Block I (wk 1–5) | Block II (wk 6–10) |
|---|---|---|
| **A** Squat | **High Bar Back Squat** → Bench, CS Row, Leg Curl, OH Triceps Ext | **High Bar Back Squat** → Bench, Pendlay Row, SL Leg Curl, V-Grip Pressdown |
| **B** Power | **Trap Bar Deadlift** → Floor Press, High Handle Pulldown, Split Squat, Leg Raises | **Safety Bar Squat** → High Incline Press, Lat Pulldown, Bulgarian Split Squat, Cable Chop |
| **C** Vertical | **2ct Paused Squat** → OHP, Pull-Up, Box Step Ups, Preacher Curl | **Romanian Deadlift** → OHP, Chin-Up, Leg Extensions, Concentration Curl |
| **D** Deadlift | **Conventional Deadlift** → Dips, CS Row, Hip Thrusts, Back Extensions | **Conventional Deadlift** → Close Grip Bench, 1-Arm DB Row, Hip Thrusts, GHR |

Day order spaces the heavy axial work: with the suggested Mon/Tue/Thu/Fri schedule,
the heavy squat (A) is followed by the light power day (B), and the two heaviest
hinges land on separate days. Both the lifting days and which session falls on
which day are configurable in Settings.

## What it does

- **Double progression** — hold a weight until you hit the top of the rep range on
  every set, then add load. The app reads your last logged week and tells you which
  it is, per BBM's own rule.
- **Speed slots** — week 1 of each block establishes an e1RM from a heavy 3–6 @ RPE 7;
  weeks 2–5 take their EMOM percentages from that number, as the eBook specifies.
  Blocks are isolated: week 6 does not read week 5's logs.
- **Conditioning** — each week's prescribed sessions as a checklist, weekly minute
  target, and heart-rate zones. Logging a 20-min test with an average HR sets your
  FTHR to 95% of it, which then drives the zone table.
- **EMOM timer** — the power days are "N reps every minute on the minute × 10
  minutes", so the app runs them: round counter, per-round countdown, an audible
  cue on each minute, and the working weight carried over from the card.
- **Guided 20-minute field test** — runs the week 1 / week 6 test with its
  5-minute checkpoints, then takes your average HR and writes FTHR (95% of it),
  which drives every conditioning zone from there.
- Rest timer, e1RM trends by lift family, 1RM / EMOM / target-weight / protein
  calculators, JSON export & import.

Both interval timers queue their cues onto the Web Audio clock the moment you tap
start, instead of firing them from `setInterval` — background tabs throttle timers
hard, but audio already scheduled still plays. The visual countdown is derived from
an absolute start timestamp, so it stays correct through a reload or a backgrounded
tab regardless. Screen-locked audio on iOS is still not guaranteed; treat the beeps
as a convenience, not a referee.

All data is held in `localStorage` on the device. Nothing is sent anywhere — which
also means **install it to your home screen**. Browsers clear storage for sites that
aren't installed and haven't been opened recently, and this is a ten-week log.
Settings shows how long it has been since your last backup once you have something
worth losing.

## Fidelity to the source

184 week-by-exercise prescriptions were cross-checked against the spreadsheet.
Two deliberate corrections:

- **V-Grip Press Down, weeks 9–10.** The sheet repeats the Lat Pull Down line above it
  (6–10 @ RPE 7). Weeks 6–8 prescribe 8–12 @ RPE 6; the app uses that throughout.
- **Box Step Ups, week 5.** The sheet replaces the quad isolation slot with a second
  Chest-Supported Row. The app keeps the quad slot, as in weeks 1–4.

Block II trunk work in weeks 9–10 uses the week-8 set count (4); the sheet's own
layout shifts there and its accessory rows duplicate the slot above them.

## Heart-rate zones

`HRmax = 208 − 0.7 × age` (Tanaka), per the eBook. FTHR is the better basis and
overrides it. Zone bands follow the spreadsheet's Training Zone calculator
(70–80 / 80–88 / 88–94 / 95–99 / 100–106 % FTHR); the eBook's prose gives slightly
overlapping Zone 3/4 bands, so the spreadsheet's non-overlapping ones are used.

## Evidence

Double progression, RPE/RIR load selection and zone-based conditioning are
well-supported. Concurrent training does not appear to blunt strength or
hypertrophy in the largest meta-analysis to date (Schumann 2022). **Lengthened
partials are the weakest link** — a handful of studies suggest rough parity with
full ROM for isolation work, and Barbell Medicine explicitly declines to call them
superior. The app's About section says the same thing.

## Running it

Static files — open `index.html`, or serve the directory and install from the
browser. `sw.js` caches the shell offline-first and updates the page network-first.
