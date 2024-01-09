const express = require("express");

const openAIController = require("../controllers/openAIController");

const router = express.Router();
router.route("/chatCompletions").post(openAIController.chatCompletions);

module.exports = router;
