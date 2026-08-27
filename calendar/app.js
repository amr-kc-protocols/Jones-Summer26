/* ══════════════════════════════════════════════════════════
   Jones Family Calendar
   Month / Week / Agenda views over a shared Supabase table.
   ══════════════════════════════════════════════════════════ */

// Tracks the 2.x line rather than an exact pin: the sb_publishable_ key
// format postdates older 2.x releases, and a stale pin would 401 on every
// request. The service worker caches whatever it first resolved, so a
// given phone stays on one version until the cache is replaced.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SCHEMA,
  HOUSEHOLD_EMAIL, PIN_SALT, SHOW_HOLIDAYS, HOLIDAY_SETS
} from './config.js';
import {
  DAY_MS, startOfDay, addDays, addMonths, daysBetween, ymd, fromYmd, hm, pad2, sameDay, startOfWeek,
  MONTHS, MON_SHORT, DOW_SHORT, DOW_MIN, DAYCODE,
  fmtTime, holidays, celebrations, parseAnnual, parseRRule, occurrenceDays, makeOccurrence,
  proposalOptions, fmtOption, inbox, proposalMarkers, eventFromProposal,
  COOL_OFF, coolOffDays, decideOn, money, burnDown, totalSaved,
  dueItems, waitingItems, spendMarkers,
  parseAmount, batchRows, batchSummary, batchToSpends
} from './lib.js';
import { PAPER_SEED, SEED_TAG, SEED_ZONE, seedRows } from './paper-seed.js';


window.__jfcBooted = true;

const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

/* ── config guard ───────────────────────────────────────── */
if (!SUPABASE_URL || SUPABASE_URL.startsWith('PASTE') ||
    !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.startsWith('PASTE')) {
  $('#setup').hidden = false;
  throw new Error('Supabase not configured — see calendar/supabase/SETUP.md');
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  // A distinct storageKey keeps this session separate from any other app
  // sharing the same Supabase project.
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'jfc-auth' },
  db: { schema: SUPABASE_SCHEMA }
});

const holidayOn = d =>
  SHOW_HOLIDAYS ? (holidays(d.getFullYear(), HOLIDAY_SETS).get(ymd(d)) || null) : null;

/* ══ state ══════════════════════════════════════════════ */
const state = {
  people: [],
  events: [],
  proposals: [],
  exceptions: new Map(),        // `${event_id}|${YYYY-MM-DD}` → exception row
  view: 'month',
  cursor: startOfDay(new Date()),
  selected: startOfDay(new Date()),
  filter: new Set(),            // empty = everyone
  weekStart: 0,
  anniversary: '',            // MM-DD or YYYY-MM-DD, household-wide
  spendItems: [],               // the want list
  spends: [],                   // logged purchases
  budget: 600,                  // personal monthly budget
  deviceOwner: localStorage.getItem('jfc-owner') || ''
};

const personById = id => state.people.find(p => p.id === id) || null;
const personByName = n => state.people.find(p => p.name === n) || null;
const colorOf = o => o.color
  || (o.personIds.length ? (personById(o.personIds[0])?.color || 'var(--faint)') : 'var(--dim)');

function visible(o) {
  if (!state.filter.size) return true;
  if (!o.personIds.length) return true;                 // family events always show
  return o.personIds.some(id => state.filter.has(id));
}

/* Map of YYYY-MM-DD → occurrences, sorted. */
function buildDayMap(from, to) {
  const map = new Map();
  const push = (key, o) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(o);
  };
  for (const ev of state.events) {
    for (const day of occurrenceDays(ev, from, to)) {
      const key = ymd(day);
      const exc = state.exceptions.get(`${ev.id}|${key}`);
      if (exc && exc.action === 'skip') continue;
      const o = makeOccurrence(ev, day, exc);
      if (!visible(o)) continue;
      if (o.allDay && o.end && o.end > o.start) {
        const span = Math.min(daysBetween(o.start, o.end), 60);
        for (let i = 0; i <= span; i++) {
          const d = addDays(o.start, i);
          if (d >= from && d <= to) push(ymd(d), o);
        }
      } else {
        push(key, o);
      }
    }
  }
  /* Unanswered asks show as tentative, so a proposed time is visible
     without pretending it is booked. */
  for (const o of proposalMarkers(state.proposals, from, to)) {
    o.color = personByName(o.askedBy)?.color || 'var(--faint)';
    if (visible(o)) push(o.dateKey, o);
  }

  /* A cooling-off day is a thing on the calendar like anything else —
     that's the whole reason the want list lives in here. */
  for (const o of spendMarkers(state.spendItems, from, to)) push(o.dateKey, o);

  /* Generated rather than stored — see celebrations() in lib.js. */
  for (const o of celebrations(state.people, state.anniversary, from, to)) {
    if (visible(o)) push(o.dateKey, o);
  }

  for (const list of map.values()) {
    list.sort((a, b) => (a.allDay !== b.allDay) ? (a.allDay ? -1 : 1) : a.start - b.start);
  }
  return map;
}

/* ══ rendering ══════════════════════════════════════════ */
const view = $('#view');

function render() {
  $('#hdrTitle').textContent = headerTitle();
  document.querySelectorAll('.views button')
    .forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
  renderFilters();
  renderInbox();
  view.replaceChildren();
  /* Money isn't a span of dates, so the things that move through dates
     have nothing to do there. */
  const isMoney = state.view === 'money';
  $('#fab').hidden = isMoney;
  $('#prev').hidden = $('#next').hidden = $('#todayBtn').hidden = isMoney;
  $('#filters').hidden = isMoney;

  if (state.view === 'month') renderMonth();
  else if (state.view === 'week') renderWeek();
  else if (isMoney) renderMoney();
  else renderAgenda();
}

function headerTitle() {
  if (state.view === 'money') return 'Money';
  if (state.view === 'month') {
    return `${MONTHS[state.cursor.getMonth()]} ${state.cursor.getFullYear()}`;
  }
  if (state.view === 'week') {
    const a = startOfWeek(state.cursor, state.weekStart), b = addDays(a, 6);
    const range = a.getMonth() === b.getMonth()
      ? `${MON_SHORT[a.getMonth()]} ${a.getDate()}–${b.getDate()}`
      : `${MON_SHORT[a.getMonth()]} ${a.getDate()} – ${MON_SHORT[b.getMonth()]} ${b.getDate()}`;
    return `${range}, ${a.getFullYear()}`;
  }
  return 'Upcoming';
}

function renderFilters() {
  const box = $('#filters');
  box.replaceChildren();
  const all = el('button', 'chip' + (state.filter.size ? '' : ' on'), 'Everyone');
  all.onclick = () => { state.filter.clear(); render(); };
  box.append(all);
  for (const p of state.people) {
    const c = el('button', 'chip' + (state.filter.has(p.id) ? ' on' : ''));
    const sw = el('span', 'sw'); sw.style.background = p.color;
    c.append(sw, document.createTextNode(p.name));
    if (state.filter.has(p.id)) c.style.color = p.color;
    c.onclick = () => {
      state.filter.has(p.id) ? state.filter.delete(p.id) : state.filter.add(p.id);
      render();
    };
    box.append(c);
  }
}

function renderMonth() {
  const first = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
  const gridStart = startOfWeek(first, state.weekStart);
  const gridEnd = addDays(gridStart, 41);
  const map = buildDayMap(gridStart, gridEnd);
  const today = startOfDay(new Date());

  const dow = el('div', 'dow');
  for (let i = 0; i < 7; i++) dow.append(el('span', null, DOW_MIN[(state.weekStart + i) % 7]));

  const grid = el('div', 'grid');
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const key = ymd(d);
    const list = map.get(key) || [];
    const cell = el('div', 'cell'
      + (d.getMonth() !== first.getMonth() ? ' out' : '')
      + (sameDay(d, today) ? ' today' : '')
      + (sameDay(d, state.selected) ? ' sel' : ''));

    cell.append(el('div', 'num', String(d.getDate())));

    const hol = holidayOn(d);
    if (hol) cell.append(el('div', 'hol', hol.short));

    if (list.length) {
      const dots = el('div', 'dots-row');
      for (const o of list.slice(0, 6)) {
        const i2 = el('i', o.spendItem ? 'coin' : o.proposed ? 'proposed' : null);
        i2.style.background = colorOf(o); dots.append(i2);
      }
      cell.append(dots);
      if (list.length > 6) cell.append(el('div', 'more', `+${list.length - 6}`));
    }

    cell.onclick = () => { state.selected = d; render(); };
    grid.append(cell);
  }

  const panel = el('div', 'day-panel');
  const head = el('div', 'day-head');
  const label = sameDay(state.selected, today)
    ? `Today · ${DOW_SHORT[state.selected.getDay()]} ${MON_SHORT[state.selected.getMonth()]} ${state.selected.getDate()}`
    : `${DOW_SHORT[state.selected.getDay()]} ${MON_SHORT[state.selected.getMonth()]} ${state.selected.getDate()}`;
  head.append(el('span', null, label));
  const ask = el('button', 'add', 'Ask');
  ask.onclick = () => openAsk(state.selected, null);
  const add = el('button', 'add', '+ Add');
  add.onclick = () => openEditor(null, state.selected);
  const acts = el('div', 'day-acts'); acts.append(ask, add);
  head.append(acts);
  panel.append(head);

  const sel = map.get(ymd(state.selected)) || [];
  if (sel.length) sel.forEach(o => panel.append(eventRow(o)));
  else panel.append(el('div', 'empty', 'Nothing scheduled'));

  view.append(dow, grid, panel);
}

