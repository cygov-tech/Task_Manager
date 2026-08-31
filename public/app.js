const PRIORITY_COLORS = { "Critical": "#e06666", "High": "#f4cccc", "Medium": "#fff2cc", "Low": "#d9ead3" };
const VISIBILITY_COLORS = { "Team": "#d9ead3", "Private": "#f4cccc" };
const DAILY_STATUS_COLORS = {
  "Didn't Start": "#f4cccc",
  "In Progress": "#fff2cc",
  "Done": "#b6d7a8",
  "Blocked": "#ea9999",
  "Moved": "#d9d2e9"
};

const state = {
  currentUser: "",
  viewFilter: "everyone",
  tasks: [],
  bugs: [],
  taskMeta: { statusOptions: [], typeOptions: [] },
  bugMeta: { statusOptions: [], typeOptions: [], severityOptions: [] },
  dailyGoalsMeta: { priorityOptions: [], statusOptions: [] },
  recurringTasks: [],
  recurringMeta: { frequencyOptions: [], weekdayNames: [] },
  checklistTemplates: [],
  checklistMeta: { visibilityOptions: [] },
  optionLists: {},
  notes: [],
  notesMeta: { visibilityOptions: [] },
  tableSort: {
    tasks: { field: null, dir: "asc", mode: "text" },
    bugs: { field: null, dir: "asc", mode: "text" },
    recurringTasks: { field: null, dir: "asc", mode: "text" },
    prioritization: { field: null, dir: "asc", mode: "text" }
  },
  tableFilters: {
    tasks: { status: "All", type: "All", owner: "All", visibility: "All", search: "" },
    bugs: { status: "All", type: "All", severity: "All", owner: "All", visibility: "All", search: "" },
    recurringTasks: { frequency: "All", owner: "All", visibility: "All", search: "" },
    prioritization: { status: "All", owner: "All", visibility: "All", search: "" }
  },
  currentWeekStart: null,
  currentYearMonth: null,
  dailyView: "week",
  weekData: null,
  monthData: null,
  dayModalDate: null,
  activityLog: [],
  weeklySummaries: [],
  openModalTaskId: null,
  openRecurringChecklistId: null,
  collapsedDays: new Set(),
  collapsedDaysInitialized: new Set(),
  collapsedEntryChecklists: new Set()
};

async function api(method, url, body) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (state.currentUser) headers["X-User-Name"] = state.currentUser;

  const response = await fetch(url, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error((data && data.error) || `Request failed: ${response.status}`);
  }
  return data;
}

// ---------- Team Member Identity ----------

const USER_STORAGE_KEY = "taskManagerUserName";

function getStoredUser() {
  return localStorage.getItem(USER_STORAGE_KEY) || "";
}

function setStoredUser(name) {
  localStorage.setItem(USER_STORAGE_KEY, name);
  state.currentUser = name;
  renderCurrentUserBadge();
}

function renderCurrentUserBadge() {
  const container = document.getElementById("current-user-badge");
  container.innerHTML = "";
  container.appendChild(el("span", {}, `Signed in as ${state.currentUser}`));
  container.appendChild(el("button", { class: "small-btn", onclick: () => openUserModal(false) }, "Switch"));
}

function openUserModal(isInitial) {
  const overlay = document.getElementById("user-modal");
  const closeBtn = document.getElementById("user-modal-close");
  const input = document.getElementById("user-name-input");
  input.value = isInitial ? "" : state.currentUser;
  closeBtn.classList.toggle("hidden", isInitial);
  overlay.classList.remove("hidden");
  input.focus();
}

function closeUserModal() {
  document.getElementById("user-modal").classList.add("hidden");
}

function initUserIdentity() {
  document.getElementById("user-modal-close").addEventListener("click", closeUserModal);
  document.getElementById("user-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("user-name-input").value.trim();
    if (!name) return;
    setStoredUser(name);
    closeUserModal();
  });

  const stored = getStoredUser();
  if (stored) {
    state.currentUser = stored;
    renderCurrentUserBadge();
  } else {
    openUserModal(true);
  }
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child === null || child === undefined) return;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  });
  return node;
}

// Enables drag-and-drop reordering of a list's direct <li data-id="..."> children.
// Calls onReorder(orderedIds) once a drag completes with a changed order.
function enableDragReorder(listEl, onReorder, itemTag) {
  const tag = itemTag || "li";
  let draggedEl = null;
  let originalOrder = null;

  listEl.addEventListener("dragstart", (e) => {
    const item = e.target.closest(`${tag}[data-id]`);
    if (!item || item.parentElement !== listEl) return;
    draggedEl = item;
    originalOrder = [...listEl.children].map((child) => child.dataset.id);
    e.dataTransfer.effectAllowed = "move";
    item.classList.add("dragging");
  });

  listEl.addEventListener("dragover", (e) => {
    if (!draggedEl) return;
    e.preventDefault();
    const target = e.target.closest(`${tag}[data-id]`);
    if (!target || target === draggedEl || target.parentElement !== listEl) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    listEl.insertBefore(draggedEl, before ? target : target.nextSibling);
  });

  listEl.addEventListener("dragend", () => {
    if (!draggedEl) return;
    draggedEl.classList.remove("dragging");
    const newOrder = [...listEl.children].map((child) => child.dataset.id);
    draggedEl = null;
    if (originalOrder && newOrder.join() !== originalOrder.join()) onReorder(newOrder);
    originalOrder = null;
  });
}

function dragHandle() {
  return el("span", { class: "drag-handle", draggable: "true", title: "Drag to reorder" }, "\u283f");
}

function colorMapFor(entity, field) {
  const list = (state.optionLists[entity] && state.optionLists[entity][field]) || [];
  const map = {};
  list.forEach((entry) => {
    if (entry && typeof entry === "object") map[entry.value] = entry.color;
  });
  return map;
}

function mergeColorMaps(...maps) {
  return Object.assign({}, ...maps);
}

function taskColorResolver(item, field) {
  if (field === "status") return colorMapFor("tasks", "status")[item.status];
  if (field === "type") return colorMapFor("tasks", "type")[item.type];
  if (field === "priority") return colorMapFor("tasks", "priority")[item.priority];
  return "";
}

function bugColorResolver(item, field) {
  if (field === "status") return colorMapFor("bugs", "status")[item.status];
  if (field === "type") return colorMapFor("bugs", "type")[item.type];
  if (field === "severity") return colorMapFor("bugs", "severity")[item.severity];
  return "";
}

function prioritizationColorResolver(item, field) {
  if (field === "status") {
    return item.kind === "bug" ? colorMapFor("bugs", "status")[item.status] : colorMapFor("tasks", "status")[item.status];
  }
  if (field === "priority") {
    return item.kind === "bug" ? colorMapFor("bugs", "severity")[item.priority] : colorMapFor("tasks", "priority")[item.priority];
  }
  return "";
}

function percentOf(done, total) {
  return total ? Math.round((done / total) * 100) : 0;
}

// Combines every trackable item on a Daily Goals day (goal entries, recurring
// tasks, in-progress/LOE tasks, and checklist items) into one done/total pair
// so a single percentage can represent "how much of the day is accomplished".
function dayCombinedProgress(day) {
  const entries = day.entries || [];
  const recurringTasks = day.recurringTasks || [];
  const scheduledTasks = day.scheduledTasks || [];
  const checklist = day.checklist || [];

  const done =
    entries.filter((e) => e.done).length +
    recurringTasks.filter((t) => t.done).length +
    scheduledTasks.filter((t) => t.status === "Done").length +
    checklist.filter((c) => c.done).length;

  const total = entries.length + recurringTasks.length + scheduledTasks.length + checklist.length;

  return { done, total };
}

// Same as dayCombinedProgress but for the summary shape returned by the
// month-view API (counts instead of full item arrays).
function monthDayCombinedProgress(day) {
  const done = (day.entryDoneCount || 0) + (day.recurringDoneCount || 0) + (day.scheduledDoneCount || 0) + (day.checklistDoneCount || 0);
  const total = (day.entryCount || 0) + (day.recurringCount || 0) + (day.scheduledCount || 0) + (day.checklistCount || 0);
  return { done, total };
}

// Computes a task's sub-task/checklist completion progress from its
// Breakdown items. Prefers checklist-item granularity (aggregated across all
// breakdown items that have a checklist) since that's the most precise
// signal; falls back to counting whole breakdown items by status when none
// of them have checklists. Returns null when the task has no breakdown items
// at all, so callers can skip rendering a badge.
function taskSubProgress(task) {
  const breakdown = task.breakdown || [];
  if (!breakdown.length) return null;

  const withChecklist = breakdown.filter((b) => b.checklistItems && b.checklistItems.length);
  if (withChecklist.length) {
    const total = withChecklist.reduce((sum, b) => sum + b.checklistItems.length, 0);
    const done = withChecklist.reduce((sum, b) => sum + b.checklistItems.filter((ci) => ci.done).length, 0);
    return { done, total };
  }

  const total = breakdown.length;
  const done = breakdown.filter((b) => b.status === "Done").length;
  return { done, total };
}

function subProgressBadge(progress) {
  if (!progress || !progress.total) return null;
  const percent = percentOf(progress.done, progress.total);
  const badge = el("span", { class: "sub-progress-badge", title: `${progress.done}/${progress.total} sub-tasks done` }, [
    el("span", { class: "sub-progress-track" }, el("span", { class: "sub-progress-fill", style: `width:${percent}%` })),
    el("span", { class: "sub-progress-text" }, `${percent}%`)
  ]);
  return badge;
}

function progressWidget(done, total, label) {
  const percent = percentOf(done, total);
  const wrap = el("div", { class: "progress-widget" });
  const track = el("div", { class: "progress-bar-track" });
  track.appendChild(el("div", { class: "progress-bar-fill", style: `width:${percent}%` }));
  wrap.appendChild(track);
  wrap.appendChild(el("span", { class: "progress-widget-label" }, `${percent}% \u2014 ${done}/${total} ${label}`));
  return wrap;
}

function badge(text, colorMap) {
  const span = el("span", { class: "badge" }, text || "");
  span.style.background = (colorMap && colorMap[text]) || "#eeeeee";
  return span;
}

function selectEl(options, value, onChange, colorMap) {
  const select = el("select", { onchange: (e) => onChange(e.target.value) });
  options.forEach((opt) => {
    const optionEl = el("option", { value: opt }, opt);
    if (opt === value) optionEl.setAttribute("selected", "selected");
    select.appendChild(optionEl);
  });
  if (colorMap) select.style.background = colorMap[value] || "";
  return select;
}

// ---------- Ownership / Visibility ----------

function filterByOwner(items) {
  if (state.viewFilter !== "mine") return items;
  return items.filter((item) => item.owner === state.currentUser);
}

// ---------- Table Sort / Filter ----------

