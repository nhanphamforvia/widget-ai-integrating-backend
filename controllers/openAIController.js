const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { useQueueFactory, checkBusy } = require("./serviceQueueFactory");
const { useStorageFactory } = require("./useStorageFactory");
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
const { getResultsByClientID, addResultToStorage, removeResultByClientIDAndSessionID, startSevenDayPeriodCleanup } = useStorageFactory();

startSevenDayPeriodCleanup();

const resetStateAndProcessNext = () => {
  resetServiceState();
  processNextRequests();
};

const REQUIRED_REQ_PROPS = ["sessionId", "clientId", "data", "tool", "prompt", "role"];

/* Main function to process requests */
const processNextRequests = async () => {
  while (true) {
    if (queue.isEmpty()) break;
    const request = getNextConcurrentRequest();

    if (request == null) break;

    commenceQueueProcess(request);

    const missingProps = REQUIRED_REQ_PROPS.reduce((missing, prop) => {
      if (request[prop] == null) {
        return [...missing, prop];
      }

      return missing;
    }, []);

    if (missingProps?.length) {
      if (request.sessionId != null) {
        await updateSession(request.sessionId, {
          status: STATUS.ERROR,
          error: `The request is missing the properties: ${missingProps.join(", ")}`,
        });
      }

      resetStateAndProcessNext();
      break;
    }

    const { sessionId, clientId, data: inputData, tool, prompt, role, requestedAt, abortController } = request;
    const { artifacts, dataForTestCases, dngWorkspace } = inputData;

    if (artifacts == null || dngWorkspace == null) {
      await updateSession(sessionId, {
        status: STATUS.ERROR,
        error: "The input data in request is missing either 'artifacts' or 'dngWorkspace' property",
      });

      resetStateAndProcessNext();
    }

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
      resetStateAndProcessNext();

      break;
    }

    await updateSession(sessionId, { status: STATUS.SUCCESS });
    finishRequest(request);

    addResultToStorage(clientId, { requestedAt, sessionId, data, errors, tool, dngWorkspace });

    resetStateAndProcessNext();
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

  let results = getResultsByClientID(clientId);

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

  removeResultByClientIDAndSessionID(clientId, sessionId);

  res.status(204).json({
    status: "success",
  });
});
