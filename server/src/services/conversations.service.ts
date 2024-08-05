import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { OpenAI } from 'openai';
import { IAgent, Message, UserAnnotation } from 'src/types';
import { ConversationsModel } from '../models/ConversationsModel';
import { ExplainableModel } from '../models/ExplainableModel';
import { MetadataConversationsModel } from '../models/MetadataConversationsModel';
import { experimentsService } from './experiments.service';
import { usersService } from './users.service';
import { CurrentStateModels } from '../models/CurrentStateModels';
import { validate } from 'uuid';
import * as fs from 'fs';
import * as Papa from 'papaparse';

dotenv.config();

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) throw new Error('Server is not configured with OpenAI API key');
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

interface CsvData {
    // Define the properties based on your CSV columns
    filename: string;
    category: string;
    valence: number;
    arousal: number;
}

const readCsvFile = (filePath: string): Promise<CsvData[]> => {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                return reject(err);
            }

            Papa.parse<CsvData>(data, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    resolve(results.data);
                },
                error: (error) => {
                    reject(error);
                },
            });
        });
    });
};

class ConversationsService {
    message = async (message, conversationId: string, streamResponse?) => {
        const [conversation, metadataConversation] = await Promise.all([
            this.getConversation(conversationId, true),
            this.getConversationMetadata(conversationId),
        ]);

        if (
            metadataConversation.maxMessages &&
            metadataConversation.messagesNumber + 1 > metadataConversation.maxMessages
        ) {
            const error = new Error('Message limit exceeded');
            error['code'] = 403;
            throw error;
        }

        const agent = JSON.parse(JSON.stringify(metadataConversation.agent));
        //const { cameraCaptureRate, ...agentWithoutCameraCaptureRate } = agent;
        //console.log(agent)
        const name = agent.title
        console.log(name)
        const ccr = agent.cameraCaptureRate
        const vai = agent.vaIntegration
        const valOption = agent.valOption
        const arOption = agent.arOption
        const explainabilityPrompt = agent.explainabilityPrompt
        //console.log("vai", vai)
        //console.log("ccr", ccr)
        delete agent.cameraCaptureRate;
        delete agent.vaIntegration;
        delete agent.valOption;
        delete agent.arOption;
        delete agent.explainabilityPrompt;
        //let tempt = await CurrentStateModels.find({ }).exec();
        //console.log(tempt)
        let val: number[] = [];
        let ar: number[] = [];

        if ( name === "vebAgent" ) {
            val = [0, 0, 0]
            ar = [0, 0, 0]
            readCsvFile('/home/ubuntu/Lexi2.0/output_csv.csv')
            .then((data) => {
                console.log(data);
            })
            .catch((error) => {
                console.error('Error reading CSV file:', error);
            });

            const savedMessage = await this.createMessageDoc(
                {
                    content: "The data should be logged",
                    role: 'assistant',
                },
                conversationId,
                conversation.length + 2,
                val,
                ar,
            );
            
            return savedMessage
        }
        
        if ( ccr != null && vai != null ) {
            const current_state = await this.getCurrentState(conversationId)
            val.push(current_state[0]["valence"] / current_state[0]["count"])
            ar.push(current_state[0]["arousal"] / current_state[0]["count"])
            val.push(Math.max(...current_state[0]["valence_all"]))
            val.push(Math.min(...current_state[0]["valence_all"]))
            ar.push(Math.max(...current_state[0]["arousal_all"]))
            ar.push(Math.min(...current_state[0]["arousal_all"]))

            await this.updateCurrentState(conversationId, 0, 0, 0);
        }
        //console.log(current_state[0]["valence"])
        //console.log(current_state[0]["arousal"])
        //console.log(val_max, ar_min)
        
        const og_text = { ...message };
        //console.log(og_text)
        const messages: any[] = this.getConversationMessages(agent, conversation, message, val, ar, ccr, vai, valOption, arOption);
        const chatRequest = this.getChatRequest(agent, messages);
        await this.createMessageDoc(og_text, conversationId, conversation.length + 1, val, ar);

        let assistantMessage = '';
        let streamExplainable = streamResponse;

        if (!streamResponse) {
            const response = await openai.chat.completions.create(chatRequest);
            assistantMessage = response.choices[0].message.content?.trim();
        } else {
            const responseStream = await openai.chat.completions.create({ ...chatRequest, stream: true });
            for await (const partialResponse of responseStream) {
                const assistantMessagePart = partialResponse.choices[0]?.delta?.content || '';
                await streamResponse(assistantMessagePart);
                assistantMessage += assistantMessagePart;
            }
        }

        const savedMessage = await this.createMessageDoc(
            {
                content: assistantMessage,
                role: 'assistant',
            },
            conversationId,
            conversation.length + 2,
            val,
            ar,
        );

        this.updateConversationMetadata(conversationId, {
            $inc: { messagesNumber: 1 },
            $set: { lastMessageDate: new Date(), lastMessageTimestamp: Date.now() },
        });

        if ( ccr != null && vai != null ) {
            const Exmessages: any[] = this.getExplainableText(agent, conversation, message, val, ar, valOption, arOption, explainabilityPrompt);
            const ExchatRequest = this.getChatRequest(agent, Exmessages);

            let ExassistantMessage = '';        

            if (true) {
                const response = await openai.chat.completions.create(ExchatRequest);
                ExassistantMessage = response.choices[0].message.content?.trim();
            } 
            /*else {
                const responseStream = await openai.chat.completions.create({ ...ExchatRequest, stream: true });
                for await (const partialResponse of responseStream) {
                    const assistantMessagePart = partialResponse.choices[0]?.delta?.content || '';
                    await streamResponse(assistantMessagePart);
                    ExassistantMessage += assistantMessagePart;
                }
            }*/
            console.log("idk why", og_text)
            await this.createExplainableDoc(
                og_text,
                message,
                {
                    content: ExassistantMessage,
                    role: 'assistant',
                },
                conversationId,
                conversation.length + 2,
                val,
                ar,
            );
        }

        return savedMessage;
    };