function renderWeek() {
  const from = startOfWeek(state.cursor, state.weekStart);
  const to = addDays(from, 6);
  const map = buildDayMap(from, to);
  for (let i = 0; i < 7; i++) view.append(dayGroup(addDays(from, i), map, true));
}

function renderAgenda() {
  const from = startOfDay(new Date());
  const to = addDays(from, 120);
  const map = buildDayMap(from, to);
  let shown = 0;
  for (let i = 0; i <= 120; i++) {
    const d = addDays(from, i);
    const list = map.get(ymd(d));
    if (!list || !list.length) continue;
    view.append(dayGroup(d, map, false));
    shown++;
  }
  if (!shown) view.append(el('div', 'empty', 'Nothing scheduled in the next four months'));
}

function dayGroup(d, map, showEmpty) {
  const list = map.get(ymd(d)) || [];
  const today = sameDay(d, startOfDay(new Date()));
  const g = el('div', 'daygroup' + (today ? ' is-today' : ''));
  const head = el('div', 'dg-head');
  head.append(el('span', null,
    `${DOW_SHORT[d.getDay()]} ${MON_SHORT[d.getMonth()]} ${d.getDate()}${today ? ' · Today' : ''}`));
  const hol = holidayOn(d);
  if (hol) head.append(el('span', 'hol-tag', hol.name));
  g.append(head);

  if (list.length) list.forEach(o => g.append(eventRow(o)));
  else if (showEmpty) {
    const e = el('div', 'empty', '—');
    e.style.padding = '8px 16px 12px';
    g.append(e);
  }
  return g;
}

function eventRow(o) {
  const row = el('div', 'ev'
    + (o.celebration ? ' is-celebration' : '')
    + (o.spendItem ? ' is-spend' : '')
    + (o.proposed ? ' is-proposed' : ''));
  const bar = el('div', 'ev-bar');
  bar.style.background = colorOf(o);

  // A decision day says what it would cost, since that's the question.
  const time = el('div', 'ev-time', o.spendItem ? money(o.spendItem.price)
                                  : o.allDay ? 'All day' : fmtTime(o.start));
  const body = el('div', 'ev-body');

  const title = el('div', 'ev-title');
  if (o.celebration) {
    // The floret off the app icon, tinted to whoever it belongs to.
    const f = el('i', 'floret');
    f.style.background = colorOf(o);
    title.append(f);
  }
  title.append(document.createTextNode(o.title));
  body.append(title);

  const meta = el('div', 'ev-meta');
  // A birthday already says whose it is in the title, and a decision off
  // the want list belongs to nobody — "Everyone" would be noise on both.
  if (o.celebration !== 'birthday' && !o.spendItem) {
    for (const id of o.personIds) {
      const p = personById(id);
      if (!p) continue;
      const w = el('span', 'who');
      const dot = el('i'); dot.style.background = p.color;
      w.append(dot, document.createTextNode(p.name));
      meta.append(w);
    }
    if (!o.personIds.length) meta.append(el('span', 'who', 'Everyone'));
  }
  if (o.proposed) {
    meta.append(el('span', 'rep',
      o.askedBy === state.deviceOwner
        ? 'waiting for an answer'
        : `${o.askedBy || 'Someone'} asked · tap to answer`));
  }
  if (o.location) meta.append(el('span', null, o.location));
  if (o.repeating) meta.append(el('span', 'rep', o.isOverride ? '↻ changed' : '↻ repeats'));
  if (meta.childNodes.length) body.append(meta);

  row.append(bar, time, body);
  // Birthdays and the anniversary aren't events, so there's nothing to edit
  // here — send the tap where they're actually changed.
  row.onclick = () => {
    if (o.spendItem) openDecide(o.spendItem);
    else if (o.proposed) {
      // Only the other phone can answer; the asker just sees it pending.
      if (o.askedBy !== state.deviceOwner) openAnswer(o.proposal);
    } else if (o.celebration) openSettings();
    else openEditor(o, o.day);
  };
  return row;
}

/* ══ sheets ═════════════════════════════════════════════ */
const scrim = $('#scrim');
let openSheet = null;

function showSheet(node) {
  openSheet = node;
  node.classList.add('on');
  scrim.classList.add('on');
}
function hideSheets() {
  document.querySelectorAll('.sheet').forEach(s => s.classList.remove('on'));
  $('#choice').classList.remove('on');
  scrim.classList.remove('on');
  openSheet = null;
}
scrim.onclick = () => { if (!choicePending) hideSheets(); };

/* this-day-only vs whole-series prompt */
let choicePending = null;
function askScope(kind) {
  return new Promise(resolve => {
    const box = $('#choice');
    $('#choiceTitle').textContent = kind === 'delete' ? 'Delete repeating event' : 'Change repeating event';
    $('#choiceText').textContent = kind === 'delete'
      ? 'This event repeats. Delete just this day, or the whole series?'
      : 'This event repeats. Apply your changes to just this day, or the whole series?';
    $('#choiceOne').textContent = kind === 'delete' ? 'Delete this day only' : 'This day only';
    $('#choiceAll').textContent = kind === 'delete' ? 'Delete all in the series' : 'All events in the series';
    $('#choiceOne').className = kind === 'delete' ? 'danger' : '';
    $('#choiceAll').className = kind === 'delete' ? 'danger' : '';
    choicePending = done => { choicePending = null; box.classList.remove('on'); resolve(done); };
    box.classList.add('on');
    scrim.classList.add('on');
  });
}
$('#choiceOne').onclick = () => choicePending && choicePending('one');
$('#choiceAll').onclick = () => choicePending && choicePending('all');
$('#choiceCancel').onclick = () => choicePending && choicePending(null);

/* ══ event editor ═══════════════════════════════════════ */
let editing = null;              // occurrence being edited, or null for new
let whoPicked = new Set();
let bydayPicked = new Set();

function openEditor(occ, forDate) {
  editing = occ;
  whoPicked = new Set(occ ? occ.personIds : []);
  bydayPicked = new Set();

  $('#evHeading').textContent = occ ? 'Edit event' : 'New event';
  $('#evDelete').hidden = !occ;
  $('#evTitle').value = occ ? occ.title : '';
  $('#evLoc').value = occ?.location || '';
  $('#evNotes').value = occ?.notes || '';

  const allDay = occ ? occ.allDay : false;
  setToggle($('#evAllDay'), allDay);

  const start = occ ? occ.start : defaultStart(forDate);
  const end = occ?.end || null;
  $('#evDate').value = ymd(start);
  $('#evStart').value = hm(start);
  $('#evEndDate').value = ymd(end || start);
  $('#evEnd').value = hm(end || new Date(start.getTime() + 3600000));

  const rule = parseRRule(occ?.ev?.rrule);
  $('#evRepeat').value = ruleToOption(rule);
  if (rule?.byday) rule.byday.forEach(d => bydayPicked.add(d));
  $('#evUntil').value = occ?.ev?.recurrence_until || '';

  renderWhoPick();
  renderByday();
  syncEditorRows();
  showSheet($('#evSheet'));
  if (!occ) setTimeout(() => $('#evTitle').focus(), 320);
}

function defaultStart(d) {
  const now = new Date();
  const base = d || startOfDay(now);
  const h = sameDay(base, startOfDay(now)) ? now.getHours() + 1 : 9;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.min(h, 21), 0);
}

function ruleToOption(r) {
  if (!r) return '';
  if (r.freq === 'DAILY') return 'DAILY';
  if (r.freq === 'MONTHLY') return 'MONTHLY';
  if (r.freq === 'YEARLY') return 'YEARLY';
  if (r.freq === 'WEEKLY') {
    if (r.interval === 2) return 'WEEKLY2';
    if (r.byday) {
      const s = r.byday.slice().sort().join(',');
      if (s === '1,2,3,4,5') return 'WEEKDAYS';
      return 'CUSTOM';
    }
    return 'WEEKLY';
  }
  return '';
}

