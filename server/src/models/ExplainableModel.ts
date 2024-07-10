import { Schema } from 'mongoose';
import { mongoDbProvider } from '../mongoDBProvider';
import { IExplainable } from '../types';

export const explainableSchema = new Schema<IExplainable>(
    {
        conversationId: { type: String, required: true },
        input: { type: String, required: true },
        response: { type: String, required: true },
        role: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
        timestamp: { type: Number, default: () => Date.now() },
        messageNumber: { type: Number, required: true },
        valence: { type: Number, default: 0, required: true },
        arousal: { type: Number, default: 0, required: true },
    },
    { versionKey: false },
);

export const ExplainableModel = mongoDbProvider.getModel('explainable', explainableSchema);
