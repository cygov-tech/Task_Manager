const express = require("express");
const crypto = require("crypto");
const store = require("../store");
const activityLog = require("../lib/activityLog");
const requestContext = require("../lib/requestContext");
const { filterVisible } = require("../lib/visibility");
const {
  dayNameFor,
  isPastDateStr,
  startOfCurrentWeek,
  addWeeksToDateStr,
  addDays,
  parseDateOnly,
  formatDate,
  currentYearMonth,
  monthLabel,
  addMonthsToYearMonth,
  monthGridDates
} = require("../lib/dates");
const { occursOn } = require("../lib/recurrence");

const STORE_NAME = "dailyGoals";
const DEFAULT = { weekMeta: {}, days: {} };

const PRIORITY_OPTIONS = ["High", "Medium", "Low"];
const STATUS_OPTIONS = ["Didn't Start", "In Progress", "Done", "Blocked", "Moved"];

const router = express.Router();

function getDay(data, date) {
  if (!data.days[date]) {
    data.days[date] = { entries: [], checklist: [], recurringDone: [] };
  }
  if (!Array.isArray(data.days[date].recurringDone)) {
    data.days[date].recurringDone = [];
  }
  return data.days[date];
}

function dayView(data, date) {
  const day = data.days[date] || { entries: [], checklist: [] };
  return {
    date,
    dayName: dayNameFor(date),
    disabled: isPastDateStr(date),
    entries: day.entries,
    checklist: day.checklist
  };
}

/**
 * Reads the Tasks and Bugs stores and buckets items with a matching deadline
 * by date, so the Daily Goals views (day/week/month) can surface upcoming
 * deadlines set on the Prioritization tab (tasks) or Bug Tracking tab (bugs)
 * alongside daily entries.
 */
async function dueItemsByDate(dates) {
  const user = requestContext.currentUser();
  const [tasksData, bugsData] = await Promise.all([
    store.read("tasks", { items: [] }),
    store.read("bugs", { items: [] })
  ]);
  const map = {};
  dates.forEach((d) => {
    map[d] = [];
  });
  filterVisible(tasksData.items, user).forEach((task) => {
    if (task.deadline && Object.prototype.hasOwnProperty.call(map, task.deadline)) {
      map[task.deadline].push({
        id: task.id,
        name: task.name,
        priority: task.priority || "Medium",
        type: "Task",
        owner: task.owner || ""
      });
    }
  });
  filterVisible(bugsData.items, user).forEach((bug) => {
    if (bug.deadline && Object.prototype.hasOwnProperty.call(map, bug.deadline)) {
      map[bug.deadline].push({
        id: bug.id,
        name: bug.title,
        priority: bug.severity || "Medium",
        type: "Bug",
        owner: bug.owner || ""
      });
    }
  });
  return map;
}

/**
 * Reads the Recurring Tasks store and, for each requested date, returns the
 * active recurring tasks that occur on that date (per their frequency rule),
 * annotated with whether they've been checked off for that specific day.
 */
async function recurringTasksForDates(dates, dailyData) {
  const user = requestContext.currentUser();
  const recurringData = await store.read("recurringTasks", { items: [] });
  const map = {};
  dates.forEach((d) => {
    map[d] = [];
  });
  filterVisible(recurringData.items, user).forEach((task) => {
    if (!task.active) return;
    dates.forEach((date) => {
      if (!occursOn(task, date)) return;
      const dayRecord = dailyData.days[date];
      const done = !!(dayRecord && Array.isArray(dayRecord.recurringDone) && dayRecord.recurringDone.includes(task.id));
      map[date].push({
        id: task.id,
        name: task.name,
        frequency: task.frequency,
        time: task.time || "",
        comments: task.comments || "",
        owner: task.owner || "",
        done
      });
    });
  });
  Object.keys(map).forEach((date) => {
    map[date].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  });
  return map;
}

/**
 * Reads the Tasks and Bugs stores and buckets items across every date in
 * their [date, date+loe] range (start date through start date + LOE days),
 * so items with a multi-day estimate show up on every day they're expected
 * to be worked on, independent of their single-day Deadline marker.
 */