function optionToRule(opt) {
  switch (opt) {
    case 'DAILY':    return 'FREQ=DAILY;INTERVAL=1';
    case 'WEEKLY':   return 'FREQ=WEEKLY;INTERVAL=1';
    case 'WEEKLY2':  return 'FREQ=WEEKLY;INTERVAL=2';
    case 'WEEKDAYS': return 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR';
    case 'MONTHLY':  return 'FREQ=MONTHLY;INTERVAL=1';
    case 'YEARLY':   return 'FREQ=YEARLY;INTERVAL=1';
    case 'CUSTOM': {
      const days = [...bydayPicked].sort((a, b) => a - b).map(i => DAYCODE[i]);
      return days.length ? `FREQ=WEEKLY;INTERVAL=1;BYDAY=${days.join(',')}` : 'FREQ=WEEKLY;INTERVAL=1';
    }
    default: return null;
  }
}

function renderWhoPick() {
  const box = $('#evWho');
  box.replaceChildren();
  for (const p of state.people) {
    const b = el('button', whoPicked.has(p.id) ? 'on' : '');
    const i = el('i'); i.style.background = p.color;
    b.append(i, document.createTextNode(p.name));
    if (whoPicked.has(p.id)) b.style.color = p.color;
    b.onclick = () => {
      whoPicked.has(p.id) ? whoPicked.delete(p.id) : whoPicked.add(p.id);
      renderWhoPick();
    };
    box.append(b);
  }
}

function renderByday() {
  const box = $('#evByday');
  box.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const d = (state.weekStart + i) % 7;
    const b = el('button', bydayPicked.has(d) ? 'on' : '', DOW_MIN[d]);
    b.onclick = () => {
      bydayPicked.has(d) ? bydayPicked.delete(d) : bydayPicked.add(d);
      renderByday();
    };
    box.append(b);
  }
}

function setToggle(node, on) { node.classList.toggle('on', !!on); }
const isOn = node => node.classList.contains('on');

function syncEditorRows() {
  const allDay = isOn($('#evAllDay'));
  $('#evStart').hidden = allDay;
  $('#evEnd').hidden = allDay;
  $('#evEndLabel').textContent = allDay ? 'Last day' : 'Ends';
  const rep = $('#evRepeat').value;
  $('#evByday').hidden = rep !== 'CUSTOM';
  $('#evUntilRow').hidden = !rep;
}

$('#evAllDay').onclick = () => { setToggle($('#evAllDay'), !isOn($('#evAllDay'))); syncEditorRows(); };
$('#evAllDayRow').onclick = e => { if (e.target.id !== 'evAllDay') $('#evAllDay').click(); };
$('#evRepeat').onchange = syncEditorRows;
$('#evCancel').onclick = hideSheets;
$('#fab').onclick = () => openEditor(null, state.view === 'month' ? state.selected : startOfDay(new Date()));

/* Collect the form into the shape the database wants. */
function readForm() {
  const allDay = isOn($('#evAllDay'));
  const date = fromYmd($('#evDate').value || ymd(new Date()));
  let starts, ends;

  if (allDay) {
    starts = date;
    const endDate = $('#evEndDate').value ? fromYmd($('#evEndDate').value) : date;
    ends = endDate > date ? endDate : null;
  } else {
    const [sh, sm] = ($('#evStart').value || '09:00').split(':').map(Number);
    starts = new Date(date.getFullYear(), date.getMonth(), date.getDate(), sh, sm);
    if ($('#evEnd').value) {
      const [eh, em] = $('#evEnd').value.split(':').map(Number);
      const endDate = $('#evEndDate').value ? fromYmd($('#evEndDate').value) : date;
      ends = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), eh, em);
      if (ends <= starts) ends = new Date(starts.getTime() + 3600000);
    } else ends = null;
  }

  return {
    title: ($('#evTitle').value || '').trim() || 'Untitled',
    notes: $('#evNotes').value.trim() || null,
    location: $('#evLoc').value.trim() || null,
    starts_at: starts.toISOString(),
    ends_at: ends ? ends.toISOString() : null,
    all_day: allDay,
    person_ids: [...whoPicked],
    rrule: optionToRule($('#evRepeat').value),
    recurrence_until: $('#evUntil').value || null,
    created_by: state.deviceOwner || null
  };
}

$('#evSave').onclick = async () => {
  const form = readForm();
  const btn = $('#evSave');
  btn.disabled = true;
  try {
    if (!editing) {
      await run(sb.from('events').insert(form));
    } else if (editing.repeating) {
      const scope = await askScope('edit');
      if (!scope) { btn.disabled = false; return; }
      if (scope === 'all') {
        await run(sb.from('events').update(form).eq('id', editing.eventId));
      } else {
        await run(sb.from('event_exceptions').upsert({
          event_id: editing.eventId,
          occurrence_date: editing.dateKey,
          action: 'override',
          overrides: {
            title: form.title, notes: form.notes, location: form.location,
            starts_at: form.starts_at, ends_at: form.ends_at,
            all_day: form.all_day, person_ids: form.person_ids
          }
        }, { onConflict: 'event_id,occurrence_date' }));
      }
    } else {
      await run(sb.from('events').update(form).eq('id', editing.eventId));
    }
    hideSheets();
    await refresh();
  } catch (e) {
    alert('Could not save: ' + e.message);
  } finally {
    btn.disabled = false;
  }
};

$('#evDelete').onclick = async () => {
  if (!editing) return;
  try {
    if (editing.repeating) {
      const scope = await askScope('delete');
      if (!scope) return;
      if (scope === 'all') {
        await run(sb.from('events').delete().eq('id', editing.eventId));
      } else {
        await run(sb.from('event_exceptions').upsert({
          event_id: editing.eventId,
          occurrence_date: editing.dateKey,
          action: 'skip',
          overrides: null
        }, { onConflict: 'event_id,occurrence_date' }));
      }
    } else {
      if (!confirm(`Delete "${editing.title}"?`)) return;
      await run(sb.from('events').delete().eq('id', editing.eventId));
    }
    hideSheets();
    await refresh();
  } catch (e) {
    alert('Could not delete: ' + e.message);
  }
};

async function run(query) {
  const { error } = await query;
  if (error) throw error;
}

/* ══ settings ═══════════════════════════════════════════ */
let draftAnniversary = '';
let draftPeople = [];

/* Restored each time the sheet opens, so last import's result doesn't
   sit there looking like this import's. Matches the markup. */
const IMPORT_HINT = $('#importHint').textContent;

function openSettings() {
  draftPeople = state.people.map(p => ({ ...p }));
  renderPeopleEditor();
  const sel = $('#deviceOwner');
  sel.replaceChildren(new Option('Not set', ''));
  state.people.forEach(p => sel.append(new Option(p.name, p.id)));
  sel.value = state.deviceOwner && state.people.some(p => p.name === state.deviceOwner)
    ? state.people.find(p => p.name === state.deviceOwner).id : '';
  $('#weekStart').value = String(state.weekStart);
  $('#spendBudget').value = state.budget ? String(state.budget) : '';
  draftAnniversary = state.anniversary;
  $('#anniversaryPick').replaceChildren(
    annualPicker(state.anniversary, v => { draftAnniversary = v; }));
  $('#importHint').textContent = IMPORT_HINT;
  showSheet($('#setSheet'));
}

/* Month + day + optional year, as three controls rather than a date input:
   a date input demands a year, and a birthday is perfectly usable without
   one. Returns a row that writes MM-DD or YYYY-MM-DD back through onChange. */
function annualPicker(value, onChange) {
  const cur = parseAnnual(value) || { year: null, month: 0, day: 0 };
  const wrap = el('div', 'annual');

  // Short month names: three of these sit side by side inside an already
  // indented row, and full names truncate on a narrow phone.
  const month = el('select');
  month.append(new Option('Mon', ''));
  MON_SHORT.forEach((m, i) => month.append(new Option(m, String(i + 1))));
  month.value = cur.month ? String(cur.month) : '';

  const day = el('select');
  day.append(new Option('Day', ''));
  for (let d = 1; d <= 31; d++) day.append(new Option(String(d), String(d)));
  day.value = cur.day ? String(cur.day) : '';

  const year = el('input');
  year.type = 'text'; year.inputMode = 'numeric'; year.maxLength = 4;
  year.placeholder = 'Year'; year.value = cur.year || '';

  const emit = () => {
    const m = Number(month.value), d = Number(day.value);
    if (!m || !d) return onChange(null);
    const y = /^\d{4}$/.test(year.value.trim()) ? year.value.trim() + '-' : '';
    onChange(`${y}${pad2(m)}-${pad2(d)}`);
  };
  month.onchange = day.onchange = emit;
  year.oninput = emit;

  wrap.append(month, day, year);
  return wrap;
}

