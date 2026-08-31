const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Simple per-file write queue so concurrent requests don't clobber each other.
const queues = new Map();

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readSync(name, defaultValue) {
  const file = filePath(name);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
    return JSON.parse(JSON.stringify(defaultValue));
  }
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return JSON.parse(JSON.stringify(defaultValue));
  return JSON.parse(raw);
}

function writeSync(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}

/**
 * Reads a JSON store, lets the mutator function modify it, then persists it.
 * Mutations against the same store name are queued to avoid race conditions.
 */
function update(name, defaultValue, mutator) {
  const previous = queues.get(name) || Promise.resolve();

  const next = previous
    .catch(() => {})
    .then(() => {
      const data = readSync(name, defaultValue);
      const result = mutator(data);
      writeSync(name, data);
      return result;
    });

  queues.set(name, next);
  return next;
}

function read(name, defaultValue) {
  return Promise.resolve(readSync(name, defaultValue));
}

module.exports = { read, update };