async function scheduledItemsByDate(dates) {
  const user = requestContext.currentUser();
  const [tasksData, bugsData] = await Promise.all([
    store.read("tasks", { items: [] }),
    store.read("bugs", { items: [] })
  ]);
  const map = {};
  dates.forEach((d) => {
    map[d] = [];
  });

  function addRange(item, name, type) {
    if (!item.date) return;
    const loeDays = Number(item.loe) || 0;
    const endStr = formatDate(addDays(parseDateOnly(item.date), loeDays));
    dates.forEach((d) => {
      if (d >= item.date && d <= endStr) {
        map[d].push({
          id: item.id,
          name,
          priority: item.priority || item.severity || "Medium",
          type,
          owner: item.owner || "",
          status: item.status || "Didn't Start",
          breakdown: item.breakdown || []
        });
      }
    });
  }

  filterVisible(tasksData.items, user).forEach((task) => addRange(task, task.name, "Task"));
  filterVisible(bugsData.items, user).forEach((bug) => addRange(bug, bug.title, "Bug"));

  return map;
}

// Work week is Sunday-Thursday; Friday and Saturday are never shown in the
// Daily Goals views.
const WORK_DAYS_PER_WEEK = 5;

function weekView(data, weekStart, dueMap, recurringMap, scheduledMap) {
  const meta = data.weekMeta[weekStart] || { mainGoal: "", weeklyFocus: "", weeklyNotes: "" };
  const days = [];
  for (let i = 0; i < WORK_DAYS_PER_WEEK; i++) {
    const date = formatDate(addDays(parseDateOnly(weekStart), i));
    const view = dayView(data, date);
    view.dueTasks = (dueMap && dueMap[date]) || [];
    view.recurringTasks = (recurringMap && recurringMap[date]) || [];
    view.scheduledTasks = (scheduledMap && scheduledMap[date]) || [];
    days.push(view);
  }
  return { weekStart, mainGoal: meta.mainGoal, weeklyFocus: meta.weeklyFocus, weeklyNotes: meta.weeklyNotes, days };
}

router.get("/meta", (req, res) => {
  res.json({ priorityOptions: PRIORITY_OPTIONS, statusOptions: STATUS_OPTIONS });
});

// --- Week view ---

router.get("/current-week", (req, res) => {
  res.json({ weekStart: formatDate(startOfCurrentWeek()) });
});

router.get("/week/:weekStart", async (req, res) => {
  const { weekStart } = req.params;
  const data = await store.read(STORE_NAME, DEFAULT);
  const dates = [];
  for (let i = 0; i < WORK_DAYS_PER_WEEK; i++) dates.push(formatDate(addDays(parseDateOnly(weekStart), i)));
  const [dueMap, recurringMap, scheduledMap] = await Promise.all([
    dueItemsByDate(dates),
    recurringTasksForDates(dates, data),
    scheduledItemsByDate(dates)
  ]);
  res.json(weekView(data, weekStart, dueMap, recurringMap, scheduledMap));
});

router.get("/week/:weekStart/adjacent/:direction", (req, res) => {
  const { weekStart, direction } = req.params;
  const delta = direction === "next" ? 1 : -1;
  res.json({ weekStart: addWeeksToDateStr(weekStart, delta) });
});

router.put("/week/:weekStart", async (req, res) => {
  const { weekStart } = req.params;
  const updates = req.body || {};
  const editableFields = ["mainGoal", "weeklyFocus", "weeklyNotes"];

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    if (!data.weekMeta[weekStart]) {
      data.weekMeta[weekStart] = { mainGoal: "", weeklyFocus: "", weeklyNotes: "" };
    }
    const meta = data.weekMeta[weekStart];
    const changes = [];
    editableFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(updates, field) && updates[field] !== meta[field]) {
        changes.push({ field, oldValue: meta[field], newValue: updates[field] });
        meta[field] = updates[field];
      }
    });
    return { view: weekView(data, weekStart), changes };
  });

  for (const change of result.changes) {
    await activityLog.log({
      action: "Updated",
      entity: "Daily Goals Week",
      entityId: weekStart,
      entityLabel: `Week of ${weekStart}`,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue
    });
  }

  res.json(result.view);
});

// --- Month view ---

