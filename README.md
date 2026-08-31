# Task Manager

A standalone web app version of the Google Sheets / Apps Script task manager workflow: task list with an elaboration/breakdown view per task, bug tracking, a weekly daily-goals planner, an activity log, and an optional AI-generated weekly summary.

Data is stored locally as JSON files in `data/` (created automatically on first run) — no database or external account needed, except optionally OpenAI for weekly summaries.

## Setup

```bash
npm install
cp .env.example .env   # optional: only needed for the Weekly Summary feature
npm start
```

Then open http://localhost:3000

## Features

- **Task Manager** — add tasks with status/type/date/Trello link; click a task name to open its detail view.
  - **Elaboration / Task Breakdown** — each task has a checklist-style breakdown table (done, name, status, notes), mirroring the "Elaboration -" tabs.
  - **Structured Comment** — generate a templated comment (context, checklist, next action, blockers, decision needed) for a task, editable and saved per task.
- **Bug Tracking** — separate list with Type (BEECHER / Midmarket / Regular), Severity (Low–Critical), and Status, color-coded like the sheet.
- **Daily Goals** — click "Create / Open Current Week" to generate a Sunday–Saturday planner. Past days are automatically locked. Entries can link to a task, with time, priority, status, and a done checkbox.
- **Activity Log** — every create/update/delete across the app is recorded automatically (timestamp, action, entity, field, old/new value).
- **Weekly Summary** — with `OPENAI_API_KEY` set in `.env`, click "Generate Weekly Summary" to get a 100-word accomplishment summary since last Monday, built from the activity log.

## Project structure

```
server/
  index.js              Express app entrypoint
  store.js              JSON file storage with a write queue
  lib/
    dates.js            Week/date helpers
    activityLog.js       Activity log read/write
    openai.js            OpenAI Responses API call for weekly summaries
  routes/
    tasks.js             Tasks + breakdown + structured comment
    bugs.js               Bug tracking
    dailyGoals.js         Weekly daily goals planner
    activityLogRoutes.js  Activity log read endpoint
    weeklySummary.js       Weekly summary generation
public/
  index.html, styles.css, app.js   Frontend (vanilla JS, no build step)
data/
  *.json                Local data files (created at runtime)
```

## Notes

- No Google account, spreadsheet, or Apps Script required — this is a fully independent app inspired by that workflow.
- All data lives in `data/*.json` in this folder. Back up that folder to back up your data.
