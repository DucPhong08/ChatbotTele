import { Schema, model, type Document } from "mongoose";

export interface ISentLog {
  chatId: number;
  articleId: Schema.Types.ObjectId;
  sentAt: Date;
}

export type SentLogDocument = Document & ISentLog;

const sentLogSchema = new Schema<ISentLog>(
  {
    chatId: { type: Number, required: true },
    articleId: { type: Schema.Types.ObjectId, ref: "News", required: true },
    sentAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
  },
);

// Tạo Index hỗn hợp độc lập và cài đặt tự động xóa sau 15 ngày để tránh phình to database
sentLogSchema.index({ chatId: 1, articleId: 1 }, { unique: true });
sentLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 15 * 24 * 60 * 60 });

export const SentLogModel = model<ISentLog>("SentLog", sentLogSchema);
