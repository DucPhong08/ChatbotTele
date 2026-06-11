import { Schema, model, type HydratedDocument } from "mongoose";
import { type Feedback } from "../types/feedback";

export type FeedbackDocument = HydratedDocument<Feedback>;

const feedbackSchema = new Schema<Feedback>(
  {
    chatId: { type: Number, required: true },
    username: { type: String, trim: true },
    name: { type: String, trim: true },
    message: { type: String, required: true, trim: true },
    status: { type: String, enum: ["pending", "processed"], default: "pending" },
    reply: { type: String, trim: true },
    repliedBy: { type: Number },
    repliedAt: { type: Date },
  },
  {
    timestamps: true,
  },
);

export const FeedbackModel = model<Feedback>("Feedback", feedbackSchema);
