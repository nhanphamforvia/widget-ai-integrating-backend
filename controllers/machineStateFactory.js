const catchAsync = require("../utils/catchAsync");

const MACHINE_STATES = {
    IDLE: "idle",
    BUSY: "busy",
  };
  
  const RESET_MACHINE_STATE_DELAY = 60000;

exports.useMachineState = () => {
  const machineState = {
    state: MACHINE_STATES.IDLE,
    currentUserId: null,
    idleTimer: null,
  };

  const resetMachineState = () => {
    machineState.state = MACHINE_STATES.IDLE;
    machineState.idleTimer = null;
    machineState.currentUserId = null;
  };

  const occupyMachine = (userId, resetTime = RESET_MACHINE_STATE_DELAY) => {
    machineState.currentUserId = userId;
    machineState.state = MACHINE_STATES.BUSY;
    if (machineState.idleTimer) {
      clearTimeout(machineState.idleTimer);
    }

    machineState.idleTimer = setTimeout(resetMachineState, resetTime);
  };

  const isMachineBusy = (userId) => {
    return machineState.state === MACHINE_STATES.BUSY && machineState.currentUserId !== userId;
  };

  const getCurrentUserId = () => {
    return machineState.currentUserId;
  };

  return [machineState, isMachineBusy, occupyMachine, getCurrentUserId];
};
  
exports.checkBusy = (isMachineBusy, getCurrentUserId) => catchAsync(async (req, res, next) => {
  const { userId } = req.user;

  if (userId == null) {
    res.status(400).json({
      status: "fail",
      message: "User ID is required!",
    });
    return;
  }
  
  if (isMachineBusy(userId)) {
    res.status(200).json({
      status: "success",
      message: "The server is busy. Please try again later!",
      data: {
        blockedByStateMachine: true,
        currentUserId: getCurrentUserId(),
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

exports.checkMachineState = (isMachineBusy, occupyMachine) => (req, res, next) => {
  const { userId } = req.user;

  if (userId == null) {
    res.status(400).json({
      status: "fail",
      message: "User ID is required!",
    });
    return;
  }

  if (isMachineBusy(userId)) {
    next(new AppError("The server is busy. Please try again later!", 429))
    return;
  }

  occupyMachine(userId);

  next();
};
  