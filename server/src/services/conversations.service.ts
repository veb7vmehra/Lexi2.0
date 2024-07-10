import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { OpenAI } from 'openai';
import { IAgent } from 'src/types';
import { ConversationsModel } from '../models/ConversationsModel';
import { ExplainableModel } from '../models/ExplainableModel';
import { MetadataConversationsModel } from '../models/MetadataConversationsModel';
import { experimentsService } from './experiments.service';
import { usersService } from './users.service';
import { CurrentStateModels } from '../models/CurrentStateModels';
import { validate } from 'uuid';

dotenv.config();

interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) throw new Error('Server is not configured with OpenAI API key');
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

class ConversationsService {
    message = async (message: any, conversationId: string, streamResponse?) => {
        const [conversation, metadataConversation] = await Promise.all([
            this.getConversation(conversationId),
            this.getConversationMetadata(conversationId),
        ]);
        //console.log(metadataConversation.agent);
        const agent = JSON.parse(JSON.stringify(metadataConversation.agent));
        //const { cameraCaptureRate, ...agentWithoutCameraCaptureRate } = agent;
        delete agent.cameraCaptureRate;
        const current_state = await this.getCurrentState(conversationId)
        const val = current_state[0]["valence"] / current_state[0]["count"]
        const ar = current_state[0]["arousal"] / current_state[0]["count"]
        console.log(current_state[0]["valence"])
        console.log(current_state[0]["arousal"])
        const messages: any[] = this.getConversationMessages(agent, conversation, message, val, ar);
        const chatRequest = this.getChatRequest(agent, messages);
        await this.createMessageDoc(message, conversationId, conversation.length + 1, val, ar);

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

        await this.createMessageDoc(
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

        const Exmessages: any[] = this.getExplainableText(agent, conversation, message, val, ar);
        const ExchatRequest = this.getChatRequest(agent, messages);

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

        await this.createExplainableDoc(
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

        return assistantMessage;
    };

    createConversation = async (userId: string, userConversationsNumber: number, experimentId: string) => {
        let agent;
        const user = await usersService.getUserById(userId);
        if (user.isAdmin) {
            agent = await experimentsService.getActiveAgent(experimentId);
        }

        const res = await MetadataConversationsModel.create({
            conversationNumber: userConversationsNumber + 1,
            experimentId,
            userId,
            agent: user.isAdmin ? agent : user.agent,
        });

        const firstMessage: Message = {
            role: 'assistant',
            content: user.isAdmin ? agent.firstChatSentence : user.agent.firstChatSentence,
        };
        //const current_state = await this.getCurrentState(res._id.toString())
        //const val = current_state["valence"] / current_state["count"]
        //const ar = current_state["arousal"] / current_state["count"]
        await this.createMessageDoc(firstMessage, res._id.toString(), 1, 0, 0);
        usersService.addConversation(userId);

        return res._id.toString();
    };

    getConversation = async (conversationId: string) => {
        const conversation = await ConversationsModel.find({ conversationId }, { _id: 0, role: 1, content: 1 });
        //console.log(conversation)
        return conversation;
    };

    getCurrentState = async (conversationId: string) => {
        try {
            console.log(conversationId);
            const current_state = await CurrentStateModels.find({ id: conversationId }).exec();
            console.log(current_state);
            return current_state;
        } catch (err) {
            console.error(err);
            return null;
        }
    };

    updateIms = async (conversationId: string, imsValues, isPreConversation: boolean) => {
        const saveField = isPreConversation ? { imsPre: imsValues } : { imsPost: imsValues };

        const res = await MetadataConversationsModel.updateMany(
            {
                _id: new mongoose.Types.ObjectId(conversationId),
            },
            { $set: saveField },
        );

        return res;
    };

    getConversationMetadata = async (conversationId: string): Promise<any> => {
        const res = await MetadataConversationsModel.findOne({ _id: new mongoose.Types.ObjectId(conversationId) });
        return res;
    };

    getUserConversations = async (userId: string): Promise<any> => {
        const conversations = [];
        const metadataConversations = await MetadataConversationsModel.find({ userId }, { agent: 0 }).lean();

        for (const metadataConversation of metadataConversations) {
            const conversation = await ConversationsModel.find({
                conversationId: metadataConversation._id,
            }).lean();
            conversations.push({
                metadata: metadataConversation,
                conversation,
            });
        }

        return conversations;
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

    private getConversationMessages = (settings: any, conversation: any[], message: any, val: number, ar: number) => {
        const systemPrompt: Message = { role: 'system', content: settings.systemStarterPrompt };
        const beforeUserMessage = { role: 'system', content: settings.beforeUserSentencePrompt };
        const afterUserMessage = { role: 'system', content: settings.afterUserSentencePrompt };
        console.log(message)
        const final_message = "The valence of the user is "+ val + " and the arousal is "+ ar + "while user replies to you " + message["content"]
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

    private getExplainableText = (settings: any, conversation: any[], message: any, val: number, ar: number) => {
        const systemPrompt: Message = { role: 'system', content: "" };
        const beforeUserMessage = { role: 'system', content: "" };
        const afterUserMessage = { role: 'system', content: "" };
        //console.log(message)
        const final_message = "The valence of the user is "+ val + " and the arousal is "+ ar + ". What do you understand from these about the emotions expressed by the user? What behavioral qualities should be displayed while responding to this user to improve their mental state?"
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


    private createMessageDoc = async (message: Message, conversationId: string, messageNumber: number, val:number, ar:number) => {
        const res = await ConversationsModel.create({
            content: message.content,
            role: message.role,
            conversationId,
            messageNumber,
            valence: val, 
            arousal: ar,
        });

        return res;
    };

    private createExplainableDoc = async (message: Message, resp: Message, conversationId: string, messageNumber: number, val:number, ar:number) => {
        const res = await ExplainableModel.create({
            input: message.content,
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
        };

        if (agent.maxTokens) chatCompletionsReq['max_tokens'] = agent.maxTokens;
        if (agent.frequencyPenalty) chatCompletionsReq['frequency_penalty'] = agent.frequencyPenalty;
        if (agent.topP) chatCompletionsReq['top_p'] = agent.topP;
        if (agent.temperature) chatCompletionsReq['temperature'] = agent.temperature;
        if (agent.presencePenalty) chatCompletionsReq['presence_penalty'] = agent.presencePenalty;
        if (agent.cameraCaptureRate) chatCompletionsReq['cameraCaptureRate'] = agent.cameraCaptureRate;
        if (agent.stopSequences) chatCompletionsReq['stop'] = agent.stopSequences;

        return chatCompletionsReq;
    };
}

export const conversationsService = new ConversationsService();
