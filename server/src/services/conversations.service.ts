import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { OpenAI } from 'openai';
import fs from "fs";
import FormData from 'form-data';
import { IAgent, Message, UserAnnotation, Audio } from 'src/types';
import { ConversationsModel } from '../models/ConversationsModel';
import { ExplainableModel } from '../models/ExplainableModel';
import { MetadataConversationsModel } from '../models/MetadataConversationsModel';
import { experimentsService } from './experiments.service';
import { usersService } from './users.service';
import { CurrentStateModels } from '../models/CurrentStateModels';
import fetch from "node-fetch";
import Meyda from 'meyda';
import { AudioContext } from "node-web-audio-api";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
//import { Readable } from "stream";
//import { PassThrough } from "stream";
//import { exec } from "child_process";
//import util from "util";
import path from "path";

//const execPromise = util.promisify(exec);

ffmpeg.setFfmpegPath(ffmpegPath.path);

dotenv.config();

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) throw new Error('Server is not configured with OpenAI API key');
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function convertToWav(inputBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const tempInput = "temp_input.wav";
        const tempOutput = "temp_output.wav";

        // Write input buffer to temp file
        fs.writeFileSync(tempInput, inputBuffer);

        // Convert to PCM WAV
        ffmpeg(tempInput)
            .output(tempOutput)
            .audioCodec("pcm_s16le") // Ensures PCM format
            .toFormat("wav")
            .on("end", () => {
                const wavBuffer = fs.readFileSync(tempOutput);
                fs.unlinkSync(tempInput);
                fs.unlinkSync(tempOutput);
                resolve(wavBuffer);
            })
            .on("error", (err) => reject(err))
            .run();
    });
}

