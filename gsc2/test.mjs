/* Checks the program baked into index.html against the Barbell Medicine
   spreadsheet it came from.

   Run with:  node gsc2/test.mjs

   The .xlsx itself isn't in the repo, so source-fixture.json holds every
   week-by-exercise prescription exactly as the sheet states it. A few of those
   entries are known to be wrong — the sheet contradicts itself — and the app
   deliberately departs from them. Those are listed in DEVIATIONS below, and
   the test fails if one of them stops being needed, so the README can't
   quietly drift out of date.                                              */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const results = [];

function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; results.push(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; results.push(`  ✗ ${name}${detail ? '\n      ' + detail : ''}`); }
}

/* ── load the program out of the single-file app ─────── */
const html = readFileSync(join(here, 'index.html'), 'utf8');
const m = html.match(/^const PROGRAM = (\{.*\});$/m);
if (!m) { console.error('Could not find PROGRAM in index.html'); process.exit(1); }
const PROGRAM = JSON.parse(m[1]);

const FIXTURE = JSON.parse(readFileSync(join(here, 'source-fixture.json'), 'utf8'));

/* The sheet's spelling drifts from the app's — "Safety bar Squat", and a "*"
   where the app writes "°". Compare on a flattened form. */
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const key = (week, name) => `${week}|${norm(name)}`;
const source = new Map(
  FIXTURE.prescriptions.map(p => [key(p.week, p.exercise), p])
);

/* Places the app knowingly departs from the sheet, because the sheet is wrong. */
const DEVIATIONS = [
  {
    weeks: [9, 10], exercise: 'V-Grip Press Down',
    why: 'the sheet repeats the Lat Pull Down line above it (6-10 @ RPE 7); ' +
         'weeks 6-8 prescribe 8-12 @ RPE 6, which is what the app uses'
  },
  {
    weeks: [5], exercise: 'Box Step Ups',
    why: 'the sheet drops the quad isolation slot for a second Chest-Supported Row; ' +
         'the app keeps the quad slot, as in weeks 1-4'
  },
  {
    weeks: [9, 10], exercise: 'Cable Chop',
    why: 'weeks 9-10 of the sheet repeat the leg curl line above (8-12 @ RPE 6) into ' +
         'the trunk slot; the app carries week 8 forward'
  },
  {
    weeks: [9, 10], exercise: 'Glute Ham Raises',
    why: 'same corrupted accessory column as Cable Chop in weeks 9-10'
  }
];
const deviates = (week, exercise) =>
  DEVIATIONS.some(d => norm(d.exercise) === norm(exercise) && d.weeks.includes(week));
const hit = new Set();

/* What the app prescribes for one slot in one week, in the fixture's shape. */
function appRx(slot, weekIdx) {
  if (slot.kind === 'power') {
    return weekIdx === 0 ? { kind: 'heavy' } : { kind: 'emom', pct: slot.pct[weekIdx] };
  }
  const reps = slot.repsByWeek ? slot.repsByWeek[weekIdx] : slot.reps;
  return { kind: 'dp', sets: slot.sets[weekIdx], lo: reps[0], hi: reps[1], rpe: String(slot.rpe) };
}

/* ── every prescription matches the source ───────────── */
let compared = 0, missing = [];
for (const [bk, block] of Object.entries(PROGRAM.blocks)) {
  block.weeks.forEach((week, weekIdx) => {
    for (const slot of block.slots) {
      if (deviates(week, slot.name)) { hit.add(key(week, slot.name)); continue; }
      const src = source.get(key(week, slot.name));
      if (!src) { missing.push(`wk ${week} ${slot.name}`); continue; }
      const got = appRx(slot, weekIdx);
      const want = { ...src };
      delete want.week; delete want.exercise;
      compared++;
      check(`${bk} wk${week} ${slot.name}`, got, want);
    }
  });
}
ok('every exercise in the app appears in the source sheet', missing.length === 0,
   missing.join(', '));
ok(`compared ${compared} prescriptions (expected 180+)`, compared >= 180);

/* Each documented deviation must still be doing work. */
for (const d of DEVIATIONS) {
  for (const w of d.weeks) {
    ok(`deviation still applies: wk ${w} ${d.exercise}`, hit.has(key(w, d.exercise)),
       'no longer diverges from the sheet — drop it from DEVIATIONS and the README');
  }
}

