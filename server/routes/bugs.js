const express = require("express");
const crypto = require("crypto");
const store = require("../store");
const activityLog = require("../lib/activityLog");
const requestContext = require("../lib/requestContext");
const { formatDateTime } = require("../lib/dates");
const { VISIBILITY_OPTIONS, isVisible, filterVisible, sanitizeVisibility } = require("../lib/visibility");
const optionLists = require("../lib/optionLists");

const STORE_NAME = "bugs";
const DEFAULT = { items: [] };

const router = express.Router();

function sanitizeLoe(loe) {
  const n = Number(loe);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

router.get("/meta", async (req, res) => {
  res.json({
    statusOptions: await optionLists.getList("bugs", "status"),
    typeOptions: await optionLists.getList("bugs", "type"),
    severityOptions: await optionLists.getList("bugs", "severity"),
    visibilityOptions: VISIBILITY_OPTIONS
  });
});

router.get("/", async (req, res) => {
  const data = await store.read(STORE_NAME, DEFAULT);
  res.json(filterVisible(data.items, requestContext.currentUser()));
});

router.post("/", async (req, res) => {
  const { title, trelloCard, type, severity, status, date, loe, deadline, comments, visibility } = req.body || {};

  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "Bug title is required." });
  }

  const bug = await store.update(STORE_NAME, DEFAULT, (data) => {
    const newBug = {
      id: crypto.randomUUID(),
      title: String(title).trim(),
      trelloCard: trelloCard || "",
      type: type || "Regular",
      severity: severity || "Medium",
      status: status || "Didn't Start",
      date: date || "",
      loe: sanitizeLoe(loe),
      deadline: deadline || "",
      comments: comments || "",
      owner: requestContext.currentUser(),
      visibility: sanitizeVisibility(visibility),
      createdAt: formatDateTime(new Date()),
      updatedAt: formatDateTime(new Date())
    };
    data.items.push(newBug);
    return newBug;
  });

  await activityLog.log({
    action: "Created",
    entity: "Bug",
    entityId: bug.id,
    entityLabel: bug.title,
    details: "Created bug"
  });

  res.status(201).json(bug);
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};
  const user = requestContext.currentUser();
  const editableFields = ["title", "trelloCard", "type", "severity", "status", "date", "loe", "deadline", "comments", "visibility", "owner"];

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const bug = data.items.find((b) => b.id === id);
    if (!bug || !isVisible(bug, user)) return null;

    const changes = [];
    editableFields.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(updates, field)) return;
      if (field === "visibility" && bug.owner && bug.owner !== user) return;
      let newValue = updates[field];
      if (field === "visibility") newValue = sanitizeVisibility(newValue);
      if (field === "loe") newValue = sanitizeLoe(newValue);
      if (newValue !== bug[field]) {
        changes.push({ field, oldValue: bug[field], newValue });
        bug[field] = newValue;
      }
    });
    bug.updatedAt = formatDateTime(new Date());
    return { bug, changes };
  });

  if (!result) return res.status(404).json({ error: "Bug not found." });

  for (const change of result.changes) {
    await activityLog.log({
      action: "Updated",
      entity: "Bug",
      entityId: id,
      entityLabel: result.bug.title,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue
    });
  }

  res.json(result.bug);
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const user = requestContext.currentUser();

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const index = data.items.findIndex((b) => b.id === id);
    if (index === -1 || !isVisible(data.items[index], user)) return null;
    const [removed] = data.items.splice(index, 1);
    return removed;
  });

  if (!result) return res.status(404).json({ error: "Bug not found." });

  await activityLog.log({
    action: "Deleted",
    entity: "Bug",
    entityId: id,
    entityLabel: result.title
  });

  res.json({ success: true });
});

module.exports = router;
