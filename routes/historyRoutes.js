const express = require("express");
const historyController = require("../controllers/historyController")

const router = express.Router();
router.route("/sessions").get(historyController.getSessions).post(historyController.createSession);
router.route("/sessions/:sessionId").get(historyController.getSession).patch(historyController.updateSession).delete(historyController.deleteSession);

module.exports = router;