async function extractAudioFeatures(audioBuffer: Buffer): Promise<{ pitch: number; loudness: number; snr: number }> {
    try {
        const audioContext = new AudioContext();

        // Convert Buffer to ArrayBuffer
        const arrayBuffer = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength);

        // Decode Audio
        const audioBufferNode = await audioContext.decodeAudioData(arrayBuffer);
        const channelData = audioBufferNode.getChannelData(0); // Get first channel

        const bufferSize = 1024;
        const numChunks = Math.floor(channelData.length / bufferSize);

        let totalPitch = 0;
        let totalLoudness = 0;
        let count = 0;

        let signalRMSsum = 0;
        let noiseRMSsum = 0;
        let signalCount = 0;
        let noiseCount = 0;

        const noiseThresholdIndex = Math.floor(numChunks * 0.1); // first 10% as noise

        for (let i = 0; i < numChunks; i++) {
            const chunkArray = channelData.slice(i * bufferSize, (i + 1) * bufferSize);
            const chunk = new Float32Array(chunkArray);
            const features = Meyda.extract(["rms", "spectralCentroid"], chunk);

            if (features && features.rms !== undefined && features.spectralCentroid !== undefined) {
                const rms = features.rms || 0;
                const pitch = features.spectralCentroid || 0;

                totalPitch += pitch;
                totalLoudness += rms;
                count++;

                if (i < noiseThresholdIndex) {
                    noiseRMSsum += rms;
                    noiseCount++;
                } else {
                    signalRMSsum += rms;
                    signalCount++;
                }
            }
        }

        // Average RMS
        const avgSignalRMS = signalCount > 0 ? signalRMSsum / signalCount : 1e-8;
        const avgNoiseRMS = noiseCount > 0 ? noiseRMSsum / noiseCount : 1e-8;

        // SNR in dB
        const snr = 20 * Math.log10(avgSignalRMS / avgNoiseRMS);

        console.log({
            avgSignalRMS,
            avgNoiseRMS,
            snr,
        });        

        return {
            pitch: count > 0 ? totalPitch / count : 0,
            loudness: count > 0 ? totalLoudness / count : 0,
            snr: Number.isFinite(snr) ? snr : 0,
        };
    } catch (error) {
        console.error("Error processing audio:", error);
        return { pitch: 0, loudness: 0, snr: 0 };
    }
}


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
        const ccr = agent.cameraCaptureRate
        const vai = agent.vaIntegration
        const timeDelay = agent.inverseTimeDelay
        
        //console.log("vai", vai)
        //console.log("ccr", ccr)
        delete agent.cameraCaptureRate;
        delete agent.vaIntegration;
        //let tempt = await CurrentStateModels.find({ }).exec();
        //console.log(tempt)
        let val = 0;
        let ar = 0
        
        if ( ccr != null && vai != null ) {
            const current_state = await this.getCurrentState(conversationId)
            val = current_state[0]["valence"] / current_state[0]["count"]
            ar = current_state[0]["arousal"] / current_state[0]["count"]
        }
        //console.log(current_state[0]["valence"])
        //console.log(current_state[0]["arousal"])
        
        const og_text = { ...message };
        //console.log(og_text)
        const messages: any[] = this.getConversationMessages(agent, conversation, message, val, ar, ccr, vai);
        const chatRequest = this.getChatRequest(agent, messages);
        await this.createMessageDoc(message, conversationId, conversation.length + 1, val, ar, 0, 0, 0);

        let assistantMessage = '';
        let streamExplainable = streamResponse;
        if (!streamResponse) {
            const response = await openai.chat.completions.create(chatRequest);
            assistantMessage = response.choices[0].message.content?.trim();
            //const num_word = assistantMessage.trim().split(/\s+/).length;
            //console.log(num_word)
            //await new Promise(resolve => setTimeout(resolve, (num_word) * 1000));
        } else {
            const responseStream = await openai.chat.completions.create({ ...chatRequest, stream: true });
            for await (const partialResponse of responseStream) {
                const assistantMessagePart = partialResponse.choices[0]?.delta?.content || '';
                await streamResponse(assistantMessagePart);
                assistantMessage += assistantMessagePart;
            }
            //const num_word = assistantMessage.trim().split(/\s+/).length;
            //console.log(num_word)
            //await new Promise(resolve => setTimeout(resolve, (num_word) * 1000));
        }
        //console.log("before create message", timeDelay)
        const savedMessage = await this.createMessageDoc(
            {
                content: assistantMessage,
                role: 'assistant',
                timeDelay: timeDelay
            },
            conversationId,
            conversation.length + 2,
            val,
            ar,
            0,
            0,
            0
        );

        this.updateConversationMetadata(conversationId, {
            $inc: { messagesNumber: 1 },
            $set: { lastMessageDate: new Date(), lastMessageTimestamp: Date.now() },
        });

        if ( ccr != null && vai != null ) {
            const Exmessages: any[] = this.getExplainableText(agent, conversation, message, val, ar);
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
                    timeDelay: timeDelay
                },
                conversationId,
                conversation.length + 2,
                val,
                ar,
            );
        }
        //console.log(savedMessage)
        
        return savedMessage;
    };

    audio = async (message, conversationId: string, streamResponse?) => {
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
        const ccr = agent.cameraCaptureRate
        const vai = agent.vaIntegration
        const timeDelay = agent.inverseTimeDelay
        
        delete agent.cameraCaptureRate;
        delete agent.vaIntegration;

        //console.log(message.content)
        //console.log(typeof(message.content))

        //const audioBlob = new Blob([message.content], { type: "audio/wav" });

        let pit = 0
        let loud = 0
        let sn = 0

        await this.processAudio(message.content).then(({ pitch, loudness, snr }) => {
            pit = pitch
            loud = loudness
            sn = snr
        });

        console.log(pit)
        console.log(loud)
        console.log(sn)

        const text = await this.transcribeAudio(message.content);

        //console.log(typeof text);
        message.content = text;

        let val = 0;
        let ar = 0
        
        if ( ccr != null && vai != null ) {
            const current_state = await this.getCurrentState(conversationId)
            val = current_state[0]["valence"] / current_state[0]["count"]
            ar = current_state[0]["arousal"] / current_state[0]["count"]
        }
        
        const og_text = { ...message };
        const messages: any[] = this.getConversationMessages(agent, conversation, message, val, ar, ccr, vai);
        const chatRequest = this.getChatRequest(agent, messages);
        
        //NEED TO FIX THE LINE BELOW
        await this.createMessageDoc(message, conversationId, conversation.length + 1, val, ar, pit, loud, sn);

        let assistantMessage = '';
        if (!streamResponse) {
            const response = await openai.chat.completions.create(chatRequest);
            assistantMessage = response.choices[0].message.content?.trim();
            //const num_word = assistantMessage.trim().split(/\s+/).length;
            //console.log(num_word)
            //await new Promise(resolve => setTimeout(resolve, (num_word) * 1000));
        } else {
            const responseStream = await openai.chat.completions.create({ ...chatRequest, stream: true });
            for await (const partialResponse of responseStream) {
                const assistantMessagePart = partialResponse.choices[0]?.delta?.content || '';
                await streamResponse(assistantMessagePart);
                assistantMessage += assistantMessagePart;
            }
            //const num_word = assistantMessage.trim().split(/\s+/).length;
            //console.log(num_word)
            //await new Promise(resolve => setTimeout(resolve, (num_word) * 1000));
        }
        //console.log("before create message", timeDelay)
        const savedMessage = await this.createMessageDoc(
            {
                content: assistantMessage,
                role: 'assistant',
                timeDelay: timeDelay
            },
            conversationId,
            conversation.length + 2,
            val,
            ar,
            pit,
            loud,
            sn,
        );

        this.updateConversationMetadata(conversationId, {
            $inc: { messagesNumber: 1 },
            $set: { lastMessageDate: new Date(), lastMessageTimestamp: Date.now() },
        });

        const audio_new = await this.transcribeText(assistantMessage);
        console.log(audio_new)

        if ( ccr != null && vai != null ) {
            const Exmessages: any[] = this.getExplainableText(agent, conversation, message, val, ar);
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
            //console.log("idk why", og_text)
            await this.createExplainableDoc(
                og_text,
                message,
                {
                    content: ExassistantMessage,
                    role: 'assistant',
                    timeDelay: timeDelay
                },
                conversationId,
                conversation.length + 2,
                val,
                ar,
            );
        }
        
        const newMessage = {
            "_id": savedMessage._id, 
            "role": savedMessage.role,
            "content": audio_new, 
            "userAnnotation": savedMessage.userAnnotation,
            "timeDelay": savedMessage.timeDelay,
        }
        //console.log(newMessage)
        return newMessage;
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
            timeDelay: null
        };
        console.log(firstMessage)
        await Promise.all([
            this.createMessageDoc(firstMessage, res._id.toString(), 1, 0, 0, 0, 0, 0),
            usersService.addConversation(userId),
            !user.isAdmin && experimentsService.addSession(experimentId),
        ]);

        return res._id.toString();
    };

    getConversation = async (conversationId: string, isLean = false): Promise<Message[]> => {
        const returnValues = isLean
            ? { _id: 0, role: 1, content: 1, timeDelay: 1}
            : { _id: 1, role: 1, content: 1, timeDelay: 1, userAnnotation: 1 };

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

    private processAudio = async (audioBuffer: Buffer) => {
        try {
            const wavBuffer = await convertToWav(audioBuffer);
            return await extractAudioFeatures(wavBuffer);
        } catch (error) {
            console.error("Error processing audio:", error);
            return { pitch: 0, loudness: 0, snr: 0 };
        }
    }


    private transcribeAudio = async (audioBuffer: Buffer): Promise<string> => {
        try {
            //console.log(typeof audioBuffer);
            //console.log(audioBuffer);
            //console.log("inside");

            // Write the buffer to a temporary file
            const tempFilePath = "./temp_audio.wav";
            fs.writeFileSync(tempFilePath, audioBuffer);

            // Create a FormData object
            const formData = new FormData();
            formData.append("file", fs.createReadStream(tempFilePath));
            formData.append("model", "whisper-1");
            formData.append("language", "en");

            //console.log("Hello");

            const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    ...formData.getHeaders(), // Important: This ensures correct Content-Type
                },
                body: formData as any,
            });

            // console.log("HELLO 2");

            const data = await response.json();
            console.log("Transcription Response:", data);

            // Cleanup temp file
            fs.unlinkSync(tempFilePath);

            return data.text || "";
        } catch (error) {
            console.error("Error transcribing audio:", error);
            return "";
        }
    };

    private transcribeText = async (text: string): Promise<Buffer> => {
        try {
            const response = await fetch("https://api.openai.com/v1/audio/speech", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "tts-1", // OpenAI's text-to-speech model
                    input: text,
                    voice: "alloy", // Choose from 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'
                }),
            });
    
            if (!response.ok) {
                throw new Error(`TTS API Error: ${response.statusText}`);
            }
    
            const audioBuffer = Buffer.from(await response.arrayBuffer());
    
            return audioBuffer;
        } catch (error) {
            console.error("Error transcribing text to speech:", error);
            return Buffer.alloc(0);
        }
    };


    private getConversationMessages = (agent: IAgent, conversation: Message[], message: Message, val: number, ar: number, ccr, vai) => {
        const systemPrompt = { role: 'system', content: agent.systemStarterPrompt };
        const beforeUserMessage = { role: 'system', content: agent.beforeUserSentencePrompt };
        const afterUserMessage = { role: 'system', content: agent.afterUserSentencePrompt };
        const inverseTimeDelay = { role: 'system', content: agent.inverseTimeDelay };
        if ( ccr != null && vai != null ) {
            const final_message = "The valence of the user is "+ val + " and the arousal is "+ ar + "while user replies to you " + message["content"]
            message["content"] = final_message
        }
        console.log(message)
        const messages = [
            systemPrompt,
            ...conversation,
            beforeUserMessage,
            message,
            afterUserMessage,
            { role: 'assistant', content: '', timeDelay: inverseTimeDelay },
        ];

        return messages;
    };

    private getExplainableText = (settings: any, conversation: any[], message: any, val: number, ar: number) => {
        const systemPrompt: Message = { role: 'system', content: "", timeDelay: null };
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

    private createMessageDoc = async (
        message: Message,
        conversationId: string,
        messageNumber: number,
        val: number,
        ar: number,
        pit: number,
        loud: number,
        snr: number,
    ): Promise<Message> => {
        
        const res = await ConversationsModel.create({
            content: message.content,
            role: message.role,
            conversationId,
            messageNumber,
            valence: val,
            arousal: ar,
            timeDelay: message.timeDelay,
            pit: pit,
            loud: loud,
            snr: snr,
        });
        //console.log("resTimeDelay", res.timeDelay)
        return { _id: res._id, role: res.role, content: res.content, userAnnotation: res.userAnnotation, timeDelay: res.timeDelay };
    };

    private createExplainableDoc = async (og_text: Message, message: Message, resp: Message, conversationId: string, messageNumber: number, val:number, ar:number) => {
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
