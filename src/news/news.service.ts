import { isValidObjectId, type PipelineStage } from "mongoose";
import { NewsModel } from "./news.model";
import { type CreateNewsInput, type NewsView } from "../types/news";
import { env } from "../config/env";

export class NewsService {
  async createManyIfNotExists(items: CreateNewsInput[]): Promise<number> {
    if (items.length === 0) {
      return 0;
    }

    const operations = items.map((item) => ({
      updateOne: {
        filter: { url: item.url },
        update: { $setOnInsert: item },
        upsert: true,
      },
    }));

    const result = await NewsModel.bulkWrite(operations, { ordered: false });

    return result.upsertedCount;
  }

  async getLatest(limit = 10, skip = 0, categories?: string | string[]): Promise<NewsView[]> {
    let matchFilter: Record<string, unknown> = {};
    if (categories) {
      const cats = Array.isArray(categories) ? categories : [categories];
      if (cats.length > 0 && !cats.includes("all")) {
        matchFilter = { category: { $in: cats } };
      }
    }

    // Lấy N bài tốt nhất từ MỖI nguồn trong 7 ngày gần nhất (tính từ lúc lưu vào DB) để đa dạng hóa
    const perSourceLimit = Math.max(5, Math.ceil((limit + skip) / 2));
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days window (1 week)

    const pipeline: PipelineStage[] = [
      {
        $match: {
          ...matchFilter,
          importanceScore: { $gte: env.notificationMinScore },
          createdAt: { $gte: cutoff },
        },
      },
      {
        $sort: {
          importanceScore: -1 as const,
          commentCount: -1 as const,
          publishedAt: -1 as const,
        },
      },
      {
        $group: {
          _id: "$source",
          articles: { $push: "$$ROOT" },
        },
      },
      {
        $project: {
          articles: { $slice: ["$articles", perSourceLimit] },
        },
      },
      { $unwind: "$articles" },
      { $replaceRoot: { newRoot: "$articles" } },
    ];

    const diversified = await NewsModel.aggregate(pipeline).exec();

    // Sắp xếp tổng hợp: ưu tiên điểm cao, rồi mới nhất
    const sorted = diversified.sort((a: NewsView, b: NewsView) => {
      const scoreA = Number.isInteger(a.importanceScore) ? (a.importanceScore as number) : 50;
      const scoreB = Number.isInteger(b.importanceScore) ? (b.importanceScore as number) : 50;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      const commentsA = Number.isInteger(a.commentCount) ? (a.commentCount as number) : 0;
      const commentsB = Number.isInteger(b.commentCount) ? (b.commentCount as number) : 0;
      if (commentsA !== commentsB) {
        return commentsB - commentsA;
      }
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

    return sorted.slice(skip, skip + limit) as NewsView[];
  }

  async getById(id: string): Promise<NewsView | null> {
    if (!isValidObjectId(id)) {
      return null;
    }
    return NewsModel.findById(id).lean<NewsView>().exec();
  }
}
