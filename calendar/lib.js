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

/* ── holidays ──────────────────────────────────────────────
   Two sets: the US ones the paper calendar prints, and the Dutch ones
   this household also keeps. Both are on by default; see HOLIDAY_SETS
   in config.js.

   Where the two land on the same day the entries merge — Nov 11 is
   Veterans Day *and* Sint-Maarten — so nothing is silently dropped. */
export function nthDow(y, m, dow, n) {
  if (n > 0) {
    const first = new Date(y, m, 1);
    return new Date(y, m, 1 + ((dow - first.getDay() + 7) % 7) + (n - 1) * 7);
  }
  const last = new Date(y, m + 1, 0);
  return new Date(y, m + 1, -((last.getDay() - dow + 7) % 7));
}

/* Easter Sunday, Gregorian (Meeus/Jones/Butcher). Six of the Dutch
   holidays are counted from it, and it sets Good Friday too. */
export function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return new Date(year, Math.floor(n / 31) - 1, (n % 31) + 1);
}

/* Each entry carries a full name and a short one; the month grid cell is
   only ~50px wide, so it uses `short` while agenda and week use `name`. */
const holidayCache = new Map();
export function holidays(year, sets = ['us', 'nl']) {
  const key = `${year}|${sets.join(',')}`;
  if (holidayCache.has(key)) return holidayCache.get(key);
  const map = new Map();

  /* Two holidays can share a date. The first one in wins the short label
     — the grid has room for one — and the full names join, so the agenda
     still shows both. US is added first, so it leads. */
  const put = (d, name, short) => {
    const k = ymd(d);
    const prev = map.get(k);
    if (prev) {
      if (!prev.name.split(' · ').includes(name)) prev.name += ` · ${name}`;
      return;
    }
    map.set(k, { name, short: short || name });
  };
  const fixed = (m, d, name, short) => put(new Date(year, m, d), name, short);

  const pasen = easter(year);
  const fromEaster = (n, name, short) => put(addDays(pasen, n), name, short);

  if (sets.includes('us')) {
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
    fromEaster(0, 'Easter', 'Easter');
  }

  if (sets.includes('nl')) {
    fromEaster(-2, 'Goede Vrijdag', 'G. Vrijdag');
    fromEaster(0, 'Eerste Paasdag', 'Paasdag');
    fromEaster(1, 'Tweede Paasdag', '2e Paasdag');
    /* Koningsdag is the 27th, but never on a Sunday — it moves back a day. */
    const apr27 = new Date(year, 3, 27);
    put(apr27.getDay() === 0 ? addDays(apr27, -1) : apr27, 'Koningsdag', 'Koningsdag');
    fixed(4, 5, 'Bevrijdingsdag', 'Bevrijding');
    fromEaster(39, 'Hemelvaartsdag', 'Hemelvaart');
    fromEaster(49, 'Eerste Pinksterdag', 'Pinksteren');
    fromEaster(50, 'Tweede Pinksterdag', '2e Pinkst.');
    fixed(10, 11, 'Sint-Maarten', 'St-Maarten');
    fixed(11, 5, 'Sinterklaas', 'Sinterklaas');
    fixed(11, 25, 'Eerste Kerstdag', 'Kerstdag');
    fixed(11, 26, 'Tweede Kerstdag', '2e Kerstdag');
  }

  holidayCache.set(key, map);
  return map;
}

/* ── birthdays and the anniversary ─────────────────────────
   These aren't stored as events. A birthday belongs to a person and an
   anniversary to the household, so they're generated from those records
   the way holidays are generated from the year. Nothing to keep in sync,
   nothing to accidentally delete, and renaming a person renames theirs.

   Stored as MM-DD, or YYYY-MM-DD when the year is known — the year is
   optional because an age is nice to have, not the point. */
