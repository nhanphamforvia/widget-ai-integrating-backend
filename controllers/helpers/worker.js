const { parentPort, workerData } = require("worker_threads");

const computeSimilarities = ({ concurTCs, existingTestCasesByWords, similarityThreshold }) => {
  const groups = new Map();
  const visited = new Map();

  const POTENTIAL_MAX = 7;

  const concursLength = concurTCs.length;
  const existingTestCaseEntries = Array.from(existingTestCasesByWords.entries());
  const existingLength = existingTestCaseEntries.length;

  for (let i = 0; i < concursLength; i++) {
    const { index, title: requiredTitle, description: requiredDescription } = concurTCs[i];
    const currentDescriptionWords = new Set(requiredDescription?.split(" ") || "");
    const currentDescriptionNumbers = (requiredDescription.match(/\d+/g) || []).map(Number);

    for (let j = 0; j < existingLength; j++) {
      const [id, value] = existingTestCaseEntries[j];
      if (visited.has(id)) continue;

      const { title: existingTitle, description: existingDescriptionWords } = value;

      // Calculate Jaccard simiflarity using intersection and union of word sets
      const intersectionSize = new Set([...currentDescriptionWords].filter((word) => existingDescriptionWords.has(word))).size;
      const unionSize = currentDescriptionWords.size + existingDescriptionWords.size - intersectionSize;
      let similarity = intersectionSize / unionSize;
      let numberSimilarity = 0;

      const numberMatches = currentDescriptionNumbers.filter((num) => existingDescriptionWords.has(num.toString()));

      if (currentDescriptionNumbers.length > 0 && numberMatches.length === 0) continue;

      if (numberMatches.length > 0) {
        similarity = 1;
        numberSimilarity = numberMatches.length / currentDescriptionNumbers.length;
      }

      if (similarity < similarityThreshold) continue;

      const group = groups.get(index) || [];
      visited.set(id, true);
      group.push({ id, similarity, numberSimilarity });
      group.sort((a, b) => {
        if (b.similarity === a.similarity) {
          return b.numberSimilarity - a.numberSimilarity;
        }

        return b.similarity - a.similarity;
      });

      if (group.length > POTENTIAL_MAX) {
        const removed = group.pop();
        visited.delete(removed.id);
      }
      groups.set(index, group);
    }
  }

  return groups;
};

parentPort.on("message", (msg) => {
  if (msg === "start") {
    const groups = computeSimilarities(workerData);
    parentPort.postMessage(Array.from(groups.entries()));
    return;
  }

  throw new Error(`Unknown message: ${msg}`);
});
