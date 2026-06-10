import { NewsModel, type News } from "./news.model";

export type CreateNewsInput = Pick<
  News,
  "title" | "url" | "source" | "publishedAt" | "summary" | "category" | "tags" | "importanceScore"
>;

export type NewsView = Pick<
  News,
  "title" | "url" | "source" | "publishedAt" | "summary" | "category" | "tags" | "importanceScore"
>;

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

  async getLatest(limit = 10): Promise<NewsView[]> {
    const latestItems = await NewsModel.find()
      .sort({ publishedAt: -1 })
      .limit(30)
      .lean<NewsView[]>()
      .exec();

    // Tự động phát hiện và dịch các bài viết cũ chưa được dịch (vẫn là tiếng Anh)
    const { AIService } = await import("../ai/ai.service");
    for (const item of latestItems) {
      const title = item.title || "";
      const hasVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(title);
      if (!hasVietnamese) {
        try {
          console.log(`[Tự động dịch] Phát hiện bài viết cũ tiếng Anh: "${title}". Đang dịch...`);
          const fallbackResult = await AIService.getFallback(title, item.summary || "");
          
          await NewsModel.updateOne(
            { _id: (item as any)._id },
            { 
              $set: { 
                title: fallbackResult.titleVi, 
                summary: fallbackResult.summaryVi 
              } 
            }
          );
          
          item.title = fallbackResult.titleVi;
          item.summary = fallbackResult.summaryVi;
        } catch (err) {
          console.error("Lỗi khi tự động dịch bài viết cũ:", err);
        }
      }
    }

    const sorted = [...latestItems].sort((a, b) => {
      const scoreA = typeof a.importanceScore === "number" ? a.importanceScore : 50;
      const scoreB = typeof b.importanceScore === "number" ? b.importanceScore : 50;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

    return sorted.slice(0, limit);
  }
}