    createConversation = async (userId: string, userConversationsNumber: number, experimentId: string) => {
        let agent;
        const [user, experimentBoundries] = await Promise.all([
            usersService.getUserById(userId),
            experimentsService.getExperimentBoundries(experimentId),
        ]);

        if (
            !user.isAdmin &&
            experimentBoundries.maxConversations &&
            userConversationsNumber + 1 > experimentBoundries.maxConversations
        ) {
            const error = new Error('Conversations limit exceeded');
            error['code'] = 403;
            throw error;
        }

        if (user.isAdmin) {
            //console.log("Vaibhav here too")
            agent = await experimentsService.getActiveAgent(experimentId);
        }
        //console.log("Are you working here?")
        //console.log("Vaibhav here", agent)
        const res = await MetadataConversationsModel.create({
            conversationNumber: userConversationsNumber + 1,
            experimentId,
            userId,
            agent: user.isAdmin ? agent : user.agent,
            maxMessages: user.isAdmin ? undefined : experimentBoundries.maxMessages,
        });
        //console.log("Why aren't you working here?")
        const firstMessage: Message = {
            role: 'assistant',
            content: user.isAdmin ? agent.firstChatSentence : user.agent.firstChatSentence,
        };
        console.log(firstMessage)
        await Promise.all([
            this.createMessageDoc(firstMessage, res._id.toString(), 1, [0, 0, 0], [0, 0, 0]),
            usersService.addConversation(userId),
            !user.isAdmin && experimentsService.addSession(experimentId),
        ]);

        return res._id.toString();
    };

    getConversation = async (conversationId: string, isLean = false): Promise<Message[]> => {
        const returnValues = isLean
            ? { _id: 0, role: 1, content: 1 }
            : { _id: 1, role: 1, content: 1, userAnnotation: 1 };

        const conversation = await ConversationsModel.find({ conversationId }, returnValues);

        return conversation;
    };

    getCurrentState = async (conversationId: string) => {
        try {
            console.log("Are you even here?")
            console.log(conversationId);
            const current_state = await CurrentStateModels.find({ id: conversationId }).exec();
            console.log(current_state);
            return current_state;
        } catch (err) {
            console.error(err);
            return null;
        }
    };

    updateCurrentState = async (conversationId: string, valence: number, arousal: number, count: number) => {
        try {
            console.log(conversationId);
            
            // Find the current state document
            const current_state = await CurrentStateModels.findOne({ id: conversationId }).exec();
            
            if (!current_state) {
                console.log('Current state not found');
                return null;
            }
    
            // Update the values
            current_state.valence = valence;
            current_state.arousal = arousal;
            current_state.count = count;
            current_state.valence_all = []
            current_state.arousal_all = []
    
            // Save the updated document
            const updated_state = await current_state.save();
            console.log(updated_state);
            return updated_state;
        } catch (err) {
            console.error(err);
            return null;
        }
    };

