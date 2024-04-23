const path = require('path');
const Database = require('../Database');

const promptsDb = new Database(path.resolve(__dirname, 'prompts.json'));

exports.getPrompts = async () => {
    const promptsData = await promptsDb.read();
    return promptsData;
}

exports.updatePrompt = async ({ promptName, newValue }) => {
    const promptsData = await promptsDb.read();
    const prompt = promptsData[promptName]
    if (prompt != null) {
        prompt.value = newValue
    }

    promptsDb.scheduleWrite()
    
    return prompt
}