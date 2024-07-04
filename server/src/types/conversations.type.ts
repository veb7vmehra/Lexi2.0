import mongoose from 'mongoose';
import { IAgent } from '../types/agents.type';

export interface IConversation {
    conversationId: string;
    content: string;
    role: string;
    createdAt: Date;
    timestamp: number;
    messageNumber: number;
    valence: number;
    arousal: number;
}

export interface IMetadataConversation {
    _id: mongoose.Types.ObjectId;
    experimentId: string;
    messagesNumber: number;
    createdAt: Date;
    timestamp: number;
    lastMessageDate: Date;
    lastMessageTimestamp: number;
    conversationNumber: number;
    agent: IAgent;
    userId: string;
    imsPre?: object;
    imsPost?: object;
}

export interface ICurrentState {
    id: string;
    valence: number;
    arousal: number;
    count: number;
}

