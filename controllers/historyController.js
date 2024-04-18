const catchAsync = require("../utils/catchAsync");
const { getSessions, getSession, updateSession, deleteSession, createSession } = require('../data/historyOperators') 

exports.getSessions = catchAsync(async (req, res, next) => {
    const { query } = req
    const sessions = getSessions(query)
    
    res.status(200).json({
        status: "success",
        results: sessions.length,
        data: sessions
    })
});

exports.getSession = catchAsync(async (req, res, next) => {
    const { params } = req

    res.status(200).json({
        status: "success",
        data: getSession(params.sessionId)
    })
});

exports.createSession = catchAsync(async (req, res, next) => {
    const { body: { userId, tool, status, origin } } = req

    if (userId == null) {
        throw new Error("UserID is required")
    }
    
    const newSession = createSession({ userId, tool, status, origin })

    res.status(201).json({
        status: "success",
        data: newSession
    })
});

exports.updateSession = catchAsync(async (req, res, next) => {
    const { params, body } = req

    const updatedSession = updateSession(params.sessionId, body)

    res.status(200).json({
        status: "success",
        data: updatedSession
    })
});

exports.deleteSession = catchAsync(async (req, res, next) => {
    const { params } = req

    deleteSession(params.sessionId)

    res.status(204).json({
        status: "success",
        data: null
    })
});