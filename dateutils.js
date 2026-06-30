// dateutils.js - shared date/time parsing & formatting for the itinerary views.
//
// Items store dates structurally (startDate "YYYY-MM-DD", endDate, startTime "HH:MM")
// when added/edited through the pickers. Older items, terminal `add`, and AI-added items
// only have a free-text `time` string (e.g. "Nov 29 7:00 PM"), so we keep a robust string
// parser as a fallback. All parsing uses LOCAL calendar components — never new Date(str) +
// toISOString(), which (a) defaults a missing year to 2001 and (b) shifts evening times
// across the date boundary when converting to UTC.
const TripDates = (() => {
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTH_ALT = MONTH_NAMES.join('|');
  const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

  const pad = n => String(n).padStart(2, '0');

  // "Mon DD" optionally followed by a 4-digit year (comma or space separated).
  const DATE_TOKEN = `(${MONTH_ALT})[a-z]*\\s+(\\d{1,2})(?:[,\\s]+(\\d{4}))?`;

  // Group key (YYYY-MM-DD) for an item: prefer structured startDate, else parse the string.
  function dateKey(item) {
    const sd = item && item.startDate;
    if (sd && /^\d{4}-\d{2}-\d{2}$/.test(sd)) return sd;
    return parseDateString(item ? item.time : null);
  }

  // Parse a free-text date ("Nov 29", "Mar 15 7pm", "Nov 29 2026", "2026-11-29 ...",
  // "March 15, 2026") into YYYY-MM-DD using local components. Year defaults to the current
  // year when absent. Returns null when no date is present.
  function parseDateString(str) {
    if (!str) return null;
    const s = String(str).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const m = s.match(new RegExp('^' + DATE_TOKEN, 'i'));
    if (m) {
      const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
      const day = parseInt(m[2], 10);
      if (mon !== undefined && day >= 1 && day <= 31) {
        const year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
        return `${year}-${pad(mon + 1)}-${pad(day)}`;
      }
    }
    return null;
  }

  // Sort key ("HH:MM" 24h, or '' for no time) for an item: prefer structured startTime,
  // else extract a clock time from the string AFTER stripping any leading date so the
  // day-of-month isn't mistaken for an hour.
  function timeKey(item) {
    const st = item && item.startTime;
    if (st && /^\d{1,2}:\d{2}$/.test(st)) return normalizeClock(st);
    return parseTimeString(item ? item.time : null);
  }

  function parseTimeString(str) {
    if (!str) return '';
    let s = String(str).trim();
    // Strip a leading "Mon DD [YYYY]" plus an optional "- Mon DD [YYYY]" range, or an ISO date.
    const datePrefix = new RegExp('^' + DATE_TOKEN + `(?:\\s*[-\\u2013]\\s*${DATE_TOKEN})?`, 'i');
    s = s.replace(datePrefix, '').replace(/^\d{4}-\d{2}-\d{2}/, '').trim();
    const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?/i);
    if (!m) return '';
    // Require minutes (with colon) or an am/pm marker to count as a real clock time —
    // a bare leftover number is not a time.
    if (m[2] === undefined && !m[3]) return '';
    let h = parseInt(m[1], 10);
    const min = m[2] !== undefined ? m[2] : '00';
    const ampm = (m[3] || '').toLowerCase();
    if (ampm.startsWith('p') && h < 12) h += 12;
    if (ampm.startsWith('a') && h === 12) h = 0;
    if (h > 23 || parseInt(min, 10) > 59) return '';
    return pad(h) + ':' + min;
  }

  function normalizeClock(t) {
    const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return '';
    return pad(parseInt(m[1], 10)) + ':' + m[2];
  }

  // Format a YYYY-MM-DD key as "Wed, Nov 18". Parsed at local noon so the weekday is correct
  // and never drifts across the UTC boundary.
  function formatHeading(key) {
    if (!key) return 'No Date';
    const d = new Date(key + 'T12:00:00');
    if (isNaN(d)) return key;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  return { dateKey, parseDateString, timeKey, parseTimeString, formatHeading, MONTH_NAMES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TripDates;
