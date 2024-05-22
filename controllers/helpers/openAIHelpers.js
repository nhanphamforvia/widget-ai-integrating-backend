const { Worker } = require("worker_threads");
const { XMLParser } = require("fast-xml-parser");
const openAIClient = require("../../openAIConnect");
const AppError = require("../../utils/appError");
const processDataInBatches = require("../../utils/processDataInBatches");

const TEMP = 0.0;
const deploymentName = process.env.OPEN_API_DEPLOYMENT_NAME;
const REQ_PER_TIME = 30;
const OPEN_AI_MAX_TOKENS = 8000;

const EXISTING_AI_TESTCASE_ROLE = "You are a tester, checking for potential test case that match the proposal test content to validate requirement";
const EXISTING_AI_TESTCASE_PROMPT = `Choose which ID of the Potential Test Cases which has description with the most similar description of the Proposal Content\n<DATA_STRING>. \nRequirement to validate: <REQ_TEXT>.\ If match found, answer in the exact format: {#}: {ID}, in which # is the number of the Proposal Content in the prompt, ID is the ID of the potential test case. If no match found, answer in the exact format {# of Proposal Content}: None, in which # is the number of the Proposal Content in the prompt`;

const TESTCASE_GEN_STRATEGIES = {
  equivalenceClassPartiion: "equivalence-class-partitioning",
  boundaryValueAnalysis: "boundary-value-analysis",
};