function renderPeopleEditor() {
  const box = $('#peopleList');
  box.replaceChildren();
  draftPeople.forEach((p, i) => {
    const row = el('div', 'person-row');

    const main = el('div', 'person-main');
    const color = el('input'); color.type = 'color'; color.value = p.color;
    color.oninput = () => { p.color = color.value; };
    const name = el('input'); name.type = 'text'; name.value = p.name;
    name.oninput = () => { p.name = name.value; };
    const del = el('button', 'del', '×');
    del.onclick = () => { draftPeople.splice(i, 1); renderPeopleEditor(); };
    main.append(color, name, del);

    const bday = el('div', 'person-bday');
    bday.append(el('span', 'bday-label', 'Born'));
    bday.append(annualPicker(p.birthday, v => { p.birthday = v; }));

    row.append(main, bday);
    box.append(row);
  });
}

$('#addPerson').onclick = () => {
  // Folk-art palette: Delft cobalt, crimson, deep green, ochre, plum, teal, rose.
  const palette = ['#27478f', '#a3242c', '#3f7350', '#c98a2b', '#7b4b8a', '#3a8a94', '#cf6f7f'];
  draftPeople.push({ id: null, name: '', color: palette[draftPeople.length % palette.length] });
  renderPeopleEditor();
};

$('#setSave').onclick = async () => {
  try {
    const keep = draftPeople.filter(p => p.name.trim());
    for (const [i, p] of keep.entries()) {
      const row = { name: p.name.trim(), color: p.color, sort_order: i + 1,
                    birthday: p.birthday || null };
      if (p.id) await run(sb.from('people').update(row).eq('id', p.id));
      else await run(sb.from('people').insert(row));
    }
    const keptIds = new Set(keep.filter(p => p.id).map(p => p.id));
    for (const p of state.people) {
      if (!keptIds.has(p.id)) await run(sb.from('people').delete().eq('id', p.id));
    }
    state.weekStart = Number($('#weekStart').value);
    state.anniversary = draftAnniversary || '';
    // A blank or unreadable budget keeps the one already set rather than
    // silently zeroing it — a zero budget would read as "always over".
    const budget = parseAmount($('#spendBudget').value);
    if (budget != null && budget > 0) state.budget = budget;
    localStorage.setItem('jfc-weekstart', String(state.weekStart));
    await run(sb.from('household_settings').update({
      week_starts_on: state.weekStart,
      anniversary: state.anniversary || null,
      spend_budget: state.budget,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }).eq('id', 1));

    const ownerId = $('#deviceOwner').value;
    state.deviceOwner = ownerId ? (draftPeople.find(p => p.id === ownerId)?.name || '') : '';
    localStorage.setItem('jfc-owner', state.deviceOwner);

    hideSheets();
    await refresh();
  } catch (e) {
    alert('Could not save settings: ' + e.message);
  }
};

/* Loads the paper pages without going near the SQL editor. Does what
   seed-from-paper.sql does, in the same order and with the same tag:
   clear what a previous import wrote, then insert. Both are scoped to
   `created_by = 'paper calendar'`, so an event you typed yourself is
   never in range of the delete. */
$('#importPaper').onclick = async () => {
  const btn = $('#importPaper');
  const hint = $('#importHint');

  /* The names in the seed are the ones schema.sql creates. Rename
     someone in the app first and their events still import, just
     attached to nobody — worth saying before, not after. */
  const wanted = [...new Set(PAPER_SEED.flatMap(e => e.who))];
  const missing = wanted.filter(n => !state.people.some(p => p.name === n));

  const already = state.events.filter(e => e.created_by === SEED_TAG).length;
  const warn = [
    `Import ${PAPER_SEED.length} entries from the paper calendar?`,
    already ? `\nThe ${already} already imported will be replaced. Events you added yourself are not touched.` : '',
    missing.length ? `\nNo one is called ${missing.join(' or ')} any more, so those entries will arrive unassigned.` : ''
  ].join('');
  if (!confirm(warn)) return;

  btn.disabled = true;
  hint.textContent = 'Importing…';
  try {
    const rows = seedRows(state.people, SEED_ZONE);
    await run(sb.from('events').delete().eq('created_by', SEED_TAG));
    await run(sb.from('events').insert(rows));
    await refresh();

    /* Counted back out of the calendar rather than trusting the insert,
       which is what the SQL's closing `select count(*)` is for. refresh()
       reports its own failures to the sync line instead of throwing, so
       a mismatch here means the rows are in and the screen is stale — not
       that the import fell short. */
    const n = state.events.filter(e => e.created_by === SEED_TAG).length;
    hint.textContent = n === rows.length
      ? `Imported ${n} ${n === 1 ? 'entry' : 'entries'}.`
      : `Imported ${rows.length}. The calendar is still showing ${n} — check the sync line.`;
  } catch (e) {
    hint.textContent = IMPORT_HINT;
    alert('Could not import: ' + e.message);
  } finally {
    btn.disabled = false;
  }
};

$('#setClose').onclick = hideSheets;
$('#settingsBtn').onclick = openSettings;
$('#signOut').onclick = async () => {
  await sb.auth.signOut();
  location.reload();
};

/* ══ data ═══════════════════════════════════════════════ */
const CACHE_KEY = 'jfc-cache-v1';

function loadCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!raw) return false;
    state.people = raw.people || [];
    state.events = raw.events || [];
    state.exceptions = new Map((raw.exceptions || [])
      .map(e => [`${e.event_id}|${e.occurrence_date}`, e]));
    state.spendItems = raw.spendItems || [];
    state.spends = raw.spends || [];
    if (raw.budget != null) state.budget = Number(raw.budget);
    return true;
  } catch { return false; }
}

function saveCache(people, events, exceptions, spendItems, spends) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      people, events, exceptions, spendItems, spends, budget: state.budget }));
  } catch { /* quota — not fatal */ }
}

function setSync(text, bad) {
  const n = $('#sync');
  n.textContent = text;
  n.classList.toggle('bad', !!bad);
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [people, events, excs, settings, proposals, items, spends] = await Promise.all([
      sb.from('people').select('*').order('sort_order'),
      sb.from('events').select('*'),
      sb.from('event_exceptions').select('*'),
      sb.from('household_settings').select('*').eq('id', 1).maybeSingle(),
      sb.from('proposals').select('*').order('created_at', { ascending: false }),
      sb.from('spend_items').select('*').order('decide_on'),
      // Ordered by entry time within a day as well, so what you just
      // logged is at the top of the list rather than lost among the
      // other rows that share its date.
      sb.from('spends').select('*')
        .order('spent_on', { ascending: false })
        .order('created_at', { ascending: false })
    ]);
    for (const r of [people, events, excs]) if (r.error) throw r.error;

    state.people = people.data || [];
    state.events = events.data || [];
    state.exceptions = new Map((excs.data || [])
      .map(e => [`${e.event_id}|${e.occurrence_date}`, e]));
    // Not in the throw list above: an install that hasn't run the latest
    // schema.sql has no proposals table, and the rest of the calendar
    // should still work. The feature just stays out of sight.
    state.proposals = proposals.error ? [] : (proposals.data || []);
    // Same tolerance for the spending tables: an install that predates them
    // keeps a working calendar, just without the Money tab having anything
    // in it. Re-running schema.sql is what turns it on.
    state.spendItems = items.error ? [] : (items.data || []);
    state.spends = spends.error ? [] : (spends.data || []);
    if (settings.data) {
      state.anniversary = settings.data.anniversary || '';
      if (settings.data.spend_budget != null) state.budget = Number(settings.data.spend_budget);
    }
    if (settings.data && settings.data.week_starts_on != null) {
      state.weekStart = settings.data.week_starts_on;
      localStorage.setItem('jfc-weekstart', String(state.weekStart));
    }
    saveCache(state.people, state.events, excs.data || [], state.spendItems, state.spends);
    setSync(`Synced ${fmtTime(new Date())}`, false);
    render();
  } catch (e) {
    setSync(navigator.onLine ? `Sync failed — ${e.message}` : 'Offline — showing last synced', true);
  } finally {
    refreshing = false;
  }
}

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 400);
}

function subscribeRealtime() {
  sb.channel('jfc-live')
    .on('postgres_changes', { event: '*', schema: SUPABASE_SCHEMA }, scheduleRefresh)
    .subscribe();
}

/* ══ lock screen ════════════════════════════════════════ */
let pin = '';
let unlocking = false;