router.get("/month/:yearMonth", async (req, res) => {
  const { yearMonth } = req.params;
  const data = await store.read(STORE_NAME, DEFAULT);
  const dates = monthGridDates(yearMonth);
  const [dueMap, recurringMap, scheduledMap] = await Promise.all([
    dueItemsByDate(dates),
    recurringTasksForDates(dates, data),
    scheduledItemsByDate(dates)
  ]);
  const [currentYear, currentMonthNum] = yearMonth.split("-").map(Number);

  const days = dates.map((date) => {
    const day = data.days[date] || { entries: [], checklist: [] };
    const [y, m] = date.split("-").map(Number);
    const dueTasks = dueMap[date] || [];
    const recurringTasks = recurringMap[date] || [];
    const scheduledTasks = scheduledMap[date] || [];
    return {
      date,
      dayName: dayNameFor(date),
      disabled: isPastDateStr(date),
      isCurrentMonth: y === currentYear && m === currentMonthNum,
      entryCount: day.entries.length,
      entryDoneCount: day.entries.filter((e) => e.done).length,
      checklistCount: day.checklist.length,
      checklistDoneCount: day.checklist.filter((c) => c.done).length,
      dueCount: dueTasks.length,
      dueTasks,
      recurringCount: recurringTasks.length,
      recurringDoneCount: recurringTasks.filter((t) => t.done).length,
      scheduledCount: scheduledTasks.length,
      scheduledDoneCount: scheduledTasks.filter((t) => t.status === "Done").length,
      scheduledTasks
    };
  });

  res.json({ yearMonth, label: monthLabel(yearMonth), days });
});

router.get("/month/:yearMonth/adjacent/:direction", (req, res) => {
  const { yearMonth, direction } = req.params;
  const delta = direction === "next" ? 1 : -1;
  res.json({ yearMonth: addMonthsToYearMonth(yearMonth, delta) });
});

router.get("/current-month", (req, res) => {
  res.json({ yearMonth: currentYearMonth() });
});

// --- Day detail ---

router.get("/day/:date", async (req, res) => {
  const { date } = req.params;
  const data = await store.read(STORE_NAME, DEFAULT);
  const [dueMap, recurringMap, scheduledMap] = await Promise.all([
    dueItemsByDate([date]),
    recurringTasksForDates([date], data),
    scheduledItemsByDate([date])
  ]);
  res.json({
    ...dayView(data, date),
    dueTasks: dueMap[date] || [],
    recurringTasks: recurringMap[date] || [],
    scheduledTasks: scheduledMap[date] || []
  });
});

router.put("/day/:date/recurring/:taskId", async (req, res) => {
  const { date, taskId } = req.params;
  const { done } = req.body || {};

  await store.update(STORE_NAME, DEFAULT, (data) => {
    const day = getDay(data, date);
    const isDone = !!done;
    const idx = day.recurringDone.indexOf(taskId);
    if (isDone && idx === -1) day.recurringDone.push(taskId);
    if (!isDone && idx !== -1) day.recurringDone.splice(idx, 1);
    return null;
  });

  const data = await store.read(STORE_NAME, DEFAULT);
  const recurringMap = await recurringTasksForDates([date], data);
  res.json({ ...dayView(data, date), recurringTasks: recurringMap[date] || [] });
});

router.post("/day/:date/entries", async (req, res) => {
  const { date } = req.params;
  const { time, goal, taskId, priority, status, notes } = req.body || {};

  if (isPastDateStr(date)) return res.status(400).json({ error: "Cannot add entries to a past day." });

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const day = getDay(data, date);
    const entry = {
      id: crypto.randomUUID(),
      time: time || "",
      goal: goal || "",
      taskId: taskId || "",
      priority: priority || "Medium",
      status: status || "Didn't Start",
      done: false,
      notes: notes || ""
    };
    day.entries.push(entry);
    return { view: dayView(data, date), entry };
  });

  await activityLog.log({
    action: "Created",
    entity: "Daily Goal Entry",
    entityId: result.entry.id,
    entityLabel: `${date} / ${result.entry.goal || result.entry.time || "entry"}`,
    details: "Added daily goal entry"
  });

  res.status(201).json(result.view);
});

router.put("/day/:date/entries/:entryId", async (req, res) => {
  const { date, entryId } = req.params;
  const updates = req.body || {};
  const editableFields = ["time", "goal", "taskId", "priority", "status", "done", "notes"];

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const day = getDay(data, date);
    const entry = day.entries.find((e) => e.id === entryId);
    if (!entry) return null;

    const changes = [];
    editableFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(updates, field) && updates[field] !== entry[field]) {
        changes.push({ field, oldValue: entry[field], newValue: updates[field] });
        entry[field] = updates[field];
      }
    });
    return { view: dayView(data, date), entry, changes };
  });

  if (!result) return res.status(404).json({ error: "Entry not found." });

  for (const change of result.changes) {
    await activityLog.log({
      action: "Updated",
      entity: "Daily Goal Entry",
      entityId: entryId,
      entityLabel: `${date} / ${result.entry.goal || result.entry.time || "entry"}`,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue
    });
  }

  res.json(result.view);
});

