const express = require("express");

const openAIController = require("../controllers/openAIController");
const authController = require("../controllers/authController");

const router = express.Router();
router.route("/chatCompletion").post(authController.protect, authController.isAdmin, openAIController.chatCompletion);

module.exports = router;
