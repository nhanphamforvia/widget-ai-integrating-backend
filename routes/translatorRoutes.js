const express = require("express");

const translatorController = require("../controllers/translatorController");

const router = express.Router();
router.route("/").get(translatorController.translate);

module.exports = router;
