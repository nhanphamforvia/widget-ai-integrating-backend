const { Worker } = require("worker_threads");
const { XMLParser } = require("fast-xml-parser");
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

/* START: CONSISTENCY */
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
/* END: CONSISTENCY */

/* START: Translate, Toxic and Quality */
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
/* END: Translate, Toxic and Quality */

/* START: Test case generation */
const filterSignalsUsedInRequirement = (requirementText, signalNames, signalsWithValues) => {
  return signalNames.reduce((signalsUsed, signalName) => {
    if (requirementText.includes(signalName)) {
      return {
        ...signalsUsed,
        [signalName]: signalsWithValues[signalName],
      };
    }

    return signalsUsed;
  }, {});
};

const reduceExistingTestCasesToMapOfWords = (existingTestCases) => {
  const existingTestCasesLookup = new Map();
  const existingTestCasesByWords = new Map();

  existingTestCases.forEach((tcXml) => {
    const id = tcXml["rdf:Description"]["oslc:shortId"];
    const title = tcXml["rdf:Description"]["dcterms:title"];
    const description = tcXml["rdf:Description"]["dcterms:description"];

    existingTestCasesByWords.set(id, {
      title: new Set(title?.split(" ") || ""),
      description: new Set(description?.split(" ") || ""),
    });

    existingTestCasesLookup.set(id, {
      xml: tcXml,
      id,
      title,
      description,
    });
  });

  return [existingTestCasesByWords, existingTestCasesLookup];
};

const parseLackConstraintsFlag = (testCaseOptionsStr) => {
  const regex = /lackConstraints[:=]\s*(\w+)/;
  const match = testCaseOptionsStr.match(regex);

  const lackConstraintsValue = match ? match[1] : null;

  return lackConstraintsValue?.trim() === "true";
};

const parseSingleTestCase = (testCaseOptionsStr) => {
  // Extract relevant information from the input string
  const titleMatch = testCaseOptionsStr.match(/Title: (.+)/);
  const descriptionMatch = testCaseOptionsStr.match(/Description: (.+)/);
  const outputDefinedMatch = testCaseOptionsStr.match(/OutputDefined:\s*(true|false)\b/);

  // Create an object with the extracted properties
  const parsedData = {
    title: titleMatch ? titleMatch[1].trim() : "",
    description: descriptionMatch ? descriptionMatch[1].trim() : "",
  };

  if (outputDefinedMatch) {
    parsedData.outputDefined = outputDefinedMatch[1].trim() === "true";
  }

  return parsedData;
};

const parseTextToArrayOfTestCases = (testCaseOptionsStr) => {
  const testCaseStrs = testCaseOptionsStr.split(/Test Case \d+:|Test Case \d+|Test Case:/);

  const testCases = testCaseStrs.map((str) => {
    return parseSingleTestCase(str);
  });

  return testCases.filter((data) => data.title !== "" && data.description !== "");
};

const selectOutputDefinedTestCasesData = (testCasesData) => {
  return testCasesData.reduce((definedTestCases, testCaseData) => {
    const { outputDefined, title, description } = testCaseData;

    if (outputDefined === false) {
      return definedTestCases;
    }

    return [
      ...definedTestCases,
      {
        title: title,
        description: description,
      },
    ];
  }, []);
};

const consultAIForTestCaseOptions = async ({ requirementData, signalsWithValues, signalNames, prompt, role }) => {
  const CONSULT_ERRORS = {
    lackConstraints: "LACK CONSTRAINTS",
    signalValuesUndefined: "SIGNALS POSSIBLE VALUES NOT FOUND",
  };

  const signalsUsed = filterSignalsUsedInRequirement(requirementData.primaryText, signalNames, signalsWithValues);

  const conditionPrompt = `\n- Requirement content: ${requirementData.primaryText}
  - Requirement type: ${requirementData.type}
  - Signals' possible values: ${JSON.stringify(signalsUsed)}`;

  const messages = [
    {
      role: "system",
      content: role,
    },
    {
      role: "user",
      content: prompt + conditionPrompt,
    },
  ];

  try {
    const resData = await chatCompletion(messages, TEMP);

    if (resData.status !== "success") {
      const message = resData.data[0];
      throw new Error(message);
    }

    if (resData.error) {
      throw new Error("Something went wrong to check the test cases!");
    }

    const testCaseOptionsStr = resData.data?.[0];

    const consultError = Object.values(CONSULT_ERRORS).find((value) => {
      return testCaseOptionsStr.includes(value);
    });

    if (consultError || parseLackConstraintsFlag(testCaseOptionsStr)) {
      const msg = `Requirement <strong>${requirementData.id}</strong> is <strong>not testable</strong> due to high toxicity`;
      throw new Error(msg);
    }

    if (testCaseOptionsStr.startsWith("Test Case")) {
      return selectOutputDefinedTestCasesData(parseTextToArrayOfTestCases(testCaseOptionsStr));
    }

    return selectOutputDefinedTestCasesData([parseSingleTestCase(testCaseOptionsStr)]);
  } catch (err) {
    throw err;
  }
};