function renderDots() {
  const box = $('#lockDots');
  box.replaceChildren();
  const n = Math.max(4, pin.length);
  for (let i = 0; i < n; i++) box.append(el('div', 'dot' + (i < pin.length ? ' on' : '')));
}

function buildPad() {
  const pad = $('#pad');
  pad.replaceChildren();
  const keys = ['1','2','3','4','5','6','7','8','9','clear','0','go'];
  for (const k of keys) {
    if (k === 'clear') {
      const b = el('button', 'fn', 'Clear');
      b.onclick = () => { pin = ''; renderDots(); };
      pad.append(b);
    } else if (k === 'go') {
      const b = el('button', 'fn', 'Enter');
      b.onclick = submitPin;
      pad.append(b);
    } else {
      const b = el('button', null, k);
      b.onclick = () => {
        if (pin.length >= 10 || unlocking) return;
        pin += k; renderDots();
        if (navigator.vibrate) navigator.vibrate(8);
      };
      pad.append(b);
    }
  }
}

async function submitPin() {
  if (unlocking || pin.length < 4) {
    if (pin.length < 4) hint('PIN is at least 4 digits', true);
    return;
  }
  unlocking = true;
  hint('Unlocking…');
  const { error } = await sb.auth.signInWithPassword({
    email: HOUSEHOLD_EMAIL, password: pin + PIN_SALT
  });
  unlocking = false;
  if (error) {
    pin = ''; renderDots();
    hint(/rate|many/i.test(error.message)
      ? 'Too many tries — wait a moment' : 'Wrong PIN', true);
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    return;
  }
  await start();
}

function hint(text, bad) {
  const n = $('#lockHint');
  n.textContent = text;
  n.classList.toggle('err', !!bad);
}

document.addEventListener('keydown', e => {
  if ($('#lock').hidden) return;
  if (/^\d$/.test(e.key) && pin.length < 10) { pin += e.key; renderDots(); }
  else if (e.key === 'Backspace') { pin = pin.slice(0, -1); renderDots(); }
  else if (e.key === 'Enter') submitPin();
});

/* ══ boot ═══════════════════════════════════════════════ */
async function start() {
  $('#lock').hidden = true;
  $('#app').hidden = false;
  state.weekStart = Number(localStorage.getItem('jfc-weekstart') || 0);
  const hadCache = loadCache();
  if (hadCache) { setSync('Showing last synced…'); render(); }
  else setSync('Loading…');
  await refresh();
  subscribeRealtime();
}

/* Keep the selected day inside the month on screen — otherwise the panel
   below the grid reports an out-of-range day as having nothing on it. */
function clampSelectionToCursor() {
  if (state.view !== 'month') return;
  if (state.selected.getFullYear() === state.cursor.getFullYear() &&
      state.selected.getMonth() === state.cursor.getMonth()) return;
  const today = startOfDay(new Date());
  state.selected = (today.getFullYear() === state.cursor.getFullYear() &&
                    today.getMonth() === state.cursor.getMonth())
    ? today
    : new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
}

function step(dir) {
  if (state.view === 'money') return;
  if (state.view === 'month') state.cursor = addMonths(state.cursor, dir);
  else if (state.view === 'week') state.cursor = addDays(state.cursor, dir * 7);
  clampSelectionToCursor();
  render();
}
$('#prev').onclick = () => step(-1);
$('#next').onclick = () => step(1);
$('#todayBtn').onclick = () => {
  state.cursor = startOfDay(new Date());
  state.selected = startOfDay(new Date());
  render();
};
document.querySelectorAll('.views button').forEach(b => {
  b.onclick = () => { state.view = b.dataset.view; render(); };
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('#app').hidden) refresh();
});
window.addEventListener('online', refresh);

(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    await start();
  } else {
    $('#lock').hidden = false;
    buildPad();
    renderDots();
  }
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* ══ proposals ══════════════════════════════════════════
   Ask → answer → event. Nothing lands on the calendar until someone
   says yes; until then an ask shows as a tentative marker. */

let askDraft = null;      // { options: [{date, time}], counterOf, personIds }
let answering = null;     // the proposal open in the answer sheet

function renderInbox() {
  const box = $('#inbox');
  const { toAnswer, answered } = inbox(state.proposals, state.deviceOwner);
  const due = dueItems(state.spendItems, new Date());
  box.replaceChildren();
  box.hidden = !(toAnswer.length + answered.length + due.length);

  /* The cooling-off period is up. This card is the whole intervention, so
     it sits above everything and shows on every view. */
  for (const it of due) {
    const waited = Math.max(0, daysBetween(new Date(it.created_at || it.decide_on), new Date()));
    const card = inboxCard(
      `Still want the ${money(it.price)} ${it.title}?`,
      waited ? `Written down ${waited} day${waited === 1 ? '' : 's'} ago` : 'Written down today',
      'Decide', false, () => openDecide(it));
    card.classList.add('decide');
    box.append(card);
  }

  for (const p of toAnswer) {
    const n = proposalOptions(p).length;
    box.append(inboxCard(
      `${p.asked_by || 'Someone'} asked: ${p.title}`,
      n === 1 ? 'One time offered' : `${n} times offered`,
      'Answer', false, () => openAnswer(p)));
  }
  for (const p of answered) {
    const yes = p.status === 'accepted';
    const when = yes ? fmtOption(proposalOptions(p)[p.chosen_index] || {}) : null;
    box.append(inboxCard(
      `${p.answered_by || 'They'} said ${yes ? 'yes' : 'no'} to ${p.title}`,
      yes ? when : (p.reply_note || 'No time given'),
      'OK', true, async () => {
        await run(sb.from('proposals').update({ seen_by_asker: true }).eq('id', p.id));
        await refresh();
      }));
  }
}

function inboxCard(title, sub, action, isAnswered, onClick) {
  const c = el('button', 'inbox-card' + (isAnswered ? ' answered' : ''));
  const body = el('div', 'ic-body');
  body.append(el('div', 'ic-title', title));
  body.append(el('div', 'ic-sub', sub));
  c.append(body, el('span', 'ic-go', action));
  c.onclick = onClick;
  return c;
}

/* ── composing an ask ── */
function openAsk(forDate, counterOf) {
  const d = forDate || state.selected || startOfDay(new Date());
  askDraft = {
    counterOf: counterOf || null,
    personIds: new Set(counterOf ? (counterOf.person_ids || []) : []),
    options: [{ date: ymd(d), time: '19:00' }]
  };
  $('#askHeading').textContent = counterOf ? 'Suggest another time' : 'Ask';
  $('#askTitle').value = counterOf ? counterOf.title : '';
  $('#askLoc').value = counterOf ? (counterOf.location || '') : '';
  $('#askNotes').value = '';
  renderAskWho();
  renderAskOptions();
  showSheet($('#askSheet'));
}

function renderAskWho() {
  const box = $('#askWho');
  box.replaceChildren();
  for (const p of state.people) {
    const b = el('button');
    const i = el('i'); i.style.background = p.color;
    b.append(i, document.createTextNode(p.name));
    if (askDraft.personIds.has(p.id)) { b.classList.add('on'); b.style.color = p.color; }
    b.onclick = () => {
      askDraft.personIds.has(p.id) ? askDraft.personIds.delete(p.id) : askDraft.personIds.add(p.id);
      renderAskWho();
    };
    box.append(b);
  }
}

function renderAskOptions() {
  const box = $('#askOptions');
  box.replaceChildren();
  askDraft.options.forEach((o, i) => {
    const row = el('div', 'opt-row');
    const date = el('input'); date.type = 'date'; date.value = o.date;
    date.onchange = () => { o.date = date.value; };
    const time = el('input'); time.type = 'time'; time.value = o.time;
    time.onchange = () => { o.time = time.value; };
    row.append(date, time);
    if (askDraft.options.length > 1) {
      const drop = el('button', 'drop', '×');
      drop.onclick = () => { askDraft.options.splice(i, 1); renderAskOptions(); };
      row.append(drop);
    }
    box.append(row);
  });
  $('#askAddOption').hidden = askDraft.options.length >= 4;
}

$('#askAddOption').onclick = () => {
  const last = askDraft.options[askDraft.options.length - 1];
  askDraft.options.push({ date: last ? last.date : ymd(startOfDay(new Date())),
                          time: last ? last.time : '19:00' });
  renderAskOptions();
};
$('#askCancel').onclick = hideSheets;

