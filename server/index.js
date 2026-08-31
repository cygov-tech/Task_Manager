require("dotenv").config();

const os = require("os");
const path = require("path");
const express = require("express");

const requestContext = require("./lib/requestContext");
const tasksRouter = require("./routes/tasks");
const bugsRouter = require("./routes/bugs");
const dailyGoalsRouter = require("./routes/dailyGoals");
const recurringTasksRouter = require("./routes/recurringTasks");
const checklistTemplatesRouter = require("./routes/checklistTemplates");
const optionListsRouter = require("./routes/optionLists");
const notesRouter = require("./routes/notes");
const activityLogRouter = require("./routes/activityLogRoutes");
const weeklySummaryRouter = require("./routes/weeklySummary");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Attaches the requesting team member's name (sent by the frontend on every
// request) to an async-local context so route handlers and activityLog can
// attribute changes without threading the value through every function call.
app.use((req, res, next) => {
  const userName = String(req.headers["x-user-name"] || "").trim() || "Unknown";
  requestContext.run({ userName }, next);
});

app.use("/api/tasks", tasksRouter);
app.use("/api/bugs", bugsRouter);
app.use("/api/daily-goals", dailyGoalsRouter);
app.use("/api/recurring-tasks", recurringTasksRouter);
app.use("/api/checklist-templates", checklistTemplatesRouter);
app.use("/api/option-lists", optionListsRouter);
app.use("/api/notes", notesRouter);
app.use("/api/activity-log", activityLogRouter);
app.use("/api/weekly-summary", weeklySummaryRouter);

app.use(express.static(path.join(__dirname, "..", "public")));

// Basic error handler so unexpected exceptions return JSON instead of crashing silently.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error." });
});

const server = app.listen(PORT, () => {
  console.log(`Task Manager running at http://localhost:${PORT}`);

  const lanIps = Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === "IPv4" && !iface.internal)
    .map((iface) => iface.address);

  lanIps.forEach((ip) => {
    console.log(`Team members on your network can use http://${ip}:${PORT}`);
  });
});

// Lets the "Stop Server" button in the app (and the desktop Stop app) shut
// the process down cleanly instead of requiring a force-kill.
app.post("/api/shutdown", (req, res) => {
  res.json({ success: true });
  console.log("Shutdown requested. Closing server...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
});
