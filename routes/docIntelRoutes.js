const express = require("express");

const docIntelController = require("../controllers/docIntelController");

const router = express.Router();
router.route("/").get(docIntelController.analyzePDF);

module.exports = router;
