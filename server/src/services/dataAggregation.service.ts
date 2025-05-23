import ExcelJS from 'exceljs';
import { conversationsService } from './conversations.service';
import { experimentsService } from './experiments.service';
import { usersService } from './users.service';
import { response } from 'express';

const mainSheetCol = [
    { header: 'Agents Mode', key: 'agentsMode' },
    { header: 'Total Number of Participants', key: 'totalParticipants' },
];

const agentsSheetCol = [
    { header: 'Number of Participants', key: 'numParticipants' },
    { header: 'Condition Title', key: 'conditionTitle' },
    { header: 'Summary', key: 'summary' },
    { header: 'System Starter Prompt', key: 'systemStarterPrompt' },
    { header: 'Before User Sentence Prompt', key: 'beforeUserSentencePrompt' },
    { header: 'After User Sentence Prompt', key: 'afterUserSentencePrompt' },
    { header: 'Inverse time delay', key: 'inverseTimeDelay' },
    { header: 'First Chat Sentence', key: 'firstChatSentence' },
    { header: 'Model', key: 'model' },
    { header: 'Temperature', key: 'temperature' },
    { header: 'Max Tokens', key: 'maxTokens' },
    { header: 'Top P', key: 'topP' },
    { header: 'Frequency Penalty', key: 'frequencyPenalty' },
    { header: 'Presence Penalty', key: 'presencePenalty' },
    { header: 'Camera Capture Rate', key: 'cameraCaptureRate'},
    { header: 'Audio Input', key: 'audioInput'},
    { header: 'Valence-Arousal Integration', key: 'vaIntegration'},
    { header: 'Stop Sequences', key: 'stopSequences' },
];

const getUserStaticFields = () => {
    return new Set([
        '_id',
        'timestamp',
        'username',
        'numberOfConversations',
        'age',
        'gender',
        'createdAt',
        'agent',
        'isAdmin',
        'password',
        'agent',
        'experimentId',
    ]);
};

const getConversationColFields = () => {
    return new Set([
        'agent',
        'username',
        'conversationNumber',
        'messagesNumber',
        'createdAt',
        'lastMessageDate',
        'isFinished',
        'id',
        '_id',
    ]);
};

const getUserColFields = () => {
    return new Set([
        '_id',
        'id',
        'timestamp',
        'username',
        'numberOfConversations',
        'age',
        'gender',
        'createdAt',
        'isAdmin',
        'password',
        'agent',
        'experimentId',
    ]);
};

const getUsersSheetCol = () => [
    { header: 'Agent', key: 'agent' },
    { header: 'Username', key: 'username' },
    { header: 'Number of Conversations', key: 'numberOfConversations' },
    { header: 'Age', key: 'age' },
    { header: 'Gender', key: 'gender' },
    { header: 'Created At', key: 'createdAt' },
];

const getConversationsSheetCol = () => [
    { header: 'Conversation ID', key: 'id' },
    { header: 'Agent', key: 'agent' },
    { header: 'User', key: 'username' },
    { header: 'Conversation Number', key: 'conversationNumber' },
    { header: 'Number Of Messages', key: 'messagesNumber' },
    { header: 'Created At', key: 'createdAt' },
    { header: 'Last Message Date', key: 'lastMessageDate' },
    { header: 'Finished', key: 'isFinished' },
];

const messagesSheetCol = [
    { header: 'Conversation ID', key: 'conversationId' },
    { header: 'Message ID', key: 'messageId' },
    { header: 'Agent', key: 'agent' },
    { header: 'User', key: 'username' },
    { header: 'Number of User Conversation', key: 'conversationNumber' },
    { header: 'Message Number', key: 'messageNumber' },
    { header: 'Role', key: 'role' },
    { header: 'User Annotation', key: 'userAnnotation' },
    { header: 'Content', key: 'content' },
    { header: 'Valence', key: 'valence' },
    { header: 'Arousal', key: 'arousal' },
    { header: 'Pitch', key: 'pit'},
    {header: 'Loudness', key: 'loud'},
    {header: 'SNR', key: 'snr'},
    { header: 'Created At', key: 'createdAt' },
];

