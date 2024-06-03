exports.useStorageFactory = () => {
  const results = new Map();

  const SEVEN_DAYS_OFFSET = 7 * 24 * 60 * 60 * 1000;
  const TWELVE_HRS_OFFSET = 12 * 60 * 60 * 1000;

  const getResultsByClientID = (clientId) => {
    return results.get(clientId) || [];
  };

  const addResultToStorage = (clientId, { requestedAt, sessionId, data, errors, tool, dngWorkspace }) => {
    const doneRequestsForClientId = getResultsByClientID(clientId);

    results.set(clientId, [
      ...doneRequestsForClientId,
      {
        requestedAt,
        sessionId,
        data,
        errors,
        tool,
        dngWorkspace,
      },
    ]);
  };

  const removeResultByClientIDAndSessionID = (clientId, sessionId) => {
    const finishedReqs = getResultsByClientID(clientId).filter((completion) => completion.sessionId !== sessionId);
    results.set(clientId, finishedReqs);
  };

  const removeOldResults = () => {
    const sevenDaysAgo = new Date(new Date().getTime() - SEVEN_DAYS_OFFSET); // 7 days in milliseconds

    results.forEach((value, clientId) => {
      const updatedResults = value.filter((completion) => new Date(completion.requestedAt) >= sevenDaysAgo);
      results.set(clientId, updatedResults);
    });
  };

  const startSevenDayPeriodCleanup = () => {
    // Run the removal function periodically (e.g., twice a day)
    setInterval(removeOldResults, TWELVE_HRS_OFFSET); // 12 hours in milliseconds
  };

  return { getResultsByClientID, addResultToStorage, removeResultByClientIDAndSessionID, startSevenDayPeriodCleanup };
};