const getRelevantExistingTestCases = async (testCasesData, existingTestCasesByWords, existingTestCasesLookup) => {
  try {
    testCasesData.forEach((tcData, i) => (tcData.index = i));
    const potentialTestCasePairs = [];
    const similarityThreshold = 0.3;

    const tcCount = testCasesData.length;
    const WORKERS_MAX = 2; // TODO need to find the max workers
    const CONCUR_MAX = 50;

    let workers = [];
    let concurTCs = [];

    const handleWorkerMessage = (workerGroups) => {
      workerGroups.forEach(([index, potentials]) => {
        potentialTestCasePairs[index] = {
          index,
          potentials: potentials.map(({ id }) => {
            return existingTestCasesLookup.has(id) ? existingTestCasesLookup.get(id) : null;
          }),
        };
      });
    };

    const createWorker = (concurTCs, existingTestCasesByWords, similarityThreshold) => {
      const worker = new Worker("./controllers/helpers/worker.js", { workerData: { concurTCs, existingTestCasesByWords, similarityThreshold } });
      worker.on("error", (err) => {
        throw err;
      });
      worker.on("message", handleWorkerMessage);
      return worker;
    };

    for (let i = 0; i < tcCount; i++) {
      if (concurTCs.length < CONCUR_MAX) {
        concurTCs.push(testCasesData[i]);
      }

      if (workers.length < WORKERS_MAX && (concurTCs.length >= CONCUR_MAX || i === tcCount - 1)) {
        const worker = createWorker(concurTCs, existingTestCasesByWords, similarityThreshold);
        workers.push(worker);
        concurTCs = [];
      }

      if (workers.length >= WORKERS_MAX || i === tcCount - 1) {
        workers.forEach((worker) => {
          worker.postMessage("start");
        });

        await Promise.allSettled(workers.map((worker) => new Promise((resolve) => worker.on("message", resolve))));
        workers.forEach((worker) => worker.terminate());
        workers = [];
      }
    }

    const potentialsWithProposalTestCases = testCasesData.map((tcData) => {
      const potentialTCs = potentialTestCasePairs.find((potentialTC) => potentialTC && potentialTC.index === tcData.index);

      return {
        ...(potentialTCs || { index: tcData.index, potentials: [] }),
        proposal: tcData,
      };
    });

    return potentialsWithProposalTestCases;
  } catch (err) {
    throw err;
  }
};

const consultAISelectExistingTestCase = async (dataStr, requirmentData) => {
  const role = "You are a tester, checking for potential test case that match the proposal test content to validate requirement";
  const prompt = `In the criteria of boundary check to validate the requirement, choose which ID of one test case from Potential Test Cases that share the most similar purpose and meaning of the description of the Proposal Content\n${dataStr}. \nRequirement to validate: ${requirmentData.primaryText}.\ If match found, answer in the exact format: {# of Proposal Content}: {ID value}. If no match found, answer in the exact format {# of Proposal Content}: None`;

  const messages = [
    {
      role: "system",
      content: role,
    },
    {
      role: "user",
      content: prompt,
    },
  ];

  try {
    const resData = await chatCompletion(messages, TEMP);

    if (resData.status !== "success") {
      throw new Error("Requirement Analysis for Testcases failure");
    }

    const potentialMatch = resData.data?.[0];
    return potentialMatch;
  } catch (err) {
    throw err;
  }
};

const splitPromiseSettledResponses = (responses) => {
  const { successList, failList } = responses.reduce(
    (obj, res) => {
      if (res.status !== "fulfilled") {
        return {
          ...obj,
          failList: [...obj.failList, res.reason],
        };
      }

      return {
        ...obj,
        successList: [...obj.successList, res.value],
      };
    },
    {
      successList: [],
      failList: [],
    }
  );

  return [successList, failList];
};

