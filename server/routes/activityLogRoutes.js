const express = require("express");
const activityLog = require("../lib/activityLog");

const router = express.Router();

router.get("/", async (req, res) => {
  const items = await activityLog.list();
  res.json(items);
});

module.exports = router;
