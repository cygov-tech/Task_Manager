function todayDateOnly() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date, days) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

function startOfCurrentWeek() {
  const today = todayDateOnly();
  const day = today.getDay(); // Sunday = 0
  return addDays(today, -day);
}

function lastMondayStart() {
  const today = todayDateOnly();
  const day = today.getDay(); // Sunday = 0, Monday = 1
  const daysSinceMonday = (day + 6) % 7;
  return addDays(today, -daysSinceMonday);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateTime(date) {
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${formatDate(date)} ${h}:${min}:${s}`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function parseDateOnly(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayNameFor(dateStr) {
  return DAY_NAMES[parseDateOnly(dateStr).getDay()];
}

function isPastDateStr(dateStr) {
  return parseDateOnly(dateStr).getTime() < todayDateOnly().getTime();
}

function startOfWeekForDate(dateStr) {
  const date = parseDateOnly(dateStr);
  const day = date.getDay();
  return formatDate(addDays(date, -day));
}

function addWeeksToDateStr(dateStr, weeks) {
  return formatDate(addDays(parseDateOnly(dateStr), weeks * 7));
}

function formatYearMonth(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function currentYearMonth() {
  return formatYearMonth(todayDateOnly());
}

function monthLabel(yearMonthStr) {
  const [y, m] = yearMonthStr.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function addMonthsToYearMonth(yearMonthStr, delta) {
  const [y, m] = yearMonthStr.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return formatYearMonth(date);
}

/**
 * Returns the flat list of date strings (Sun-Thu rows) needed to render a
 * full calendar grid for the given "YYYY-MM" month, including leading/
 * trailing days from the adjacent months so every week row is complete.
 * Friday and Saturday are excluded since they're not work days.
 */
function monthGridDates(yearMonthStr) {
  const [y, m] = yearMonthStr.split("-").map(Number);
  const firstOfMonth = new Date(y, m - 1, 1);
  const lastOfMonth = new Date(y, m, 0);
  const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay());
  const daysAfterLast = 6 - lastOfMonth.getDay();
  const gridEnd = addDays(lastOfMonth, daysAfterLast);

  const dates = [];
  let cursor = gridStart;
  while (cursor.getTime() <= gridEnd.getTime()) {
    const dayOfWeek = cursor.getDay();
    if (dayOfWeek !== 5 && dayOfWeek !== 6) dates.push(formatDate(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

module.exports = {
  todayDateOnly,
  addDays,
  startOfCurrentWeek,
  lastMondayStart,
  formatDate,
  formatDateTime,
  DAY_NAMES,
  parseDateOnly,
  dayNameFor,
  isPastDateStr,
  startOfWeekForDate,
  addWeeksToDateStr,
  formatYearMonth,
  currentYearMonth,
  monthLabel,
  addMonthsToYearMonth,
  monthGridDates
};