    updateConversationSurveysData = async (conversationId: string, data, isPreConversation: boolean) => {
        const saveField = isPreConversation ? { preConversation: data } : { postConversation: data };
        const res = await this.updateConversationMetadata(conversationId, saveField);

        return res;
    };

    getConversationMetadata = async (conversationId: string): Promise<any> => {
        const res = await MetadataConversationsModel.findOne({ _id: new mongoose.Types.ObjectId(conversationId) });
        return res;
    };

    getUserConversations = async (userId: string, ccr, vai): Promise<any> => {
        const conversations = [];
        const metadataConversations = await MetadataConversationsModel.find({ userId }, { agent: 0 }).lean();

        for (const metadataConversation of metadataConversations) {
            const conversation = await ConversationsModel.find({
                conversationId: metadataConversation._id,
            }).lean();
            let expAI = {}
            console.log(ccr)
            if (ccr != null && vai != null) {
                expAI = await ExplainableModel.find({
                    conversationId: metadataConversation._id,
                }).lean()
            }
            conversations.push({
                metadata: metadataConversation,
                conversation,
                expAIData: expAI,
            });
        }

        return conversations;
    };

    finishConversation = async (conversationId: string, experimentId: string, isAdmin: boolean): Promise<void> => {
        const res = await MetadataConversationsModel.updateOne(
            { _id: new mongoose.Types.ObjectId(conversationId) },
            { $set: { isFinished: true } },
        );

        if (res.modifiedCount && !isAdmin) {
            await experimentsService.closeSession(experimentId);
        }
    };

    deleteExperimentConversations = async (experimentId: string): Promise<void> => {
        const conversationIds = await this.getExperimentConversationsIds(experimentId);
        await Promise.all([
            MetadataConversationsModel.deleteMany({ _id: { $in: conversationIds.ids } }),
            ConversationsModel.deleteMany({ conversationId: { $in: conversationIds.strIds } }),
        ]);
    };

    updateUserAnnotation = async (messageId: string, userAnnotation: UserAnnotation): Promise<Message> => {
        const message: Message = await ConversationsModel.findOneAndUpdate(
            { _id: messageId },
            { $set: { userAnnotation } },
            { new: true },
        );

        return message;
    };

    private updateConversationMetadata = async (conversationId, fields) => {
        try {
            const res = await MetadataConversationsModel.updateOne(
                { _id: new mongoose.Types.ObjectId(conversationId) },
                fields,
            );
            return res;
        } catch (error) {
            console.error(`updateConversationMetadata - ${error}`);
        }
    };

    private getConversationMessages = (agent: IAgent, conversation: Message[], message: Message, val, ar, ccr, vai, valOption, arOption) => {
        const systemPrompt = { role: 'system', content: agent.systemStarterPrompt };
        const beforeUserMessage = { role: 'system', content: agent.beforeUserSentencePrompt };
        const afterUserMessage = { role: 'system', content: agent.afterUserSentencePrompt };
	
        if ( ccr != null && vai != null ) {
            let v_text = "";
            let a_text = "";
            if (valOption === "mean") {
                v_text = "The valence of the user is "+ val[0].toString()
            } else if (valOption === "max") {
                v_text = "The valence of the user is "+ val[1].toString()
            } else if (valOption === "min") {
                v_text = "The valence of the user is "+ val[2].toString()
            } else if (valOption === "all") {
                v_text = "The average valence of the user is "+ val[0].toString() + " while the range of Valence is from "+ val[2].toString() + " to " + val[1].toString()
            }

            if (arOption === "mean") {
                a_text = " and the arousal of the user is "+ ar[0].toString()
            } else if (arOption === "max") {
                a_text = " and the arousal of the user is "+ ar[1].toString()
            } else if (arOption === "min") {
                a_text = " and the arousal of the user is "+ ar[2].toString()
            } else if (arOption === "all") {
                v_text = " and the average arousal of the user is "+ ar[0].toString() + " while the range of arousal is from "+ ar[2].toString() + " to " + ar[1].toString()
            }
            const final_message = v_text + a_text + " while user replies to you " + message["content"] + " (Do not share the Valence Arousal values with user.)"
            message["content"] = final_message
        }
	//message["content"] = agent.beforeUserSentencePrompt + " " + message["content"] + " " + agent.afterUserSentencePrompt
        console.log(message)
        const messages = [
            systemPrompt,
            ...conversation,
            beforeUserMessage,
            message,
            afterUserMessage,
            { role: 'assistant', content: '' },
        ];

        return messages;
    };

