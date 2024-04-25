const express = require("express");

const openAIController = require("../controllers/openAIController");
const authController = require("../controllers/authController");

const router = express.Router();
router.route("/chatCompletion").post(authController.getClientID, openAIController.checkMachineState, openAIController.chatCompletion);
router.route("/checkBusy").post(authController.getClientID, openAIController.checkBusy);

module.exports = router;
