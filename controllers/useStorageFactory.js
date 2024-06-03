exports.useStorageFactory = () => {
  const results = new Map();

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

  return { getResultsByClientID, addResultToStorage, removeResultByClientIDAndSessionID };
};
