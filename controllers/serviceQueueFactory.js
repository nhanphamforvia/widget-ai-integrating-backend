const Queue = require("../utils/Queue");
const catchAsync = require("../utils/catchAsync");

const MACHINE_STATES = {
  IDLE: "idle",
  BUSY: "busy",
};

const QUEUE_ITEM_STATES = {
  PENDING: "pending",
  RUNNING: "running",
  DONE: "done",
};

exports.useQueueFactory = () => {
  const queue = new Queue();
  let state = MACHINE_STATES.IDLE;
  let progressingItem = null;

  const isBusy = () => {
    return state === MACHINE_STATES.BUSY;
  };

  const commenceQueueProcess = (queueItem) => {
    state = MACHINE_STATES.BUSY;
    queueItem.status = QUEUE_ITEM_STATES.RUNNING;
    progressingItem = queueItem;
  };

  const resetServiceState = () => {
    state = MACHINE_STATES.IDLE;
  };

  const subscribeToQueue = (jobData) => {
    jobData.status = QUEUE_ITEM_STATES.PENDING;
    queue.enqueue(jobData);
  };

  const finishRequest = () => {
    if (queue.isEmpty()) return;

    const item = queue.dequeue();
    item.status = QUEUE_ITEM_STATES.DONE;
  };

  const getNextRequest = () => {
    return queue.peek();
  };

  const peekRequest = () => {
    return queue.peek();
  };

  const printQueue = () => {
    queue.printQueue();
  };

  const deleteQueueItem = (sessionId, clientId) => {
    const index = queue.findItemIndex((item) => item.sessionId === sessionId && item.clientId === clientId);
    if (index < 0) return;

    queue.removeItem(index);
    if (queue.isEmpty()) {
      state = MACHINE_STATES.IDLE;
    }
  };

  const setItemProgress = (progress) => {
    progressingItem["progress"] = progress;
  };

  const getCompressedQueue = ({ tool = null, clientId = null }) => {
    let fileredQueueItems = queue.items;

    if (tool != null) {
      fileredQueueItems = fileredQueueItems.filter((item) => item.tool === tool);
    }

    if (clientId != null) {
      fileredQueueItems = fileredQueueItems.filter((item) => item.clientId === clientId);
    }

    return fileredQueueItems.map(({ clientId, sessionId, tool, requestedAt, data: { artifacts, dngWorkspace }, progress = null }) => ({
      requestedAt,
      clientId,
      sessionId,
      tool,
      dngWorkspace,
      progress,
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
    finishRequest,
    deleteQueueItem,
    setItemProgress,
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