$('#askSend').onclick = async () => {
  const btn = $('#askSend');
  const title = ($('#askTitle').value || '').trim();
  if (!title) { alert('What are you asking about?'); return; }

  const options = askDraft.options
    .filter(o => o.date)
    .map(o => {
      const [h, m] = (o.time || '19:00').split(':').map(Number);
      const d = fromYmd(o.date);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
      return { start: start.toISOString(),
               end: new Date(start.getTime() + 2 * 3600000).toISOString(),
               all_day: false };
    });
  if (!options.length) { alert('Offer at least one time.'); return; }

  btn.disabled = true;
  try {
    await run(sb.from('proposals').insert({
      title,
      notes: $('#askNotes').value.trim() || null,
      location: $('#askLoc').value.trim() || null,
      asked_by: state.deviceOwner || 'Someone',
      person_ids: [...askDraft.personIds],
      options,
      counter_of: askDraft.counterOf ? askDraft.counterOf.id : null
    }));
    // A counter answers the ask it replaces, so it stops asking to be answered.
    if (askDraft.counterOf) {
      await run(sb.from('proposals').update({
        status: 'superseded', answered_by: state.deviceOwner || null,
        answered_at: new Date().toISOString()
      }).eq('id', askDraft.counterOf.id));
    }
    hideSheets();
    await refresh();
  } catch (e) {
    alert('Could not send that: ' + e.message);
  } finally {
    btn.disabled = false;
  }
};

/* ── answering one ── */
function openAnswer(p) {
  answering = p;
  $('#ansHeading').textContent = `${p.asked_by || 'Someone'} asked`;

  const sum = el('div', 'ask-summary');
  sum.append(el('div', 'as-title', p.title));
  const bits = [];
  if (p.location) bits.push(p.location);
  const who = (p.person_ids || []).map(id => personById(id)?.name).filter(Boolean);
  bits.push(who.length ? who.join(', ') : 'just the two of you');
  sum.append(el('div', 'as-meta', bits.join(' · ')));
  if (p.notes) sum.append(el('div', 'as-note', p.notes));
  $('#ansSummary').replaceChildren(sum);

  const box = $('#ansOptions');
  box.replaceChildren();
  proposalOptions(p).forEach((o, i) => {
    const b = el('button', 'opt-pick');
    b.append(document.createTextNode(fmtOption(o)), el('span', 'yes', 'Yes'));
    b.onclick = () => accept(p, i);
    box.append(b);
  });
  $('#ansNote').value = '';
  showSheet($('#ansSheet'));
}

async function accept(p, index) {
  const form = eventFromProposal(p, index, state.deviceOwner);
  if (!form) return;
  try {
    const ins = await run(sb.from('events').insert(form).select().single());
    await run(sb.from('proposals').update({
      status: 'accepted',
      answered_by: state.deviceOwner || null,
      answered_at: new Date().toISOString(),
      reply_note: $('#ansNote').value.trim() || null,
      chosen_index: index,
      event_id: ins?.id || null
    }).eq('id', p.id));
    state.selected = startOfDay(new Date(form.starts_at));
    state.cursor = state.selected;
    hideSheets();
    await refresh();
  } catch (e) {
    alert('Could not accept that: ' + e.message);
  }
}

$('#ansDecline').onclick = async () => {
  if (!answering) return;
  try {
    await run(sb.from('proposals').update({
      status: 'declined',
      answered_by: state.deviceOwner || null,
      answered_at: new Date().toISOString(),
      reply_note: $('#ansNote').value.trim() || null
    }).eq('id', answering.id));
    hideSheets();
    await refresh();
  } catch (e) {
    alert('Could not send that: ' + e.message);
  }
};

$('#ansCounter').onclick = () => {
  const p = answering;
  hideSheets();
  openAsk(state.selected, p);
};
$('#ansClose').onclick = hideSheets;

/* ══ money ══════════════════════════════════════════════
   The want list, the burn-down, and one number.

   The shape of the thing: wanting something writes it down and puts a
   decision on a future day instead of a charge on today. When the day
   comes the app asks once. Letting it go banks the price — same "I saved
   $80" hit, without the $80 leaving. */

const shortDate = d => `${DOW_SHORT[d.getDay()]} ${MON_SHORT[d.getMonth()]} ${d.getDate()}`;

/* Count-up on the plaque. `savedShown` is what the number on screen last
   read, so a re-render for some unrelated reason doesn't replay it. */
let savedShown = null;
let pendingBump = null;          // { amount, title } — set when you let something go

function countUp(node, from, to, ms = 950) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still || from == null || Math.abs(to - from) < 0.5) {
    node.textContent = money(to);
    return;
  }
  const t0 = performance.now();
  const tick = now => {
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = money(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
    else node.textContent = money(to);
  };
  requestAnimationFrame(tick);
}

function renderMoney() {
  const today = startOfDay(new Date());
  const saved = totalSaved(state.spendItems, state.spends, state.budget, today);
  const burn = burnDown(state.spends, state.budget, today, state.weekStart);

  /* ── the plaque ── */
  const card = el('div', 'saved-card');
  card.append(el('div', 'saved-label', 'Total saved'));
  const num = el('div', 'saved-num', money(savedShown != null ? savedShown : saved.total));
  card.append(num);

  const parts = [];
  if (saved.declined) parts.push(`${money(saved.declined)} let go`);
  if (saved.banked) parts.push(`${money(saved.banked)} banked`);
  card.append(el('div', 'saved-sub', parts.length
    ? parts.join(' · ')
    : 'Write down the next thing you want instead of buying it'));

  const bump = el('div', 'saved-bump');
  card.append(bump);
  view.append(card);

  countUp(num, savedShown, saved.total);
  if (pendingBump) {
    bump.textContent = `+ ${money(pendingBump.amount)} · ${pendingBump.title}`;
    requestAnimationFrame(() => bump.classList.add('on'));
    pendingBump = null;
  }
  savedShown = saved.total;

  /* ── the two things you can do ── */
  const acts = el('div', 'money-acts');
  const wantBtn = el('button', 'primary', 'Want something');
  wantBtn.onclick = () => openWant();
  const logBtn = el('button', null, 'Log a purchase');
  logBtn.onclick = () => openLog();
  acts.append(wantBtn, logBtn);
  view.append(acts);

  // The one that gets used after a weekend: a statement screenshot on
  // screen and a column of amounts under it.
  const many = el('div', 'money-acts');
  many.style.marginTop = '-8px';
  const manyBtn = el('button', null, '＋ Log several at once');
  manyBtn.onclick = () => openBatch();
  many.append(manyBtn);
  view.append(many);

  /* ── this week, then this month ── */
  view.append(burnBlock(
    'This week',
    burn.week.total, burn.allowance,
    burn.elapsed / 7,
    burn.ahead >= 0
      ? [`${money(burn.week.total, true)} of ${money(burn.allowance)} · `, `${money(Math.abs(burn.ahead))} under pace`, '']
      : [`${money(burn.week.total, true)} of ${money(burn.allowance)} · `, `${money(Math.abs(burn.ahead))} over pace`, 'over']
  ));

  const wantedPart = burn.month.wanted
    ? ` · ${money(burn.month.wanted)} of it wanted`
    : ' · none of it wanted so far';
  view.append(burnBlock(
    MONTHS[today.getMonth()],
    burn.month.total, burn.budget,
    burn.monthElapsed / burn.monthDays,
    [`${money(burn.month.total, true)} of ${money(burn.budget)}${wantedPart}`, '', '']
  ));

  /* ── waiting on a decision ── */
  const waiting = waitingItems(state.spendItems);
  if (waiting.length) {
    const sec = moneySection(`Cooling off · ${money(waiting.reduce((n, i) => n + Number(i.price || 0), 0))}`);
    for (const it of waiting) {
      const day = fromYmd(it.decide_on);
      const isDue = day <= today;
      const meta = el('div', 'sp-meta');
      meta.append(el('span', isDue ? 'due-now' : null,
        isDue ? 'Ready to decide' : `Decides ${shortDate(day)}`));
      if (it.place) meta.append(el('span', null, it.place));
      sec.append(spendRow(it.title, meta, money(it.price), null, () => openDecide(it)));
    }
    view.append(sec);
  }

  /* ── the ledger: what you decided, most recent first ── */
  const settled = state.spendItems
    .filter(i => i.status !== 'waiting')
    .sort((a, b) => new Date(b.decided_at || 0) - new Date(a.decided_at || 0))
    .slice(0, 8);
  if (settled.length) {
    const sec = moneySection('Decided');
    for (const it of settled) {
      const letGo = it.status === 'let_go';
      const meta = el('div', 'sp-meta');
      meta.append(el('span', null, letGo ? 'Let it go' : 'Bought it, having thought about it'));
      if (it.decided_at) meta.append(el('span', null, shortDate(new Date(it.decided_at))));
      sec.append(spendRow(it.title, meta, money(it.price), letGo ? 'let-go' : null,
        () => openDecide(it)));
    }
    view.append(sec);
  }

  /* ── what actually went out ── */
  const recent = state.spends.slice(0, 8);
  if (recent.length) {
    const sec = moneySection('Spent');
    for (const sp of recent) {
      const meta = el('div', 'sp-meta');
      meta.append(el('span', `sp-tag ${sp.kind === 'needed' ? 'needed' : 'wanted'}`,
        sp.kind === 'needed' ? 'Needed' : 'Wanted'));
      meta.append(el('span', null, shortDate(fromYmd(sp.spent_on))));
      sec.append(spendRow(sp.note || (sp.kind === 'needed' ? 'Something needed' : 'Something wanted'),
        meta, money(sp.amount, true), null, () => deleteSpend(sp)));
    }
    view.append(sec);
  }

  if (!waiting.length && !settled.length && !recent.length) {
    view.append(el('div', 'empty',
      'Nothing logged yet. The next time you catch yourself about to buy something, put it on the want list instead.'));
  }
}

