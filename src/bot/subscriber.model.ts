import { Schema, model, type HydratedDocument } from "mongoose";

export interface Subscriber {
  chatId: number;
  createdAt: Date;
  updatedAt: Date;
}

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
