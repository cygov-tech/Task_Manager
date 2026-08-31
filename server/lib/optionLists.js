const store = require("../store");

const STORE_NAME = "optionLists";

const DEFAULTS = {
  tasks: {
    status: ["Called Ofir", "Sent on WA", "Didn't Start", "In the Middle", "Done", "Needs Approval", "Awaiting for Ofir", "Delaying"],
    type: ["Task", "Bug", "Follow-up", "Content", "Design", "Admin", "Other"],
    priority: ["Critical", "High", "Medium", "Low"]
  },
  bugs: {
    status: ["Called Ofir", "Sent on WA", "Didn't Start", "In the Middle", "Done", "Needs Approval", "Awaiting for Ofir", "Delaying"],
    type: ["BEECHER", "Midmarket", "Regular"],
    severity: ["Low", "Medium", "High", "Critical"]
  }
};

const DEFAULT_COLORS = {
  tasks: {
    status: {
      "Called Ofir": "#cfe2f3",
      "Sent on WA": "#d9ead3",
      "Didn't Start": "#f4cccc",
      "In the Middle": "#fff2cc",
      "Done": "#b6d7a8",
      "Needs Approval": "#eadcf8",
      "Awaiting for Ofir": "#fce5cd",
      "Delaying": "#ea9999"
    },
    type: {
      "Task": "#d9eaf7",
      "Bug": "#f4cccc",
      "Follow-up": "#fff2cc",
      "Content": "#d9ead3",
      "Design": "#eadcf8",
      "Admin": "#fce5cd",
      "Other": "#eeeeee"
    },
    priority: { "Critical": "#e06666", "High": "#f4cccc", "Medium": "#fff2cc", "Low": "#d9ead3" }
  },
  bugs: {
    status: {
      "Called Ofir": "#cfe2f3",
      "Sent on WA": "#d9ead3",
      "Didn't Start": "#f4cccc",
      "In the Middle": "#fff2cc",
      "Done": "#b6d7a8",
      "Needs Approval": "#eadcf8",
      "Awaiting for Ofir": "#fce5cd",
      "Delaying": "#ea9999"
    },
    type: { "BEECHER": "#cfe2f3", "Midmarket": "#d9ead3", "Regular": "#eeeeee" },
    severity: { "Low": "#d9ead3", "Medium": "#fff2cc", "High": "#f9cb9c", "Critical": "#e06666" }
  }
};

const FALLBACK_COLOR = "#eeeeee";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function isValidField(entity, field) {
  return !!(DEFAULTS[entity] && DEFAULTS[entity][field]);
}

function requireValidField(entity, field) {
  if (!isValidField(entity, field)) {
    throw new Error(`"${field}" is not an editable option list for "${entity}".`);
  }
}

function defaultColorFor(entity, field, value) {
  return (DEFAULT_COLORS[entity] && DEFAULT_COLORS[entity][field] && DEFAULT_COLORS[entity][field][value]) || FALLBACK_COLOR;
}

// Normalizes a stored list (which may be legacy plain strings, or {value,color} objects) into {value,color} objects.
function normalizeEntries(entity, field, rawList) {
  return rawList.map((item) => {
    if (item && typeof item === "object") {
      return { value: item.value, color: item.color || defaultColorFor(entity, field, item.value) };
    }
    return { value: item, color: defaultColorFor(entity, field, item) };
  });
}

async function getAll() {
  const data = await store.read(STORE_NAME, {});
  const result = {};
  Object.keys(DEFAULTS).forEach((entity) => {
    result[entity] = {};
    Object.keys(DEFAULTS[entity]).forEach((field) => {
      const key = `${entity}.${field}`;
      const raw = data[key] || DEFAULTS[entity][field];
      result[entity][field] = normalizeEntries(entity, field, raw);
    });
  });
  return result;
}

async function getList(entity, field) {
  requireValidField(entity, field);
  const all = await getAll();
  return all[entity][field].map((entry) => entry.value);
}

async function addOption(entity, field, value, color) {
  requireValidField(entity, field);
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new Error("Option value is required.");
  if (color && !HEX_COLOR_PATTERN.test(color)) throw new Error("Color must be a valid hex code (e.g. #d9ead3).");

  return store.update(STORE_NAME, {}, (data) => {
    const key = `${entity}.${field}`;
    const current = normalizeEntries(entity, field, data[key] || DEFAULTS[entity][field]);
    if (!current.some((entry) => entry.value === trimmed)) {
      current.push({ value: trimmed, color: color || defaultColorFor(entity, field, trimmed) });
    }
    data[key] = current;
    return current;
  });
}

async function renameOption(entity, field, oldValue, newValue) {
  requireValidField(entity, field);
  const trimmed = String(newValue || "").trim();
  if (!trimmed) throw new Error("Option value is required.");

  return store.update(STORE_NAME, {}, (data) => {
    const key = `${entity}.${field}`;
    const current = normalizeEntries(entity, field, data[key] || DEFAULTS[entity][field]);
    const idx = current.findIndex((entry) => entry.value === oldValue);
    if (idx !== -1) {
      current[idx] = { value: trimmed, color: current[idx].color };
    } else if (!current.some((entry) => entry.value === trimmed)) {
      current.push({ value: trimmed, color: defaultColorFor(entity, field, trimmed) });
    }
    data[key] = current;
    return current;
  });
}

async function setColor(entity, field, value, color) {
  requireValidField(entity, field);
  if (!HEX_COLOR_PATTERN.test(color || "")) throw new Error("Color must be a valid hex code (e.g. #d9ead3).");

  return store.update(STORE_NAME, {}, (data) => {
    const key = `${entity}.${field}`;
    const current = normalizeEntries(entity, field, data[key] || DEFAULTS[entity][field]);
    const idx = current.findIndex((entry) => entry.value === value);
    if (idx === -1) throw new Error("Option value not found.");
    current[idx] = { value: current[idx].value, color };
    data[key] = current;
    return current;
  });
}

async function removeOption(entity, field, value) {
  requireValidField(entity, field);

  return store.update(STORE_NAME, {}, (data) => {
    const key = `${entity}.${field}`;
    const current = normalizeEntries(entity, field, data[key] || DEFAULTS[entity][field]);
    data[key] = current.filter((entry) => entry.value !== value);
    return data[key];
  });
}

module.exports = {
  DEFAULTS,
  isValidField,
  getAll,
  getList,
  addOption,
  renameOption,
  removeOption,
  setColor
};
