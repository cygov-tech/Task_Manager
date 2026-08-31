const express = require("express");
const crypto = require("crypto");
const store = require("../store");
const activityLog = require("../lib/activityLog");
const requestContext = require("../lib/requestContext");
const { formatDateTime } = require("../lib/dates");
const { VISIBILITY_OPTIONS, isVisible, filterVisible, sanitizeVisibility } = require("../lib/visibility");

const STORE_NAME = "checklistTemplates";
const DEFAULT = { items: [] };

const router = express.Router();

function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => String(i || "").trim())
    .filter((i) => i.length > 0)
    .map((text) => ({ id: crypto.randomUUID(), text }));
}

router.get("/meta", (req, res) => {
  res.json({ visibilityOptions: VISIBILITY_OPTIONS });
});

router.get("/", async (req, res) => {
  const data = await store.read(STORE_NAME, DEFAULT);
  res.json(filterVisible(data.items, requestContext.currentUser()));
});

router.post("/", async (req, res) => {
  const { name, items, visibility } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Checklist name is required." });
  }

  const template = await store.update(STORE_NAME, DEFAULT, (data) => {
    const newTemplate = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      items: sanitizeItems(items),
      owner: requestContext.currentUser(),
      visibility: sanitizeVisibility(visibility),
      createdAt: formatDateTime(new Date()),
      updatedAt: formatDateTime(new Date())
    };
    data.items.push(newTemplate);
    return newTemplate;
  });

  await activityLog.log({
    action: "Created",
    entity: "Checklist Template",
    entityId: template.id,
    entityLabel: template.name,
    details: `${template.items.length} item(s)`
  });

  res.status(201).json(template);
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};
  const user = requestContext.currentUser();

  const result = await store.update(STORE_NAME, DEFAULT, (data) => {
    const template = data.items.find((t) => t.id === id);
    if (!template || !isVisible(template, user)) return null;

    const changes = [];

    if (Object.prototype.hasOwnProperty.call(updates, "name")) {
      const newValue = String(updates.name || "").trim();
      if (newValue && newValue !== template.name) {
        changes.push({ field: "name", oldValue: template.name, newValue });
        template.name = newValue;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "items")) {
      const newValue = sanitizeItems(updates.items);
      if (JSON.stringify(newValue) !== JSON.stringify(template.items)) {
        changes.push({ field: "items", oldValue: template.items, newValue });
        template.items = newValue;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(updates, "visibility") &&
      (!template.owner || template.owner === user)
    ) {
      const newValue = sanitizeVisibility(updates.visibility);
      if (newValue !== template.visibility) {
        changes.push({ field: "visibility", oldValue: template.visibility, newValue });
        template.visibility = newValue;
      }
    }

    template.updatedAt = formatDateTime(new Date());
    return { template, changes };
  });

  if (!result) return res.status(404).json({ error: "Checklist template not found." });

  for (const change of result.changes) {
    await activityLog.log({
      action: "Updated",
      entity: "Checklist Template",
      entityId: id,
      entityLabel: result.template.name,
      field: change.field,
      oldValue: JSON.stringify(change.oldValue),
      newValue: JSON.stringify(change.newValue)
    });
  }

  res.json(result.template);
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

  if (!result) return res.status(404).json({ error: "Checklist template not found." });

  await activityLog.log({
    action: "Deleted",
    entity: "Checklist Template",
    entityId: id,
    entityLabel: result.name
  });

  res.json({ success: true });
});

module.exports = router;
