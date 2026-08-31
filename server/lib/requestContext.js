const { AsyncLocalStorage } = require("async_hooks");

const als = new AsyncLocalStorage();

function run(store, fn) {
  return als.run(store, fn);
}

function get() {
  return als.getStore();
}

function currentUser() {
  const ctx = get();
  return (ctx && ctx.userName) || "Unknown";
}

module.exports = { run, get, currentUser };
