/* Pure date, holiday and recurrence logic — no DOM, no network.
   Split out from app.js so it can be exercised by test.mjs. */

export const DAY_MS = 86400000;

export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
export const pad2 = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const fromYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const hm = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
export const sameDay = (a, b) => !!a && !!b && ymd(a) === ymd(b);
export const startOfWeek = (d, ws) => addDays(startOfDay(d), -(((d.getDay() - ws) + 7) % 7));

export const MONTHS = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
export const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export const DOW_MIN   = ['S','M','T','W','T','F','S'];
export const DAYCODE   = ['SU','MO','TU','WE','TH','FR','SA'];

export function fmtTime(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return m ? `${h}:${pad2(m)} ${ap}` : `${h} ${ap}`;
}

/* ── US holidays, matching what the paper calendar prints ── */
export function nthDow(y, m, dow, n) {
  if (n > 0) {
    const first = new Date(y, m, 1);
    return new Date(y, m, 1 + ((dow - first.getDay() + 7) % 7) + (n - 1) * 7);
  }
  const last = new Date(y, m + 1, 0);
  return new Date(y, m + 1, -((last.getDay() - dow + 7) % 7));
}

/* Each entry carries a full name and a short one; the month grid cell is
   only ~50px wide, so it uses `short` while agenda and week use `name`. */
const holidayCache = new Map();
export function holidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const map = new Map();
  const put = (d, name, short) => map.set(ymd(d), { name, short: short || name });
  const fixed = (m, d, name, short) => put(new Date(year, m, d), name, short);

  fixed(0, 1, "New Year's Day", "New Year's");
  put(nthDow(year, 0, 1, 3), 'MLK Day', 'MLK Day');
  fixed(1, 14, "Valentine's Day", "Valentine's");
  put(nthDow(year, 1, 1, 3), "Presidents' Day", "Presidents'");
  fixed(2, 17, "St. Patrick's Day", "St. Pat's");
  put(nthDow(year, 4, 0, 2), "Mother's Day", "Mother's");
  put(nthDow(year, 4, 1, -1), 'Memorial Day', 'Memorial');
  fixed(5, 19, 'Juneteenth', 'Juneteenth');
  put(nthDow(year, 5, 0, 3), "Father's Day", "Father's");
  fixed(6, 4, 'Independence Day', 'July 4');
  put(nthDow(year, 8, 1, 1), 'Labor Day', 'Labor Day');
  put(nthDow(year, 9, 1, 2), 'Columbus Day', 'Columbus');
  fixed(9, 31, 'Halloween', 'Halloween');
  fixed(10, 11, 'Veterans Day', 'Veterans');
  put(nthDow(year, 10, 4, 4), 'Thanksgiving', 'Thanksgiv.');
  fixed(11, 24, 'Christmas Eve', 'Xmas Eve');
  fixed(11, 25, 'Christmas', 'Christmas');
  fixed(11, 31, "New Year's Eve", "NYE");

  holidayCache.set(year, map);
  return map;
}

/* ── recurrence ────────────────────────────────────────── */
export function parseRRule(s) {
  if (!s) return null;
  const out = { freq: null, interval: 1, byday: null };
  for (const part of String(s).split(';')) {
    const [k, v] = part.split('=');
    if (k === 'FREQ') out.freq = v;
    else if (k === 'INTERVAL') out.interval = Math.max(1, parseInt(v, 10) || 1);
    else if (k === 'BYDAY') {
      const days = v.split(',').map(c => DAYCODE.indexOf(c)).filter(i => i >= 0);
      if (days.length) out.byday = days;
    }
  }
  return out.freq ? out : null;
}