function applyTableSortAndFilter(items, tableKey, searchFields, colorResolver) {
  const filters = state.tableFilters[tableKey];
  let result = items.filter((item) => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hit = searchFields.some((f) => String(item[f] || "").toLowerCase().includes(q));
      if (!hit) return false;
    }
    return Object.keys(filters).every((key) => {
      if (key === "search" || filters[key] === "All") return true;
      return String(item[key] || "") === filters[key];
    });
  });
  const sort = state.tableSort[tableKey];
  if (sort.field) {
    result = [...result].sort((a, b) => {
      let av, bv;
      if (sort.mode === "color" && colorResolver) {
        av = (colorResolver(a, sort.field) || "").toLowerCase();
        bv = (colorResolver(b, sort.field) || "").toLowerCase();
      } else {
        av = String(a[sort.field] ?? "").toLowerCase();
        bv = String(b[sort.field] ?? "").toLowerCase();
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }
  return result;
}

function setupSortableHeaders() {
  const renderFnByTable = {
    tasks: renderTasks,
    bugs: renderBugs,
    recurringTasks: renderRecurringTasks,
    prioritization: renderPrioritization
  };
  document.querySelectorAll("[data-sort-field]").forEach((th) => {
    th.classList.add("sortable-header");
    th.addEventListener("click", () => {
      const table = th.dataset.sortTable;
      const field = th.dataset.sortField;
      const sort = state.tableSort[table];
      sort.dir = sort.field === field && sort.mode === "text" && sort.dir === "asc" ? "desc" : "asc";
      sort.field = field;
      sort.mode = "text";
      updateSortIndicators(table);
      renderFnByTable[table]();
    });
    if (th.dataset.sortColorable === "true") {
      const swatchBtn = el(
        "span",
        {
          class: "sort-color-btn",
          title: "Sort by color",
          onclick: (e) => {
            e.stopPropagation();
            const table = th.dataset.sortTable;
            const field = th.dataset.sortField;
            const sort = state.tableSort[table];
            sort.dir = sort.field === field && sort.mode === "color" && sort.dir === "asc" ? "desc" : "asc";
            sort.field = field;
            sort.mode = "color";
            updateSortIndicators(table);
            renderFnByTable[table]();
          }
        },
        "\u{1F3A8}"
      );
      th.appendChild(swatchBtn);
    }
  });
}

function updateSortIndicators(table) {
  const sort = state.tableSort[table];
  document.querySelectorAll(`[data-sort-table="${table}"]`).forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc", "sort-color-active");
    if (th.dataset.sortField === sort.field) {
      th.classList.add(sort.dir === "asc" ? "sort-asc" : "sort-desc");
      if (sort.mode === "color") th.classList.add("sort-color-active");
    }
  });
}

function ownerFilterOptions(items) {
  const owners = new Set();
  if (state.currentUser) owners.add(state.currentUser);
  items.forEach((item) => {
    if (item.owner) owners.add(item.owner);
  });
  return Array.from(owners).sort((a, b) => a.localeCompare(b));
}

function buildFilterControl(label, options, currentValue, onChange) {
  const select = el("select", { onchange: (e) => onChange(e.target.value) });
  select.appendChild(el("option", { value: "All" }, `All ${label}`));
  options.forEach((opt) => {
    const optionEl = el("option", { value: opt }, opt);
    if (opt === currentValue) optionEl.setAttribute("selected", "selected");
    select.appendChild(optionEl);
  });
  return select;
}

function renderTableFilters(containerId, tableKey, items, fieldConfigs, searchPlaceholder, renderFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  fieldConfigs.forEach(({ key, label, options }) => {
    const filters = state.tableFilters[tableKey];
    const control = buildFilterControl(label, options, filters[key], (val) => {
      filters[key] = val;
      renderFn();
    });
    container.appendChild(control);
  });

  const searchInput = el("input", {
    type: "search",
    placeholder: searchPlaceholder || "Search...",
    value: state.tableFilters[tableKey].search,
    oninput: (e) => {
      state.tableFilters[tableKey].search = e.target.value;
      renderFn();
    }
  });
  container.appendChild(searchInput);
}

function renderAllTableFilters() {
  renderTableFilters(
    "tasks-filters",
    "tasks",
    state.tasks,
    [
      { key: "status", label: "Statuses", options: state.taskMeta.statusOptions || [] },
      { key: "type", label: "Types", options: state.taskMeta.typeOptions || [] },
      { key: "owner", label: "Owners", options: ownerFilterOptions(state.tasks) },
      { key: "visibility", label: "Visibility", options: ["Team", "Private"] }
    ],
    "Search tasks...",
    renderTasks
  );

  renderTableFilters(
    "bugs-filters",
    "bugs",
    state.bugs,
    [
      { key: "status", label: "Statuses", options: state.bugMeta.statusOptions || [] },
      { key: "type", label: "Types", options: state.bugMeta.typeOptions || [] },
      { key: "severity", label: "Severities", options: state.bugMeta.severityOptions || [] },
      { key: "owner", label: "Owners", options: ownerFilterOptions(state.bugs) },
      { key: "visibility", label: "Visibility", options: ["Team", "Private"] }
    ],
    "Search bugs...",
    renderBugs
  );

  renderTableFilters(
    "recurring-tasks-filters",
    "recurringTasks",
    state.recurringTasks,
    [
      { key: "frequency", label: "Frequencies", options: state.recurringMeta.frequencyOptions || [] },
      { key: "owner", label: "Owners", options: ownerFilterOptions(state.recurringTasks) },
      { key: "visibility", label: "Visibility", options: ["Team", "Private"] }
    ],
    "Search recurring tasks...",
    renderRecurringTasks
  );

  const prioritizationItems = [...state.tasks, ...state.bugs];
  renderTableFilters(
    "prioritization-filters",
    "prioritization",
    prioritizationItems,
    [
      {
        key: "status",
        label: "Statuses",
        options: Array.from(new Set([...(state.taskMeta.statusOptions || []), ...(state.bugMeta.statusOptions || [])]))
      },
      { key: "owner", label: "Owners", options: ownerFilterOptions(prioritizationItems) },
      { key: "visibility", label: "Visibility", options: ["Team", "Private"] }
    ],
    "Search...",
    renderPrioritization
  );
}

function visibilityControl(item, visibilityOptions, onChange) {
  if (item.owner && item.owner !== state.currentUser) {
    return badge(item.visibility || "Team", VISIBILITY_COLORS);
  }
  return selectEl(visibilityOptions || ["Team", "Private"], item.visibility || "Team", onChange, VISIBILITY_COLORS);
}

function visibilityCell(item, visibilityOptions, onChange) {
  return el("td", {}, visibilityControl(item, visibilityOptions, onChange));
}

function startToggleCell(item, onChange) {
  const started = !!item.date;
  const toggleBtn = el(
    "button",
    {
      class: started ? "small-btn start-toggle-btn started" : "small-btn start-toggle-btn",
      onclick: () => onChange(started ? "" : todayStr())
    },
    started ? "Pause" : "Start"
  );
  const dateInput = el("input", {
    type: "date",
    class: "start-date-input",
    value: item.date || "",
    onchange: (e) => onChange(e.target.value)
  });
  const wrap = el("div", { class: "start-toggle-wrap" }, [toggleBtn, dateInput]);
  return el("td", {}, wrap);
}

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/g;

function extractFirstUrl(text) {
  if (!text) return null;
  const match = String(text).match(URL_PATTERN);
  return match ? match[0] : null;
}

function linkifyInto(container, text) {
  container.innerHTML = "";
  const str = text || "";
  let lastIndex = 0;
  let match;
  URL_PATTERN.lastIndex = 0;
  while ((match = URL_PATTERN.exec(str)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(str.slice(lastIndex, match.index)));
    }
    container.appendChild(el("a", { href: match[0], target: "_blank", rel: "noopener noreferrer" }, match[0]));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < str.length) {
    container.appendChild(document.createTextNode(str.slice(lastIndex)));
  }
}

function commentsCell(value, onChange) {
  const input = el("input", {
    type: "text",
    value: value || "",
    placeholder: "Comments",
    onchange: (e) => {
      onChange(e.target.value);
      refreshLink();
    }
  });
  const wrap = el("div", { class: "comments-cell-wrap" }, [input]);
  function refreshLink() {
    const existing = wrap.querySelector(".comment-link-btn");
    if (existing) existing.remove();
    const url = extractFirstUrl(input.value);
    if (url) {
      wrap.appendChild(el("a", { href: url, target: "_blank", rel: "noopener noreferrer", class: "comment-link-btn", title: url }, "\uD83D\uDD17"));
    }
  }
  refreshLink();
  return el("td", {}, wrap);
}

function ownerSelectEl(items, currentOwner, onChange) {
  const owners = new Set();
  if (state.currentUser) owners.add(state.currentUser);
  items.forEach((item) => {
    if (item.owner) owners.add(item.owner);
  });
  if (currentOwner) owners.add(currentOwner);
  const sorted = Array.from(owners).sort((a, b) => a.localeCompare(b));

  const select = el("select", { onchange: (e) => onChange(e.target.value) });
  const blankOption = el("option", { value: "" }, "(unassigned)");
  if (!currentOwner) blankOption.setAttribute("selected", "selected");
  select.appendChild(blankOption);
  sorted.forEach((name) => {
    const optionEl = el("option", { value: name }, name);
    if (name === currentOwner) optionEl.setAttribute("selected", "selected");
    select.appendChild(optionEl);
  });
  return select;
}

function ownerCell(items, currentOwner, onChange) {
  return el("td", {}, ownerSelectEl(items, currentOwner, onChange));
}

function initOwnerFilter() {
  document.querySelectorAll("#owner-filter-toggle .view-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#owner-filter-toggle .view-toggle-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.viewFilter = btn.dataset.ownerFilter;
      renderTasks();
      renderBugs();
      renderRecurringTasks();
      renderPrioritization();
    });
  });
}

function initStopServerButton() {
  const btn = document.getElementById("stop-server-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!confirm("Stop the Task Manager server? You'll need to reopen the desktop app to start it again.")) return;
    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch (err) {
      // The server closing the connection while responding can look like a
      // network error in the browser — that's expected, not a failure.
    }
    document.body.innerHTML =
      '<div style="padding:40px;font-family:sans-serif;font-size:18px;">Server stopped. You can close this tab.</div>';
  });
}

// ---------- Tabs ----------

const TAB_HISTORY_KEY = "tabHistory";
let tabHistory = [];
try {
  tabHistory = JSON.parse(sessionStorage.getItem(TAB_HISTORY_KEY) || "[]");
} catch (err) {
  tabHistory = [];
}

function activateTab(tabId, { recordHistory = true } = {}) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  const panel = document.getElementById(tabId);
  if (!btn || !panel) return;

  const currentBtn = document.querySelector(".tab-btn.active");
  const currentTab = currentBtn ? currentBtn.dataset.tab : null;

  if (recordHistory && currentTab && currentTab !== tabId) {
    tabHistory.push(currentTab);
    sessionStorage.setItem(TAB_HISTORY_KEY, JSON.stringify(tabHistory));
  }

  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  panel.classList.add("active");

  const backBtn = document.getElementById("back-btn");
  if (backBtn) backBtn.disabled = tabHistory.length === 0;
}

function goBackTab() {
  if (!tabHistory.length) return;
  const previousTab = tabHistory.pop();
  sessionStorage.setItem(TAB_HISTORY_KEY, JSON.stringify(tabHistory));
  activateTab(previousTab, { recordHistory: false });
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
  const backBtn = document.getElementById("back-btn");
  if (backBtn) {
    backBtn.disabled = tabHistory.length === 0;
    backBtn.addEventListener("click", goBackTab);
  }
}

// ---------- Task Manager ----------

async function loadTaskMeta() {
  state.taskMeta = await api("GET", "/api/tasks/meta");
  const typeSelect = document.getElementById("new-task-type");
  typeSelect.innerHTML = "";
  state.taskMeta.typeOptions.forEach((opt) => typeSelect.appendChild(el("option", { value: opt }, opt)));

  const visibilitySelect = document.getElementById("new-task-visibility");
  visibilitySelect.innerHTML = "";
  (state.taskMeta.visibilityOptions || ["Team", "Private"]).forEach((opt) =>
    visibilitySelect.appendChild(el("option", { value: opt }, opt))
  );
}

