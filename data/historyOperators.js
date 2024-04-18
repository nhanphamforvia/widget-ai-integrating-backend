const fs = require('fs')
const crypto = require('crypto');

const historyPath = "./data/history.json"
const FILTER_QUERY_FIELDS = ["userId", "id"]

const readDb = () => {
    const historyJson = fs.readFileSync(historyPath, 'utf8');
    return JSON.parse(historyJson)
}

const writeDb = (newData) => {
    fs.writeFileSync(historyPath, JSON.stringify(newData, null, 2), 'utf8');
}

const STATUS = {
    PENDING: "pending",
    SUCCESS: "success",
    ERROR: "error",
    DENIED: "denied"
}

exports.STATUS = STATUS

exports.getSessions = (query) => {
    const queryObj = Object.entries(query).filter(([key, _]) => FILTER_QUERY_FIELDS.includes(key))
    const historyData = readDb()

    return historyData?.sessions.filter(item => {
        return queryObj.every(([key, value]) => {
            return item[key] == value
        })
    }); 
}

exports.getSession = (sessionId) => {
    const historyData = readDb()

    const session = historyData?.sessions.find(session => {
        return session.id === sessionId
    })

    return session
}

exports.createSession = ({ userId, origin, status = STATUS.PENDING, tool = "unknown",  }) => {
    if (userId == null) throw new Error("UserId is not defined")

    const historyData = readDb()    

    const session = {
        id: crypto.randomUUID(),
        userId,
        createdAt: new Date().toISOString(),
        finishedAt: null,
        status: status || STATUS.PENDING,
        tool,
        origin,
    }

    if (status === STATUS.DENIED || status === STATUS.ERROR || status === STATUS.SUCCESS) {
        session.finishedAt = new Date().toISOString()
    }

    const isValidStatus = Object.values(STATUS).some(allowedValue => {
        return status === allowedValue
    })

    if (!isValidStatus) throw new Error("Invalid Status");

    session.status = status;

    historyData.sessions.push(session)
    writeDb(historyData)

    return session
}

exports.updateSession = (sessionId, { status = null }) => {
    const historyData = readDb()

    const session = historyData.sessions.find(session => {
        return session.id === sessionId;
    })

    if (status === STATUS.DENIED || status === STATUS.ERROR || status === STATUS.SUCCESS) {
        session.finishedAt = new Date().toISOString()
    }

    const isValidStatus = Object.values(STATUS).some(allowedValue => {
        return status === allowedValue
    })

    if (!isValidStatus) throw new Error("Invalid Status");

    session.status = status;
    writeDb(historyData)

    return session
}

exports.deleteSession = (sessionId) => {
    const historyData = readDb()
    
    historyData.sessions = historyData.sessions.filter(session => session.id !== sessionId)

    writeDb(historyData)
}