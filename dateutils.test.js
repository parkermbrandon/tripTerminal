// Regression guard for the itinerary date/time logic in dateutils.js.
// Plain Node, no dependencies. Run from anywhere:  node dateutils.test.js
// Exit code 0 = all passed, 1 = at least one failure.
//
// These cover the three bugs that motivated dateutils.js:
//   1. Wrong weekday   — "Nov 18" was parsed as year 2001 (a Sunday) instead of 2026.
//   2. Times unordered — the sort key grabbed the day-of-month, not the clock time.
//   3. Off-by-one      — evening times rolled to the next day via toISOString()/UTC.
// Assertions that check a weekday use a fixed-year structured date so they stay valid
// in any future year and any timezone; legacy-string date checks only assert the date
// part (year defaults to the current year), never a year-dependent weekday.

const T = require('./dateutils.js');

const YEAR = new Date().getFullYear();
let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = got === want;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + label.padEnd(54) +
    'got=' + JSON.stringify(got) + (ok ? '' : '  want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}

// --- Bug 1: weekday must be correct (real year, not 2001) ---
// Fixed-year structured dates: deterministic forever, in every timezone.
eq('structured 2026-11-18 -> dateKey', T.dateKey({ startDate: '2026-11-18' }), '2026-11-18');
eq('2026-11-18 -> heading is Wednesday', T.formatHeading('2026-11-18'), 'Wed, Nov 18');
eq('2026-11-29 -> heading is Sunday', T.formatHeading('2026-11-29'), 'Sun, Nov 29');
eq('legacy "Nov 18" uses current year (not 2001)', T.parseDateString('Nov 18'), YEAR + '-11-18');

// --- Bug 3: evening event must NOT roll to the next day ---
// Assert the date part only (year-independent); proves no UTC roll-forward.
eq('structured 11/29 7pm -> dateKey stays 29', T.dateKey({ startDate: '2026-11-29', startTime: '19:00' }), '2026-11-29');
eq('legacy "Nov 29 7:00 PM" -> stays 29', T.parseDateString('Nov 29 7:00 PM'), YEAR + '-11-29');
eq('legacy "Nov 29 11:30 PM" -> stays 29', T.parseDateString('Nov 29 11:30 PM'), YEAR + '-11-29');

// --- Bug 2: time sort key is the clock time, not the day-of-month ---
eq('timeKey "Nov 18 2:30 PM"', T.timeKey({ time: 'Nov 18 2:30 PM' }), '14:30');
eq('timeKey "Nov 18 9:00 AM"', T.timeKey({ time: 'Nov 18 9:00 AM' }), '09:00');
eq('timeKey "Nov 29 7:00 PM"', T.timeKey({ time: 'Nov 29 7:00 PM' }), '19:00');
eq('timeKey structured 07:00', T.timeKey({ startTime: '07:00' }), '07:00');
eq('timeKey "Nov 18" (no time) is empty', T.timeKey({ time: 'Nov 18' }), '');
const am = T.timeKey({ time: 'Nov 18 9:00 AM' }), pm = T.timeKey({ time: 'Nov 18 2:30 PM' });
eq('9:00 AM sorts before 2:30 PM', am.localeCompare(pm) < 0, true);

// --- Format coverage: ranges, terminal "7pm", ISO, explicit/comma years, edges ---
eq('range "Mar 14 - Mar 19" -> start date', T.parseDateString('Mar 14 - Mar 19'), YEAR + '-03-14');
eq('range time stripped (no bogus time)', T.timeKey({ time: 'Mar 14 - Mar 19' }), '');
eq('terminal "Mar 15 7pm" -> date', T.parseDateString('Mar 15 7pm'), YEAR + '-03-15');
eq('terminal "Mar 15 7pm" -> time', T.timeKey({ time: 'Mar 15 7pm' }), '19:00');
eq('ISO "2026-03-15 10:00 AM" -> date', T.parseDateString('2026-03-15 10:00 AM'), '2026-03-15');
eq('explicit year "Nov 29 2027"', T.parseDateString('Nov 29 2027'), '2027-11-29');
eq('"March 15, 2026" comma year', T.parseDateString('March 15, 2026'), '2026-03-15');
eq('structured startDate wins over string', T.dateKey({ startDate: '2026-12-05', time: 'Nov 29 7:00 PM' }), '2026-12-05');
eq('no date present -> null', T.dateKey({ time: '2:30 PM' }), null);
eq('empty item -> null / empty', T.dateKey({}), null);
eq('noon edge "12:00 PM"', T.parseTimeString('12:00 PM'), '12:00');
eq('midnight edge "12:00 AM"', T.parseTimeString('12:00 AM'), '00:00');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