function moneySection(label) {
  const sec = el('div', 'money-sec');
  const head = el('div', 'dg-head');
  head.append(el('span', null, label));
  sec.append(head);
  return sec;
}

function spendRow(title, metaNode, priceText, priceCls, onClick) {
  const row = el('button', 'sp-row');
  const main = el('div', 'sp-main');
  main.append(el('div', 'sp-title', title));
  if (metaNode) main.append(metaNode);
  row.append(main, el('div', 'sp-price' + (priceCls ? ' ' + priceCls : ''), priceText));
  row.onclick = onClick;
  return row;
}

/* A bar with a gold pace marker on it: left of the marker is under, right
   of it is over. The bar caps at full so going over doesn't overflow the
   track, but the note underneath still says by how much. */
function burnBlock(label, spent, cap, paceFraction, [noteLead, noteBold, boldCls]) {
  const box = el('div', 'burn');
  const head = el('div', 'burn-head');
  head.append(el('span', 'bh-label', label));
  const left = cap - spent;
  const n = el('span', 'bh-num' + (left < 0 ? ' over' : ''),
    left >= 0 ? `${money(left)} left` : `${money(-left)} over`);
  head.append(n);
  box.append(head);

  const bar = el('div', 'bar');
  const fill = el('div', 'bar-fill' + (left < 0 ? ' over' : ''));
  fill.style.width = `${Math.min(100, cap > 0 ? (spent / cap) * 100 : 0)}%`;
  const pace = el('div', 'bar-pace');
  pace.style.left = `${Math.min(100, Math.max(0, paceFraction * 100))}%`;
  bar.append(fill, pace);
  box.append(bar);

  const note = el('div', 'burn-note');
  note.append(document.createTextNode(noteLead));
  if (noteBold) note.append(el('b', boldCls || null, noteBold));
  box.append(note);
  return box;
}

/* ── writing something down instead of buying it ── */
function openWant() {
  $('#wantTitle').value = '';
  $('#wantPrice').value = '';
  $('#wantPlace').value = '';
  $('#wantNotes').value = '';
  renderWantWait();
  showSheet($('#wantSheet'));
  setTimeout(() => $('#wantTitle').focus(), 320);
}

/* Says what will happen before you commit to it, and updates as you type
   — the wait is the product, so it shouldn't be a surprise after saving. */
function renderWantWait() {
  const price = parseAmount($('#wantPrice').value);
  const note = $('#wantWait');
  const save = $('#wantSave');
  note.replaceChildren();

  if (price == null || price <= 0) {
    note.textContent = 'Put in a price and this will tell you when you decide.';
    save.textContent = 'Save';
    return;
  }
  const days = coolOffDays(price);
  if (!days) {
    note.append(document.createTextNode('Under your '));
    note.append(el('b', null, money(COOL_OFF.free)));
    note.append(document.createTextNode(' line — not worth thinking over. Saving it logs it as bought.'));
    save.textContent = 'Log it';
    return;
  }
  const day = decideOn(price, new Date());
  note.append(document.createTextNode('It goes on the calendar for '));
  note.append(el('b', null, shortDate(day)));
  note.append(document.createTextNode(` — ${days} days from now. Nothing leaves your budget until then.`));
  save.textContent = 'Save';
}
$('#wantPrice').oninput = renderWantWait;
$('#wantCancel').onclick = hideSheets;

$('#wantSave').onclick = async () => {
  const btn = $('#wantSave');
  const title = $('#wantTitle').value.trim();
  const price = parseAmount($('#wantPrice').value);
  if (!title) { alert('What is it?'); return; }
  if (price == null || price <= 0) { alert('How much is it?'); return; }

  /* Small enough that a cooling-off period would just be bureaucracy —
     straight into the ledger as a purchase, no decision to make later. */
  if (!coolOffDays(price)) {
    btn.disabled = true;
    try {
      await run(sb.from('spends').insert({
        spent_on: ymd(startOfDay(new Date())), amount: price,
        kind: 'wanted', note: title, owner: state.deviceOwner || null
      }));
      hideSheets();
      await refresh();
    } catch (e) {
      alert('Could not save that: ' + e.message);
    } finally { btn.disabled = false; }
    return;
  }

  btn.disabled = true;
  try {
    const day = decideOn(price, new Date());
    await run(sb.from('spend_items').insert({
      title, price, place: $('#wantPlace').value.trim() || null,
      notes: $('#wantNotes').value.trim() || null,
      owner: state.deviceOwner || null,
      status: 'waiting', decide_on: ymd(day)
    }));
    // Land on the day it will come back, so you see it sitting there.
    state.selected = day;
    state.cursor = day;
    hideSheets();
    await refresh();
  } catch (e) {
    alert('Could not save that: ' + e.message);
  } finally { btn.disabled = false; }
};

/* ── logging what did go out ── */
let logKind = 'wanted';
let logItem = null;              // the want-list item this purchase settles

function openLog(prefill) {
  logItem = prefill?.item || null;
  logKind = prefill?.kind || 'wanted';
  $('#logHeading').textContent = logItem ? 'What did it cost?' : 'Log a purchase';
  $('#logAmount').value = prefill?.amount != null ? String(prefill.amount) : '';
  $('#logNote').value = prefill?.note || '';
  $('#logDate').value = ymd(startOfDay(new Date()));
  renderLogKind();
  showSheet($('#logSheet'));
  setTimeout(() => $('#logAmount').focus(), 320);
}

function renderLogKind() {
  document.querySelectorAll('#logKind button').forEach(b => {
    b.classList.toggle('on', b.dataset.kind === logKind);
  });
}
document.querySelectorAll('#logKind button').forEach(b => {
  b.onclick = () => { logKind = b.dataset.kind; renderLogKind(); };
});
$('#logCancel').onclick = hideSheets;

$('#logSave').onclick = async () => {
  const btn = $('#logSave');
  const amount = parseAmount($('#logAmount').value);
  if (amount == null || amount <= 0) { alert('How much was it?'); return; }
  const on = $('#logDate').value || ymd(startOfDay(new Date()));

  btn.disabled = true;
  try {
    await run(sb.from('spends').insert({
      spent_on: on, amount, kind: logKind,
      note: $('#logNote').value.trim() || null,
      owner: state.deviceOwner || null,
      item_id: logItem ? logItem.id : null
    }));
    /* Buying at the end of a cooling-off is a decision, not a relapse —
       the item closes as decided rather than staying on the list. */
    if (logItem) {
      await run(sb.from('spend_items')
        .update({ status: 'bought', decided_at: new Date().toISOString() })
        .eq('id', logItem.id));
    }
    hideSheets();
    await refresh();
  } catch (e) {
    alert('Could not save that: ' + e.message);
  } finally { btn.disabled = false; }
};

async function deleteSpend(sp) {
  if (!confirm(`Remove this ${money(sp.amount, true)} purchase?`)) return;
  try {
    await run(sb.from('spends').delete().eq('id', sp.id));
    await refresh();
  } catch (e) {
    alert('Could not remove that: ' + e.message);
  }
}

/* ── the decision ── */
let deciding = null;

function openDecide(item) {
  deciding = item;
  const settled = item.status !== 'waiting';
  $('#decHeading').textContent = settled ? 'Already decided' : 'Still want it?';

  const sum = el('div', 'ask-summary');
  sum.append(el('div', 'as-title', `${item.title} · ${money(item.price)}`));

  const bits = [];
  if (item.place) bits.push(item.place);
  if (item.created_at) {
    const waited = Math.max(0, daysBetween(new Date(item.created_at), new Date()));
    bits.push(waited ? `written down ${waited} day${waited === 1 ? '' : 's'} ago` : 'written down today');
  }
  if (settled) bits.push(item.status === 'let_go' ? 'let go' : 'bought');
  sum.append(el('div', 'as-meta', bits.join(' · ')));
  // Why you wanted it, in your own words, read back on the day — which is
  // most of what makes the answer easy.
  if (item.notes) sum.append(el('div', 'as-note', `“${item.notes}”`));
  $('#decSummary').replaceChildren(sum);

  $('#decLetGo').hidden = settled;
  $('#decBuy').hidden = settled;
  $('#decWait').hidden = settled;
  $('#decDrop').textContent = settled ? 'Remove from the ledger' : 'Remove from the list';
  showSheet($('#decSheet'));
}

