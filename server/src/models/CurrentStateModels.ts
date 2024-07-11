import { Schema } from 'mongoose';
import { mongoDbProvider } from '../mongoDBProvider';
import { ICurrentState } from '../types';

export const currentStateSchema = new Schema<ICurrentState>(
    {
        id: { type: String, required: true },
        valence: { type: Number, required: true },
        arousal: { type: Number, required: true },
        count: { type: Number, required: true },
    },
    { versionKey: false },
);

export const CurrentStateModels = mongoDbProvider.getModel('current_state', currentStateSchema);
