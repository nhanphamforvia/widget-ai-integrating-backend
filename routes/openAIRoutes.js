const express = require("express");

const openAIController = require("../controllers/openAIController");
const authController = require("../controllers/authController");

const router = express.Router();
router.route("/chatCompletion").post(authController.getClientID, openAIController.chatCompletion);
router.route("/chatCompletion/queue").get(openAIController.getQueue);

router.route("/checkBusy").post(authController.getClientID, openAIController.checkBusy);
router.use(authController.getClientID);
router.route("/chatCompletion/results").post(openAIController.getCompleteResults).delete(openAIController.deleteResult);

module.exports = router;