router.post("/day/:date/entries/:entryId/move", async (req, res) => {
  const { date, entryId } = req.params;
  const { targetDate } = req.body || {};

  if (!targetDate || typeof targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return res.status(400).json({ error: "A valid target date is required." });
  }
  if (targetDate === date) {
    return res.status(400).json({ error: "Target date must be different from the current date." });
  }
  if (isPastDateStr(targetDate)) {
    return res.status(400).json({ error: "Cannot move an entry to a past day." });
  }

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const sourceDay = getDay(data, date);
    const index = sourceDay.entries.findIndex((e) => e.id === entryId);
    if (index === -1) return null;
    const [entry] = sourceDay.entries.splice(index, 1);
    const targetDay = getDay(data, targetDate);
    targetDay.entries.push(entry);
    return { entry, sourceView: dayView(data, date), targetView: dayView(data, targetDate) };
  });

  if (!result) return res.status(404).json({ error: "Entry not found." });

  await activityLog.log({
    action: "Moved",
    entity: "Daily Goal Entry",
    entityId: entryId,
    entityLabel: `${result.entry.goal || result.entry.time || "entry"}`,
    details: `Moved from ${date} to ${targetDate}`
  });

  res.json({ sourceView: result.sourceView, targetView: result.targetView });
});

router.delete("/day/:date/entries/:entryId", async (req, res) => {
  const { date, entryId } = req.params;

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const day = getDay(data, date);
    const index = day.entries.findIndex((e) => e.id === entryId);
    if (index === -1) return null;
    const [removed] = day.entries.splice(index, 1);
    return { view: dayView(data, date), removed };
  });

  if (!result) return res.status(404).json({ error: "Entry not found." });

  await activityLog.log({
    action: "Deleted",
    entity: "Daily Goal Entry",
    entityId: entryId,
    entityLabel: `${date} / ${result.removed.goal || result.removed.time || "entry"}`
  });

  res.json(result.view);
});

// --- Day checklist ---

router.post("/day/:date/checklist", async (req, res) => {
  const { date } = req.params;
  const { text } = req.body || {};

  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "Checklist item text is required." });
  }

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const day = getDay(data, date);
    const item = { id: crypto.randomUUID(), text: String(text).trim(), done: false };
    day.checklist.push(item);
    return { view: dayView(data, date), item };
  });

  await activityLog.log({
    action: "Created",
    entity: "Daily Checklist Item",
    entityId: result.item.id,
    entityLabel: `${date} / ${result.item.text}`,
    details: "Added checklist item"
  });

  res.status(201).json(result.view);
});

router.put("/day/:date/checklist/reorder", async (req, res) => {
  const { date } = req.params;
  const { order } = req.body || {};

  if (!Array.isArray(order)) {
    return res.status(400).json({ error: "order must be an array of checklist item ids." });
  }

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const day = getDay(data, date);
    const byId = new Map(day.checklist.map((c) => [c.id, c]));
    const reordered = order.map((cid) => byId.get(cid)).filter(Boolean);
    day.checklist.forEach((c) => {
      if (!order.includes(c.id)) reordered.push(c);
    });
    day.checklist = reordered;
    return dayView(data, date);
  });

  res.json(result);
});

router.put("/day/:date/checklist/:itemId", async (req, res) => {
  const { date, itemId } = req.params;
  const updates = req.body || {};
  const editableFields = ["text", "done"];

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const day = getDay(data, date);
    const item = day.checklist.find((c) => c.id === itemId);
    if (!item) return null;

    const changes = [];
    editableFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(updates, field) && updates[field] !== item[field]) {
        changes.push({ field, oldValue: item[field], newValue: updates[field] });
        item[field] = updates[field];
      }
    });
    return { view: dayView(data, date), item, changes };
  });

  if (!result) return res.status(404).json({ error: "Checklist item not found." });

  for (const change of result.changes) {
    await activityLog.log({
      action: "Updated",
      entity: "Daily Checklist Item",
      entityId: itemId,
      entityLabel: `${date} / ${result.item.text}`,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue
    });
  }

  res.json(result.view);
});

router.delete("/day/:date/checklist/:itemId", async (req, res) => {
  const { date, itemId } = req.params;

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const day = getDay(data, date);
    const index = day.checklist.findIndex((c) => c.id === itemId);
    if (index === -1) return null;
    const [removed] = day.checklist.splice(index, 1);
    return { view: dayView(data, date), removed };
  });

  if (!result) return res.status(404).json({ error: "Checklist item not found." });

  await activityLog.log({
    action: "Deleted",
    entity: "Daily Checklist Item",
    entityId: itemId,
    entityLabel: `${date} / ${result.removed.text}`
  });

  res.json(result.view);
});

module.exports = router;
