const express = require("express");

const translatorController = require("../controllers/translatorController");
const authController = require("../controllers/authController");

const router = express.Router();
router.route("/translate").post(authController.protect, translatorController.checkMachineState, translatorController.translate);
router.route("/checkBusy").post(authController.protect, translatorController.checkBusy);

module.exports = router;
