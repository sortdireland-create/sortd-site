// js/school-year.js — the Irish school year and weekly-class scheduling,
// shared by class pages (js/class-page.js) and the Sortd calendar in the
// planner (js/planner.js). Exposes window.SortdSchoolYear.
//
// ONE EDIT A YEAR: update TERMS, BREAKS and BANK_HOLIDAYS each August.
// 2026/27 = standardised school year (Circular 0018/2026).
(function () {
  'use strict';
  var TERMS = [
    ['2026-08-27', '2026-12-22'],
    ['2027-01-06', '2027-03-19'],
    ['2027-04-05', '2027-06-25']
  ];
  var BREAKS = [ // midterms inside a term: classes pause
    ['2026-10-26', '2026-10-30', 'Midterm'],
    ['2027-02-18', '2027-02-19', 'Midterm']
  ];
  var HOLIDAYS = [ // gaps between terms, for labelling the calendar
    ['2026-12-23', '2027-01-05', 'Christmas holidays'],
    ['2027-03-22', '2027-04-02', 'Easter holidays'],
    ['2027-06-26', '2027-08-26', 'Summer holidays']
  ];
  var BANK_HOLIDAYS = ['2026-10-26', '2026-12-25', '2026-12-26', '2027-01-01', '2027-02-01', '2027-03-17', '2027-03-29', '2027-05-03', '2027-06-07'];

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAY_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function nice(d) { return DAY_NAMES[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function today() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function fmtTime(mins) { var h = Math.floor(mins / 60), m = mins % 60, mer = h >= 12 ? 'pm' : 'am'; var h12 = h % 12 || 12; return h12 + (m ? ':' + pad(m) : '') + mer; }

  // ---- Timetable parsing ("Mon (Venue): 5:00-5:45pm Grade 1, ...") ----
  function dayIndex(word) { return DAY_SHORT.indexOf(String(word || '').toLowerCase().slice(0, 3)); }
  function toMinutes(h, m, mer) {
    h = +h; m = +(m || 0);
    if (mer) { mer = mer.toLowerCase(); if (mer === 'pm' && h !== 12) h += 12; if (mer === 'am' && h === 12) h = 0; }
    return h * 60 + m;
  }
  var TIME_RE = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(.*)$/i;
  function parseRange(s) {
    var m = String(s).trim().match(TIME_RE); if (!m) return null;
    var endMer = m[6] || m[3], end = toMinutes(m[4], m[5], endMer);
    var start = toMinutes(m[1], m[2], m[3] || endMer);
    if (!m[3] && start > end) start = toMinutes(m[1], m[2], 'am');
    if (!m[3] && !endMer && +m[1] < 8) { start += 720; end += 720; }
    if (end <= start || start < 360) return null;
    return { start: start, end: end, label: (m[7] || '').replace(/^[\s:–-]+/, '').trim() };
  }
  function parseTimetable(text) {
    var out = [];
    String(text || '').split('\n').forEach(function (line) {
      line = line.trim(); if (!line) return;
      var m = line.match(/^([A-Za-z]{3,9})\.?\s*(?:\(([^)]*)\))?\s*:\s*(.+)$/);
      if (!m || dayIndex(m[1]) === -1) return;
      var day = dayIndex(m[1]), venue = (m[2] || '').trim();
      m[3].split(/,\s*(?=\d)/).forEach(function (slot) {
        var r = parseRange(slot); if (r) out.push({ day: day, venue: venue, start: r.start, end: r.end, label: r.label });
      });
    });
    return out;
  }

  // ---- Term-time dates ----
  function within(s, list) { for (var i = 0; i < list.length; i++) if (s >= list[i][0] && s <= list[i][1]) return list[i]; return null; }
  function inBreak(d) { return !!within(iso(d), BREAKS); }
  function termOf(d) { var s = iso(d); for (var i = 0; i < TERMS.length; i++) if (s >= TERMS[i][0] && s <= TERMS[i][1]) return i; return -1; }
  function isBankHoliday(d) { return BANK_HOLIDAYS.indexOf(iso(d)) !== -1; }
  function whyOff(d) { // null if a normal term-time day
    var s = iso(d), b = within(s, BREAKS); if (b) return b[2];
    var h = within(s, HOLIDAYS); if (h) return h[2];
    if (termOf(d) === -1) return 'No school';
    if (isBankHoliday(d)) return 'Bank holiday';
    return null;
  }
  function firstOnOrAfter(d, dow) { var x = new Date(d.getTime()); while (x.getDay() !== dow) x = addDays(x, 1); return x; }
  function lastTermDay() { return parseISO(TERMS[TERMS.length - 1][1]); }
  function currentTermEnd(from) { // end of the term containing (or next after) `from`
    var s = iso(from);
    for (var i = 0; i < TERMS.length; i++) if (s <= TERMS[i][1]) return parseISO(TERMS[i][1]);
    return lastTermDay();
  }
  // Does a weekly class run on this date?
  function runsOn(d, dow, from, until) {
    if (d.getDay() !== dow) return false;
    if (from && d < from) return false;
    if (until && d > until) return false;
    return termOf(d) !== -1 && !inBreak(d) && !isBankHoliday(d);
  }
  // Unbroken weekly runs from `from` to `until`; bank holidays become exceptions.
  function runs(dow, from, until) {
    var out = [], cur = null, d = firstOnOrAfter(from, dow);
    for (; d <= until; d = addDays(d, 7)) {
      var ok = termOf(d) !== -1 && !inBreak(d);
      if (ok) {
        if (cur && termOf(d) === cur.term && !cur.broken) cur.last = d;
        else { cur = { term: termOf(d), first: d, last: d, ex: [] }; out.push(cur); }
        if (isBankHoliday(d)) cur.ex.push(d);
      } else if (cur) cur.broken = true;
    }
    out.forEach(function (r) {
      while (r.ex.length && iso(r.ex[0]) === iso(r.first)) { r.ex.shift(); r.first = addDays(r.first, 7); }
      while (r.ex.length && iso(r.ex[r.ex.length - 1]) === iso(r.last)) { r.ex.pop(); r.last = addDays(r.last, -7); }
    });
    return out.filter(function (r) { return r.first <= r.last; });
  }
  function count(r) { return Math.round((r.last - r.first) / (7 * 864e5)) + 1 - r.ex.length; }

  // ---- Calendar exports. ev = { uid, title, details, location, day, start, end } ----
  function stamp(d, mins) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(Math.floor(mins / 60)) + pad(mins % 60) + '00'; }
  function ymd(d) { return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
  function googleLink(ev, r) {
    var p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: stamp(r.first, ev.start) + '/' + stamp(r.first, ev.end), ctz: 'Europe/Dublin',
      details: ev.details || '', location: ev.location || '', recur: 'RRULE:FREQ=WEEKLY;UNTIL=' + ymd(r.last) + 'T235959Z' });
    return 'https://calendar.google.com/calendar/render?' + p.toString();
  }
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function fold(line) { var out = ''; while (line.length > 73) { out += line.slice(0, 73) + '\r\n '; line = line.slice(73); } return out + line; }
  function icsEvents(ev, rs) {
    var L = [], now = new Date(), dtstamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + '00Z';
    rs.forEach(function (r, i) {
      L.push('BEGIN:VEVENT', 'UID:' + ev.uid + '-' + ymd(r.first) + '-' + i + '@sortd-ireland.ie', 'DTSTAMP:' + dtstamp,
        ev.allDay ? 'DTSTART;VALUE=DATE:' + ymd(r.first) : 'DTSTART;TZID=Europe/Dublin:' + stamp(r.first, ev.start),
        ev.allDay ? 'DTEND;VALUE=DATE:' + ymd(new Date(r.first.getFullYear(), r.first.getMonth(), r.first.getDate() + 1)) : 'DTEND;TZID=Europe/Dublin:' + stamp(r.first, ev.end));
      if (iso(r.first) !== iso(r.last)) L.push('RRULE:FREQ=WEEKLY;UNTIL=' + ymd(r.last) + 'T235959Z');
      if (r.ex.length) L.push('EXDATE;TZID=Europe/Dublin:' + r.ex.map(function (d) { return stamp(d, ev.start); }).join(','));
      L.push(fold('SUMMARY:' + icsEscape(ev.title)), fold('DESCRIPTION:' + icsEscape(ev.details || '')), fold('LOCATION:' + icsEscape(ev.location || '')));
      if (ev.url) L.push(fold('URL:' + ev.url));
      L.push('END:VEVENT');
    });
    return L;
  }
  function ics(list) { // list of [ev, runs]
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sortd Ireland//Sortd calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Sortd',
      'BEGIN:VTIMEZONE', 'TZID:Europe/Dublin',
      'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'TZNAME:IST', 'DTSTART:19700329T010000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
      'BEGIN:STANDARD', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'TZNAME:GMT', 'DTSTART:19701025T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
      'END:VTIMEZONE'];
    list.forEach(function (x) { L = L.concat(icsEvents(x[0], x[1])); });
    L.push('END:VCALENDAR');
    return L.join('\r\n');
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  window.SortdSchoolYear = {
    TERMS: TERMS, BREAKS: BREAKS, HOLIDAYS: HOLIDAYS, BANK_HOLIDAYS: BANK_HOLIDAYS, DAY_NAMES: DAY_NAMES, MONTHS: MONTHS,
    pad: pad, iso: iso, parseISO: parseISO, addDays: addDays, nice: nice, today: today, fmtTime: fmtTime,
    dayIndex: dayIndex, parseRange: parseRange, parseTimetable: parseTimetable,
    termOf: termOf, inBreak: inBreak, isBankHoliday: isBankHoliday, whyOff: whyOff, firstOnOrAfter: firstOnOrAfter,
    lastTermDay: lastTermDay, currentTermEnd: currentTermEnd, runsOn: runsOn, runs: runs, count: count,
    googleLink: googleLink, ics: ics, download: download
  };
})();
