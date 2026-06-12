import { Schema, model, type HydratedDocument } from "mongoose";
import { type News } from "../types/news";

export type NewsDocument = HydratedDocument<News>;

const newsSchema = new Schema<News>(
  {
    title: { type: String, required: true, trim: true },
    titleEn: { type: String, trim: true },
    url: { type: String, required: true, trim: true },
    source: { type: String, required: true, trim: true },
    publishedAt: { type: Date, required: true },
    summary: { type: String, trim: true },
    summaryEn: { type: String, trim: true },
    category: { type: String, trim: true },
    tags: { type: [String], default: [] },
    skills: { type: [String], default: [] },
    commentCount: { type: Number, min: 0 },
    importanceScore: { type: Number, default: 50 },
    importanceReason: { type: String, trim: true },
    importanceReasonEn: { type: String, trim: true },
    isFallback: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

newsSchema.index({ url: 1 }, { unique: true });
newsSchema.index({ publishedAt: -1 });
newsSchema.index({ importanceScore: -1, commentCount: -1, publishedAt: -1 });
newsSchema.index({ source: 1 });
newsSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15 * 24 * 60 * 60 });

export const NewsModel = model<News>("News", newsSchema);
