/**
 * Determines whether a recurring task occurs on a given YYYY-MM-DD date.
 * Supported frequencies:
 *  - "Daily": every day
 *  - "Weekly": on specific days of the week (task.weekdays, 0=Sunday..6=Saturday)
 *  - "Monthly": on one or more specific days-of-month (task.monthDays), each
 *    clamped to the last day of shorter months (e.g. day 31 falls on Feb 28/29)
 *  - "End of Month": the last calendar day of every month
 */
function occursOn(task, dateStr) {
  if (!task.active) return false;

  const [y, m, d] = dateStr.split("-").map(Number);
  const lastDayOfMonth = new Date(y, m, 0).getDate();

  switch (task.frequency) {
    case "Daily":
      return true;
    case "Weekly":
      return Array.isArray(task.weekdays) && task.weekdays.includes(new Date(y, m - 1, d).getDay());
    case "Monthly": {
      const days = Array.isArray(task.monthDays) && task.monthDays.length ? task.monthDays : [1];
      const targets = new Set(days.map((n) => Math.min(n, lastDayOfMonth)));
      return targets.has(d);
    }
    case "End of Month":
      return d === lastDayOfMonth;
    default:
      return false;
  }
}

module.exports = { occursOn };