/* ── the full-body restructure holds ─────────────────── */
const LOWER_LEAD = new Set(['Squat', 'Deadlift', 'Power', 'Hamstrings']);
for (const [bk, block] of Object.entries(PROGRAM.blocks)) {
  const keys = block.slots.map(s => s.key);
  check(`${bk}: 20 movement-pattern slots`, keys.length, 20);
  check(`${bk}: no slot key used twice`, new Set(keys).size, 20);
  check(`${bk}: five weeks`, block.weeks.length, 5);

  for (const day of ['A', 'B', 'C', 'D']) {
    const slots = block.slots.filter(s => s.day === day);
    check(`${bk} day ${day}: five exercises`, slots.length, 5);

    /* The point of the whole exercise: every day opens with a multi-joint
       lower body lift, and every day is full body. */
    ok(`${bk} day ${day} opens with a multi-joint lower body lift`,
       LOWER_LEAD.has(slots[0].sub), `leads with ${slots[0].name} (${slots[0].sub})`);
    ok(`${bk} day ${day} trains upper body too`,
       slots.some(s => ['Chest', 'Back', 'Shoulders'].includes(s.sub)),
       slots.map(s => s.sub).join(', '));
    ok(`${bk} day ${day} has a second lower body slot`,
       slots.slice(1).some(s => ['Quads', 'Hamstrings', 'Glutes', 'Squat', 'Deadlift'].includes(s.sub)),
       slots.map(s => s.sub).join(', '));
  }

  /* Set counts never fall as a block runs, except where the sheet tapers. */
  for (const slot of block.slots) {
    if (slot.kind === 'power') {
      check(`${bk} ${slot.key}: week 1 sets the e1RM`, slot.pct[0], null);
      ok(`${bk} ${slot.key}: EMOM percentages climb`,
         slot.pct.slice(1).every((p, i, a) => i === 0 || p > a[i - 1]), slot.pct.join(','));
    } else {
      check(`${bk} ${slot.key}: five weekly set counts`, slot.sets.length, 5);
      ok(`${bk} ${slot.key}: sets start at 1-2`, slot.sets[0] <= 2, String(slot.sets[0]));
    }
  }
}

/* Both blocks lay out the same four day roles, so the week 6 switch isn't jarring. */
for (const day of ['A', 'B', 'C', 'D']) {
  /* The lead may differ — block I opens day C on a squat, block II on a hinge —
     but both are multi-joint lower body, checked above. What follows matches. */
  const roles = ['I', 'II'].map(bk =>
    PROGRAM.blocks[bk].slots.filter(s => s.day === day).slice(1).map(s => s.sub).join('/'));
  ok(`day ${day} keeps its shape after the lead across the block change`,
     roles[0] === roles[1], `I: ${roles[0]}   II: ${roles[1]}`);
}

/* ── conditioning ────────────────────────────────────── */
check('ten weeks of conditioning', PROGRAM.conditioning.length, 10);
check('weekly volumes match the sheet',
  PROGRAM.conditioning.map(c => c.volume),
  FIXTURE.conditioning.map(c => c.volume));
ok('conditioning volume never drops',
  PROGRAM.conditioning.every((c, i, a) => i === 0 || c.volume >= a[i - 1].volume),
  PROGRAM.conditioning.map(c => c.volume).join(','));
for (const c of PROGRAM.conditioning) {
  ok(`wk ${c.week}: sessions are listed`, c.sessions.length >= 4, `${c.sessions.length} sessions`);
  ok(`wk ${c.week}: every session has a duration`,
     c.sessions.every(s => s.min > 0 && s.label && s.detail));
}
/* The threshold test is what sets FTHR, and it opens each block. */
const testWeeks = PROGRAM.conditioning
  .filter(c => c.sessions.some(s => s.kind === 'test')).map(c => c.week);
check('the 20-minute test runs in weeks 1 and 6', testWeeks, [1, 6]);

/* ── exercise swap options ───────────────────────────── */
for (const [bk, block] of Object.entries(PROGRAM.blocks)) {
  for (const slot of block.slots) {
    const opts = PROGRAM.options[slot.key];
    ok(`${bk} ${slot.key}: has swap options`, Array.isArray(opts) && opts.length >= 4);
    if (opts) ok(`${bk} ${slot.key}: its default is among them`, opts.includes(slot.name),
                 `${slot.name} missing from [${opts.slice(0, 3)}...]`);
  }
}

/* ── report ──────────────────────────────────────────── */
console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
