const crypto = require('crypto');
const path = require('path');
const Database = require('./Database');
const moment = require('moment');

const FILTER_QUERY_FIELDS = new Set(["clientId", "id", "status"]);
const SELECT_FIELDS = new Set(["clientId", "id", "status", "createdAt", "finishedAt", "tool"]);

const historyDb = new Database(path.resolve(__dirname, 'history.json'));

const STATUS = {
    PENDING: "pending",
    SUCCESS: "success",
    ERROR: "error",
    DENIED: "denied"
}
exports.STATUS = STATUS

const isValidStatus = (status) => Object.values(STATUS).some(allowedValue => {
    return status === allowedValue
})

const getQueryObject = (query) => {
    return Object.entries(query).filter(([key, _]) => FILTER_QUERY_FIELDS.has(key));
}

const filterSessions = (sessions, queryObj) => {
    return sessions.filter(session => {
        return queryObj.every(([key, value]) => session[key] == value);
    });
}

const selectFieldsFromSessions = (sessions, select) => {
    const selectFields = select.split(',').filter(field => SELECT_FIELDS.has(field));

    return sessions.map(session => {
        return selectFields.reduce((obj, field) => {
            if (session[field]) {
                obj[field] = session[field];
            }
            return obj;
        }, {});
    });
}

const filterSessionsByDate = (sessions, dateField, targetDateStr) => {
    const targetDate = new Date(targetDateStr);

    return sessions.filter(session => {
        if (!session[dateField]) return false;
        const sessionDate = new Date(session[dateField]);
        return moment(targetDate).isSame(sessionDate, 'day')
    });
}

exports.getSessions = async (query) => {
    const { start, end, status, select } = query;

    if (status && !isValidStatus(status)) {
        throw new Error("Invalid status query!");
    }

    const historyData = await historyDb.read();
    const queryObj = getQueryObject(query);
    let filteredHistoryData = filterSessions(historyData?.sessions, queryObj);

    if (select) {
        filteredHistoryData = selectFieldsFromSessions(filteredHistoryData, select);
    }

    if (end) {
        filteredHistoryData = filterSessionsByDate(filteredHistoryData, 'finishedAt', end);
    }

    if (start) {
        filteredHistoryData = filterSessionsByDate(filteredHistoryData, 'createdAt', start);
    }

    return filteredHistoryData;
}

exports.getSession = async (sessionId) => {
    const historyData = await historyDb.read()

    const session = historyData?.sessions.find(session => {
        return session.id === sessionId
    })

    return session
}

exports.createSession = async ({ clientId, origin, status = STATUS.PENDING, tool = "unknown",  }) => {
    if (clientId == null) throw new Error("Random ClientID is not defined")

    const historyData = await historyDb.read()    

    const session = {
        id: crypto.randomUUID(),
        clientId,
        createdAt: new Date().toISOString(),
        finishedAt: null,
        status: status || STATUS.PENDING,
        tool,
        origin,
    }

    if (status === STATUS.DENIED || status === STATUS.ERROR || status === STATUS.SUCCESS) {
        session.finishedAt = new Date().toISOString()
    }

    if (!isValidStatus(status)) throw new Error("Invalid Status");

    session.status = status;

    historyData.sessions.push(session)
    historyDb.scheduleWrite()

    return session
}

exports.updateSession = async (sessionId, { status = null }) => {
    const historyData = await historyDb.read()

    const session = historyData.sessions.find(session => {
        return session.id === sessionId;
    })

    if (status === STATUS.DENIED || status === STATUS.ERROR || status === STATUS.SUCCESS) {
        session.finishedAt = new Date().toISOString()
    }

    if (status) {
        const isValidStatus = Object.values(STATUS).some(allowedValue => {
            return status === allowedValue
        })
    
        if (!isValidStatus) throw new Error("Invalid Status");
    
        session.status = status;
    }

    historyDb.scheduleWrite()

    return session
}

exports.deleteSession = async (sessionId) => {
    const historyData = await historyDb.read()
    
    historyData.sessions = historyData.sessions.filter(session => session.id !== sessionId)

    historyDb.scheduleWrite()
}