async function loadTasks() {
  state.tasks = await api("GET", "/api/tasks");
  renderTasks();
  renderPrioritization();
  renderTaskDropdownsInDailyGoals();
  renderAllTableFilters();
}

function renderTasks() {
  const tbody = document.getElementById("tasks-tbody");
  tbody.innerHTML = "";

  const ownedTasks = filterByOwner(state.tasks);
  const progressEl = document.getElementById("tasks-progress");
  if (progressEl) {
    progressEl.innerHTML = "";
    const doneCount = ownedTasks.filter((t) => t.status === "Done").length;
    progressEl.appendChild(progressWidget(doneCount, ownedTasks.length, "tasks done"));
  }

  applyTableSortAndFilter(ownedTasks, "tasks", ["name", "comments"], taskColorResolver).forEach((task, index) => {
    const tr = el("tr", {});
    tr.appendChild(el("td", {}, String(index + 1)));

    const nameCell = el("td", { class: "name-cell", onclick: () => openTaskModal(task.id) }, task.name);
    const taskSubBadge = subProgressBadge(taskSubProgress(task));
    if (taskSubBadge) nameCell.appendChild(taskSubBadge);
    tr.appendChild(nameCell);

    const statusCell = el("td", {});
    statusCell.appendChild(
      selectEl(state.taskMeta.statusOptions, task.status, (val) => updateTask(task.id, { status: val }), colorMapFor("tasks", "status"))
    );
    tr.appendChild(statusCell);

    const typeCell = el("td", {});
    typeCell.appendChild(
      selectEl(state.taskMeta.typeOptions, task.type, (val) => updateTask(task.id, { type: val }), colorMapFor("tasks", "type"))
    );
    tr.appendChild(typeCell);

    const loeInput = el("input", {
      type: "number",
      min: "0",
      value: task.loe || 0,
      class: "loe-input",
      onchange: (e) => updateTask(task.id, { loe: e.target.value })
    });
    tr.appendChild(el("td", {}, loeInput));

    const deadlineInput = el("input", {
      type: "date",
      value: task.deadline || "",
      onchange: (e) => updateTask(task.id, { deadline: e.target.value })
    });
    tr.appendChild(el("td", {}, deadlineInput));

    tr.appendChild(startToggleCell(task, (val) => updateTask(task.id, { date: val })));

    const trelloInput = el("input", {
      type: "text",
      value: task.trelloCard || "",
      placeholder: "Trello link",
      onchange: (e) => updateTask(task.id, { trelloCard: e.target.value })
    });
    tr.appendChild(el("td", {}, trelloInput));

    tr.appendChild(ownerCell(state.tasks, task.owner, (val) => updateTask(task.id, { owner: val })));
    tr.appendChild(
      visibilityCell(task, state.taskMeta.visibilityOptions, (val) => updateTask(task.id, { visibility: val }))
    );

    const deleteBtn = el("button", { class: "danger", onclick: () => deleteTask(task.id) }, "Delete");
    tr.appendChild(el("td", {}, deleteBtn));

    tbody.appendChild(tr);
  });
}

async function updateTask(id, updates) {
  const task = await api("PUT", `/api/tasks/${id}`, updates);
  const idx = state.tasks.findIndex((t) => t.id === id);
  if (idx !== -1) state.tasks[idx] = task;
  renderTasks();
  renderPrioritization();
  if ("deadline" in updates) {
    if (state.dailyView === "week" && state.currentWeekStart) await loadWeek(state.currentWeekStart);
    if (state.dailyView === "month" && state.currentYearMonth) await loadMonth(state.currentYearMonth);
  } else {
    renderTaskDropdownsInDailyGoals();
  }
}

// ---------- Prioritization ----------

const PRIORITY_RANK = { "Critical": 0, "High": 1, "Medium": 2, "Low": 3 };

