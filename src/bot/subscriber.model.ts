import { Schema, model, type HydratedDocument } from "mongoose";
import { type Subscriber } from "../types/subscriber";

export type SubscriberDocument = HydratedDocument<Subscriber>;

const subscriberSchema = new Schema<Subscriber>(
  {
    chatId: { type: Number, required: true, unique: true },
    preferredCategories: { type: [String], default: ["all"] },
    customPrompt: { type: String, default: "" },
  },
  {
    timestamps: true,
  },
);

export const SubscriberModel = model<Subscriber>("Subscriber", subscriberSchema);
