const express = require("express");
const crypto = require("crypto");
const store = require("../store");
const activityLog = require("../lib/activityLog");
const openai = require("../lib/openai");
const { lastMondayStart, formatDate, formatDateTime } = require("../lib/dates");

const STORE_NAME = "weeklySummaries";
const DEFAULT = { items: [] };

const router = express.Router();

router.get("/status", (req, res) => {
  res.json({ configured: openai.isConfigured(), model: openai.getModel() });
});

router.get("/", async (req, res) => {
  const data = await store.read(STORE_NAME, DEFAULT);
  res.json(data.items.slice().reverse());
});

router.post("/generate", async (req, res) => {
  if (!openai.isConfigured()) {
    return res.status(400).json({
      error: "OPENAI_API_KEY is not configured. Add it to your .env file and restart the server."
    });
  }

  const since = lastMondayStart();
  const sinceLabel = formatDate(since);
  const logRows = await activityLog.since(since);

  if (logRows.length === 0) {
    return res.status(400).json({ error: "No logged activity found since last Monday." });
  }

  let summaryText;
  try {
    summaryText = await openai.summarizeActivity(logRows, sinceLabel);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }

  const summary = await store.update(STORE_NAME, DEFAULT, (data) => {
    const entry = {
      id: crypto.randomUUID(),
      since: sinceLabel,
      generatedAt: formatDateTime(new Date()),
      logCount: logRows.length,
      summary: summaryText
    };
    data.items.push(entry);
    return entry;
  });

  await activityLog.log({
    action: "Summary",
    entity: "Weekly Summary",
    entityId: summary.id,
    entityLabel: `Since ${sinceLabel}`,
    details: "Generated OpenAI weekly summary"
  });

  res.status(201).json(summary);
});

module.exports = router;
