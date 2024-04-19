const openAIClient = require("../openAIConnect");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { useMachineState, checkBusy, checkMachineState } = require("./machineStateFactory");

const TEMP = 0.0;

// State Machine variables
const [_, isServiceBusy, clientOccupyService, getCurrentClientId] = useMachineState();

exports.checkBusy = checkBusy(isServiceBusy, getCurrentClientId, "OpenAI");
exports.checkMachineState = checkMachineState(isServiceBusy, clientOccupyService);

exports.chatCompletion = catchAsync(async (req, res, next) => {
  const deploymentName = process.env.OPEN_API_DEPLOYMENT_NAME;
  const { sysContent, userContent, temperature = TEMP } = req.body;

  if (sysContent == null || userContent == null) {
    return res.status(400).json({
      status: "fail",
      message: "Need to have both system content and user content for chat completions!",
    });
  }

  const messages = [
    {
      role: "system",
      content: sysContent,
    },
    {
      role: "user",
      content: userContent,
    },
  ];

  try {
    const result = await openAIClient.getChatCompletions(deploymentName, messages, { temperature });

    if (result.choices == null) {
      next(new AppError(`Failed to complete the chat for: ${content}`, 400))
    }

    res.status(200).json({
      status: "success",
      data: result.choices.map((choice) => choice.message.content),
    });
  } catch (err) {
    next(err)
  }
});
