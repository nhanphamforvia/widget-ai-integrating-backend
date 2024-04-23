const express = require("express");
const promptsController = require("../controllers/promptsController")

const router = express.Router();

router.route('/').get(promptsController.getPrompts)
router.route('/:promptName').patch(promptsController.updatePrompt)

module.exports = router;
