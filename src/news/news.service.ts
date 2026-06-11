import { isValidObjectId } from "mongoose";
import { NewsModel } from "./news.model";
import { type CreateNewsInput, type NewsView } from "../types/news";

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

  async getLatest(limit = 10, skip = 0): Promise<NewsView[]> {
    const fetchLimit = Math.max(100, limit + skip);
    const latestItems = await NewsModel.find()
      .sort({ publishedAt: -1 })
      .limit(fetchLimit)
      .lean<NewsView[]>()
      .exec();

    const sorted = [...latestItems].sort((a, b) => {
      const scoreA = typeof a.importanceScore === "number" ? a.importanceScore : 50;
      const scoreB = typeof b.importanceScore === "number" ? b.importanceScore : 50;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

    return sorted.slice(skip, skip + limit);
  }

  async getById(id: string): Promise<NewsView | null> {
    if (!isValidObjectId(id)) {
      return null;
    }
    return NewsModel.findById(id).lean<NewsView>().exec();
  }
}
