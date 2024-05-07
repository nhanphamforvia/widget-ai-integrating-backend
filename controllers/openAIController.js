const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { useQueueFactory, checkBusy } = require("./serviceQueueFactory");
const { updateSession, createSession, deleteSession, getSession, STATUS } = require("../data/history/historyOperators");
const { useChatCompletionForConsistency, useChatCompletionForIndividualItem, useChatCompletionForTestCaseGeneration } = require("./helpers/openAIHelpers");

// State Machine and Queue variables
const { queue, subscribeToQueue, getNextRequest, isBusy, commenceQueueProcess, resetServiceState, getCompressedQueue, finishRequest, deleteQueueItem, setItemProgress } =
  useQueueFactory();
const finishedRequests = new Map();

/* Main function to process requests */
const processNextRequest = async () => {
  if (isBusy() || queue.isEmpty()) return;

  const request = getNextRequest();
  commenceQueueProcess(request);

  const { sessionId, clientId, data: inputData, tool, prompt, role, requestedAt } = request;
  const { artifacts, dataForTestCases, dngWorkspace } = inputData;

  // TODO: Check if tool is consistency, make a branch to handle it separately.

  let results;
  switch (tool) {
    case "consistency":
      results = await useChatCompletionForConsistency(artifacts, prompt, role, setItemProgress);
      break;
    case "translate":
    case "toxic":
    case "quality":
      results = await useChatCompletionForIndividualItem(artifacts, prompt, role, setItemProgress);
      break;
    case "test-cases-generation":
      results = await useChatCompletionForTestCaseGeneration(artifacts, dataForTestCases, prompt, role, setItemProgress);
      break;
    default:
      throw new AppError("Invalid tool specified", 400);
  }

  if (results == null) {
    throw new AppError("Results not correctly parsed or in a wrong format!", 400);
  }

  const { data, errors } = results;
  const session = getSession(sessionId);

  if (session.status === STATUS.CANCELLED) {
    resetServiceState();
    processNextRequest();

    return;
  }

  await updateSession(sessionId, { status: STATUS.SUCCESS });
  finishRequest();

  const doneRequestsForClientId = finishedRequests.get(clientId) || [];
  finishedRequests.set(clientId, [
    ...doneRequestsForClientId,
    {
      requestedAt,
      sessionId,
      data,
      errors,
      tool,
      dngWorkspace,
    },
  ]);

  resetServiceState();
  processNextRequest();
};

/* Controller functions */
exports.chatCompletion = catchAsync(async (req, res, next) => {
  const { data, tool, prompt, role } = req.body;
  const { clientId } = req.client;

  const session = await createSession({
    clientId,
    status: STATUS.PENDING,
    tool,
  });

  subscribeToQueue({
    sessionId: session.id,
    clientId,
    data,
    tool,
    prompt,
    role,
    requestedAt: new Date().toString(),
  });

  processNextRequest();

  res.status(200).json({
    status: "success",
    data: {
      sessionId: session.id,
      clientId: clientId,
      tool,
    },
  });
});

exports.checkConsistency = catchAsync(async (req, res, next) => {
  const { data, tool, prompt, role } = req.body;
  const { clientId } = req.client;

  const session = await createSession({
    clientId,
    status: STATUS.PENDING,
    tool,
  });

  subscribeToQueue({
    sessionId: session.id,
    clientId,
    data,
    tool,
    prompt,
    role,
    requestedAt: new Date().toString(),
  });

  processNextRequest();

  res.status(200).json({
    status: "success",
    data: {
      sessionId: session.id,
      clientId: clientId,
      tool,
    },
  });
});

exports.checkBusy = checkBusy(isBusy, "OpenAI");

exports.getQueue = catchAsync(async (req, res, next) => {
  const queue = getCompressedQueue(req.query);

  res.status(200).json({
    status: "success",
    results: queue.length,
    data: {
      queue,
    },
  });
});

exports.deleteQueueItem = catchAsync(async (req, res, next) => {
  const { clientId } = req.client;
  const { sessionId } = req.body;

  deleteQueueItem(sessionId, clientId);
  await updateSession(sessionId, { status: STATUS.CANCELLED });

  res.status(204).json({
    status: "success",
  });
});

exports.getCompleteResults = catchAsync(async (req, res, next) => {
  const { clientId } = req.client;

  res.status(200).json({
    status: "success",
    data: finishedRequests.get(clientId),
  });
});

exports.deleteResult = catchAsync(async (req, res, next) => {
  const { clientId } = req.client;
  const { sessionId } = req.body;

  const finishedReqs = finishedRequests.get(clientId).filter((completion) => completion.sessionId !== sessionId);
  finishedRequests.set(clientId, finishedReqs);

  res.status(204).json({
    status: "success",
  });
});
