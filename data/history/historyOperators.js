const crypto = require("crypto");
const path = require("path");
const Database = require("../Database");
const moment = require("moment");

const FILTER_QUERY_FIELDS = new Set(["clientId", "id", "status", "tool"]);
const SELECT_FIELDS = new Set(["clientId", "id", "status", "createdAt", "finishedAt", "tool"]);
const SORT_FIELDS = new Set(["status", "tool", "createdAt", "duration"]);
const SYS_PROPS = new Set(["id", "clientId", "createdAt", "finishedAt", "duration", "status", "tool"]);

const historyDb = new Database(path.resolve(__dirname, "history.json"));

const STATUS = {
  PENDING: "pending",
  SUCCESS: "success",
  ERROR: "error",
  DENIED: "denied",
  CANCELLED: "cancelled",
};

exports.STATUS = STATUS;

const isValidStatus = (status) => {
  const validStatusNames = Object.values(STATUS);
  const filteredStatus = status.split(",");

  return filteredStatus.every((status) => {
    return validStatusNames.some((allowedValue) => {
      return status === allowedValue;
    });
  });
};

const getQueryObject = (query) => {
  return Object.entries(query).filter(([key, _]) => FILTER_QUERY_FIELDS.has(key));
};

const filterSessionsByFields = (sessions, queryObj) => {
  return sessions.filter((session) => {
    return queryObj.every(([key, value]) => value.split(",").includes(session[key]));
  });
};

const sortSessionsByFields = (sessions, sort) => {
  const sortFields = sort.split(",").reduce((fieldsAndValues, sortField) => {
    const [field, value] = sortField.split("=");

    if (SORT_FIELDS.has(field)) {
      return [...fieldsAndValues, { field, value }];
    }

    return fieldsAndValues;
  }, []);

  sortFields.forEach(({ field, value }) => {
    switch (field) {
      case "duration": {
        sessions.sort((sessionA, sessionB) => (value > 0 ? sessionA[field] - sessionB[field] : sessionB[field] - sessionA[field]));
        break;
      }

      case "createdAt": {
        sessions.sort((sessionA, sessionB) =>
          value > 0 ? moment(sessionA.createdAt).diff(moment(sessionB.createdAt)) : moment(sessionB.createdAt).diff(moment(sessionA.createdAt))
        );
        break;
      }

      case "status":
      case "tool": {
        sessions.sort((sessionA, sessionB) => {
          return value > 0 ? sessionA[field].localeCompare(sessionB[field]) : sessionB[field].localeCompare(sessionA[field]);
        });
        break;
      }

      default: {
        break;
      }
    }
  });

  return sessions;
};

const selectFieldsFromSessions = (sessions, select) => {
  const selectFields = select.split(",").filter((field) => SELECT_FIELDS.has(field));

  return sessions.map((session) => {
    return selectFields.reduce((obj, field) => {
      if (session[field]) {
        obj[field] = session[field];
      }
      return obj;
    }, {});
  });
};

const filterSessionsByDate = (sessions, dateField, targetDateStr) => {
  const targetDate = new Date(targetDateStr);

  return sessions.filter((session) => {
    if (!session[dateField]) return false;
    const sessionDate = new Date(session[dateField]);
    return moment(targetDate).isSame(sessionDate, "day");
  });
};

const filterSessionsDateSpan = (sessions, type, dateStr) => {
  const targetDate = new Date(dateStr);

  return sessions.filter((session) => {
    const sessionDate = new Date(session.createdAt);

    if (type === "fromDate") return moment(targetDate).startOf("day").isSameOrBefore(sessionDate);
    else return moment(targetDate).endOf("day").isSameOrAfter(sessionDate);
  });
};

const finishSession = (session) => {
  session.finishedAt = new Date().toISOString();
  const startMoment = moment(session.createdAt);
  const finishMoment = moment(session.finishedAt);

  session.duration = startMoment.isValid() && finishMoment.isValid() ? moment.duration(finishMoment.diff(startMoment)).asMilliseconds() : "N/A";
};

exports.getSessions = async (query) => {
  const { createdAt, finishedAt, fromDate, toDate, status, select, sort } = query;

  if (status && !isValidStatus(status)) {
    throw new Error("Invalid status query!");
  }

  const historyData = await historyDb.read();
  const queryObj = getQueryObject(query);
  let filteredHistoryData = filterSessionsByFields(historyData?.sessions, queryObj);

  if (sort) {
    filteredHistoryData = sortSessionsByFields(filteredHistoryData, sort);
  }

  if (createdAt) {
    filteredHistoryData = filterSessionsByDate(filteredHistoryData, "createdAt", createdAt);
  }

  if (finishedAt) {
    filteredHistoryData = filterSessionsByDate(filteredHistoryData, "finishedAt", finishedAt);
  }

  if (fromDate) {
    filteredHistoryData = filterSessionsDateSpan(filteredHistoryData, "fromDate", fromDate);
  }

  if (toDate) {
    filteredHistoryData = filterSessionsDateSpan(filteredHistoryData, "toDate", toDate);
  }

  if (select) {
    filteredHistoryData = selectFieldsFromSessions(filteredHistoryData, select);
  }

  return filteredHistoryData;
};

exports.getSession = async (sessionId) => {
  const historyData = await historyDb.read();

  const session = historyData?.sessions.find((session) => {
    return session.id === sessionId;
  });

  return session;
};

exports.createSession = async ({ clientId, origin, status = STATUS.PENDING, tool = "unknown" }) => {
  if (clientId == null) throw new Error("Random ClientID is not defined");

  const historyData = await historyDb.read();

  const session = {
    id: crypto.randomUUID(),
    clientId,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    duration: 0,
    status: status || STATUS.PENDING,
    tool,
    origin,
  };

  if (status === STATUS.DENIED || status === STATUS.ERROR || status === STATUS.SUCCESS || status === STATUS.CANCELLED) {
    finishSession(session);
  }

  if (!isValidStatus(status)) throw new Error("Invalid Status");

  session.status = status;

  historyData.sessions.push(session);
  historyDb.scheduleWrite();

  return session;
};

exports.updateSession = async (sessionId, { status = null, ...otherProps }) => {
  const historyData = await historyDb.read();

  const session = historyData.sessions.find((session) => {
    return session.id === sessionId;
  });

  if (session == null) {
    return null;
  }

  if (status === STATUS.DENIED || status === STATUS.ERROR || status === STATUS.SUCCESS || status === STATUS.CANCELLED) {
    finishSession(session);
  }

  if (status) {
    const isValidStatus = Object.values(STATUS).some((allowedValue) => {
      return status === allowedValue;
    });

    if (!isValidStatus) throw new Error("Invalid Status");

    session.status = status;
  }

  Object.entries(otherProps).forEach(([key, value]) => {
    if (SYS_PROPS.has(key)) return;

    session[key] = value;
  });

  historyDb.scheduleWrite();

  return session;
};

exports.deleteSession = async (sessionId) => {
  const historyData = await historyDb.read();

  historyData.sessions = historyData.sessions.filter((session) => session.id !== sessionId);

  historyDb.scheduleWrite();
};
