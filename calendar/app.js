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
  HOUSEHOLD_EMAIL, PIN_SALT, SHOW_HOLIDAYS
} from './config.js';
import {
  DAY_MS, startOfDay, addDays, addMonths, daysBetween, ymd, fromYmd, hm, sameDay, startOfWeek,
  MONTHS, MON_SHORT, DOW_SHORT, DOW_MIN, DAYCODE,
  fmtTime, holidays, parseRRule, occurrenceDays, makeOccurrence
} from './lib.js';


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

const holidayOn = d => SHOW_HOLIDAYS ? (holidays(d.getFullYear()).get(ymd(d)) || null) : null;

/* ══ state ══════════════════════════════════════════════ */
const state = {
  people: [],
  events: [],
  exceptions: new Map(),        // `${event_id}|${YYYY-MM-DD}` → exception row
  view: 'month',
  cursor: startOfDay(new Date()),
  selected: startOfDay(new Date()),
  filter: new Set(),            // empty = everyone
  weekStart: 0,
  deviceOwner: localStorage.getItem('jfc-owner') || ''
};

const personById = id => state.people.find(p => p.id === id) || null;
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
  view.replaceChildren();
  if (state.view === 'month') renderMonth();
  else if (state.view === 'week') renderWeek();
  else renderAgenda();
}

function headerTitle() {
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
        const i2 = el('i'); i2.style.background = colorOf(o); dots.append(i2);
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
  const add = el('button', 'add', '+ Add');
  add.onclick = () => openEditor(null, state.selected);
  head.append(add);
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
  const row = el('div', 'ev');
  const bar = el('div', 'ev-bar');
  bar.style.background = colorOf(o);

  const time = el('div', 'ev-time', o.allDay ? 'All day' : fmtTime(o.start));
  const body = el('div', 'ev-body');
  body.append(el('div', 'ev-title', o.title));

  const meta = el('div', 'ev-meta');
  for (const id of o.personIds) {
    const p = personById(id);
    if (!p) continue;
    const w = el('span', 'who');
    const dot = el('i'); dot.style.background = p.color;
    w.append(dot, document.createTextNode(p.name));
    meta.append(w);
  }
  if (!o.personIds.length) meta.append(el('span', 'who', 'Everyone'));
  if (o.location) meta.append(el('span', null, o.location));
  if (o.repeating) meta.append(el('span', 'rep', o.isOverride ? '↻ changed' : '↻ repeats'));
  if (meta.childNodes.length) body.append(meta);

  row.append(bar, time, body);
  row.onclick = () => openEditor(o, o.day);
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
let draftPeople = [];

function openSettings() {
  draftPeople = state.people.map(p => ({ ...p }));
  renderPeopleEditor();
  const sel = $('#deviceOwner');
  sel.replaceChildren(new Option('Not set', ''));
  state.people.forEach(p => sel.append(new Option(p.name, p.id)));
  sel.value = state.deviceOwner && state.people.some(p => p.name === state.deviceOwner)
    ? state.people.find(p => p.name === state.deviceOwner).id : '';
  $('#weekStart').value = String(state.weekStart);
  showSheet($('#setSheet'));
}

function renderPeopleEditor() {
  const box = $('#peopleList');
  box.replaceChildren();
  draftPeople.forEach((p, i) => {
    const row = el('div', 'person-row');
    const color = el('input'); color.type = 'color'; color.value = p.color;
    color.oninput = () => { p.color = color.value; };
    const name = el('input'); name.type = 'text'; name.value = p.name;
    name.oninput = () => { p.name = name.value; };
    const del = el('button', 'del', '×');
    del.onclick = () => { draftPeople.splice(i, 1); renderPeopleEditor(); };
    row.append(color, name, del);
    box.append(row);
  });
}

$('#addPerson').onclick = () => {
  const palette = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04'];
  draftPeople.push({ id: null, name: '', color: palette[draftPeople.length % palette.length] });
  renderPeopleEditor();
};

$('#setSave').onclick = async () => {
  try {
    const keep = draftPeople.filter(p => p.name.trim());
    for (const [i, p] of keep.entries()) {
      const row = { name: p.name.trim(), color: p.color, sort_order: i + 1 };
      if (p.id) await run(sb.from('people').update(row).eq('id', p.id));
      else await run(sb.from('people').insert(row));
    }
    const keptIds = new Set(keep.filter(p => p.id).map(p => p.id));
    for (const p of state.people) {
      if (!keptIds.has(p.id)) await run(sb.from('people').delete().eq('id', p.id));
    }
    state.weekStart = Number($('#weekStart').value);
    localStorage.setItem('jfc-weekstart', String(state.weekStart));
    await run(sb.from('household_settings').update({
      week_starts_on: state.weekStart,
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
    return true;
  } catch { return false; }
}

function saveCache(people, events, exceptions) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ people, events, exceptions }));
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
    const [people, events, excs, settings] = await Promise.all([
      sb.from('people').select('*').order('sort_order'),
      sb.from('events').select('*'),
      sb.from('event_exceptions').select('*'),
      sb.from('household_settings').select('*').eq('id', 1).maybeSingle()
    ]);
    for (const r of [people, events, excs]) if (r.error) throw r.error;

    state.people = people.data || [];
    state.events = events.data || [];
    state.exceptions = new Map((excs.data || [])
      .map(e => [`${e.event_id}|${e.occurrence_date}`, e]));
    if (settings.data && settings.data.week_starts_on != null) {
      state.weekStart = settings.data.week_starts_on;
      localStorage.setItem('jfc-weekstart', String(state.weekStart));
    }
    saveCache(state.people, state.events, excs.data || []);
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
