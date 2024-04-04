const openAIClient = require("../openAIConnect");
const catchAsync = require("../utils/catchAsync");

const TEMP = 0.0;

exports.chatCompletion = catchAsync(async (req, res, next) => {
  const deploymentName = process.env.OPEN_API_DEPLOYMENT_NAME;
  const { sysContent, userContent } = req.body;

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

  const result = await openAIClient.getChatCompletions(deploymentName, messages, { temperature: TEMP });

  if (result.choices == null) {
    return res.status(400).json({
      status: "fail",
      message: `Failed to complete the chat for: ${content}`,
    });
  }

  res.status(200).json({
    status: "success",
    data: result.choices.map((choice) => choice.message.content),
  });
});