/* Every day this event lands on within [from, to], as local midnights. */
export function occurrenceDays(ev, from, to) {
  const base = new Date(ev.starts_at);
  if (isNaN(base)) return [];
  const baseDay = startOfDay(base);
  const rule = parseRRule(ev.rrule);
  const until = ev.recurrence_until ? fromYmd(ev.recurrence_until) : null;
  const last = (until && until < to) ? until : startOfDay(to);
  const first = baseDay > from ? baseDay : startOfDay(from);
  if (last < first) return [];

  if (!rule) return (baseDay >= first && baseDay <= last) ? [baseDay] : [];

  const out = [];
  const CAP = 2000;

  if (rule.freq === 'DAILY') {
    const step = rule.interval;
    const n = Math.max(0, Math.ceil(daysBetween(baseDay, first) / step));
    for (let i = 0; i < CAP; i++) {
      const d = addDays(baseDay, (n + i) * step);
      if (d > last) break;
      if (d >= first) out.push(d);
    }

  } else if (rule.freq === 'WEEKLY') {
    const days = (rule.byday && rule.byday.length ? rule.byday : [baseDay.getDay()])
      .slice().sort((a, b) => a - b);
    const baseWeek = startOfWeek(baseDay, 0);
    const w = Math.max(0, Math.floor(daysBetween(baseWeek, startOfWeek(first, 0)) / 7 / rule.interval));
    for (let i = 0; i < CAP; i++) {
      const wk = addDays(baseWeek, (w + i) * rule.interval * 7);
      if (wk > last) break;
      for (const dow of days) {
        const d = addDays(wk, dow);
        if (d >= first && d >= baseDay && d <= last) out.push(d);
      }
    }

  } else if (rule.freq === 'MONTHLY') {
    const dom = baseDay.getDate();
    const diffM = (first.getFullYear() - baseDay.getFullYear()) * 12
                + (first.getMonth() - baseDay.getMonth());
    const n = Math.max(0, Math.floor(diffM / rule.interval));
    for (let i = 0; i < CAP; i++) {
      const step = (n + i) * rule.interval;
      const monthStart = new Date(baseDay.getFullYear(), baseDay.getMonth() + step, 1);
      if (monthStart > last) break;
      const d = new Date(baseDay.getFullYear(), baseDay.getMonth() + step, dom);
      if (d.getDate() !== dom) continue;          // e.g. the 31st of a short month
      if (d > last) break;
      if (d >= first && d >= baseDay) out.push(d);
    }

  } else if (rule.freq === 'YEARLY') {
    const dom = baseDay.getDate();
    const n = Math.max(0, Math.floor((first.getFullYear() - baseDay.getFullYear()) / rule.interval));
    for (let i = 0; i < CAP; i++) {
      const year = baseDay.getFullYear() + (n + i) * rule.interval;
      if (new Date(year, 0, 1) > last) break;
      const d = new Date(year, baseDay.getMonth(), dom);
      if (d.getDate() !== dom) continue;           // Feb 29 in a non-leap year
      if (d > last) break;
      if (d >= first && d >= baseDay) out.push(d);
    }
  }
  return out;
}

/* One concrete instance of an event on one day, with any
   single-occurrence override already folded in. */
export function makeOccurrence(ev, day, exc) {
  const base = new Date(ev.starts_at);
  const o = {
    ev, eventId: ev.id, dateKey: ymd(day), day,
    title: ev.title, notes: ev.notes, location: ev.location,
    allDay: ev.all_day, personIds: ev.person_ids || [], color: ev.color,
    repeating: !!ev.rrule, isOverride: false
  };

  if (ev.all_day) {
    o.start = day;
    const span = ev.ends_at
      ? Math.max(0, Math.round((startOfDay(new Date(ev.ends_at)) - startOfDay(base)) / DAY_MS))
      : 0;
    o.end = addDays(day, span);
  } else {
    o.start = new Date(day.getFullYear(), day.getMonth(), day.getDate(),
                       base.getHours(), base.getMinutes());
    o.end = ev.ends_at ? new Date(o.start.getTime() + (new Date(ev.ends_at) - base)) : null;
  }

  const ov = exc && exc.action === 'override' ? exc.overrides : null;
  if (ov) {
    o.isOverride = true;
    if (ov.title != null) o.title = ov.title;
    if (ov.notes !== undefined) o.notes = ov.notes;
    if (ov.location !== undefined) o.location = ov.location;
    if (ov.color !== undefined) o.color = ov.color;
    if (ov.person_ids) o.personIds = ov.person_ids;
    if (ov.all_day != null) o.allDay = ov.all_day;
    if (ov.starts_at) o.start = new Date(ov.starts_at);
    if (ov.ends_at !== undefined) o.end = ov.ends_at ? new Date(ov.ends_at) : null;
    if (o.allDay) o.start = startOfDay(o.start);
  }
  return o;
}
