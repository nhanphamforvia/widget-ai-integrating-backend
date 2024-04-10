const express = require("express");

const openAIController = require("../controllers/openAIController");
const authController = require("../controllers/authController");

const router = express.Router();
router.route("/chatCompletion").post(authController.protect, openAIController.checkMachineState, openAIController.chatCompletion);
router.route("/checkBusy").post(authController.protect, openAIController.checkBusy);

module.exports = router;
