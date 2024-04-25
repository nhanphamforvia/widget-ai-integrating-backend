const express = require("express");
const authController = require("../controllers/authController");
const historyController = require("../controllers/historyController");

const router = express.Router();

router.route("/sessions").get(historyController.getSessions).post(historyController.createSession);
router.use(authController.protect);

router.route("/sessions/:sessionId").get(historyController.getSession).patch(historyController.updateSession).delete(historyController.deleteSession);

router.route("/sessions/years/weeks").get(historyController.getSessionsByYearAndWeek);
router.route("/sessions/years/:year/weeks").get(historyController.getSessionsByWeekInYear);

module.exports = router;