const chatCompletion = async (messages, temperature = TEMP, { signal = null }) => {
  try {
    if (signal != null && signal.aborted) {
      return null;
    }

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

const executeCheckConsistency = async ({ visitedMap, checkQueue, prompt, role, abortController }) => {
  const REQ_PER_TIME = 30;

  const issues = [];
  const issuesData = [];
  const errors = [];

  const promiseHandler = async ({ current, others, otherIds, currentId }, abortController) => {
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
      const resData = await chatCompletion(messages, TEMP, { signal: abortController?.signal });

      if (resData.status === "success") {
        const message = resData.data[0];

        if (resData.error) {
          return null;
        }

        return {
          issue: `<strong>(${currentId} - ${otherIds.join(", ")})</strong> - ${message}`,
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

  const responses = await processDataInBatches(checkQueue, REQ_PER_TIME, promiseHandler, null, abortController);

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

const buildQueueAndCheckConsistency = async ({ requirements, maxCharsPerReq, prompt, role, visitedMap, abortController }) => {
  let checkQueue = [];

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
        abortController,
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

      if (charCount >= maxCharsPerReq) {
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

exports.useChatCompletionForConsistency = async (similarTextGroups, prompt, role, progressHandler, sessionId, { abortController = null }) => {
  const groupsTotal = similarTextGroups.length;

  const visitedMap = new Map();
  const consistencyIssues = [];
  const consistencyIssuesData = [];
  const consistencyCheckErrors = [];

  for (let i = 0; i < groupsTotal; i++) {
    const { issues, issuesData, errors } = await buildQueueAndCheckConsistency({
      requirements: similarTextGroups[i],
      maxCharsPerReq: OPEN_AI_MAX_TOKENS,
      prompt,
      role,
      visitedMap,
      abortController,
    });

    consistencyIssues.push(...issues);
    consistencyIssuesData.push(...issuesData);
    consistencyCheckErrors.push(...errors);

    progressHandler({ currentIndex: i, totalIndices: groupsTotal, processId: sessionId });
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
const individualPromiseHandler = (prompt, role) => async (art, abortController) => {
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
    const resData = await chatCompletion(messages, TEMP, { signal: abortController?.signal });

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

exports.useChatCompletionForIndividualItem = async (artifacts, prompt, role, progressHandler, sessionId, { batchSize = REQ_PER_TIME, abortController = null }) => {
  const results = await processDataInBatches(artifacts, batchSize, individualPromiseHandler(prompt, role), progressHandler, abortController, sessionId);

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
    const startIndex = requirementText.indexOf(signalName);
    // const quoteIndex = requirementText.indexOf('"', startIndex);
    // const spaceIndex = requirementText.indexOf(" ", startIndex);

    // let endIndex = -1;
    // if (quoteIndex < 0 && spaceIndex > 0) {
    //   endIndex = spaceIndex;
    // } else if (spaceIndex < 0 && quoteIndex > 0) {
    //   endIndex = quoteIndex;
    // } else if (spaceIndex > 0 && quoteIndex > 0) {
    //   endIndex = Math.min(spaceIndex, quoteIndex);
    // }

    const subString = requirementText.slice(startIndex);
    let i = 0;
    let endIndex = 0;

    while (!endIndex && i <= subString.length - 1) {
      const char = subString[i];
      if (char === "_" || (char >= "a" && char <= "z") || (char >= "A" && char <= "Z")) {
        i++;
        continue;
      }

      endIndex = startIndex + i;
      break;
    }

    const signalNameInReq = requirementText.slice(startIndex, endIndex);

    if (signalsWithValues[signalNameInReq]) {
      const type =
        signalsWithValues[signalNameInReq].enumerationValues == null || signalsWithValues[signalNameInReq].enumerationValues == "NA"
          ? TESTCASE_GEN_STRATEGIES.boundaryValueAnalysis
          : TESTCASE_GEN_STRATEGIES.equivalenceClassPartiion;

      return {
        ...signalsUsed,
        [signalName]: {
          ...signalsWithValues[signalNameInReq],
          type,
        },
      };
    }

    return signalsUsed;
  }, {});
};

const reduceExistingTestCasesToMapOfWords = (existingTestCases) => {
  const existingTestCasesLookup = new Map();
  const existingTestCasesByWords = new Map();

  existingTestCases.forEach((tcXml) => {
    const id = tcXml["rdf:Description"]["oslc:shortId"]?.["#text"];
    const title = tcXml["rdf:Description"]["dcterms:title"]?.["#text"];
    const description = tcXml["rdf:Description"]["dcterms:description"]?.["#text"];
    const rdfType = tcXml["rdf:Description"]["rdf:type"]["@_rdf:resource"];
    const rdfAbout = tcXml["rdf:Description"]["@_rdf:about"];
    const testLevel = tcXml["rdf:Description"]["custom:test_level"];

    if (!rdfType.endsWith("qm#TestCase")) return;

    existingTestCasesByWords.set(id, {
      title: new Set(title?.split(" ") || ""),
      description: new Set(description?.split(/[. "'\s]+/) || ""),
    });

    existingTestCasesLookup.set(id, {
      xml: tcXml,
      id,
      title,
      description,
      rdfType,
      rdfAbout,
      testLevel,
    });
  });

  return [existingTestCasesByWords, existingTestCasesLookup];
};

const parseSingleTestCase = (testCaseOptionsStr) => {
  // Extract relevant information from the input string
  const titleMatch = testCaseOptionsStr.match(/Title: (.+)/);
  const descriptionMatch = testCaseOptionsStr.match(/Description: (.+)/);
  const outputDefinedMatch = testCaseOptionsStr.match(/OutputDefined:\s*(true|false|True|False|TRUE|FALSE)\b/);

  // Create an object with the extracted properties
  const parsedData = {
    title: titleMatch ? titleMatch[1].trim() : "",
    description: descriptionMatch ? descriptionMatch[1].trim() : "",
  };

  if (outputDefinedMatch) {
    parsedData.outputDefined = outputDefinedMatch[1].trim().toLowerCase() === "true";
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

const consultAIForTestCasesGeneration = async ({ requirementData, signalsUsed, prompt, role, abortController }) => {
  const GENERATE_ERRORS = {
    lackConstraints: "LACK_CONSTRAINTS",
    signalValuesUndefined: "SIGNALS_POSSIBLE_VALUES_NOT_FOUND",
  };

  const conditionPrompt = `\n- Requirement content: ${requirementData.primaryText}\n- SIGNALS_POSSIBLE_VALUES: ${JSON.stringify(signalsUsed, null, 2)}`;

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
    const resData = await chatCompletion(messages, TEMP, { signal: abortController?.signal });

    if (resData.status !== "success") {
      const message = resData.data[0];
      throw new Error(message);
    }

    if (resData.error) {
      throw new Error("Something went wrong to check the test cases!");
    }

    const testCaseOptionsStr = resData.data?.[0];

    const consultError = Object.values(GENERATE_ERRORS).find((value) => {
      return testCaseOptionsStr.includes(value);
    });

    if (consultError) {
      const msg = `Requirement <strong>${requirementData.id}</strong> is <strong>not testable</strong> due to ${consultError?.split("_")?.join(" ")}`;
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

const getRelevantExistingTestCases = async ({ testCasesData, existingTestCasesByWords, existingTestCasesLookup, signalUsedNames, reqTestCaseLevel }) => {
  try {
    testCasesData.forEach((tcData, i) => {
      tcData.index = i;
    });

    const potentialTestCasePairs = [];
    const similarityThreshold = 0.5;

    const tcCount = testCasesData.length;
    const WORKERS_MAX = require("os").cpus().length - 1;
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

    const createWorker = (concurTCs, reqTestCaseLevel, existingTestCasesByWords, existingTestCasesLookup, similarityThreshold, signalUsedNames) => {
      const worker = new Worker("./controllers/helpers/worker.js", {
        workerData: { concurTCs, reqTestCaseLevel, existingTestCasesByWords, existingTestCasesLookup, similarityThreshold, signalUsedNames },
      });
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
        const worker = createWorker(concurTCs, reqTestCaseLevel, existingTestCasesByWords, existingTestCasesLookup, similarityThreshold, signalUsedNames);
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

const consultAISelectExistingTestCase = async (dataStr, requirmentData, abortController) => {
  const messages = [
    {
      role: "system",
      content: EXISTING_AI_TESTCASE_ROLE,
    },
    {
      role: "user",
      content: EXISTING_AI_TESTCASE_PROMPT.replace("<DATA_STRING>", dataStr).replace("<REQ_TEXT>", requirmentData.primaryText),
    },
  ];

  try {
    const resData = await chatCompletion(messages, TEMP, { signal: abortController?.signal });

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

const getTestCasesMatches = async (potentialsWithProposalTestCases, requirementData, abortController) => {
  const SLIDE_WIDTH = 5;

  const promptsData = potentialsWithProposalTestCases.map((item) => {
    return `Proposal Content ${item.index}:\n\tDescription: ${item.proposal.description}\nPotential Test Cases ${item.index}:\n${item.potentials.map(
      (potential) => `\tID: ${potential.id}\nDescription: ${potential.description}`
    )}\n\n`;
  });

  const promiseHandler = async (dataStr, abortController) => consultAISelectExistingTestCase(dataStr, requirementData, abortController);
  const promptResponses = await processDataInBatches(promptsData, SLIDE_WIDTH, promiseHandler, null, abortController);

  return splitPromiseSettledResponses(promptResponses);
};

const parseAndRematchPairData = (match, testCasesData, existingTestCasesLookup) => {
  let splitItem = match.split(": ");

  const index = parseInt(splitItem[0]);
  const matchedIDs = splitItem[1] === "None" || splitItem[1] === "none" || splitItem[1] == null ? null : splitItem[1].split(",").map(Number);
  const bestMatchedId = matchedIDs?.[0];

  return {
    index,
    proposal: testCasesData.find((tc) => tc.index === index),
    matchedTestCase: bestMatchedId && existingTestCasesLookup.has(bestMatchedId) ? existingTestCasesLookup.get(bestMatchedId) : null,
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

const checkExistOrCreateTestCases = async ({
  requirementData,
  signalsWithValues,
  signalNames,
  testLevelsData,
  existingTestCasesByWords,
  existingTestCasesLookup,
  prompt,
  role,
  abortController,
}) => {
  try {
    const signalsUsed = filterSignalsUsedInRequirement(requirementData.primaryText, signalNames, signalsWithValues);

    const testCasesData = await consultAIForTestCasesGeneration({
      requirementData,
      signalsUsed,
      prompt,
      role,
      abortController,
    });

    const { H_TestLevelByArtURILookup } = testLevelsData;
    const reqTestCaseLevel = H_TestLevelByArtURILookup[requirementData.typeRdfUri];

    const potentialsWithProposalTestCases = await getRelevantExistingTestCases({
      testCasesData,
      existingTestCasesByWords,
      existingTestCasesLookup,
      signalUsedNames: Object.keys(signalsUsed),
      reqTestCaseLevel,
    });

    const [matchedExistingTestCases, failedMatching] = await getTestCasesMatches(potentialsWithProposalTestCases, requirementData, abortController);

    // TODO: Handle failed matchin here
    const rematches = matchedExistingTestCases.map((match) => {
      return parseAndRematchPairData(match, testCasesData, existingTestCasesLookup);
    });

    const { tcCreationRequired, matchedTCs } = extractTestCasesToCreateOrMatch(rematches);

    return {
      requirementData: requirementData,
      tcCreationRequired,
      matchedTCs,
    };
  } catch (err) {
    throw err;
  }
};

// const parseLackConstraintsFlag = (testCaseOptionsStr) => {
//   const regex = /lackConstraints[:=]\s*(\w+)/;
//   const match = testCaseOptionsStr.match(regex);

//   const lackConstraintsValue = match ? match[1] : null;

//   return lackConstraintsValue?.trim() === "true";
// };

exports.useChatCompletionForTestCaseGeneration = async (
  artifacts,
  dataForTestCases,
  prompt,
  role,
  progressHandler,
  sessionId,
  { batchSize = REQ_PER_TIME, abortController = null }
) => {
  const xmlParser = new XMLParser({ ignoreAttributes: false });

  try {
    const { existingTestCases, signalsWithValues, commonEtmTCEnvVariables, testLevelsData } = dataForTestCases;
    const existingTestCaseXmls = existingTestCases.map((tcStr) => xmlParser.parse(tcStr));
    const signalNames = Array.from(Object.keys(signalsWithValues));
    const [existingTestCasesByWords, existingTestCasesLookup] = reduceExistingTestCasesToMapOfWords(existingTestCaseXmls);

    const promiseHandler = async (requirementData, abortController) =>
      checkExistOrCreateTestCases({
        requirementData,
        signalsWithValues,
        signalNames,
        testLevelsData,
        existingTestCasesByWords,
        existingTestCasesLookup,
        prompt,
        role,
        abortController,
      });

    const responses = await processDataInBatches(artifacts, batchSize, promiseHandler, progressHandler, abortController, sessionId);

    const { testCases, errors } = responses.reduce(
      (testCasesForRequirements, res) => {
        if (res.status === "fulfilled") {
          return {
            ...testCasesForRequirements,
            testCases: [...testCasesForRequirements.testCases, res.value],
          };
        } else {
          return {
            ...testCasesForRequirements,
            errors: [...testCasesForRequirements.errors, typeof res.reason === "object" ? res.reason.message : res.reason],
          };
        }
      },
      {
        testCases: [],
        errors: [],
      }
    );

    return {
      data: {
        testCases,
        commonEtmTCEnvVariables,
      },
      errors,
    };
  } catch (err) {
    throw err;
  }
};
/* END: Test case generation */
