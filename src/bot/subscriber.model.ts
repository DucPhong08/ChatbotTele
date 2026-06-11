import { Schema, model, type HydratedDocument } from "mongoose";
import { type Subscriber } from "../types/subscriber";

export type SubscriberDocument = HydratedDocument<Subscriber>;

const subscriberSchema = new Schema<Subscriber>(
  {
    chatId: { type: Number, required: true, unique: true },
  },
  {
    timestamps: true,
  },
);

export const SubscriberModel = model<Subscriber>("Subscriber", subscriberSchema);
