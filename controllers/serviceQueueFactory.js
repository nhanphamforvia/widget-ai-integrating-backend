const Queue = require("../utils/Queue");
const catchAsync = require("../utils/catchAsync");

const MACHINE_STATES = {
  IDLE: "idle",
  BUSY: "busy",
};

exports.useQueueFactory = () => {
  const queue = new Queue();

  let state = MACHINE_STATES.IDLE;
  
  const isBusy = () => {
    return state === MACHINE_STATES.BUSY;
  };

  const commenceQueueProcess = () => {
    state = MACHINE_STATES.BUSY;
  };

  const resetServiceState = () => {
    state = MACHINE_STATES.IDLE;
  };

  const subscribeToQueue = (jobData) => {
    queue.enqueue(jobData);
  };

  const getNextRequest = () => {
    return queue.dequeue();
  };

  const peekRequest = () => {
    return queue.peek();
  };

  const printQueue = () => {
    queue.printQueue();
  };

  const getCompressedQueue = ({ tool = null, clientId = null }) => {
    let fileredQueueItems = queue.items;

    if (tool != null) {
      fileredQueueItems = fileredQueueItems.filter((item) => item.tool === tool);
    }

    if (clientId != null) {
      fileredQueueItems = fileredQueueItems.filter((item) => item.clientId === clientId);
    }

    return fileredQueueItems.map(({ clientId, sessionId, tool, requestedAt, data: { artifacts, moduleURI, projectId } }) => ({
      requestedAt,
      clientId,
      sessionId,
      tool,
      projectId,
      moduleURI,
      artifactCount: artifacts.length,
    }));
  };

  return {
    queue,
    subscribeToQueue,
    getNextRequest,
    peekRequest,
    printQueue,
    commenceQueueProcess,
    resetServiceState,
    isBusy,
    getCompressedQueue,
  };
};

exports.checkBusy = (isServiceBusy, serviceName) =>
  catchAsync(async (req, res, next) => {
    const { clientId } = req.client;

    if (clientId == null) {
      next(new AppError("Random Client Id is required!", 400));
    }

    if (isServiceBusy()) {
      res.status(200).json({
        status: "success",
        message: `<p>The server with ${serviceName} is busy. <br/>Do you want to add your request to queue?</p>`,
        data: {
          blockedByStateMachine: true,
        },
      });

      return;
    }

    res.status(200).json({
      status: "success",
      data: {
        blockedByStateMachine: false,
      },
    });
  });
