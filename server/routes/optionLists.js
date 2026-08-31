const express = require("express");
const optionLists = require("../lib/optionLists");

const router = express.Router();

router.get("/", async (req, res) => {
  res.json(await optionLists.getAll());
});

router.post("/:entity/:field", async (req, res) => {
  try {
    const list = await optionLists.addOption(req.params.entity, req.params.field, req.body?.value, req.body?.color);
    res.json(list);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:entity/:field/:oldValue", async (req, res) => {
  try {
    const list = await optionLists.renameOption(req.params.entity, req.params.field, req.params.oldValue, req.body?.value);
    res.json(list);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:entity/:field/:value/color", async (req, res) => {
  try {
    const list = await optionLists.setColor(req.params.entity, req.params.field, req.params.value, req.body?.color);
    res.json(list);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:entity/:field/:value", async (req, res) => {
  try {
    const list = await optionLists.removeOption(req.params.entity, req.params.field, req.params.value);
    res.json(list);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