$('#decClose').onclick = hideSheets;

$('#decLetGo').onclick = async () => {
  const item = deciding;
  if (!item) return;
  try {
    await run(sb.from('spend_items')
      .update({ status: 'let_go', decided_at: new Date().toISOString() })
      .eq('id', item.id));
    // The payoff, on the screen that holds the number.
    pendingBump = { amount: Number(item.price) || 0, title: item.title };
    state.view = 'money';
    document.querySelectorAll('.views button')
      .forEach(b => b.classList.toggle('on', b.dataset.view === 'money'));
    hideSheets();
    await refresh();
  } catch (e) {
    alert('Could not save that: ' + e.message);
  }
};

$('#decBuy').onclick = () => {
  const item = deciding;
  if (!item) return;
  hideSheets();
  // The listed price is a guess; what it actually cost is what the budget
  // needs, so this goes through the ordinary log sheet.
  openLog({ amount: item.price, kind: 'wanted', note: item.title, item });
};

$('#decWait').onclick = async () => {
  const item = deciding;
  if (!item) return;
  try {
    const day = addDays(startOfDay(new Date()), 7);
    await run(sb.from('spend_items').update({ decide_on: ymd(day) }).eq('id', item.id));
    hideSheets();
    await refresh();
  } catch (e) {
    alert('Could not save that: ' + e.message);
  }
};

$('#decDrop').onclick = async () => {
  const item = deciding;
  if (!item) return;
  if (!confirm(`Remove "${item.title}"? It won't count as let go.`)) return;
  try {
    await run(sb.from('spend_items').delete().eq('id', item.id));
    hideSheets();
    await refresh();
  } catch (e) {
    alert('Could not remove that: ' + e.message);
  }
};

/* ══ logging several at once ════════════════════════════
   A statement screenshot pinned at the top and a column of amounts
   under it. The screenshot is a local object URL and is never uploaded
   — it exists to be read off, and dies when the sheet closes.

   The row list always keeps one empty row at the bottom, and grows as
   you fill it, so a batch of nine costs nine amounts and no taps on
   "add". That is the whole point: the friction of logging is what
   decides whether these numbers stay honest. */

let batchDraft = [];
let shotUrl = null;

const blankRow = () => ({ amount: '', note: '', kind: 'wanted' });

function openBatch() {
  batchDraft = [blankRow(), blankRow()];
  $('#batchDate').value = ymd(startOfDay(new Date()));
  clearShot();
  renderBatchRows();
  showSheet($('#batchSheet'));
}

function clearShot() {
  if (shotUrl) { URL.revokeObjectURL(shotUrl); shotUrl = null; }
  $('#batchShotImg').removeAttribute('src');
  $('#batchShotBox').hidden = true;
  $('#batchShotPick').hidden = false;
  $('#batchShotWrap').classList.remove('tall');
  $('#batchShotZoom').textContent = 'Bigger';
  $('#batchShotInput').value = '';
}

$('#batchShotPick').onclick = () => $('#batchShotInput').click();
$('#batchShotInput').onchange = () => {
  const file = $('#batchShotInput').files[0];
  if (!file) return;
  if (shotUrl) URL.revokeObjectURL(shotUrl);
  shotUrl = URL.createObjectURL(file);
  $('#batchShotImg').src = shotUrl;
  $('#batchShotBox').hidden = false;
  $('#batchShotPick').hidden = true;
};
$('#batchShotDrop').onclick = clearShot;
$('#batchShotZoom').onclick = () => {
  // Tall shows the image at natural width inside a scroller, which is
  // what makes a column of small figures actually readable.
  const wrap = $('#batchShotWrap');
  const tall = wrap.classList.toggle('tall');
  $('#batchShotZoom').textContent = tall ? 'Smaller' : 'Bigger';
};

/* Rows are built one at a time and appended, never re-rendered as a
   list while you type: replacing the input you are currently in throws
   focus away and can swallow a keystroke. Only deleting a row — where
   you are not mid-word — rebuilds the lot. */
function buildRow(r) {
  const row = el('div', 'brow');

  const amt = el('input', 'b-amt');
  amt.type = 'text'; amt.inputMode = 'decimal'; amt.value = r.amount;
  amt.placeholder = '0'; amt.enterKeyHint = 'next';
  amt.oninput = () => {
    r.amount = amt.value;
    // Filling the last row grows the sheet, so a long statement never
    // needs a trip to the "add" button. Appending rather than
    // re-rendering leaves the caret exactly where it was.
    if (r === batchDraft[batchDraft.length - 1] && amt.value.trim()) {
      const next = blankRow();
      batchDraft.push(next);
      $('#batchRows').append(buildRow(next));
    }
    markGhosts();
    syncBatchTotal();
  };

  const note = el('input', 'b-note');
  note.type = 'text'; note.value = r.note;
  note.placeholder = 'What for (optional)';
  note.autocomplete = 'off'; note.enterKeyHint = 'next';
  note.oninput = () => { r.note = note.value; };

  // One tap flips it. A picker would cost more than the row is worth.
  const kind = el('button', 'b-kind');
  const paintKind = () => {
    kind.textContent = r.kind === 'needed' ? 'N' : 'W';
    kind.title = r.kind === 'needed' ? 'Needed' : 'Wanted';
    kind.classList.toggle('want', r.kind !== 'needed');
  };
  paintKind();
  kind.onclick = () => {
    r.kind = r.kind === 'needed' ? 'wanted' : 'needed';
    paintKind();
    syncBatchTotal();
  };

  const drop = el('button', 'b-drop', '×');
  drop.onclick = () => {
    const i = batchDraft.indexOf(r);
    if (i >= 0) batchDraft.splice(i, 1);
    if (!batchDraft.length) batchDraft.push(blankRow());
    if (batchDraft[batchDraft.length - 1].amount.trim()) batchDraft.push(blankRow());
    renderBatchRows();
  };

  row.append(amt, note, kind, drop);
  return row;
}

/* The trailing empty row is dimmed, so it reads as somewhere to type
   rather than as a purchase of nothing. */
function markGhosts() {
  const rows = [...$('#batchRows').children];
  rows.forEach((node, i) => {
    node.classList.toggle('ghost', !batchDraft[i]?.amount.trim() && i === rows.length - 1);
  });
}

function renderBatchRows() {
  const box = $('#batchRows');
  box.replaceChildren(...batchDraft.map(buildRow));
  markGhosts();
  syncBatchTotal();
}

/* The size of what you're about to enter, and what it does to the week,
   before you commit to it rather than after. */
function syncBatchTotal() {
  const sum = batchSummary(batchDraft);
  $('#batchCount').textContent = sum.count
    ? `${sum.count} purchase${sum.count === 1 ? '' : 's'}`
      + (sum.wanted ? ` · ${money(sum.wanted, true)} wanted` : ' · none of it wanted')
    : 'Nothing yet';
  $('#batchTotal').textContent = money(sum.total, true);

  const note = $('#batchWeek');
  note.replaceChildren();
  if (!sum.count) return;

  const on = $('#batchDate').value || ymd(startOfDay(new Date()));
  const day = fromYmd(on);
  const burn = burnDown(state.spends, state.budget, day, state.weekStart);
  const after = burn.week.total + sum.total;
  const over = after > burn.allowance;
  note.append(document.createTextNode('That week goes to '));
  note.append(el('b', over ? 'over' : null, money(after, true)));
  note.append(document.createTextNode(` of ${money(burn.allowance)}`));
}
$('#batchDate').onchange = syncBatchTotal;

$('#batchAddRow').onclick = () => {
  batchDraft.push(blankRow());
  renderBatchRows();
};
$('#batchCancel').onclick = () => { clearShot(); hideSheets(); };

$('#batchSave').onclick = async () => {
  const btn = $('#batchSave');
  const keep = batchRows(batchDraft);
  if (!keep.length) { alert('Put an amount on at least one row.'); return; }
  const on = $('#batchDate').value || ymd(startOfDay(new Date()));

  btn.disabled = true;
  try {
    await run(sb.from('spends').insert(
      batchToSpends(batchDraft, on, state.deviceOwner || null)));
    clearShot();
    hideSheets();
    await refresh();
  } catch (e) {
    alert('Could not save those: ' + e.message);
  } finally { btn.disabled = false; }
};
