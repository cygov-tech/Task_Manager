const express = require("express");
const crypto = require("crypto");
const store = require("../store");
const activityLog = require("../lib/activityLog");
const requestContext = require("../lib/requestContext");
const { formatDateTime } = require("../lib/dates");
const { VISIBILITY_OPTIONS, isVisible, filterVisible, sanitizeVisibility } = require("../lib/visibility");

const STORE_NAME = "notes";
const DEFAULT = { items: [] };

const router = express.Router();

router.get("/meta", (req, res) => {
  res.json({ visibilityOptions: VISIBILITY_OPTIONS });
});

router.get("/", async (req, res) => {
  const data = await store.read(STORE_NAME, DEFAULT);
  res.json(filterVisible(data.items, requestContext.currentUser()));
});

router.post("/", async (req, res) => {
  const { title, body, visibility } = req.body || {};

  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "Note title is required." });
  }

  const note = await store.update(STORE_NAME, DEFAULT, (data) => {
    const newNote = {
      id: crypto.randomUUID(),
      title: String(title).trim(),
      body: body || "",
      owner: requestContext.currentUser(),
      visibility: sanitizeVisibility(visibility || "Private"),
      createdAt: formatDateTime(new Date()),
      updatedAt: formatDateTime(new Date())
    };
    data.items.push(newNote);
    return newNote;
  });

  await activityLog.log({
    action: "Created",
    entity: "Note",
    entityId: note.id,
    entityLabel: note.title,
    details: "Created note"
  });

  res.status(201).json(note);
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};
  const user = requestContext.currentUser();

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const note = data.items.find((n) => n.id === id);
    if (!note || !isVisible(note, user)) return null;

    const changes = [];

    if (Object.prototype.hasOwnProperty.call(updates, "title")) {
      const newValue = String(updates.title || "").trim();
      if (newValue && newValue !== note.title) {
        changes.push({ field: "title", oldValue: note.title, newValue });
        note.title = newValue;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "body")) {
      const newValue = updates.body || "";
      if (newValue !== note.body) {
        changes.push({ field: "body", oldValue: note.body, newValue });
        note.body = newValue;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(updates, "visibility") &&
      (!note.owner || note.owner === user)
    ) {
      const newValue = sanitizeVisibility(updates.visibility);
      if (newValue !== note.visibility) {
        changes.push({ field: "visibility", oldValue: note.visibility, newValue });
        note.visibility = newValue;
      }
    }

    note.updatedAt = formatDateTime(new Date());
    return { note, changes };
  });

  if (!result) return res.status(404).json({ error: "Note not found." });

  for (const change of result.changes) {
    await activityLog.log({
      action: "Updated",
      entity: "Note",
      entityId: id,
      entityLabel: result.note.title,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue
    });
  }

  res.json(result.note);
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const user = requestContext.currentUser();

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const index = data.items.findIndex((n) => n.id === id);
    if (index === -1 || !isVisible(data.items[index], user)) return null;
    const [removed] = data.items.splice(index, 1);
    return removed;
  });

  if (!result) return res.status(404).json({ error: "Note not found." });

  await activityLog.log({
    action: "Deleted",
    entity: "Note",
    entityId: id,
    entityLabel: result.title
  });

  res.json({ success: true });
});

module.exports = router;
