const openAIClient = require("../openAIConnect");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { useQueueFactory, checkBusy } = require("./serviceQueueFactory");
const { updateSession, createSession, deleteSession, STATUS } = require("../data/history/historyOperators");
const processDataInBatches = require("../utils/processDataInBatches");

const TEMP = 0.0;
const deploymentName = process.env.OPEN_API_DEPLOYMENT_NAME;
const REQ_PER_TIME = 30;

// State Machine and Queue variables
const { queue, subscribeToQueue, getNextRequest, isBusy, commenceQueueProcess, resetServiceState, getCompressedQueue } = useQueueFactory();

const finishedRequests = new Map();

const chatCompletion = async (messages, temperature = TEMP) => {
  try {
    const result = await openAIClient.getChatCompletions(deploymentName, messages, { temperature });

    if (result.choices == null) {
      throw new AppError(`Failed to complete the chat for: ${content}`, 400);
    }

    return {
      status: "success",
      data: result.choices.map((choice) => choice.message.content),
    };
  } catch (err) {
    throw err;
  }
};

const promiseHandler = (prompt, role) => async (art) => {
  const messages = [
    {
      role: "system",
      content: role,
    },
    {
      role: "user",
      content: prompt + art.primaryText,
    },
  ];

  try {
    const resData = await chatCompletion(messages, TEMP);

    if (resData.status === "success") {
      const message = resData.data[0];

      if (message.includes("No issue")) {
        return null;
      }

      return {
        artId: art.id,
        message,
      };
    }
  } catch (err) {
    throw err;
  }
};

const processNextRequest = async () => {
  if (isBusy() || queue.isEmpty()) return;

  commenceQueueProcess();
  const request = getNextRequest();

  const {
    sessionId,
    clientId,
    data: { artifacts, moduleURI, configPreset, rawConfigPreset, configURI, changesetURL, componentURL, moduleViewId, projectId },
    tool,
    prompt,
    role,
    requestedAt,
  } = request;

  const data = [];
  const abortController = new AbortController();

  // TODO: Check if tool is consistency, make a branch to handle it separately.

  const progressHandler = ({ currentIndex, totalIndices }) => {
    const progress = ((currentIndex / totalIndices) * 100).toFixed(2);
    // console.log(progress);
  };

  const results = await processDataInBatches(artifacts, REQ_PER_TIME, promiseHandler(prompt, role), progressHandler, abortController);

  results.forEach((res) => {
    if (res.status === "fulfilled" && res.value) {
      data.push(res.value);
    }

    if (res.status === "rejected") {
      console.error(res.reason);
    }
  });

  await updateSession(sessionId, { status: STATUS.SUCCESS });

  const doneRequestsForClientId = finishedRequests.get(clientId) || [];

  finishedRequests.set(clientId, [
    ...doneRequestsForClientId,
    {
      requestedAt,
      sessionId,
      data,
      tool,
      moduleURI,
      configPreset,
      rawConfigPreset,
      configURI,
      changesetURL,
      componentURL,
      moduleViewId,
      projectId,
    },
  ]);

  resetServiceState();
  processNextRequest();
};

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
  res.status(200).json({
    status: "success",
    data: {
      queue: getCompressedQueue(),
    },
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