    private getExplainableText = (settings: any, conversation: any[], message: any, val, ar, valOption, arOption, explainabilityPrompt) => {
        const systemPrompt: Message = { role: 'system', content: "" };
        const beforeUserMessage = { role: 'system', content: "" };
        const afterUserMessage = { role: 'system', content: "" };
        //console.log(message)
        let v_text = "";
        let a_text = "";
        if (valOption === "mean") {
            v_text = "The valence of the user is "+ val[0].toString()
        } else if (valOption === "max") {
            v_text = "The valence of the user is "+ val[1].toString()
        } else if (valOption === "min") {
            v_text = "The valence of the user is "+ val[2].toString()
        } else if (valOption === "all") {
            v_text = "The average valence of the user is "+ val[0].toString() + "while the range of Valence is from "+ val[2].toString() + " to " + val[1].toString()
        }

        if (arOption === "mean") {
            a_text = " and the arousal of the user is "+ ar[0].toString()
        } else if (arOption === "max") {
            a_text = " and the arousal of the user is "+ ar[1].toString()
        } else if (arOption === "min") {
            a_text = " and the arousal of the user is "+ ar[2].toString()
        } else if (arOption === "all") {
            v_text = " and the average arousal of the user is "+ ar[0].toString() + "while the range of arousal is from "+ ar[2].toString() + " to " + ar[1].toString()
        }
        const final_message = v_text + a_text + ". " + explainabilityPrompt
        message["content"] = final_message
        console.log(message)
        const messages: any = [
            systemPrompt,
            ...conversation,
            beforeUserMessage,
            message,
            afterUserMessage,
            { role: 'assistant', content: '' },
        ];

        return messages;
    };

    private createMessageDoc = async (
        message: Message,
        conversationId: string,
        messageNumber: number,
        val,
        ar,
    ): Promise<Message> => {
        const res = await ConversationsModel.create({
            content: message.content,
            role: message.role,
            conversationId,
            messageNumber,
            valence: val,
            arousal: ar,
        });

        return { _id: res._id, role: res.role, content: res.content, userAnnotation: res.userAnnotation };
    };

    private createExplainableDoc = async (og_text: Message, message: Message, resp: Message, conversationId: string, messageNumber: number, val, ar) => {
        const res = await ExplainableModel.create({
            user_input: og_text.content,
            prompt_input: message.content,
            response: resp.content,
            role: resp.role,
            conversationId,
            messageNumber,
            valence: val, 
            arousal: ar,
        });

        return res;
    };

    private getChatRequest = (agent: IAgent, messages: Message[]) => {
        const chatCompletionsReq = {
            messages,
            model: agent.model,
            //"gpt-4o"
        };

        if (agent.maxTokens) chatCompletionsReq['max_tokens'] = agent.maxTokens;
        if (agent.frequencyPenalty) chatCompletionsReq['frequency_penalty'] = agent.frequencyPenalty;
        if (agent.topP) chatCompletionsReq['top_p'] = agent.topP;
        if (agent.temperature) chatCompletionsReq['temperature'] = agent.temperature;
        if (agent.presencePenalty) chatCompletionsReq['presence_penalty'] = agent.presencePenalty;
        if (agent.cameraCaptureRate) chatCompletionsReq['cameraCaptureRate'] = agent.cameraCaptureRate;
        if (agent.vaIntegration) chatCompletionsReq['vaIntegration'] = agent.vaIntegration;
        if (agent.stopSequences) chatCompletionsReq['stop'] = agent.stopSequences;

        return chatCompletionsReq;
    };

    private getExperimentConversationsIds = async (
        experimentId: string,
    ): Promise<{ ids: mongoose.Types.ObjectId[]; strIds: string[] }> => {
        const conversationsIds = await MetadataConversationsModel.aggregate([
            { $match: { experimentId } },
            { $project: { _id: 1, id: { $toString: '$_id' } } },
            { $group: { _id: null, ids: { $push: '$_id' }, strIds: { $push: '$id' } } },
            { $project: { _id: 0, ids: 1, strIds: 1 } },
        ]);
        return conversationsIds[0];
    };
}

export const conversationsService = new ConversationsService();