function switchToBugTab(bugId) {
  document.querySelector('[data-tab="bugs"]').click();
  if (!bugId) return;
  requestAnimationFrame(() => {
    const row = document.querySelector(`#bugs-tbody tr[data-id="${bugId}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("row-highlight");
    setTimeout(() => row.classList.remove("row-highlight"), 2000);
  });
}

function renderPrioritization() {
  const tbody = document.getElementById("prioritization-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const taskItems = filterByOwner(state.tasks).map((t) => ({
    kind: "task",
    id: t.id,
    name: t.name,
    priority: t.priority || "Medium",
    loe: t.loe || 0,
    deadline: t.deadline || "",
    date: t.date || "",
    comments: t.comments || "",
    status: t.status,
    owner: t.owner || "",
    visibility: t.visibility || "Team",
    breakdown: t.breakdown || []
  }));
  const bugItems = filterByOwner(state.bugs).map((b) => ({
    kind: "bug",
    id: b.id,
    name: b.title,
    priority: b.severity || "Medium",
    loe: b.loe || 0,
    deadline: b.deadline || "",
    date: b.date || "",
    comments: b.comments || "",
    status: b.status,
    owner: b.owner || "",
    visibility: b.visibility || "Team"
  }));

  let sorted = [...taskItems, ...bugItems].sort((a, b) => {
    const rankDiff = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
    if (rankDiff !== 0) return rankDiff;
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return 0;
  });

  sorted = applyTableSortAndFilter(sorted, "prioritization", ["name", "comments"], prioritizationColorResolver);

  sorted.forEach((item, index) => {
    const tr = el("tr", {});
    tr.appendChild(el("td", {}, String(index + 1)));

    const nameCell = el(
      "td",
      { class: "name-cell", onclick: () => (item.kind === "task" ? openTaskModal(item.id) : switchToBugTab(item.id)) },
      `${item.name}${item.kind === "bug" ? " (Bug)" : ""}`
    );
    if (item.kind === "task") {
      const prioritizationSubBadge = subProgressBadge(taskSubProgress(item));
      if (prioritizationSubBadge) nameCell.appendChild(prioritizationSubBadge);
    }
    tr.appendChild(nameCell);

    const priorityOptions = item.kind === "task" ? state.taskMeta.priorityOptions || [] : state.bugMeta.severityOptions || [];
    const priorityCell = el("td", {});
    const priorityColorMap = item.kind === "task" ? colorMapFor("tasks", "priority") : colorMapFor("bugs", "severity");
    priorityCell.appendChild(
      selectEl(priorityOptions, item.priority, (val) =>
        item.kind === "task" ? updateTask(item.id, { priority: val }) : updateBug(item.id, { severity: val }), priorityColorMap)
    );
    tr.appendChild(priorityCell);

    const loeInput = el("input", {
      type: "number",
      min: "0",
      value: item.loe,
      class: "loe-input",
      onchange: (e) =>
        item.kind === "task" ? updateTask(item.id, { loe: e.target.value }) : updateBug(item.id, { loe: e.target.value })
    });
    tr.appendChild(el("td", {}, loeInput));

    const deadlineInput = el("input", {
      type: "date",
      value: item.deadline,
      onchange: (e) =>
        item.kind === "task" ? updateTask(item.id, { deadline: e.target.value }) : updateBug(item.id, { deadline: e.target.value })
    });
    tr.appendChild(el("td", {}, deadlineInput));

    tr.appendChild(
      startToggleCell(item, (val) =>
        item.kind === "task" ? updateTask(item.id, { date: val }) : updateBug(item.id, { date: val }))
    );

    tr.appendChild(
      commentsCell(item.comments, (val) =>
        item.kind === "task" ? updateTask(item.id, { comments: val }) : updateBug(item.id, { comments: val }))
    );

    const statusOptions = item.kind === "task" ? state.taskMeta.statusOptions : state.bugMeta.statusOptions;
    const statusColorMap = item.kind === "task" ? colorMapFor("tasks", "status") : colorMapFor("bugs", "status");
    const statusCell = el("td", {});
    statusCell.appendChild(
      selectEl(statusOptions, item.status, (val) =>
        item.kind === "task" ? updateTask(item.id, { status: val }) : updateBug(item.id, { status: val }), statusColorMap)
    );
    tr.appendChild(statusCell);

    tr.appendChild(
      ownerCell(item.kind === "task" ? state.tasks : state.bugs, item.owner, (val) =>
        item.kind === "task" ? updateTask(item.id, { owner: val }) : updateBug(item.id, { owner: val }))
    );

    const visibilityOptions = item.kind === "task" ? state.taskMeta.visibilityOptions : state.bugMeta.visibilityOptions;
    tr.appendChild(
      visibilityCell(item, visibilityOptions, (val) =>
        item.kind === "task" ? updateTask(item.id, { visibility: val }) : updateBug(item.id, { visibility: val }))
    );

    tbody.appendChild(tr);
  });
}

async function deleteTask(id) {
  if (!confirm("Delete this task? This cannot be undone.")) return;
  await api("DELETE", `/api/tasks/${id}`);
  await loadTasks();
}

document.getElementById("new-task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("new-task-name").value.trim();
  const type = document.getElementById("new-task-type").value;
  const visibility = document.getElementById("new-task-visibility").value;
  if (!name) return;
  await api("POST", "/api/tasks", { name, type, visibility });
  document.getElementById("new-task-name").value = "";
  await loadTasks();
});

// ---------- Recurring Tasks ----------

async function loadRecurringMeta() {
  state.recurringMeta = await api("GET", "/api/recurring-tasks/meta");

  const freqSelect = document.getElementById("new-recurring-frequency");
  freqSelect.innerHTML = "";
  state.recurringMeta.frequencyOptions.forEach((opt) => freqSelect.appendChild(el("option", { value: opt }, opt)));

  const weekdaysBox = document.getElementById("new-recurring-weekdays");
  weekdaysBox.innerHTML = "";
  state.recurringMeta.weekdayNames.forEach((name, idx) => {
    const checkbox = el("input", { type: "checkbox", value: String(idx) });
    weekdaysBox.appendChild(el("label", {}, [checkbox, name.slice(0, 3)]));
  });

  const monthdaysBox = document.getElementById("new-recurring-monthdays");
  monthdaysBox.innerHTML = "";
  for (let d = 1; d <= 31; d++) {
    const checkbox = el("input", { type: "checkbox", value: String(d) });
    monthdaysBox.appendChild(el("label", {}, [checkbox, String(d)]));
  }

  freqSelect.addEventListener("change", updateNewRecurringFieldVisibility);
  updateNewRecurringFieldVisibility();

  const visibilitySelect = document.getElementById("new-recurring-visibility");
  visibilitySelect.innerHTML = "";
  (state.recurringMeta.visibilityOptions || ["Team", "Private"]).forEach((opt) =>
    visibilitySelect.appendChild(el("option", { value: opt }, opt))
  );
}

function updateNewRecurringFieldVisibility() {
  const freq = document.getElementById("new-recurring-frequency").value;
  document.getElementById("new-recurring-weekdays").classList.toggle("hidden", freq !== "Weekly");
  document.getElementById("new-recurring-monthdays").classList.toggle("hidden", freq !== "Monthly");
}

async function loadRecurringTasks() {
  state.recurringTasks = await api("GET", "/api/recurring-tasks");
  renderRecurringTasks();
  renderAllTableFilters();
  if (state.dailyView === "week" && state.currentWeekStart) await loadWeek(state.currentWeekStart);
  if (state.dailyView === "month" && state.currentYearMonth) await loadMonth(state.currentYearMonth);
}

function recurringDetailsText(task) {
  switch (task.frequency) {
    case "Daily":
      return "Every day";
    case "Weekly":
      return (task.weekdays || [])
        .slice()
        .sort((a, b) => a - b)
        .map((d) => (state.recurringMeta.weekdayNames[d] || "").slice(0, 3))
        .join(", ") || "(no days selected)";
    case "Monthly":
      return (task.monthDays || []).length
        ? `Day${task.monthDays.length > 1 ? "s" : ""} ${task.monthDays.join(", ")} of month`
        : "(no days selected)";
    case "End of Month":
      return "Last day of month";
    default:
      return "";
  }
}

function renderRecurringTasks() {
  const tbody = document.getElementById("recurring-tasks-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  applyTableSortAndFilter(filterByOwner(state.recurringTasks), "recurringTasks", ["name", "comments"]).forEach((task, index) => {
    const tr = el("tr", {});
    tr.appendChild(el("td", {}, String(index + 1)));

    const nameInput = el("input", {
      type: "text",
      value: task.name,
      onchange: (e) => updateRecurringTask(task.id, { name: e.target.value })
    });
    tr.appendChild(el("td", {}, nameInput));

    const freqCell = el("td", {});
    freqCell.appendChild(
      selectEl(state.recurringMeta.frequencyOptions, task.frequency, (val) => updateRecurringTask(task.id, { frequency: val }))
    );
    tr.appendChild(freqCell);

    tr.appendChild(el("td", {}, recurringDetailsText(task)));

    const timeInput = el("input", {
      type: "time",
      value: task.time || "",
      onchange: (e) => updateRecurringTask(task.id, { time: e.target.value })
    });
    tr.appendChild(el("td", {}, timeInput));

    tr.appendChild(commentsCell(task.comments, (val) => updateRecurringTask(task.id, { comments: val })));

    const activeCheckbox = el("input", {
      type: "checkbox",
      onchange: (e) => updateRecurringTask(task.id, { active: e.target.checked })
    });
    if (task.active) activeCheckbox.setAttribute("checked", "checked");
    tr.appendChild(el("td", {}, activeCheckbox));

    const checklistItems = task.checklistItems || [];
    const doneCount = checklistItems.filter((c) => c.done).length;
    const checklistLabel = checklistItems.length ? `Checklist (${doneCount}/${checklistItems.length})` : "Checklist";
    const checklistBtn = el(
      "button",
      { class: "small-btn", onclick: () => openRecurringChecklistModal(task.id) },
      checklistLabel
    );
    tr.appendChild(el("td", {}, checklistBtn));

    tr.appendChild(ownerCell(state.recurringTasks, task.owner, (val) => updateRecurringTask(task.id, { owner: val })));
    tr.appendChild(
      visibilityCell(task, state.recurringMeta.visibilityOptions, (val) => updateRecurringTask(task.id, { visibility: val }))
    );

    const deleteBtn = el("button", { class: "danger small-btn", onclick: () => deleteRecurringTask(task.id) }, "Delete");
    tr.appendChild(el("td", {}, deleteBtn));

    tbody.appendChild(tr);
  });
}

async function updateRecurringTask(id, updates) {
  const task = await api("PUT", `/api/recurring-tasks/${id}`, updates);
  const idx = state.recurringTasks.findIndex((t) => t.id === id);
  if (idx !== -1) state.recurringTasks[idx] = task;
  renderRecurringTasks();
  if (state.dailyView === "week" && state.currentWeekStart) await loadWeek(state.currentWeekStart);
  if (state.dailyView === "month" && state.currentYearMonth) await loadMonth(state.currentYearMonth);
}

async function deleteRecurringTask(id) {
  if (!confirm("Delete this recurring task? This cannot be undone.")) return;
  await api("DELETE", `/api/recurring-tasks/${id}`);
  await loadRecurringTasks();
}

document.getElementById("new-recurring-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("new-recurring-name").value.trim();
  const frequency = document.getElementById("new-recurring-frequency").value;
  const weekdays = Array.from(document.querySelectorAll("#new-recurring-weekdays input[type=checkbox]:checked")).map((cb) =>
    Number(cb.value)
  );
  const monthDays = Array.from(document.querySelectorAll("#new-recurring-monthdays input[type=checkbox]:checked")).map((cb) =>
    Number(cb.value)
  );
  const time = document.getElementById("new-recurring-time").value;
  const comments = document.getElementById("new-recurring-comments").value;
  const visibility = document.getElementById("new-recurring-visibility").value;
  if (!name) return;

  await api("POST", "/api/recurring-tasks", { name, frequency, weekdays, monthDays, time, comments, visibility });

  document.getElementById("new-recurring-name").value = "";
  document.getElementById("new-recurring-comments").value = "";
  document.getElementById("new-recurring-time").value = "";
  document.querySelectorAll("#new-recurring-weekdays input[type=checkbox]").forEach((cb) => (cb.checked = false));
  document.querySelectorAll("#new-recurring-monthdays input[type=checkbox]").forEach((cb) => (cb.checked = false));

  await loadRecurringTasks();
});

async function toggleRecurringDone(date, taskId, done) {
  await api("PUT", `/api/daily-goals/day/${date}/recurring/${taskId}`, { done });
  await afterDailyGoalsChange(date);
}

async function toggleScheduledTaskDone(date, task, done) {
  const newStatus = done ? "Done" : "In the Middle";
  if (task.type === "Bug") {
    await updateBug(task.id, { status: newStatus });
  } else {
    await updateTask(task.id, { status: newStatus });
  }
  await afterDailyGoalsChange(date);
}

// ---------- Recurring Task Checklist Modal ----------

function openRecurringChecklistModal(taskId) {
  state.openRecurringChecklistId = taskId;
  renderRecurringChecklistModal();
  document.getElementById("recurring-checklist-modal").classList.remove("hidden");
}

function closeRecurringChecklistModal() {
  state.openRecurringChecklistId = null;
  document.getElementById("recurring-checklist-modal").classList.add("hidden");
}

document.getElementById("recurring-checklist-modal-close").addEventListener("click", closeRecurringChecklistModal);
document.getElementById("recurring-checklist-modal").addEventListener("click", (e) => {
  if (e.target.id === "recurring-checklist-modal") closeRecurringChecklistModal();
});

function renderRecurringChecklistModal() {
  const task = state.recurringTasks.find((t) => t.id === state.openRecurringChecklistId);
  if (!task) return;

  document.getElementById("recurring-checklist-modal-name").textContent = `${task.name} — Checklist`;

  const content = document.getElementById("recurring-checklist-content");
  content.innerHTML = "";

  const checklistItems = task.checklistItems || [];
  const list = el("ul", { class: "checklist-list" });
  checklistItems.forEach((ci) => {
    const li = el("li", { class: ci.done ? "done" : "" });
    const checkbox = el("input", {
      type: "checkbox",
      onchange: (e) => updateRecurringChecklistItem(task.id, ci.id, { done: e.target.checked })
    });
    if (ci.done) checkbox.setAttribute("checked", "checked");
    li.appendChild(checkbox);
    li.appendChild(el("span", { class: "checklist-text" }, ci.text));
    li.appendChild(
      el("button", { class: "danger small-btn", onclick: () => deleteRecurringChecklistItem(task.id, ci.id) }, "\u00d7")
    );
    list.appendChild(li);
  });
  content.appendChild(list);

  const addInput = el("input", { type: "text", placeholder: "Add step", class: "checklist-add-input" });
  const addBtn = el(
    "button",
    {
      class: "small-btn",
      onclick: () => {
        const text = addInput.value.trim();
        if (!text) return;
        addRecurringChecklistItem(task.id, text);
        addInput.value = "";
      }
    },
    "Add"
  );
  content.appendChild(el("div", { class: "checklist-add-row" }, [addInput, addBtn]));

  if (state.checklistTemplates.length) {
    const templateSelect = el("select", {
      class: "checklist-template-select",
      onchange: (e) => {
        const templateId = e.target.value;
        e.target.value = "";
        if (!templateId) return;
        applyRecurringChecklistTemplate(task.id, templateId);
      }
    });
    templateSelect.appendChild(el("option", { value: "" }, "Apply template..."));
    state.checklistTemplates.forEach((tpl) => {
      templateSelect.appendChild(el("option", { value: tpl.id }, tpl.name));
    });
    content.appendChild(templateSelect);
  }
}

async function addRecurringChecklistItem(taskId, text) {
  const task = await api("POST", `/api/recurring-tasks/${taskId}/checklist`, { text });
  const idx = state.recurringTasks.findIndex((t) => t.id === taskId);
  if (idx !== -1) state.recurringTasks[idx] = task;
  renderRecurringChecklistModal();
  renderRecurringTasks();
}

async function updateRecurringChecklistItem(taskId, checklistItemId, updates) {
  const task = await api("PUT", `/api/recurring-tasks/${taskId}/checklist/${checklistItemId}`, updates);
  const idx = state.recurringTasks.findIndex((t) => t.id === taskId);
  if (idx !== -1) state.recurringTasks[idx] = task;
  renderRecurringChecklistModal();
  renderRecurringTasks();
}

async function deleteRecurringChecklistItem(taskId, checklistItemId) {
  const task = await api("DELETE", `/api/recurring-tasks/${taskId}/checklist/${checklistItemId}`);
  const idx = state.recurringTasks.findIndex((t) => t.id === taskId);
  if (idx !== -1) state.recurringTasks[idx] = task;
  renderRecurringChecklistModal();
  renderRecurringTasks();
}

async function applyRecurringChecklistTemplate(taskId, templateId) {
  const template = state.checklistTemplates.find((t) => t.id === templateId);
  if (!template) return;
  for (const templateItem of template.items) {
    await addRecurringChecklistItem(taskId, templateItem.text);
  }
}

// ---------- Task Modal (Elaboration) ----------

function openTaskModal(taskId) {
  state.openModalTaskId = taskId;
  renderTaskModal();
  document.getElementById("task-modal").classList.remove("hidden");
}

function closeTaskModal() {
  state.openModalTaskId = null;
  document.getElementById("task-modal").classList.add("hidden");
}

document.getElementById("task-modal-close").addEventListener("click", closeTaskModal);
document.getElementById("task-modal").addEventListener("click", (e) => {
  if (e.target.id === "task-modal") closeTaskModal();
});

function renderTaskModal() {
  const task = state.tasks.find((t) => t.id === state.openModalTaskId);
  if (!task) return;

  document.getElementById("modal-task-name").textContent = task.name;
  document.getElementById("modal-structured-comment").value = task.structuredComment || "";
  linkifyInto(document.getElementById("modal-structured-comment-preview"), task.structuredComment || "");

  const tbody = document.getElementById("breakdown-tbody");
  tbody.innerHTML = "";

  task.breakdown.forEach((item) => {
    const tr = el("tr", { "data-id": item.id });

    const checkbox = el("input", {
      type: "checkbox",
      onchange: (e) => updateBreakdownItem(task.id, item.id, { checklist: e.target.checked })
    });
    if (item.checklist) checkbox.setAttribute("checked", "checked");
    tr.appendChild(el("td", {}, checkbox));

    const nameCell = el("td", { class: "breakdown-name-cell" });
    nameCell.appendChild(dragHandle());
    const nameInput = el("input", {
      type: "text",
      value: item.name,
      onchange: (e) => updateBreakdownItem(task.id, item.id, { name: e.target.value })
    });
    nameCell.appendChild(nameInput);
    tr.appendChild(nameCell);

    const statusCell = el("td", {});
    statusCell.appendChild(
      selectEl(state.taskMeta.statusOptions, item.status, (val) => updateBreakdownItem(task.id, item.id, { status: val }), colorMapFor("tasks", "status"))
    );
    tr.appendChild(statusCell);

    const notesInput = el("input", {
      type: "text",
      value: item.notes || "",
      onchange: (e) => updateBreakdownItem(task.id, item.id, { notes: e.target.value })
    });
    tr.appendChild(el("td", {}, notesInput));

    tr.appendChild(renderChecklistCell(task, item));

    const deleteBtn = el("button", { class: "danger small-btn", onclick: () => deleteBreakdownItem(task.id, item.id) }, "Delete");
    tr.appendChild(el("td", {}, deleteBtn));

    tbody.appendChild(tr);
  });

  if (task.breakdown.length > 1) {
    enableDragReorder(tbody, (order) => reorderBreakdown(task.id, order), "tr");
  }
}

async function reorderBreakdown(taskId, order) {
  const task = await api("PUT", `/api/tasks/${taskId}/breakdown/reorder`, { order });
  const idx = state.tasks.findIndex((t) => t.id === taskId);
  if (idx !== -1) state.tasks[idx] = task;
  renderTaskModal();
}

function renderChecklistCell(task, item) {
  const td = el("td", { class: "checklist-cell" });
  const checklistItems = item.checklistItems || [];

  const list = el("ul", { class: "checklist-list" });
  checklistItems.forEach((ci) => {
    const li = el("li", { class: ci.done ? "done" : "", "data-id": ci.id });
    li.appendChild(dragHandle());
    const checkbox = el("input", {
      type: "checkbox",
      onchange: (e) => updateSubtaskChecklistItem(task.id, item.id, ci.id, { done: e.target.checked })
    });
    if (ci.done) checkbox.setAttribute("checked", "checked");
    li.appendChild(checkbox);
    li.appendChild(el("span", { class: "checklist-text" }, ci.text));
    li.appendChild(
      el("button", { class: "danger small-btn", onclick: () => deleteSubtaskChecklistItem(task.id, item.id, ci.id) }, "\u00d7")
    );
    list.appendChild(li);
  });
  td.appendChild(list);
  if (checklistItems.length > 1) {
    enableDragReorder(list, (order) => reorderSubtaskChecklist(task.id, item.id, order));
  }

  const addInput = el("input", { type: "text", placeholder: "Add step", class: "checklist-add-input" });
  const addBtn = el("button", {
    class: "small-btn",
    onclick: () => {
      const text = addInput.value.trim();
      if (!text) return;
      addSubtaskChecklistItem(task.id, item.id, text);
      addInput.value = "";
    }
  }, "Add");
  const addRow = el("div", { class: "checklist-add-row" }, [addInput, addBtn]);
  td.appendChild(addRow);

  if (state.checklistTemplates.length) {
    const templateSelect = el("select", {
      class: "checklist-template-select",
      onchange: (e) => {
        const templateId = e.target.value;
        e.target.value = "";
        if (!templateId) return;
        applyChecklistTemplate(task.id, item.id, templateId);
      }
    });
    templateSelect.appendChild(el("option", { value: "" }, "Apply template..."));
    state.checklistTemplates.forEach((tpl) => {
      templateSelect.appendChild(el("option", { value: tpl.id }, tpl.name));
    });
    td.appendChild(templateSelect);
  }

  return td;
}

async function addSubtaskChecklistItem(taskId, itemId, text) {
  const task = await api("POST", `/api/tasks/${taskId}/breakdown/${itemId}/checklist`, { text });
  const idx = state.tasks.findIndex((t) => t.id === taskId);
  if (idx !== -1) state.tasks[idx] = task;
  renderTaskModal();
}

async function updateSubtaskChecklistItem(taskId, itemId, checklistItemId, updates) {
  const task = await api("PUT", `/api/tasks/${taskId}/breakdown/${itemId}/checklist/${checklistItemId}`, updates);
  const idx = state.tasks.findIndex((t) => t.id === taskId);
  if (idx !== -1) state.tasks[idx] = task;
  renderTaskModal();
}

async function deleteSubtaskChecklistItem(taskId, itemId, checklistItemId) {
  const task = await api("DELETE", `/api/tasks/${taskId}/breakdown/${itemId}/checklist/${checklistItemId}`);
  const idx = state.tasks.findIndex((t) => t.id === taskId);
  if (idx !== -1) state.tasks[idx] = task;
  renderTaskModal();
}

async function reorderSubtaskChecklist(taskId, itemId, order) {
  const task = await api("PUT", `/api/tasks/${taskId}/breakdown/${itemId}/checklist/reorder`, { order });
  const idx = state.tasks.findIndex((t) => t.id === taskId);
  if (idx !== -1) state.tasks[idx] = task;
  renderTaskModal();
}

async function applyChecklistTemplate(taskId, itemId, templateId) {
  const template = state.checklistTemplates.find((t) => t.id === templateId);
  if (!template) return;
  for (const templateItem of template.items) {
    await addSubtaskChecklistItem(taskId, itemId, templateItem.text);
  }
}

// ---------- Checklist Templates ----------

async function loadChecklistMeta() {
  state.checklistMeta = await api("GET", "/api/checklist-templates/meta");
  const visibilitySelect = document.getElementById("new-checklist-visibility");
  visibilitySelect.innerHTML = "";
  (state.checklistMeta.visibilityOptions || ["Team", "Private"]).forEach((opt) =>
    visibilitySelect.appendChild(el("option", { value: opt }, opt))
  );
}

async function loadChecklistTemplates() {
  state.checklistTemplates = await api("GET", "/api/checklist-templates");
  renderChecklistTemplates();
  renderTaskModal();
}

function renderChecklistTemplates() {
  const container = document.getElementById("checklists-list");
  if (!container) return;
  container.innerHTML = "";

  state.checklistTemplates.forEach((template) => {
    const card = el("div", { class: "checklist-template-card" });

    const nameInput = el("input", {
      type: "text",
      value: template.name,
      onchange: (e) => updateChecklistTemplate(template.id, { name: e.target.value })
    });
    const header = el("div", { class: "checklist-template-header" }, [
      nameInput,
      el("span", { class: "hint" }, template.owner ? `by ${template.owner}` : ""),
      visibilityControl(template, state.checklistMeta.visibilityOptions, (val) =>
        updateChecklistTemplate(template.id, { visibility: val })
      ),
      el("button", { class: "danger small-btn", onclick: () => deleteChecklistTemplate(template.id) }, "Delete")
    ]);
    card.appendChild(header);

    const itemsText = (template.items || []).map((i) => i.text).join("\n");
    const itemsArea = el("textarea", {
      rows: String(Math.max(3, (template.items || []).length + 1)),
      placeholder: "One checklist step per line",
      onchange: (e) =>
        updateChecklistTemplate(template.id, {
          items: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean)
        })
    });
    itemsArea.value = itemsText;
    card.appendChild(itemsArea);

    container.appendChild(card);
  });
}

async function updateChecklistTemplate(id, updates) {
  const template = await api("PUT", `/api/checklist-templates/${id}`, updates);
  const idx = state.checklistTemplates.findIndex((t) => t.id === id);
  if (idx !== -1) state.checklistTemplates[idx] = template;
  renderChecklistTemplates();
  renderTaskModal();
}

async function deleteChecklistTemplate(id) {
  if (!confirm("Delete this checklist template? This cannot be undone.")) return;
  await api("DELETE", `/api/checklist-templates/${id}`);
  await loadChecklistTemplates();
}

document.getElementById("new-checklist-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("new-checklist-name").value.trim();
  const visibility = document.getElementById("new-checklist-visibility").value;
  if (!name) return;
  await api("POST", "/api/checklist-templates", { name, items: [], visibility });
  document.getElementById("new-checklist-name").value = "";
  await loadChecklistTemplates();
});

// ---------- Notebook ----------

async function loadNotesMeta() {
  state.notesMeta = await api("GET", "/api/notes/meta");
  const visibilitySelect = document.getElementById("new-note-visibility");
  visibilitySelect.innerHTML = "";
  (state.notesMeta.visibilityOptions || ["Team", "Private"]).forEach((opt) => {
    const optionEl = el("option", { value: opt }, opt);
    if (opt === "Private") optionEl.setAttribute("selected", "selected");
    visibilitySelect.appendChild(optionEl);
  });
}

async function loadNotes() {
  state.notes = await api("GET", "/api/notes");
  renderNotebook();
}

function renderNotebook() {
  const container = document.getElementById("notebook-list");
  if (!container) return;
  container.innerHTML = "";

  state.notes.forEach((note) => {
    const card = el("div", { class: "checklist-template-card" });

    const titleInput = el("input", {
      type: "text",
      value: note.title,
      onchange: (e) => updateNote(note.id, { title: e.target.value })
    });
    const header = el("div", { class: "checklist-template-header" }, [
      titleInput,
      el("span", { class: "hint" }, note.owner ? `by ${note.owner}` : ""),
      visibilityControl(note, state.notesMeta.visibilityOptions, (val) => updateNote(note.id, { visibility: val })),
      el("button", { class: "danger small-btn", onclick: () => deleteNote(note.id) }, "Delete")
    ]);
    card.appendChild(header);

    const bodyArea = el("textarea", {
      rows: "6",
      placeholder: "Write your note here...",
      onchange: (e) => updateNote(note.id, { body: e.target.value })
    });
    bodyArea.value = note.body || "";
    card.appendChild(bodyArea);

    container.appendChild(card);
  });
}

async function updateNote(id, updates) {
  const note = await api("PUT", `/api/notes/${id}`, updates);
  const idx = state.notes.findIndex((n) => n.id === id);
  if (idx !== -1) state.notes[idx] = note;
  renderNotebook();
}

async function deleteNote(id) {
  if (!confirm("Delete this note? This cannot be undone.")) return;
  await api("DELETE", `/api/notes/${id}`);
  await loadNotes();
}

document.getElementById("new-note-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("new-note-title").value.trim();
  const visibility = document.getElementById("new-note-visibility").value;
  if (!title) return;
  await api("POST", "/api/notes", { title, body: "", visibility });
  document.getElementById("new-note-title").value = "";
  await loadNotes();
});

// ---------- Dropdown Options ----------

const OPTION_LIST_CONFIG = [
  { entity: "tasks", field: "status", label: "Task Status" },
  { entity: "tasks", field: "type", label: "Task Type" },
  { entity: "tasks", field: "priority", label: "Task Priority" },
  { entity: "bugs", field: "status", label: "Bug Status" },
  { entity: "bugs", field: "type", label: "Bug Type" },
  { entity: "bugs", field: "severity", label: "Bug Severity" }
];

async function loadOptionLists() {
  state.optionLists = await api("GET", "/api/option-lists");
  renderOptionsTab();
}

async function refreshAfterOptionListChange(entity) {
  await loadOptionLists();
  if (entity === "tasks") {
    await loadTaskMeta();
    renderTasks();
    renderPrioritization();
  } else {
    await loadBugMeta();
    renderBugs();
    renderPrioritization();
  }
}

async function mutateOptionList(entity, field, method, path, body) {
  try {
    await api(method, path, body);
    await refreshAfterOptionListChange(entity);
  } catch (err) {
    alert(err.message);
  }
}

function renderOptionsTab() {
  const container = document.getElementById("options-list");
  if (!container) return;
  container.innerHTML = "";

  OPTION_LIST_CONFIG.forEach(({ entity, field, label }) => {
    const entries = (state.optionLists[entity] && state.optionLists[entity][field]) || [];
    const card = el("div", { class: "checklist-template-card" });
    card.appendChild(el("div", { class: "checklist-template-header" }, [el("strong", {}, label)]));

    const list = el("ul", { class: "checklist-list" });
    entries.forEach(({ value, color }) => {
      const li = el("li", {});
      const input = el("input", { type: "text", value });
      const colorInput = el("input", {
        type: "color",
        value: color || "#eeeeee",
        class: "option-color-input",
        title: "Badge color",
        onchange: (e) =>
          mutateOptionList(
            entity,
            field,
            "PUT",
            `/api/option-lists/${entity}/${field}/${encodeURIComponent(value)}/color`,
            { color: e.target.value }
          )
      });
      const saveBtn = el(
        "button",
        {
          class: "small-btn",
          onclick: () => {
            const newValue = input.value.trim();
            if (!newValue || newValue === value) return;
            mutateOptionList(
              entity,
              field,
              "PUT",
              `/api/option-lists/${entity}/${field}/${encodeURIComponent(value)}`,
              { value: newValue }
            );
          }
        },
        "Save"
      );
      const deleteBtn = el(
        "button",
        {
          class: "danger small-btn",
          onclick: () =>
            mutateOptionList(entity, field, "DELETE", `/api/option-lists/${entity}/${field}/${encodeURIComponent(value)}`)
        },
        "Delete"
      );
      li.appendChild(colorInput);
      li.appendChild(input);
      li.appendChild(saveBtn);
      li.appendChild(deleteBtn);
      list.appendChild(li);
    });
    card.appendChild(list);

    const addInput = el("input", { type: "text", placeholder: "New option" });
    const addColorInput = el("input", { type: "color", class: "option-color-input", title: "Badge color", value: "#eeeeee" });
    const addForm = el("div", { class: "inline-form" }, [
      addColorInput,
      addInput,
      el(
        "button",
        {
          onclick: () => {
            const value = addInput.value.trim();
            if (!value) return;
            mutateOptionList(entity, field, "POST", `/api/option-lists/${entity}/${field}`, { value, color: addColorInput.value });
            addInput.value = "";
            addColorInput.value = "#eeeeee";
          }
        },
        "Add"
      )
    ]);
    card.appendChild(addForm);

    container.appendChild(card);
  });
}

async function updateBreakdownItem(taskId, itemId, updates) {
  const task = await api("PUT", `/api/tasks/${taskId}/breakdown/${itemId}`, updates);
  const idx = state.tasks.findIndex((t) => t.id === taskId);
  if (idx !== -1) state.tasks[idx] = task;
  renderTaskModal();
}

async function deleteBreakdownItem(taskId, itemId) {
  const task = await api("DELETE", `/api/tasks/${taskId}/breakdown/${itemId}`);
  const idx = state.tasks.findIndex((t) => t.id === taskId);
  if (idx !== -1) state.tasks[idx] = task;
  renderTaskModal();
}

document.getElementById("new-breakdown-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("new-breakdown-name");
  const name = nameInput.value.trim();
  if (!name || !state.openModalTaskId) return;
  const task = await api("POST", `/api/tasks/${state.openModalTaskId}/breakdown`, { name });
  const idx = state.tasks.findIndex((t) => t.id === state.openModalTaskId);
  if (idx !== -1) state.tasks[idx] = task;
  nameInput.value = "";
  renderTaskModal();
});

document.getElementById("generate-comment-btn").addEventListener("click", async () => {
  if (!state.openModalTaskId) return;
  const task = await api("POST", `/api/tasks/${state.openModalTaskId}/comment`);
  const idx = state.tasks.findIndex((t) => t.id === state.openModalTaskId);
  if (idx !== -1) state.tasks[idx] = task;
  renderTaskModal();
  renderTasks();
});

document.getElementById("save-comment-btn").addEventListener("click", async () => {
  if (!state.openModalTaskId) return;
  const value = document.getElementById("modal-structured-comment").value;
  await updateTask(state.openModalTaskId, { structuredComment: value });
});

document.getElementById("modal-structured-comment").addEventListener("input", (e) => {
  linkifyInto(document.getElementById("modal-structured-comment-preview"), e.target.value);
});

// ---------- Bug Tracking ----------

async function loadBugMeta() {
  state.bugMeta = await api("GET", "/api/bugs/meta");
  const typeSelect = document.getElementById("new-bug-type");
  const severitySelect = document.getElementById("new-bug-severity");
  typeSelect.innerHTML = "";
  severitySelect.innerHTML = "";
  state.bugMeta.typeOptions.forEach((opt) => typeSelect.appendChild(el("option", { value: opt }, opt)));
  state.bugMeta.severityOptions.forEach((opt) => severitySelect.appendChild(el("option", { value: opt }, opt)));

  const visibilitySelect = document.getElementById("new-bug-visibility");
  visibilitySelect.innerHTML = "";
  (state.bugMeta.visibilityOptions || ["Team", "Private"]).forEach((opt) =>
    visibilitySelect.appendChild(el("option", { value: opt }, opt))
  );
}

async function loadBugs() {
  state.bugs = await api("GET", "/api/bugs");
  renderBugs();
  renderPrioritization();
  renderAllTableFilters();
}

function renderBugs() {
  const tbody = document.getElementById("bugs-tbody");
  tbody.innerHTML = "";

  applyTableSortAndFilter(filterByOwner(state.bugs), "bugs", ["title", "comments"], bugColorResolver).forEach((bug, index) => {
    const tr = el("tr", { "data-id": bug.id });
    tr.appendChild(el("td", {}, String(index + 1)));

    const titleInput = el("input", {
      type: "text",
      value: bug.title,
      onchange: (e) => updateBug(bug.id, { title: e.target.value })
    });
    tr.appendChild(el("td", {}, titleInput));

    const trelloInput = el("input", {
      type: "text",
      value: bug.trelloCard || "",
      placeholder: "Trello link",
      onchange: (e) => updateBug(bug.id, { trelloCard: e.target.value })
    });
    tr.appendChild(el("td", {}, trelloInput));

    const typeCell = el("td", {});
    typeCell.appendChild(selectEl(state.bugMeta.typeOptions, bug.type, (val) => updateBug(bug.id, { type: val }), colorMapFor("bugs", "type")));
    tr.appendChild(typeCell);

    const severityCell = el("td", {});
    severityCell.appendChild(
      selectEl(state.bugMeta.severityOptions, bug.severity, (val) => updateBug(bug.id, { severity: val }), colorMapFor("bugs", "severity"))
    );
    tr.appendChild(severityCell);

    const loeInput = el("input", {
      type: "number",
      min: "0",
      value: bug.loe || 0,
      class: "loe-input",
      onchange: (e) => updateBug(bug.id, { loe: e.target.value })
    });
    tr.appendChild(el("td", {}, loeInput));

    const deadlineInput = el("input", {
      type: "date",
      value: bug.deadline || "",
      onchange: (e) => updateBug(bug.id, { deadline: e.target.value })
    });
    tr.appendChild(el("td", {}, deadlineInput));

    tr.appendChild(startToggleCell(bug, (val) => updateBug(bug.id, { date: val })));

    tr.appendChild(commentsCell(bug.comments, (val) => updateBug(bug.id, { comments: val })));

    const statusCell = el("td", {});
    statusCell.appendChild(
      selectEl(state.bugMeta.statusOptions, bug.status, (val) => updateBug(bug.id, { status: val }), colorMapFor("bugs", "status"))
    );
    tr.appendChild(statusCell);

    tr.appendChild(ownerCell(state.bugs, bug.owner, (val) => updateBug(bug.id, { owner: val })));
    tr.appendChild(
      visibilityCell(bug, state.bugMeta.visibilityOptions, (val) => updateBug(bug.id, { visibility: val }))
    );

    const deleteBtn = el("button", { class: "danger", onclick: () => deleteBug(bug.id) }, "Delete");
    tr.appendChild(el("td", {}, deleteBtn));

    tbody.appendChild(tr);
  });
}

async function updateBug(id, updates) {
  const bug = await api("PUT", `/api/bugs/${id}`, updates);
  const idx = state.bugs.findIndex((b) => b.id === id);
  if (idx !== -1) state.bugs[idx] = bug;
  renderBugs();
  renderPrioritization();
  if ("deadline" in updates) {
    if (state.dailyView === "week" && state.currentWeekStart) await loadWeek(state.currentWeekStart);
    if (state.dailyView === "month" && state.currentYearMonth) await loadMonth(state.currentYearMonth);
  }
}

async function deleteBug(id) {
  if (!confirm("Delete this bug? This cannot be undone.")) return;
  await api("DELETE", `/api/bugs/${id}`);
  await loadBugs();
}

document.getElementById("new-bug-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("new-bug-title").value.trim();
  const type = document.getElementById("new-bug-type").value;
  const severity = document.getElementById("new-bug-severity").value;
  const visibility = document.getElementById("new-bug-visibility").value;
  if (!title) return;
  await api("POST", "/api/bugs", { title, type, severity, visibility });
  document.getElementById("new-bug-title").value = "";
  await loadBugs();
});

// ---------- Daily Goals ----------

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function startOfWeekForDateClient(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - date.getDay());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function currentYearMonthClient() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function loadDailyGoalsMeta() {
  state.dailyGoalsMeta = await api("GET", "/api/daily-goals/meta");
}

function initDailyGoalsNav() {
  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-toggle-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".daily-view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      document.getElementById(`${view}-view`).classList.add("active");
      state.dailyView = view;
      if (view === "week") loadWeek(state.currentWeekStart);
      if (view === "month") loadMonth(state.currentYearMonth);
    });
  });

  document.getElementById("prev-week-btn").addEventListener("click", () => shiftWeek(-1));
  document.getElementById("next-week-btn").addEventListener("click", () => shiftWeek(1));
  document.getElementById("today-week-btn").addEventListener("click", () => {
    state.currentWeekStart = startOfWeekForDateClient(todayStr());
    loadWeek(state.currentWeekStart);
  });

  document.getElementById("prev-month-btn").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("next-month-btn").addEventListener("click", () => shiftMonth(1));
  document.getElementById("today-month-btn").addEventListener("click", () => {
    state.currentYearMonth = currentYearMonthClient();
    loadMonth(state.currentYearMonth);
  });

  document.getElementById("day-modal-close").addEventListener("click", closeDayModal);
  document.getElementById("day-modal").addEventListener("click", (e) => {
    if (e.target.id === "day-modal") closeDayModal();
  });
}

async function shiftWeek(delta) {
  const res = await api("GET", `/api/daily-goals/week/${state.currentWeekStart}/adjacent/${delta > 0 ? "next" : "prev"}`);
  state.currentWeekStart = res.weekStart;
  loadWeek(state.currentWeekStart);
}

async function shiftMonth(delta) {
  const res = await api("GET", `/api/daily-goals/month/${state.currentYearMonth}/adjacent/${delta > 0 ? "next" : "prev"}`);
  state.currentYearMonth = res.yearMonth;
  loadMonth(state.currentYearMonth);
}

async function initDailyGoals() {
  const [weekRes, monthRes] = await Promise.all([
    api("GET", "/api/daily-goals/current-week"),
    api("GET", "/api/daily-goals/current-month")
  ]);
  state.currentWeekStart = weekRes.weekStart;
  state.currentYearMonth = monthRes.yearMonth;
  state.dailyView = "week";
  await loadWeek(state.currentWeekStart);
}

function renderTaskDropdownsInDailyGoals() {
  if (!document.getElementById("daily-goals").classList.contains("active")) return;
  if (state.dailyView === "week") renderWeek();
}

// --- Week view ---

async function loadWeek(weekStart) {
  state.weekData = await api("GET", `/api/daily-goals/week/${weekStart}`);
  initDefaultCollapsedDays();
  renderWeek();
}

function initDefaultCollapsedDays() {
  if (!state.weekData) return;
  const today = todayStr();
  state.weekData.days.forEach((day) => {
    if (state.collapsedDaysInitialized.has(day.date)) return;
    state.collapsedDaysInitialized.add(day.date);
    if (day.date !== today) state.collapsedDays.add(day.date);
  });
}

function renderWeek() {
  const headerEl = document.getElementById("week-header");
  const daysEl = document.getElementById("daily-goals-days");
  headerEl.innerHTML = "";
  daysEl.innerHTML = "";

  const week = state.weekData;
  if (!week) return;

  const mainGoalInput = el("input", {
    type: "text",
    value: week.mainGoal || "",
    onchange: (e) => updateWeekMeta({ mainGoal: e.target.value })
  });
  const focusInput = el("input", {
    type: "text",
    value: week.weeklyFocus || "",
    onchange: (e) => updateWeekMeta({ weeklyFocus: e.target.value })
  });
  const notesInput = el("textarea", { rows: "2", onchange: (e) => updateWeekMeta({ weeklyNotes: e.target.value }) });
  notesInput.value = week.weeklyNotes || "";

  headerEl.appendChild(el("div", {}, [el("label", {}, `Week of ${week.weekStart} \u2014 Main Weekly Goal`), mainGoalInput]));
  headerEl.appendChild(el("div", {}, [el("label", {}, "Weekly Focus"), focusInput]));
  headerEl.appendChild(el("div", {}, [el("label", {}, "Weekly Notes"), notesInput]));

  const weekProgress = week.days.reduce(
    (sum, day) => {
      const p = dayCombinedProgress(day);
      return { done: sum.done + p.done, total: sum.total + p.total };
    },
    { done: 0, total: 0 }
  );
  headerEl.appendChild(progressWidget(weekProgress.done, weekProgress.total, "items done this week"));

  week.days.forEach((day) => {
    const collapsed = state.collapsedDays.has(day.date);
    const card = el("div", { class: `day-card${day.disabled ? " disabled" : ""}` });
    const dayProgress = dayCombinedProgress(day);
    const header = el("div", { class: "day-card-header", onclick: () => toggleDayCollapsed(day.date) }, [
      el("span", { class: `collapse-arrow${collapsed ? " collapsed" : ""}` }, "\u25be"),
      el("span", {}, `${day.dayName} - ${day.date}${day.disabled ? " (past)" : ""}`),
      dayProgress.total ? el("span", { class: "day-progress-badge" }, `${percentOf(dayProgress.done, dayProgress.total)}%`) : null
    ]);
    card.appendChild(header);
    if (!collapsed) {
      const body = el("div", { class: "day-card-body" });
      body.appendChild(renderDayContent(day));
      card.appendChild(body);
    }
    daysEl.appendChild(card);
  });
}

function toggleDayCollapsed(date) {
  if (state.collapsedDays.has(date)) state.collapsedDays.delete(date);
  else state.collapsedDays.add(date);
  renderWeek();
}

async function updateWeekMeta(updates) {
  state.weekData = await api("PUT", `/api/daily-goals/week/${state.currentWeekStart}`, updates);
}

// --- Month view ---

async function loadMonth(yearMonth) {
  state.monthData = await api("GET", `/api/daily-goals/month/${yearMonth}`);
  renderMonth();
}

function renderMonth() {
  const month = state.monthData;
  if (!month) return;

  document.getElementById("month-label").textContent = month.label;

  const grid = document.getElementById("month-grid");
  grid.innerHTML = "";

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu"];
  dayNames.forEach((name) => grid.appendChild(el("div", { class: "month-grid-day-name" }, name)));

  const today = todayStr();

  month.days.forEach((day) => {
    const classes = ["month-day-cell"];
    if (!day.isCurrentMonth) classes.push("other-month");
    if (day.disabled) classes.push("past");
    if (day.date === today) classes.push("today");

    const cell = el("div", { class: classes.join(" "), onclick: () => openDayModal(day.date) });
    const dayProgress = monthDayCombinedProgress(day);
    const numberRow = el("div", { class: "month-day-number-row" }, [
      el("span", { class: "month-day-number" }, String(Number(day.date.split("-")[2]))),
      dayProgress.total ? el("span", { class: "day-progress-badge" }, `${percentOf(dayProgress.done, dayProgress.total)}%`) : null
    ]);
    cell.appendChild(numberRow);

    if (day.entryCount > 0) {
      cell.appendChild(el("span", { class: "month-day-indicator entries" }, `${day.entryDoneCount}/${day.entryCount} goals`));
    }
    if (day.checklistCount > 0) {
      cell.appendChild(el("span", { class: "month-day-indicator checklist" }, `${day.checklistDoneCount}/${day.checklistCount} checklist`));
    }
    if (day.dueCount > 0) {
      cell.appendChild(el("span", { class: "month-day-indicator due" }, `${day.dueCount} due`));
    }
    if (day.recurringCount > 0) {
      cell.appendChild(
        el("span", { class: "month-day-indicator recurring" }, `${day.recurringDoneCount}/${day.recurringCount} recurring`)
      );
    }
    if (day.scheduledCount > 0) {
      cell.appendChild(el("span", { class: "month-day-indicator scheduled" }, `${day.scheduledCount} in progress`));
    }

    grid.appendChild(cell);
  });
}

// --- Day modal (Month View day detail) ---

function openDayModal(date) {
  state.dayModalDate = date;
  api("GET", `/api/daily-goals/day/${date}`).then((day) => {
    document.getElementById("day-modal-title").textContent = `${day.dayName} - ${day.date}${day.disabled ? " (past)" : ""}`;
    const content = document.getElementById("day-modal-content");
    content.innerHTML = "";
    content.appendChild(renderDayContent(day));
    document.getElementById("day-modal").classList.remove("hidden");
  });
}

function closeDayModal() {
  state.dayModalDate = null;
  document.getElementById("day-modal").classList.add("hidden");
}

/**
 * Renders the shared day content (goal entries table + add-entry form,
 * plus a checklist) used by both the inline Week View day cards and the
 * Month View day detail modal.
 */
function renderDayContent(day) {
  const container = el("div", {});
  const taskOrBugPriorityColors = mergeColorMaps(colorMapFor("tasks", "priority"), colorMapFor("bugs", "severity"));

  if (day.dueTasks && day.dueTasks.length) {
    const dueBox = el("div", { class: "due-tasks" });
    dueBox.appendChild(el("h3", {}, "Projects Due"));
    const list = el("ul", { class: "due-tasks-list" });
    day.dueTasks.forEach((task) => {
      const nameSpan = el(
        "span",
        { class: "name-cell", onclick: () => (task.type === "Bug" ? switchToBugTab(task.id) : openTaskModal(task.id)) },
        `${task.name}${task.type === "Bug" ? " (Bug)" : ""}`
      );
      list.appendChild(el("li", {}, [badge(task.priority, taskOrBugPriorityColors), nameSpan]));
    });
    dueBox.appendChild(list);
    container.appendChild(dueBox);
  }

  if (day.scheduledTasks && day.scheduledTasks.length) {
    const scheduledBox = el("div", { class: "scheduled-tasks" });
    scheduledBox.appendChild(el("h3", {}, "In Progress (by LOE)"));
    const list = el("ul", { class: "scheduled-tasks-list" });
    day.scheduledTasks.forEach((task) => {
      const done = task.status === "Done";
      const checkbox = el("input", {
        type: "checkbox",
        onchange: (e) => toggleScheduledTaskDone(day.date, task, e.target.checked)
      });
      if (done) checkbox.setAttribute("checked", "checked");
      const nameSpan = el(
        "span",
        { class: "name-cell", onclick: () => (task.type === "Bug" ? switchToBugTab(task.id) : openTaskModal(task.id)) },
        `${task.name}${task.type === "Bug" ? " (Bug)" : ""}`
      );
      const li = el("li", { class: done ? "done" : "" }, [checkbox, badge(task.priority, taskOrBugPriorityColors), nameSpan]);
      const subBadge = subProgressBadge(taskSubProgress(task));
      if (subBadge) li.appendChild(subBadge);
      list.appendChild(li);
    });
    scheduledBox.appendChild(list);
    container.appendChild(scheduledBox);
  }

  if (day.recurringTasks && day.recurringTasks.length) {
    const recurringBox = el("div", { class: "recurring-tasks" });
    recurringBox.appendChild(el("h3", {}, "Recurring Tasks"));
    const list = el("ul", { class: "recurring-tasks-list" });
    day.recurringTasks.forEach((task) => {
      const checkbox = el("input", {
        type: "checkbox",
        onchange: (e) => toggleRecurringDone(day.date, task.id, e.target.checked)
      });
      if (task.done) checkbox.setAttribute("checked", "checked");
      const nameText = task.time ? `${task.time} \u2013 ${task.name}` : task.name;
      const li = el("li", { class: task.done ? "done" : "" }, [
        checkbox,
        el("span", { class: "recurring-task-name" }, nameText)
      ]);
      if (task.comments) {
        const commentSpan = el("span", { class: "hint" });
        commentSpan.appendChild(document.createTextNode("("));
        const linkSpan = el("span", {});
        linkifyInto(linkSpan, task.comments);
        commentSpan.appendChild(linkSpan);
        commentSpan.appendChild(document.createTextNode(")"));
        li.appendChild(commentSpan);
      }
      list.appendChild(li);
    });
    recurringBox.appendChild(list);
    container.appendChild(recurringBox);
  }

  const table = el("table", { class: "data-table small" });
  table.appendChild(
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Time"),
      el("th", {}, "Goal"),
      el("th", {}, "Task"),
      el("th", {}, "Priority"),
      el("th", {}, "Status"),
      el("th", {}, "Done"),
      el("th", {}, "Notes"),
      el("th", {}, "Move"),
      el("th", {}, "")
    ]))
  );
  const tbody = el("tbody", {});
  day.entries.forEach((entry) => {
    tbody.appendChild(renderEntryRow(day.date, entry));
    const checklistRow = renderEntryChecklistRow(day.date, entry);
    if (checklistRow) tbody.appendChild(checklistRow);
  });
  table.appendChild(tbody);
  container.appendChild(el("div", { class: "table-scroll" }, table));

  if (!day.disabled) {
    const form = el("form", { class: "inline-form", style: "padding:10px 0;" });
    const timeInput = el("input", { type: "time" });
    const goalInput = el("input", { type: "text", placeholder: "Goal" });
    const addBtn = el("button", { type: "submit" }, "Add Entry");
    form.appendChild(timeInput);
    form.appendChild(goalInput);
    form.appendChild(addBtn);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await api("POST", `/api/daily-goals/day/${day.date}/entries`, { time: timeInput.value, goal: goalInput.value });
      await afterDailyGoalsChange(day.date);
    });
    container.appendChild(form);
  }

  container.appendChild(el("h3", {}, "Checklist"));
  const checklist = el("ul", { class: "checklist-list" });
  day.checklist.forEach((item) => checklist.appendChild(renderChecklistRow(day.date, item)));
  container.appendChild(checklist);
  if (!day.disabled && day.checklist.length > 1) {
    enableDragReorder(checklist, (order) => reorderChecklist(day.date, order));
  }

  if (!day.disabled) {
    const checklistForm = el("form", { class: "inline-form" });
    const textInput = el("input", { type: "text", placeholder: "Checklist item" });
    const addBtn = el("button", { type: "submit" }, "Add Item");
    checklistForm.appendChild(textInput);
    checklistForm.appendChild(addBtn);
    checklistForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = textInput.value.trim();
      if (!text) return;
      await api("POST", `/api/daily-goals/day/${day.date}/checklist`, { text });
      await afterDailyGoalsChange(day.date);
    });
    container.appendChild(checklistForm);
  }

  return container;
}

function renderEntryRow(date, entry) {
  const tr = el("tr", {});

  const timeInput = el("input", {
    type: "time",
    value: entry.time || "",
    onchange: (e) => updateEntry(date, entry.id, { time: e.target.value })
  });
  tr.appendChild(el("td", {}, timeInput));

  const goalInput = el("input", {
    type: "text",
    value: entry.goal || "",
    onchange: (e) => updateEntry(date, entry.id, { goal: e.target.value })
  });
  tr.appendChild(el("td", {}, goalInput));

  const taskSelect = el("select", { onchange: (e) => updateEntry(date, entry.id, { taskId: e.target.value }) });
  taskSelect.appendChild(el("option", { value: "" }, "(none)"));
  state.tasks.forEach((task) => {
    const opt = el("option", { value: task.id }, task.name);
    if (task.id === entry.taskId) opt.setAttribute("selected", "selected");
    taskSelect.appendChild(opt);
  });
  tr.appendChild(el("td", {}, taskSelect));

  const priorityCell = el("td", {});
  priorityCell.appendChild(
    selectEl(state.dailyGoalsMeta.priorityOptions, entry.priority, (val) => updateEntry(date, entry.id, { priority: val }), PRIORITY_COLORS)
  );
  tr.appendChild(priorityCell);

  const statusCell = el("td", {});
  statusCell.appendChild(
    selectEl(state.dailyGoalsMeta.statusOptions, entry.status, (val) => updateEntry(date, entry.id, { status: val }), DAILY_STATUS_COLORS)
  );
  tr.appendChild(statusCell);

  const doneCheckbox = el("input", {
    type: "checkbox",
    onchange: (e) => updateEntry(date, entry.id, { done: e.target.checked })
  });
  if (entry.done) doneCheckbox.setAttribute("checked", "checked");
  tr.appendChild(el("td", {}, doneCheckbox));

  const notesInput = el("input", {
    type: "text",
    value: entry.notes || "",
    onchange: (e) => updateEntry(date, entry.id, { notes: e.target.value })
  });
  tr.appendChild(el("td", {}, notesInput));

  const moveDateInput = el("input", { type: "date", class: "move-date-input" });
  const moveBtn = el(
    "button",
    {
      class: "small-btn",
      onclick: () => {
        if (!moveDateInput.value) return;
        moveEntry(date, entry.id, moveDateInput.value);
      }
    },
    "Move"
  );
  tr.appendChild(el("td", {}, el("div", { class: "move-entry-wrap" }, [moveDateInput, moveBtn])));

  const deleteBtn = el("button", { class: "danger small-btn", onclick: () => deleteEntry(date, entry.id) }, "Delete");
  tr.appendChild(el("td", {}, deleteBtn));

  return tr;
}

/**
 * If a day entry is linked to a Task that has sub-tasks with their own
 * checklists (see Checklists feature), renders an extra row underneath the
 * entry showing those checklist items so they can be checked off directly
 * from the Daily Goals view without opening the Task detail modal.
 */
function renderEntryChecklistRow(date, entry) {
  if (!entry.taskId) return null;
  const task = state.tasks.find((t) => t.id === entry.taskId);
  if (!task) return null;

  const breakdownItemsWithChecklists = (task.breakdown || []).filter(
    (item) => item.checklistItems && item.checklistItems.length
  );
  if (!breakdownItemsWithChecklists.length) return null;

  const totalItems = breakdownItemsWithChecklists.reduce((sum, b) => sum + b.checklistItems.length, 0);
  const doneItems = breakdownItemsWithChecklists.reduce(
    (sum, b) => sum + b.checklistItems.filter((ci) => ci.done).length,
    0
  );
  const collapsed = state.collapsedEntryChecklists.has(entry.id);

  const td = el("td", { colspan: "8", class: "entry-checklist-cell" });
  const toggle = el(
    "div",
    { class: "entry-checklist-toggle", onclick: () => toggleEntryChecklistCollapsed(entry.id, date) },
    [
      el("span", { class: `collapse-arrow${collapsed ? " collapsed" : ""}` }, "\u25be"),
      el("span", {}, `Checklist (${doneItems}/${totalItems} \u2014 ${percentOf(doneItems, totalItems)}%)`)
    ]
  );
  td.appendChild(toggle);

  if (!collapsed) {
    breakdownItemsWithChecklists.forEach((breakdownItem) => {
      const group = el("div", { class: "entry-checklist-group" });
      group.appendChild(el("div", { class: "entry-checklist-label" }, breakdownItem.name));
      const list = el("ul", { class: "checklist-list" });
      breakdownItem.checklistItems.forEach((ci) => {
        const li = el("li", { class: ci.done ? "done" : "" });
        const checkbox = el("input", {
          type: "checkbox",
          onchange: async (e) => {
            await updateSubtaskChecklistItem(task.id, breakdownItem.id, ci.id, { done: e.target.checked });
            await afterDailyGoalsChange(date);
          }
        });
        if (ci.done) checkbox.setAttribute("checked", "checked");
        li.appendChild(checkbox);
        li.appendChild(el("span", { class: "checklist-text" }, ci.text));
        list.appendChild(li);
      });
      group.appendChild(list);
      td.appendChild(group);
    });
  }

  return el("tr", { class: "entry-checklist-row" }, td);
}

function toggleEntryChecklistCollapsed(entryId, date) {
  if (state.collapsedEntryChecklists.has(entryId)) state.collapsedEntryChecklists.delete(entryId);
  else state.collapsedEntryChecklists.add(entryId);
  if (state.dayModalDate === date) openDayModal(date);
  else if (state.dailyView === "week") renderWeek();
}

async function updateEntry(date, entryId, updates) {
  await api("PUT", `/api/daily-goals/day/${date}/entries/${entryId}`, updates);
  await afterDailyGoalsChange(date);
}

async function deleteEntry(date, entryId) {
  await api("DELETE", `/api/daily-goals/day/${date}/entries/${entryId}`);
  await afterDailyGoalsChange(date);
}

async function moveEntry(date, entryId, targetDate) {
  if (!targetDate || targetDate === date) return;
  try {
    await api("POST", `/api/daily-goals/day/${date}/entries/${entryId}/move`, { targetDate });
  } catch (err) {
    alert(err.message || "Could not move entry.");
    return;
  }
  await afterDailyGoalsChange(date);
}

function renderChecklistRow(date, item) {
  const li = el("li", { class: item.done ? "done" : "", "data-id": item.id });
  li.appendChild(dragHandle());

  const checkbox = el("input", {
    type: "checkbox",
    onchange: (e) => updateChecklistItem(date, item.id, { done: e.target.checked })
  });
  if (item.done) checkbox.setAttribute("checked", "checked");
  li.appendChild(checkbox);

  const textInput = el("input", {
    type: "text",
    class: "checklist-text",
    value: item.text,
    onchange: (e) => updateChecklistItem(date, item.id, { text: e.target.value })
  });
  li.appendChild(textInput);

  const deleteBtn = el("button", { class: "danger small-btn", onclick: () => deleteChecklistItem(date, item.id) }, "Delete");
  li.appendChild(deleteBtn);

  return li;
}

async function updateChecklistItem(date, itemId, updates) {
  await api("PUT", `/api/daily-goals/day/${date}/checklist/${itemId}`, updates);
  await afterDailyGoalsChange(date);
}

async function deleteChecklistItem(date, itemId) {
  await api("DELETE", `/api/daily-goals/day/${date}/checklist/${itemId}`);
  await afterDailyGoalsChange(date);
}

async function reorderChecklist(date, order) {
  await api("PUT", `/api/daily-goals/day/${date}/checklist/reorder`, { order });
  await afterDailyGoalsChange(date);
}

/**
 * Refreshes whichever Daily Goals views could be showing stale data
 * after a mutation to a specific day's entries or checklist.
 */
async function afterDailyGoalsChange(date) {
  if (state.dayModalDate === date) openDayModal(date);
  if (state.dailyView === "week") await loadWeek(state.currentWeekStart);
  if (state.dailyView === "month") await loadMonth(state.currentYearMonth);
}

// ---------- Activity Log ----------

async function loadActivityLog() {
  state.activityLog = await api("GET", "/api/activity-log");
  renderActivityLog();
}

function renderActivityLog() {
  const tbody = document.getElementById("activity-log-tbody");
  tbody.innerHTML = "";

  const groups = new Map(); // weekStart -> entries[]
  state.activityLog.forEach((entry) => {
    const dateOnly = (entry.timestamp || "").split(" ")[0];
    const weekStart = dateOnly ? startOfWeekForDateClient(dateOnly) : "Unknown";
    if (!groups.has(weekStart)) groups.set(weekStart, []);
    groups.get(weekStart).push(entry);
  });

  const weekStarts = [...groups.keys()].sort().reverse(); // newest week first
  weekStarts.forEach((weekStart) => {
    tbody.appendChild(
      el("tr", { class: "activity-log-week-header" }, [
        el("td", { colspan: "9" }, weekStart === "Unknown" ? "Unknown week" : `Week of ${weekStart}`)
      ])
    );
    groups.get(weekStart).forEach((entry) => {
      const tr = el("tr", {}, [
        el("td", {}, entry.timestamp),
        el("td", {}, entry.user || ""),
        el("td", {}, entry.action),
        el("td", {}, entry.entity),
        el("td", {}, entry.entityLabel),
        el("td", {}, entry.field),
        el("td", {}, entry.oldValue),
        el("td", {}, entry.newValue),
        el("td", {}, entry.details)
      ]);
      tbody.appendChild(tr);
    });
  });
}

// ---------- Weekly Summary ----------

async function loadWeeklySummaryStatus() {
  const status = await api("GET", "/api/weekly-summary/status");
  const statusEl = document.getElementById("openai-status");
  statusEl.textContent = status.configured
    ? `OpenAI configured (model: ${status.model})`
    : "OpenAI API key not configured. Add OPENAI_API_KEY to your .env file to enable summaries.";
}

async function loadWeeklySummaries() {
  state.weeklySummaries = await api("GET", "/api/weekly-summary");
  renderWeeklySummaries();
}

function renderWeeklySummaries() {
  const container = document.getElementById("weekly-summary-list");
  container.innerHTML = "";

  if (state.weeklySummaries.length === 0) {
    container.appendChild(el("p", { class: "hint" }, "No summaries generated yet."));
    return;
  }

  state.weeklySummaries.forEach((summary) => {
    const card = el("div", { class: "summary-card" }, [
      el("div", { class: "meta" }, `Since ${summary.since} — generated ${summary.generatedAt} — ${summary.logCount} log entries`),
      el("div", {}, summary.summary)
    ]);
    container.appendChild(card);
  });
}

document.getElementById("generate-summary-btn").addEventListener("click", async () => {
  try {
    await api("POST", "/api/weekly-summary/generate");
    await loadWeeklySummaries();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Init ----------

async function init() {
  initUserIdentity();
  initTabs();
  initOwnerFilter();
  initDailyGoalsNav();
  initStopServerButton();
  await Promise.all([
    loadTaskMeta(),
    loadBugMeta(),
    loadDailyGoalsMeta(),
    loadRecurringMeta(),
    loadChecklistMeta(),
    loadOptionLists(),
    loadNotesMeta()
  ]);
  await Promise.all([
    loadTasks(),
    loadBugs(),
    loadRecurringTasks(),
    loadChecklistTemplates(),
    loadNotes(),
    initDailyGoals(),
    loadActivityLog(),
    loadWeeklySummaryStatus(),
    loadWeeklySummaries()
  ]);
  setupSortableHeaders();
}

init().catch((err) => {
  console.error(err);
  alert("Failed to initialize app: " + err.message);
});