const expAISheetCol = [
    { header: 'Conversation ID', key: 'conversationId' },
    { header: 'user_input', key: 'user_input' },
    { header: 'prompt_input', key: 'prompt_input' },
    { header: 'response', key: 'response' },
    { header: 'Message Number', key: 'messageNumber' },
    { header: 'Role', key: 'role' },
    { header: 'Valence', key: 'valence' },
    { header: 'Arousal', key: 'arousal' },
    { header: 'Created At', key: 'createdAt' },
]

class DataAggregationService {
    getExperimentData = async (experimentId: string) => {
        const [experimentUsers, experiment] = await Promise.all([
            usersService.getExperimentUsers(experimentId),
            experimentsService.getExperiment(experimentId),
        ]);

        const agents = [];
        let totalUsers = 0;
        for (const users of experimentUsers) {
            totalUsers += users.data.length;
            const data = [];
            for (const user of users.data) {
                const { agent, ...userWithoutAgent } = user;
                //console.log(agent)
                const conversations = await conversationsService.getUserConversations(user._id, agent.cameraCaptureRate, agent.vaIntegration);
                //console.log(conversations[0])
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                data.push({
                    numberOfConversations: user.numberOfConversations,
                    user: userWithoutAgent,
                    conversations,
                });
            }

            agents.push({
                numberOfParticipants: users.data.length,
                condition: users.agent,
                data,
            });
        }

        return {
            agentsMode: experiment.agentsMode,
            numberOfParticipants: totalUsers,
            agents,
        };
    };

