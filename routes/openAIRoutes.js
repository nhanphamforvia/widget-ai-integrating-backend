const express = require("express");

const openAIController = require("../controllers/openAIController");

const router = express.Router();
router.route("/chatCompletion").post(openAIController.chatCompletion);

module.exports = router;
