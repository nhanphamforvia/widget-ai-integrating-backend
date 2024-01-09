const catchAsync = require("../utils/catchAsync");

exports.chatCompletion = catchAsync(async (req, res, next) => {
  const endpoint = `${process.env.OPEN_API_BASE}/openai/deployments/${process.env.OPEN_API_DEPLOYMENT_NAME}/completions?api-version=${process.env.OPEN_API_VERSION}`;

  const headers = {
    "Content-Type": "application/json",
    "api-key": process.env.OPEN_API_KEY,
  };

  const data = {
    prompt: `${req.body.content}`,
    max_tokens: 1000,
  };

  const fetchRes = await fetch(endpoint, {
    headers,
    method: "POST",
    body: JSON.stringify(data),
  });

  console.log(fetchRes);

  const fetchData = await fetchRes.json();

  console.log("\nprompt: " + req.body.content + "\n");
  console.log(fetchData);
  console.log("\nresult: " + fetchData.choices?.[0]?.text);

  res.status(200).json({
    status: "success",
    data: fetchData,
  });
});
