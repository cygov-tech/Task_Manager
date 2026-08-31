const express = require("express");
const crypto = require("crypto");
const store = require("../store");
const activityLog = require("../lib/activityLog");
const requestContext = require("../lib/requestContext");
const { formatDateTime } = require("../lib/dates");
const { VISIBILITY_OPTIONS, isVisible, filterVisible, sanitizeVisibility } = require("../lib/visibility");
const optionLists = require("../lib/optionLists");

const STORE_NAME = "tasks";
const DEFAULT = { items: [] };

const router = express.Router();

function sanitizeLoe(loe) {
  const n = Number(loe);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

router.get("/meta", async (req, res) => {
  res.json({
    statusOptions: await optionLists.getList("tasks", "status"),
    typeOptions: await optionLists.getList("tasks", "type"),
    priorityOptions: await optionLists.getList("tasks", "priority"),
    visibilityOptions: VISIBILITY_OPTIONS
  });
});

router.get("/", async (req, res) => {
  const data = await store.read(STORE_NAME, DEFAULT);
  res.json(filterVisible(data.items, requestContext.currentUser()));
});

router.post("/", async (req, res) => {
  const { name, status, type, date, trelloCard, priority, loe, deadline, comments, visibility } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Task name is required." });
  }

  const task = await store.update(STORE_NAME, DEFAULT, (data) => {
    const newTask = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      status: status || "Didn't Start",
      type: type || "Task",
      date: date || "",
      structuredComment: "",
      trelloCard: trelloCard || "",
      priority: priority || "Medium",
      loe: sanitizeLoe(loe),
      deadline: deadline || "",
      comments: comments || "",
      breakdown: [],
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
    entity: "Task",
    entityId: task.id,
    entityLabel: task.name,
    details: "Created task"
  });

  res.status(201).json(task);
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};
  const user = requestContext.currentUser();
  const editableFields = [
    "name",
    "status",
    "type",
    "date",
    "structuredComment",
    "trelloCard",
    "priority",
    "loe",
    "deadline",
    "comments",
    "visibility",
    "owner"
  ];

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;

    const changes = [];
    editableFields.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(updates, field)) return;
      // Only the creator can change who an item is shared with.
      if (field === "visibility" && task.owner && task.owner !== user) return;
      let newValue = updates[field];
      if (field === "visibility") newValue = sanitizeVisibility(newValue);
      if (field === "loe") newValue = sanitizeLoe(newValue);
      if (newValue !== task[field]) {
        changes.push({ field, oldValue: task[field], newValue });
        task[field] = newValue;
      }
    });
    task.updatedAt = formatDateTime(new Date());
    return { task, changes };
  });

  if (!result) return res.status(404).json({ error: "Task not found." });

  for (const change of result.changes) {
    await activityLog.log({
      action: "Updated",
      entity: "Task",
      entityId: id,
      entityLabel: result.task.name,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue
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

  if (!result) return res.status(404).json({ error: "Task not found." });

  await activityLog.log({
    action: "Deleted",
    entity: "Task",
    entityId: id,
    entityLabel: result.name,
    details: "Deleted task and its breakdown"
  });

  res.json({ success: true });
});

/**
 * Generates a structured comment for a task, mirroring the Apps Script
 * "Create structured comment" menu action.
 */
router.post("/:id/comment", async (req, res) => {
  const { id } = req.params;
  const user = requestContext.currentUser();

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;

    const now = formatDateTime(new Date());
    const comment =
      "Structured Comment\n" +
      `Created: ${now}\n` +
      `Task: ${task.name}\n` +
      `Status: ${task.status}\n` +
      `Type: ${task.type}\n` +
      `Date: ${task.date || "Not set"}\n` +
      `Trello Card: ${task.trelloCard || "Not linked"}\n\n` +
      "Context:\n- \n\n" +
      "Checklist:\n\u2610 Item 1\n\u2610 Item 2\n\u2610 Item 3\n\n" +
      "Next Action:\n- \n\n" +
      "Blockers / Risks:\n- \n\n" +
      "Decision Needed:\n- ";

    task.structuredComment = comment;
    task.updatedAt = now;
    return task;
  });

  if (!result) return res.status(404).json({ error: "Task not found." });

  await activityLog.log({
    action: "Generated",
    entity: "Task",
    entityId: id,
    entityLabel: result.name,
    details: "Generated structured comment"
  });

  res.json(result);
});

