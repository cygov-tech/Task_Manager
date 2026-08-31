const express = require("express");
const crypto = require("crypto");
const store = require("../store");
const activityLog = require("../lib/activityLog");
const requestContext = require("../lib/requestContext");
const { formatDateTime } = require("../lib/dates");
const { VISIBILITY_OPTIONS, isVisible, filterVisible, sanitizeVisibility } = require("../lib/visibility");

const STORE_NAME = "recurringTasks";
const DEFAULT = { items: [] };

const FREQUENCY_OPTIONS = ["Daily", "Weekly", "Monthly", "End of Month"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const router = express.Router();

function sanitizeWeekdays(weekdays) {
  if (!Array.isArray(weekdays)) return [];
  return weekdays
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

function sanitizeMonthDays(monthDays) {
  if (!Array.isArray(monthDays)) return [];
  const cleaned = monthDays
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31);
  return [...new Set(cleaned)].sort((a, b) => a - b);
}

function sanitizeTime(time) {
  if (!time || typeof time !== "string" || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) return "";
  return time;
}

router.get("/meta", (req, res) => {
  res.json({ frequencyOptions: FREQUENCY_OPTIONS, weekdayNames: WEEKDAY_NAMES, visibilityOptions: VISIBILITY_OPTIONS });
});

router.get("/", async (req, res) => {
  const data = await store.read(STORE_NAME, DEFAULT);
  res.json(filterVisible(data.items, requestContext.currentUser()));
});

router.post("/", async (req, res) => {
  const { name, frequency, weekdays, monthDays, time, comments, visibility } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Recurring task name is required." });
  }
  if (!FREQUENCY_OPTIONS.includes(frequency)) {
    return res.status(400).json({ error: "Invalid frequency." });
  }

  const task = await store.update(STORE_NAME, DEFAULT, (data) => {
    const newTask = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      frequency,
      weekdays: frequency === "Weekly" ? sanitizeWeekdays(weekdays) : [],
      monthDays: frequency === "Monthly" ? sanitizeMonthDays(monthDays) : [],
      time: sanitizeTime(time),
      comments: comments || "",
      active: true,
      checklistItems: [],
      owner: requestContext.currentUser(),
      visibility: sanitizeVisibility(visibility),
      createdAt: formatDateTime(new Date()),
      updatedAt: formatDateTime(new Date())
    };
    data.items.push(newTask);
    return newTask;
  });

  await activityLog.log({
    action: "Created",
    entity: "Recurring Task",
    entityId: task.id,
    entityLabel: task.name,
    details: `Frequency: ${task.frequency}`
  });

  res.status(201).json(task);
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};
  const user = requestContext.currentUser();
  const editableFields = ["name", "frequency", "weekdays", "monthDays", "time", "comments", "active", "visibility", "owner"];

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;

    const changes = [];
    editableFields.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(updates, field)) return;
      if (field === "visibility" && task.owner && task.owner !== user) return;
      let newValue = updates[field];
      if (field === "weekdays") newValue = sanitizeWeekdays(newValue);
      if (field === "monthDays") newValue = sanitizeMonthDays(newValue);
      if (field === "time") newValue = sanitizeTime(newValue);
      if (field === "visibility") newValue = sanitizeVisibility(newValue);

      const oldValue = task[field];
      if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
        changes.push({ field, oldValue, newValue });
        task[field] = newValue;
      }
    });
    task.updatedAt = formatDateTime(new Date());
    return { task, changes };
  });

  if (!result) return res.status(404).json({ error: "Recurring task not found." });

  for (const change of result.changes) {
    await activityLog.log({
      action: "Updated",
      entity: "Recurring Task",
      entityId: id,
      entityLabel: result.task.name,
      field: change.field,
      oldValue: JSON.stringify(change.oldValue),
      newValue: JSON.stringify(change.newValue)
    });
  }

  res.json(result.task);
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const user = requestContext.currentUser();

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const index = data.items.findIndex((t) => t.id === id);
    if (index === -1 || !isVisible(data.items[index], user)) return null;
    const [removed] = data.items.splice(index, 1);
    return removed;
  });

  if (!result) return res.status(404).json({ error: "Recurring task not found." });

  await activityLog.log({
    action: "Deleted",
    entity: "Recurring Task",
    entityId: id,
    entityLabel: result.name
  });

  res.json({ success: true });
});

// --- Checklist items ---

router.post("/:id/checklist", async (req, res) => {
  const { id } = req.params;
  const { text } = req.body || {};
  const user = requestContext.currentUser();

  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "Checklist item text is required." });
  }

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;
    if (!Array.isArray(task.checklistItems)) task.checklistItems = [];

    const checklistItem = { id: crypto.randomUUID(), text: String(text).trim(), done: false };
    task.checklistItems.push(checklistItem);
    task.updatedAt = formatDateTime(new Date());
    return { task, checklistItem };
  });

  if (!result) return res.status(404).json({ error: "Recurring task not found." });

  await activityLog.log({
    action: "Created",
    entity: "Checklist Item",
    entityId: result.checklistItem.id,
    entityLabel: `${result.task.name} / ${result.checklistItem.text}`,
    details: "Added checklist item"
  });

  res.status(201).json(result.task);
});

router.put("/:id/checklist/:checklistItemId", async (req, res) => {
  const { id, checklistItemId } = req.params;
  const updates = req.body || {};
  const user = requestContext.currentUser();
  const editableFields = ["text", "done"];

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;
    if (!Array.isArray(task.checklistItems)) return null;
    const checklistItem = task.checklistItems.find((c) => c.id === checklistItemId);
    if (!checklistItem) return null;

    const changes = [];
    editableFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(updates, field) && updates[field] !== checklistItem[field]) {
        changes.push({ field, oldValue: checklistItem[field], newValue: updates[field] });
        checklistItem[field] = updates[field];
      }
    });
    task.updatedAt = formatDateTime(new Date());
    return { task, checklistItem, changes };
  });

  if (!result) return res.status(404).json({ error: "Checklist item not found." });

  for (const change of result.changes) {
    await activityLog.log({
      action: "Updated",
      entity: "Checklist Item",
      entityId: checklistItemId,
      entityLabel: `${result.task.name} / ${result.checklistItem.text}`,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue
    });
  }

  res.json(result.task);
});

router.delete("/:id/checklist/:checklistItemId", async (req, res) => {
  const { id, checklistItemId } = req.params;
  const user = requestContext.currentUser();

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;
    if (!Array.isArray(task.checklistItems)) return null;
    const index = task.checklistItems.findIndex((c) => c.id === checklistItemId);
    if (index === -1) return null;
    const [removed] = task.checklistItems.splice(index, 1);
    task.updatedAt = formatDateTime(new Date());
    return { task, removed };
  });

  if (!result) return res.status(404).json({ error: "Checklist item not found." });

  await activityLog.log({
    action: "Deleted",
    entity: "Checklist Item",
    entityId: checklistItemId,
    entityLabel: `${result.task.name} / ${result.removed.text}`
  });

  res.json(result.task);
});

module.exports = router;
