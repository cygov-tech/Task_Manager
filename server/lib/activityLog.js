const crypto = require("crypto");
const store = require("../store");
const { formatDateTime } = require("./dates");
const requestContext = require("./requestContext");

const STORE_NAME = "activityLog";
const DEFAULT = { items: [] };

/**
 * The activity log only documents two kinds of events:
 * - an "achieved checklist" (a checklist item being marked done)
 * - a "progression" (a status field changing, e.g. task/bug/breakdown status)
 * Everything else (creates, deletes, renames, non-status field edits, etc.)
 * is intentionally not recorded here.
 */
function isQualifying(field, newValue) {
  if (field === "done") return String(newValue) === "true";
  if (field === "status") return true;
  return false;
}

/**
 * Appends an entry to the activity log.
 * action: short verb, e.g. "Created", "Updated", "Deleted", "Summary"
 * entity: which area of the app, e.g. "Task", "Bug", "Daily Goal", "Weekly Summary"
 */
function log({ action, entity, entityId, entityLabel, field, oldValue, newValue, details }) {
  if (!isQualifying(field, newValue)) return undefined;
  const user = requestContext.currentUser();
  return store.update(STORE_NAME, DEFAULT, (data) => {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: formatDateTime(new Date()),
      user,
      action: action || "",
      entity: entity || "",
      entityId: entityId || "",
      entityLabel: entityLabel || "",
      field: field || "",
      oldValue: oldValue === undefined || oldValue === null ? "" : String(oldValue),
      newValue: newValue === undefined || newValue === null ? "" : String(newValue),
      details: details || ""
    };
    data.items.push(entry);
    return entry;
  });
}

async function list() {
  const data = await store.read(STORE_NAME, DEFAULT);
  return data.items
    .filter((item) => isQualifying(item.field, item.newValue))
    .slice()
    .reverse(); // newest first
}

async function since(sinceDate) {
  const data = await store.read(STORE_NAME, DEFAULT);
  return data.items.filter((item) => parseTimestamp(item.timestamp) >= sinceDate);
}

function parseTimestamp(timestamp) {
  const match = String(timestamp).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return new Date(0);
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    match[6] ? Number(match[6]) : 0
  );
}

module.exports = { log, list, since };