// --- Task breakdown (elaboration checklist) ---

router.post("/:id/breakdown", async (req, res) => {
  const { id } = req.params;
  const { name, status, notes } = req.body || {};
  const user = requestContext.currentUser();

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Breakdown item name is required." });
  }

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;

    const item = {
      id: crypto.randomUUID(),
      checklist: false,
      name: String(name).trim(),
      status: status || "Didn't Start",
      notes: notes || "",
      checklistItems: []
    };
    task.breakdown.push(item);
    task.updatedAt = formatDateTime(new Date());
    return { task, item };
  });

  if (!result) return res.status(404).json({ error: "Task not found." });

  await activityLog.log({
    action: "Created",
    entity: "Task Breakdown Item",
    entityId: result.item.id,
    entityLabel: `${result.task.name} / ${result.item.name}`,
    details: "Added breakdown item"
  });

  res.status(201).json(result.task);
});

router.put("/:id/breakdown/reorder", async (req, res) => {
  const { id } = req.params;
  const { order } = req.body || {};
  const user = requestContext.currentUser();

  if (!Array.isArray(order)) {
    return res.status(400).json({ error: "order must be an array of breakdown item ids." });
  }

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;

    const byId = new Map(task.breakdown.map((b) => [b.id, b]));
    const reordered = order.map((bid) => byId.get(bid)).filter(Boolean);
    task.breakdown.forEach((b) => {
      if (!order.includes(b.id)) reordered.push(b);
    });
    task.breakdown = reordered;
    task.updatedAt = formatDateTime(new Date());
    return task;
  });

  if (!result) return res.status(404).json({ error: "Task not found." });

  res.json(result);
});

router.put("/:id/breakdown/:itemId", async (req, res) => {
  const { id, itemId } = req.params;
  const updates = req.body || {};
  const user = requestContext.currentUser();
  const editableFields = ["checklist", "name", "status", "notes"];

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;
    const item = task.breakdown.find((b) => b.id === itemId);
    if (!item) return null;

    const changes = [];
    editableFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(updates, field) && updates[field] !== item[field]) {
        changes.push({ field, oldValue: item[field], newValue: updates[field] });
        item[field] = updates[field];
      }
    });
    task.updatedAt = formatDateTime(new Date());
    return { task, item, changes };
  });

  if (!result) return res.status(404).json({ error: "Task or breakdown item not found." });

  for (const change of result.changes) {
    await activityLog.log({
      action: "Updated",
      entity: "Task Breakdown Item",
      entityId: itemId,
      entityLabel: `${result.task.name} / ${result.item.name}`,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue
    });
  }

  res.json(result.task);
});

router.delete("/:id/breakdown/:itemId", async (req, res) => {
  const { id, itemId } = req.params;
  const user = requestContext.currentUser();

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;
    const index = task.breakdown.findIndex((b) => b.id === itemId);
    if (index === -1) return null;
    const [removed] = task.breakdown.splice(index, 1);
    task.updatedAt = formatDateTime(new Date());
    return { task, removed };
  });

  if (!result) return res.status(404).json({ error: "Task or breakdown item not found." });

  await activityLog.log({
    action: "Deleted",
    entity: "Task Breakdown Item",
    entityId: itemId,
    entityLabel: `${result.task.name} / ${result.removed.name}`
  });

  res.json(result.task);
});

// --- Checklist items nested inside a breakdown item (sub-task) ---

