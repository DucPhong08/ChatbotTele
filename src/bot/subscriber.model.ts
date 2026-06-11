import { Schema, model, type HydratedDocument } from "mongoose";
import { type Subscriber } from "../types/subscriber";

export type SubscriberDocument = HydratedDocument<Subscriber>;

const subscriberSchema = new Schema<Subscriber>(
  {
    chatId: { type: Number, required: true, unique: true },
    username: { type: String, trim: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    isActiveAI: { type: Boolean, default: true },
    preferredCategories: { type: [String], default: ["all"] },
    customPrompt: { type: String, default: "" },
    language: { type: String, enum: ["vi", "en"], default: "vi" },
  },
  {
    timestamps: true,
  },
);

export const SubscriberModel = model<Subscriber>("Subscriber", subscriberSchema);