const getTestCasesMatches = async (potentialsWithProposalTestCases, requirementData) => {
  const SLIDE_WIDTH = 5;

  const promptsData = potentialsWithProposalTestCases.map((item) => {
    return `Proposal Content ${item.index}:\n\tDescription: ${item.proposal.description}\nPotential Test Cases ${item.index}:\n${item.potentials.map(
      (potential) => `\tID: ${potential.id}\nDescription: ${potential.description}`
    )}\n\n`;
  });

  const promiseHandler = async (dataStr) => consultAISelectExistingTestCase(dataStr, requirementData);
  const promptResponses = await processDataInBatches(promptsData, SLIDE_WIDTH, promiseHandler, null);

  return splitPromiseSettledResponses(promptResponses);
};

const parseAndRematchPairData = (match, testCasesData, existingTestCasesLookup) => {
  let splitItem = match.split(": ");

  const index = parseInt(splitItem[0]);
  const matchedIDs = splitItem[1] === "None" || splitItem[1] === "none" || splitItem[1] == null ? null : splitItem[1].split(",");

  return {
    index,
    proposal: testCasesData.find((tc) => tc.index === index),
    matchedTestCase: matchedIDs && existingTestCasesLookup.has(matchedIDs[0].trim()) ? existingTestCasesLookup.get(matchedIDs[0].trim()) : null,
  };
};

const extractTestCasesToCreateOrMatch = (rematches) => {
  return rematches.reduce(
    (obj, rematch) => {
      if (rematch.matchedTestCase == null)
        return {
          ...obj,
          tcCreationRequired: [...obj.tcCreationRequired, rematch],
        };

      return {
        ...obj,
        matchedTCs: [...obj.matchedTCs, rematch],
      };
    },
    {
      tcCreationRequired: [],
      matchedTCs: [],
    }
  );
};

const checkExistOrCreateTestCases = async ({ requirementData, signalsWithValues, signalNames, existingTestCasesByWords, existingTestCasesLookup, prompt, role }) => {
  try {
    const testCasesData = await consultAIForTestCaseOptions({
      requirementData,
      signalsWithValues,
      signalNames,
      prompt,
      role,
    });

    const potentialsWithProposalTestCases = await getRelevantExistingTestCases(testCasesData, existingTestCasesByWords, existingTestCasesLookup);
    const [matchedExistingTestCases, failedMatching] = await getTestCasesMatches(potentialsWithProposalTestCases, requirementData);

    // TODO: Handle failed matchin here
    const rematches = matchedExistingTestCases.map((match) => {
      return parseAndRematchPairData(match, testCasesData, existingTestCasesLookup);
    });

    const { tcCreationRequired, matchedTCs } = extractTestCasesToCreateOrMatch(rematches);

    console.log(matchedTCs);

    return { tcCreationRequired, matchedTCs };
  } catch (err) {
    throw err;
  }
};

exports.useChatCompletionForTestCaseGeneration = async (artifacts, dataForTestCases, prompt, role, batchSize = REQ_PER_TIME) => {
  const abortController = new AbortController();
  const xmlParser = new XMLParser();

  try {
    const { existingTestCases, signalsWithValues, commonEtmTCEnvVariables } = dataForTestCases;
    const existingTestCaseXmls = existingTestCases.map((tcStr) => xmlParser.parse(tcStr));
    const signalNames = Array.from(Object.keys(signalsWithValues));
    const [existingTestCasesByWords, existingTestCasesLookup] = reduceExistingTestCasesToMapOfWords(existingTestCaseXmls);

    const promiseHandler = async (requirementData) =>
      checkExistOrCreateTestCases({ requirementData, signalsWithValues, signalNames, existingTestCasesByWords, existingTestCasesLookup, commonEtmTCEnvVariables, prompt, role });
    const progressHandler = ({}) => {};

    const responses = await processDataInBatches(artifacts, REQ_PER_TIME, promiseHandler, progressHandler, abortController);

    const { tcCreationRequired, matchedTCs, errors } = responses.reduce(
      (flattenData, res) => {
        if (res.status === "fulfilled") {
          return {
            ...flattenData,
            tcCreationRequired: [...flattenData.tcCreationRequired, res.value.tcCreationRequired],
            matchedTCs: [...flattenData.matchedTCs, res.value.matchedTCs],
          };
        }

        if (res.status === "rejected") {
          return {
            ...flattenData,
            errors: [...flattenData.errors, res.reason],
          };
        }

        return flattenData;
      },
      {
        tcCreationRequired: [],
        matchedTCs: [],
        errors: [],
      }
    );

    return {
      data: {
        tcCreationRequired,
        matchedTCs,
      },
      errors,
    };
  } catch (err) {
    throw err;
  }
};
/* END: Test case generation */