router.post("/:id/breakdown/:itemId/checklist", async (req, res) => {
  const { id, itemId } = req.params;
  const { text } = req.body || {};
  const user = requestContext.currentUser();

  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "Checklist item text is required." });
  }

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;
    const item = task.breakdown.find((b) => b.id === itemId);
    if (!item) return null;
    if (!Array.isArray(item.checklistItems)) item.checklistItems = [];

    const checklistItem = { id: crypto.randomUUID(), text: String(text).trim(), done: false };
    item.checklistItems.push(checklistItem);
    task.updatedAt = formatDateTime(new Date());
    return { task, item, checklistItem };
  });

  if (!result) return res.status(404).json({ error: "Task or breakdown item not found." });

  await activityLog.log({
    action: "Created",
    entity: "Checklist Item",
    entityId: result.checklistItem.id,
    entityLabel: `${result.task.name} / ${result.item.name} / ${result.checklistItem.text}`,
    details: "Added checklist item"
  });

  res.status(201).json(result.task);
});

router.put("/:id/breakdown/:itemId/checklist/reorder", async (req, res) => {
  const { id, itemId } = req.params;
  const { order } = req.body || {};
  const user = requestContext.currentUser();

  if (!Array.isArray(order)) {
    return res.status(400).json({ error: "order must be an array of checklist item ids." });
  }

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;
    const item = task.breakdown.find((b) => b.id === itemId);
    if (!item || !Array.isArray(item.checklistItems)) return null;

    const byId = new Map(item.checklistItems.map((ci) => [ci.id, ci]));
    const reordered = order.map((cid) => byId.get(cid)).filter(Boolean);
    item.checklistItems.forEach((ci) => {
      if (!order.includes(ci.id)) reordered.push(ci);
    });
    item.checklistItems = reordered;
    task.updatedAt = formatDateTime(new Date());
    return task;
  });

  if (!result) return res.status(404).json({ error: "Task or breakdown item not found." });

  res.json(result);
});

router.put("/:id/breakdown/:itemId/checklist/:checklistItemId", async (req, res) => {
  const { id, itemId, checklistItemId } = req.params;
  const updates = req.body || {};
  const user = requestContext.currentUser();
  const editableFields = ["text", "done"];

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;
    const item = task.breakdown.find((b) => b.id === itemId);
    if (!item || !Array.isArray(item.checklistItems)) return null;
    const checklistItem = item.checklistItems.find((c) => c.id === checklistItemId);
    if (!checklistItem) return null;

    const changes = [];
    editableFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(updates, field) && updates[field] !== checklistItem[field]) {
        changes.push({ field, oldValue: checklistItem[field], newValue: updates[field] });
        checklistItem[field] = updates[field];
      }
    });
    task.updatedAt = formatDateTime(new Date());
    return { task, item, checklistItem, changes };
  });

  if (!result) return res.status(404).json({ error: "Checklist item not found." });

  for (const change of result.changes) {
    await activityLog.log({
      action: "Updated",
      entity: "Checklist Item",
      entityId: checklistItemId,
      entityLabel: `${result.task.name} / ${result.item.name} / ${result.checklistItem.text}`,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue
    });
  }

  res.json(result.task);
});

router.delete("/:id/breakdown/:itemId/checklist/:checklistItemId", async (req, res) => {
  const { id, itemId, checklistItemId } = req.params;
  const user = requestContext.currentUser();

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const task = data.items.find((t) => t.id === id);
    if (!task || !isVisible(task, user)) return null;
    const item = task.breakdown.find((b) => b.id === itemId);
    if (!item || !Array.isArray(item.checklistItems)) return null;
    const index = item.checklistItems.findIndex((c) => c.id === checklistItemId);
    if (index === -1) return null;
    const [removed] = item.checklistItems.splice(index, 1);
    task.updatedAt = formatDateTime(new Date());
    return { task, item, removed };
  });

  if (!result) return res.status(404).json({ error: "Checklist item not found." });

  await activityLog.log({
    action: "Deleted",
    entity: "Checklist Item",
    entityId: checklistItemId,
    entityLabel: `${result.task.name} / ${result.item.name} / ${result.removed.text}`
  });

  res.json(result.task);
});

module.exports = router;