export const isLeapYear = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function parseAnnual(s) {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec((s || '').trim());
  if (!m) return null;
  const year = m[1] ? Number(m[1]) : null;
  const month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  /* Reject a day the month never has — 02-30, 04-31. */
  if (day > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return null;
  return { year, month, day };
}

/* Feb 29 falls back to Mar 1 in a common year, so a leap-day birthday is
   still marked every year rather than three times out of four. */
export function annualDate(a, year) {
  if (a.month === 2 && a.day === 29 && !isLeapYear(year)) return new Date(year, 2, 1);
  return new Date(year, a.month - 1, a.day);
}

/* Occurrence-shaped, so the day map, the filters and the row renderer all
   treat these exactly like any other all-day event. */
export function celebrations(people, anniversary, from, to) {
  const out = [];
  const years = [...new Set([from.getFullYear(), to.getFullYear()])];

  const add = (a, kind, title, personIds, color, agePart) => {
    for (const year of years) {
      const day = annualDate(a, year);
      if (day < from || day > to) continue;
      const age = a.year != null ? year - a.year : null;
      out.push({
        celebration: kind, ev: null, eventId: `${kind}:${title}:${year}`,
        dateKey: ymd(day), day,
        title: age != null && age >= 0 ? `${title} ${agePart(age)}` : title,
        notes: null, location: null,
        allDay: true, start: day, end: day,
        personIds, color, repeating: false, isOverride: false
      });
    }
  };

  for (const p of people) {
    const a = parseAnnual(p.birthday);
    if (a && p.name) add(a, 'birthday', `${p.name}'s birthday`, [p.id], p.color, n => `(${n})`);
  }
  const a = parseAnnual(anniversary);
  if (a) add(a, 'anniversary', 'Anniversary', [], 'var(--gold)',
             n => `(${n} year${n === 1 ? '' : 's'})`);

  return out;
}

/* ── proposals ─────────────────────────────────────────────
   An ask carries one or more suggested times and turns into a real
   event only when it's accepted. Both phones share a login, so "who is
   this for" is decided by the device owner name set in Settings. */

export function proposalOptions(p) {
  const raw = Array.isArray(p.options) ? p.options
            : (typeof p.options === 'string' ? JSON.parse(p.options || '[]') : []);
  return raw.map(o => ({
    start: new Date(o.start),
    end: o.end ? new Date(o.end) : null,
    allDay: !!o.all_day
  })).filter(o => !isNaN(o.start));
}

export function fmtOption(o) {
  const d = `${DOW_SHORT[o.start.getDay()]} ${MON_SHORT[o.start.getMonth()]} ${o.start.getDate()}`;
  if (o.allDay) return `${d} · all day`;
  return o.end ? `${d} · ${fmtTime(o.start)}–${fmtTime(o.end)}` : `${d} · ${fmtTime(o.start)}`;
}

/* Who is looking at this. An unset device owner can't be told apart, so
   it sees everything rather than nothing — the app nudges you to set it. */
export function proposalRole(p, me) {
  if (!me) return 'unknown';
  return p.asked_by === me ? 'asker' : 'answerer';
}

/* What each phone should be told about, split by what it can do. */
export function inbox(proposals, me) {
  const toAnswer = [], answered = [];
  for (const p of proposals) {
    const role = proposalRole(p, me);
    if (p.status === 'pending') {
      if (role !== 'asker') toAnswer.push(p);
    } else if ((p.status === 'accepted' || p.status === 'declined')
               && role === 'asker' && !p.seen_by_asker) {
      answered.push(p);
    }
  }
  const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);
  return { toAnswer: toAnswer.sort(byNewest), answered: answered.sort(byNewest) };
}

/* Pending times, shaped like occurrences so the grid and the day list can
   show them as tentative alongside real events. */
export function proposalMarkers(proposals, from, to) {
  const out = [];
  for (const p of proposals) {
    if (p.status !== 'pending') continue;
    proposalOptions(p).forEach((o, i) => {
      const day = startOfDay(o.start);
      if (day < from || day > to) return;
      out.push({
        proposed: true, proposal: p, optionIndex: i,
        ev: null, eventId: `proposal:${p.id}:${i}`,
        dateKey: ymd(day), day,
        title: p.title, notes: p.notes, location: p.location,
        askedBy: p.asked_by,
        allDay: o.allDay, start: o.start, end: o.end,
        personIds: p.person_ids || [], color: null,
        repeating: false, isOverride: false
      });
    });
  }
  return out;
}

/* The event row an accepted option becomes. Kept here so it matches what
   the editor writes, and so it can be tested without a database. */
export function eventFromProposal(p, index, by) {
  const o = proposalOptions(p)[index];
  if (!o) return null;
  return {
    title: p.title,
    notes: p.notes || null,
    location: p.location || null,
    starts_at: o.start.toISOString(),
    ends_at: o.end ? o.end.toISOString() : null,
    all_day: o.allDay,
    person_ids: p.person_ids || [],
    rrule: null,
    recurrence_until: null,
    created_by: by || p.asked_by || null
  };
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
