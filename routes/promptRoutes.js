const express = require("express");
const authController = require("../controllers/authController")
const promptsController = require("../controllers/promptsController")

const router = express.Router();

router.route('/').get(promptsController.getPrompts)
router.route('/:promptName').patch(authController.protect, promptsController.updatePrompt)

module.exports = router;
