const openAIClient = require("../../openAIConnect");
const AppError = require("../../utils/appError");
const processDataInBatches = require("../../utils/processDataInBatches");

const TEMP = 0.0;
const deploymentName = process.env.OPEN_API_DEPLOYMENT_NAME;
const REQ_PER_TIME = 30;

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

// Consistency
const parsePairsWithIssuesOnly = (string) => {
  let regex = /^Issues \((\d+ - \d+)\): ([\s\S]*?)(?=^Issues \(\d+ - \d+\): |$)/gm;
  let match;
  let result = [];

  while ((match = regex.exec(string)) !== null) {
    result.push({
      pairIds: match[1].split(" - ").map(Number),
      message: match[2].trim(),
    });
  }

  return result;
};

const executeCheckConsistency = async ({ visitedMap, checkQueue, prompt, role }) => {
  const REQ_PER_TIME = 30;

  const issues = [];
  const issuesData = [];
  const errors = [];

  const abortController = new AbortController();

  const promiseHandler = async ({ current, others, otherIds, currentId }) => {
    const visitedKey = `${currentId}: ${otherIds.join(",")}`;
    if (visitedMap.has(visitedKey)) {
      return null;
    }

    visitedMap.set(visitedKey, true);

    const messages = [
      {
        role: "system",
        content: role,
      },
      {
        role: "user",
        content: prompt + `${current}\n${others}`,
      },
    ];

    try {
      const resData = await chatCompletion(messages, TEMP);

      if (resData.status === "success") {
        const message = resData.data[0];

        if (resData.error) {
          return null;
        }

        return {
          issue: `(${currentId} - ${otherIds.join(", ")}) - ${message}`,
          issueData: {
            artId: currentId,
            otherIds: otherIds,
            message,
          },
        };
      }
    } catch (err) {
      throw err;
    }
  };

  const progressHandler = ({ batchResponses }) => {};

  const responses = await processDataInBatches(checkQueue, REQ_PER_TIME, promiseHandler, progressHandler, abortController);

  responses.forEach((res) => {
    if (res.status === "fulfilled" && res.value != null) {
      const { issue, issueData } = res.value;
      issues.push(issue);
      issuesData.push(issueData);
    }
    if (res.status === "rejected") {
      errors.push(res.reason);
    }
  });

  return {
    issues,
    issuesData,
    errors,
  };
};

const buildQueueAndCheckConsistency = async ({ requirements, MAX_CHARS = 4000, prompt, role, visitedMap }) => {
  let checkQueue = [];
  const abortController = new AbortController();

  const REQ_PER_TIME = 30;
  const artsCount = requirements.length;

  const queueIssues = [];
  const queueIssuesData = [];
  const queueErrors = [];

  const innerCheckConsistency = async () => {
    try {
      const { issues, issuesData, errors } = await executeCheckConsistency({
        visitedMap,
        checkQueue,
        prompt,
        role,
      });

      checkQueue = [];
      queueIssues.push(...issues);
      queueIssuesData.push(...issuesData);
      queueErrors.push(...errors);
    } catch (err) {
      throw err;
    }
  };

  for (let i = 0; i < artsCount; i++) {
    const currentArt = requirements[i];
    const remainingArts = requirements.slice(i + 1);

    const currentStatementText = `Main: ${currentArt.id}: ${currentArt.primaryText.trim()}`;
    let charCount = prompt.length + currentStatementText.length;
    let j = 0;
    let otherStatementTexts = "Others:\n";
    let otherIds = [];

    const remainingLength = remainingArts.length;

    while (j < remainingLength) {
      const otherArt = remainingArts[j];
      const nextStatementText = `${otherArt.id}: ${otherArt.primaryText.trim()}\n`;

      charCount += nextStatementText.length;

      if (charCount >= MAX_CHARS) {
        checkQueue.push({ current: currentStatementText, currentId: currentArt.id, otherIds, others: otherStatementTexts });

        charCount = prompt.length + currentStatementText.length;
        otherStatementTexts = "";
        otherIds = [];
        j -= 1;
      } else {
        otherIds.push(otherArt.id);
        otherStatementTexts += nextStatementText;
      }

      if (j == remainingLength - 1) {
        checkQueue.push({ current: currentStatementText, currentId: currentArt.id, otherIds, others: otherStatementTexts });
      }

      j += 1;
    }

    if (checkQueue.length >= REQ_PER_TIME) {
      await innerCheckConsistency();
    }

    if (abortController.signal.aborted) break;
  }

  if (!abortController.signal.aborted && checkQueue.length > 0) {
    await innerCheckConsistency();
  }

  return {
    issues: queueIssues,
    issuesData: queueIssuesData.map((issueData) => ({
      ...issueData,
      pairsWithIssues: parsePairsWithIssuesOnly(issueData.message),
    })),
    errors: queueErrors,
  };
};

// Translate, Toxic and Quality
const individualPromiseHandler = (prompt, role) => async (art) => {
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

      if (message.startsWith("No issue")) {
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

// Exported functions
exports.useChatCompletionForConsistency = async (similarTextGroups, prompt, role) => {
  const groupsTotal = similarTextGroups.length;

  const visitedMap = new Map();
  const consistencyIssues = [];
  const consistencyIssuesData = [];
  const consistencyCheckErrors = [];

  for (let i = 0; i < groupsTotal; i++) {
    const { issues, issuesData, errors } = await buildQueueAndCheckConsistency({
      requirements: similarTextGroups[i],
      MAX_CHARS: 4000,
      prompt,
      role,
      visitedMap,
    });

    consistencyIssues.push(...issues);
    consistencyIssuesData.push(...issuesData);
    consistencyCheckErrors.push(...errors);
  }

  return {
    data: {
      consistencyIssues,
      consistencyIssuesData,
    },
    errors: consistencyCheckErrors,
  };
};

exports.useChatCompletionForIndividualItem = async (artifacts, prompt, role, batchSize = REQ_PER_TIME) => {
  const abortController = new AbortController(); // TODO: Find a way so the client can cancel this while this is running!

  const progressHandler = ({ currentIndex, totalIndices }) => {
    const progress = ((currentIndex / totalIndices) * 100).toFixed(2);
    // TODO: Find a way to let client get this progress info
  };

  const results = await processDataInBatches(artifacts, batchSize, individualPromiseHandler(prompt, role), progressHandler, abortController);

  return results.reduce(
    (dataAndError, res) => {
      if (res.status === "fulfilled" && res.value) {
        return {
          ...dataAndError,
          data: [...dataAndError.data, res.value],
        };
      }

      if (res.status === "rejected") {
        return {
          ...dataAndError,
          errors: [...dataAndError.errors, res.reason],
        };
      }

      return dataAndError;
    },
    {
      data: [],
      errors: [],
    }
  );
};
