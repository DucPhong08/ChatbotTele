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
    const cats = categories ? (Array.isArray(categories) ? categories : [categories]) : ["all"];
    const isFiltered = cats.length > 0 && !cats.includes("all");

    const fetchWithFilter = async (filter: Record<string, any>): Promise<NewsView[]> => {
      const perSourceLimit = Math.max(5, Math.ceil((limit + skip) / 2));
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days window (1 week)

      const pipeline: PipelineStage[] = [
        {
          $match: {
            ...filter,
            importanceScore: { $gte: env.notificationMinScore },
            createdAt: { $gte: cutoff },
          },
        },
        {
          $sort: {
            publishedAt: -1 as const,
            importanceScore: -1 as const,
            createdAt: -1 as const,
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

      return diversified.sort((a: NewsView, b: NewsView) => {
        const pubA = new Date(a.publishedAt).getTime();
        const pubB = new Date(b.publishedAt).getTime();
        if (pubA !== pubB) {
          return pubB - pubA;
        }
        const scoreA = Number.isInteger(a.importanceScore) ? (a.importanceScore as number) : 50;
        const scoreB = Number.isInteger(b.importanceScore) ? (b.importanceScore as number) : 50;
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeA !== timeB) {
          return timeB - timeA;
        }
        const commentsA = Number.isInteger(a.commentCount) ? (a.commentCount as number) : 0;
        const commentsB = Number.isInteger(b.commentCount) ? (b.commentCount as number) : 0;
        return commentsB - commentsA;
      });
    };

    let preferred: NewsView[] = [];
    if (isFiltered) {
      preferred = await fetchWithFilter({ category: { $in: cats } });
    } else {
      preferred = await fetchWithFilter({});
    }

    const targetLength = limit + skip;
    if (isFiltered && preferred.length < targetLength) {
      const allNews = await fetchWithFilter({});
      const seenIds = new Set(preferred.map((p) => p._id?.toString()));

      const padding: NewsView[] = [];
      for (const item of allNews) {
        const itemId = item._id?.toString();
        if (itemId && !seenIds.has(itemId)) {
          padding.push(item);
        }
      }

      const combined = [...preferred, ...padding];
      return combined.slice(skip, skip + limit) as NewsView[];
    }

    return preferred.slice(skip, skip + limit) as NewsView[];
  }

  async getById(id: string): Promise<NewsView | null> {
    if (!isValidObjectId(id)) {
      return null;
    }
    return NewsModel.findById(id).lean<NewsView>().exec();
  }
}
