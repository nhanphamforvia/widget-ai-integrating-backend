const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { useQueueFactory, checkBusy } = require("./serviceQueueFactory");
const { updateSession, createSession, deleteSession, getSession, STATUS } = require("../data/history/historyOperators");
const { useChatCompletionForConsistency, useChatCompletionForIndividualItem, useChatCompletionForTestCaseGeneration } = require("./helpers/openAIHelpers");

// State Machine and Queue variables
const {
  queue,
  subscribeToQueue,
  isBusy,
  commenceQueueProcess,
  resetServiceState,
  getCompressedQueue,
  finishRequest,
  deleteQueueItem,
  updateItemProgress,
  getNextConcurrentRequest,
} = useQueueFactory();
const finishedRequests = new Map();

/* Main function to process requests */
const processNextRequests = async () => {
  while (true) {
    const request = getNextConcurrentRequest();
    if (request == null || queue.isEmpty()) break;

    commenceQueueProcess(request);

    const { sessionId, clientId, data: inputData, tool, prompt, role, requestedAt, abortController } = request;
    const { artifacts, dataForTestCases, dngWorkspace } = inputData;

    // TODO: Check if tool is consistency, make a branch to handle it separately.

    const progressHandler = ({ processId, currentIndex, totalIndices }) => {
      const progress = (((currentIndex + 1) / (totalIndices + 1)) * 100).toFixed(2);
      updateItemProgress(processId, progress);
    };

    let results;
    switch (tool) {
      case "consistency":
        results = await useChatCompletionForConsistency(artifacts, prompt, role, progressHandler, sessionId, { abortController });
        break;
      case "translate":
      case "toxic":
      case "quality":
        results = await useChatCompletionForIndividualItem(artifacts, prompt, role, progressHandler, sessionId, { abortController });
        break;
      case "test-cases-generation":
        results = await useChatCompletionForTestCaseGeneration(artifacts, dataForTestCases, prompt, role, progressHandler, sessionId, { abortController });
        break;
      default:
        throw new AppError("Invalid tool specified", 400);
    }

    if (results == null) {
      throw new AppError("Results not correctly parsed or in a wrong format!", 400);
    }

    const { data, errors } = results;
    const session = await getSession(sessionId);

    if (session.status === STATUS.CANCELLED) {
      resetServiceState(request);
      processNextRequests();

      return;
    }

    await updateSession(sessionId, { status: STATUS.SUCCESS });
    finishRequest(request);

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
    processNextRequests();
  }
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

  const queueLength = subscribeToQueue({
    sessionId: session.id,
    clientId,
    data,
    tool,
    prompt,
    role,
    requestedAt: new Date().toString(),
  });

  processNextRequests();

  res.status(200).json({
    status: "success",
    data: {
      sessionId: session.id,
      clientId: clientId,
      tool,
      queueLength,
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

  processNextRequests();

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

  const deletedItem = deleteQueueItem(sessionId, clientId);

  if (deletedItem != null && deletedItem.abortController) {
    deletedItem.abortController.abort();
  }

  await updateSession(sessionId, { status: STATUS.CANCELLED });

  processNextRequests();

  res.status(204).json({
    status: "success",
  });
});

exports.getCompleteResults = catchAsync(async (req, res, next) => {
  const { tool } = req.query;
  const { clientId } = req.client;

  let results = finishedRequests.get(clientId) || [];

  if (tool != null && results) {
    results = results.filter((item) => item.tool === tool);
  }

  res.status(200).json({
    status: "success",
    data: results,
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
