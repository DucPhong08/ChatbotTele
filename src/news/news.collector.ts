import Parser from "rss-parser";
import { NewsService } from "./news.service";
import { type CreateNewsInput, type NewsView } from "../types/news";
import { NewsModel } from "./news.model";
import { AIService } from "../ai/ai.service";

import { feeds } from "./feeds.config";

type RssFeed = Record<string, unknown>;

type RssItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  contentSnippet?: string;
  content?: string;
  categories?: string[];
};

export class NewsCollector {
  private readonly parser = new Parser<RssFeed, RssItem>({
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  private readonly lastFetchTimes = new Map<string, number>();

  constructor(private readonly newsService: NewsService) {}

  async collect(): Promise<NewsView[]> {
    const collectedItems: CreateNewsInput[] = [];
    const seenUrls = new Set<string>();

    for (const feed of feeds) {
      try {
        const now = Date.now();
        const lastFetch = this.lastFetchTimes.get(feed.url) || 0;
        if (now - lastFetch < 3 * 60 * 1000) {
          console.log(
            `Bỏ qua quét nguồn ${feed.source} do vừa mới quét cách đây ít hơn 3 phút (tránh Rate Limit 429).`,
          );
          continue;
        }
        this.lastFetchTimes.set(feed.url, now);

        const parsedFeed = await this.parser.parseURL(feed.url);

        const candidates = parsedFeed.items
          .map((item) => {
            const title = item.title?.trim();
            const url = item.link?.trim();

            if (!title || !url || seenUrls.has(url)) {
              return null;
            }

            seenUrls.add(url);

            return {
              title,
              url,
              content:
                item.contentSnippet?.trim() || item.content?.trim() || "",
              publishedAt: this.parseDate(item.isoDate || item.pubDate),
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        const existingItems = await NewsModel.find({
          url: { $in: candidates.map((item) => item.url) },
        })
          .select("url")
          .lean<Array<{ url: string }>>()
          .exec();
        const existingUrls = new Set(existingItems.map((item) => item.url));

        const newCandidates = candidates.filter((item) => !existingUrls.has(item.url));

        // Gộp bài viết thành nhóm 5 bài, gọi batch AI để tiết kiệm quota
        for (let i = 0; i < newCandidates.length; i += 5) {
          const batch = newCandidates.slice(i, i + 5);
          const batchInput = batch.map((item) => ({
            title: item.title,
            content: item.content,
            source: feed.source,
            url: item.url,
            publishedAt: item.publishedAt,
          }));

          const aiResults = await AIService.processArticleBatch(batchInput);

          for (let j = 0; j < batch.length; j++) {
            const item = batch[j];
            const aiResult = aiResults[j];
            if (!aiResult) continue;

            collectedItems.push({
              title: aiResult.titleVi,
              url: item.url,
              source: feed.source,
              publishedAt: item.publishedAt,
              summary: aiResult.summaryVi,
              category: aiResult.category,
              tags: aiResult.tags,
              skills: feed.skills,
              importanceScore: aiResult.importanceScore,
              importanceReason: aiResult.importanceReason,
            });
          }
        }
      } catch (error) {
        console.error(
          `Thất bại khi thu thập dữ liệu RSS feed từ: ${feed.source}`,
          error,
        );
      }
    }

    await this.newsService.createManyIfNotExists(collectedItems);

    if (collectedItems.length === 0) {
      return [];
    }

    const urls = collectedItems.map((item) => item.url);
    const savedArticles = await NewsModel.find({ url: { $in: urls } })
      .lean<NewsView[]>()
      .exec();

    return savedArticles;
  }

  /**
   * Xử lý song song với giới hạn concurrency.
   * Tránh gọi quá nhiều AI request cùng lúc gây rate limit.
   */
  private async processPool<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concurrency: number,
  ): Promise<R[]> {
    const results: R[] = [];
    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        const currentIndex = index++;
        try {
          const result = await fn(items[currentIndex]);
          results.push(result);
        } catch (error) {
          console.error(`Lỗi khi xử lý bài viết song song:`, error);
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    );
    await Promise.all(workers);
    return results;
  }

  private parseDate(value?: string): Date {
    if (!value) {
      return new Date();
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
}
