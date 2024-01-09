const catchAsync = require("../utils/catchAsync");

exports.chatCompletions = catchAsync(async (req, res, next) => {
  const endpoint = `${process.env.OPEP_API_BASE}/openai/deployments/${process.env.OPEN_API_DEPLOYMENT_NAME}/completions?api-version=${process.env.CHAT_COMPLETION_API_VERSION}`;

  const headers = {
    "Content-Type": "application/json",
    "api-key": process.env.OPEN_API_KEY,
  };

  console.log(req.body.content);

  const data = {
    prompt: `${req.body.content}`,
    max_tokens: 4000,
  };

  const fetchRes = await fetch(endpoint, {
    headers,
    method: "POST",
    body: JSON.stringify(data),
  });

  const fetchData = await fetchRes.json();

  res.status(200).json({
    status: "success",
    data: fetchData,
  });
});