    createExperimentDataExcel = async (experimentId) => {
        const experimentData = await this.getExperimentData(experimentId);
        const workbook = new ExcelJS.Workbook();

        const mainSheet = workbook.addWorksheet('Main');
        const agentsSheet = workbook.addWorksheet('Agents');
        const usersSheet = workbook.addWorksheet('Users');
        const conversationsSheet = workbook.addWorksheet('Conversations');
        const messagesSheet = workbook.addWorksheet('Messages');
        const expAISheet = workbook.addWorksheet('Explainable AI');
        const conversationsSheetCol = getConversationsSheetCol();
        const usersSheetCol = getUsersSheetCol();
        const conversationColFields = getConversationColFields();
        const userStaticFields = getUserStaticFields();
        const userColFields = getUserColFields();

        experimentData.agents.forEach((agent) => {
            agent.data.forEach((user) => {
                user.conversations.forEach((conversation) => {
                    Object.keys(user.user).forEach((field) => {
                        if (!userColFields.has(field)) {
                            userColFields.add(field);
                            usersSheetCol.push({ header: field, key: field });
                        }
                    });
                    if (conversation.metadata.preConversation) {
                        Object.keys(conversation.metadata.preConversation).forEach((key) => {
                            if (!conversationColFields.has(`pre_${key}`)) {
                                conversationColFields.add(`pre_${key}`);
                                conversationsSheetCol.push({ header: `pre_${key}`, key: `pre_${key}` });
                            }
                        });
                    }
                    if (conversation.metadata.postConversation) {
                        Object.keys(conversation.metadata.postConversation).forEach((key) => {
                            if (!conversationColFields.has(`post_${key}`)) {
                                conversationColFields.add(`post_${key}`);
                                conversationsSheetCol.push({ header: `post_${key}`, key: `post_${key}` });
                            }
                        });
                    }
                });
            });
        });

        mainSheet.columns = mainSheetCol;
        agentsSheet.columns = agentsSheetCol;
        usersSheet.columns = usersSheetCol;
        conversationsSheet.columns = conversationsSheetCol;
        messagesSheet.columns = messagesSheetCol;
        expAISheet.columns = expAISheetCol;

        mainSheet.addRow({
            agentsMode: experimentData.agentsMode,
            totalParticipants: experimentData.numberOfParticipants,
        });

        let userRowIndex = 1;
        let conversationRowIndex = 1;
        let agentRowIndex = 1;

        experimentData.agents.forEach((agent) => {
            agentsSheet.addRow({
                numParticipants: agent.numberOfParticipants,
                conditionTitle: agent.condition.title,
                summary: agent.condition.summary,
                systemStarterPrompt: agent.condition.systemStarterPrompt,
                beforeUserSentencePrompt: agent.condition.beforeUserSentencePrompt,
                afterUserSentencePrompt: agent.condition.afterUserSentencePrompt,
                inverseTimeDelay: agent.condition.inverseTimeDelay,
                firstChatSentence: agent.condition.firstChatSentence,
                model: agent.condition.model,
                temperature: agent.condition.temperature,
                maxTokens: agent.condition.maxTokens,
                topP: agent.condition.topP,
                frequencyPenalty: agent.condition.frequencyPenalty,
                presencePenalty: agent.condition.presencePenalty,
                cameraCaptureRate: agent.condition.cameraCaptureRate,
                audioInput: agent.condition.audioInput,
                vaIntegration: agent.condition.vaIntegration,
                stopSequences: agent.condition.stopSequences,
            });

            agent.data.forEach((user) => {
                const userRow = {
                    agent: {
                        text: agent.condition.title,
                        hyperlink: `#\'Agents\'!A${agentRowIndex + 1}`,
                    },
                    username: user.user.username,
                    numberOfConversations: user.numberOfConversations,
                    age: user.user.age,
                    gender: user.user.gender,
                    createdAt: user.user.createdAt,
                };

                Object.entries(user.user).forEach(([key, value]) => {
                    if (!userStaticFields.has(key)) {
                        userRow[key] = value;
                    }
                });

                usersSheet.addRow(userRow);
                user.conversations.forEach((conversation) => {
                    const conversationRow = {
                        id: conversation.metadata._id,
                        agent: {
                            text: agent.condition.title,
                            hyperlink: `#\'Agents\'!A${agentRowIndex + 1}`,
                        },
                        username: {
                            text: user.user.username,
                            hyperlink: `#\'Users\'!A${userRowIndex + 1}`,
                        },
                        conversationNumber: conversation.metadata.conversationNumber,
                        messagesNumber: conversation.metadata.messagesNumber,
                        createdAt: conversation.metadata.createdAt,
                        lastMessageDate: conversation.metadata.lastMessageDate,
                        isFinished: conversation.metadata.isFinished,
                    };

                    if (conversation.metadata.preConversation) {
                        Object.entries(conversation.metadata.preConversation).forEach(([key, value]) => {
                            conversationRow[`pre_${key}`] = value;
                        });
                    }

                    if (conversation.metadata.postConversation) {
                        Object.entries(conversation.metadata.postConversation).forEach(([key, value]) => {
                            conversationRow[`post_${key}`] = value;
                        });
                    }

                    conversationsSheet.addRow(conversationRow);
                    //console.log(conversation.conversation.length);
                    //console.log(conversation.expAIData.length);
                    //let count = 0;
                    conversation.conversation.forEach((message) => {
                        messagesSheet.addRow({
                            conversationId: {
                                text: conversation.metadata._id,
                                hyperlink: `#\'Conversations\'!A${conversationRowIndex + 1}`,
                            },
                            messageId: message._id,
                            agent: {
                                text: agent.condition.title,
                                hyperlink: `#\'Agents\'!A${agentRowIndex + 1}`,
                            },
                            username: {
                                text: user.user.username,
                                hyperlink: `#\'Users\'!A${userRowIndex + 1}`,
                            },
                            conversationNumber: conversation.metadata.conversationNumber,
                            content: message.content,
                            valence: message.valence,
                            arousal: message.arousal,
                            pit: message.pit,
                            loud: message.loud,
                            snr: message.snr,
                            role: message.role,
                            createdAt: message.createdAt,
                            messageNumber: message.messageNumber,
                            userAnnotation: message.userAnnotation,
                        });
                    });
                    console.log(agent.condition.cameraCaptureRate)
                    if ( agent.condition.cameraCaptureRate != null && agent.condition.vaIntegration != null ) {
                        conversation.expAIData.forEach((message) => {
                            expAISheet.addRow({
                                conversationId: {
                                    text: conversation.metadata._id,
                                    hyperlink: `#\'Conversations\'!A${conversationRowIndex + 1}`,
                                },
                                user_input: message.user_input,
                                prompt_input: message.prompt_input,
                                response: message.response,
                                valence: message.valence,
                                arousal: message.arousal,
                                role: message.role,
                                createdAt: message.createdAt,
                                messageNumber: message.messageNumber,
                            });
                        });
                    }

                    conversationRowIndex++;
                });

                userRowIndex++;
            });
            agentRowIndex++;
        });

        return workbook;
    };
}

export const dataAggregationService = new DataAggregationService();
