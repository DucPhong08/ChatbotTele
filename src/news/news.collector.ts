import Parser from "rss-parser";
import { NewsService } from "./news.service";
import { type CreateNewsInput, type NewsView } from "../types/news";
import { NewsModel } from "./news.model";
import { AIService } from "../ai/ai.service";
import { env } from "../config/env";
import { feeds as devFeeds } from "./feed/feeds-dev.config";
import { feeds as mxhFeeds } from "./feed/feeds-mxh.config";
import { FeedModel } from "./feed.model";
import { scrapeArticleContent } from "../utils/scraper";

const feeds = env.feedSource === "mxh" ? mxhFeeds : devFeeds;

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

type CandidateArticle = {
  title: string;
  url: string;
  content: string;
  publishedAt: Date;
};

const FEED_FETCH_COOLDOWN_MS = 3 * 60 * 1000;
const AI_BATCH_SIZE = 5;
const SCRAPE_CONCURRENCY = 3;

export class NewsCollector {
  private readonly parser = new Parser<RssFeed, RssItem>({
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  private readonly lastFetchTimes = new Map<string, number>();

  constructor(private readonly newsService: NewsService) {}

  async collect(): Promise<NewsView[]> {
    const collectedItems: CreateNewsInput[] = [];
    const seenUrls = new Set<string>();

    await this.seedFeedsIfEmpty();

    const activeFeeds = await FeedModel.find({ isActive: true }).lean().exec();

    console.log(`[NewsCollector] Bắt đầu quét tin từ ${activeFeeds.length} nguồn đang hoạt động.`);

    for (const feed of activeFeeds) {
      try {
        if (this.shouldSkipFeed(feed.url, feed.source)) {
          continue;
        }

        const parsedFeed = await this.parser.parseURL(feed.url);
        this.lastFetchTimes.set(feed.url, Date.now());

        const candidates = this.extractCandidates(parsedFeed.items, seenUrls);

        if (candidates.length === 0) {
          continue;
        }

        const newCandidates = await this.filterNewCandidates(candidates);

        if (newCandidates.length === 0) {
          continue;
        }

        for (let i = 0; i < newCandidates.length; i += AI_BATCH_SIZE) {
          const batch = newCandidates.slice(i, i + AI_BATCH_SIZE);

          try {
            const scrapedBatch = await this.processPool(
              batch,
              async (item) => {
                console.log(`[NewsCollector] Đang cào chi tiết bài viết: ${item.url}`);

                const fullContent = await scrapeArticleContent(item.url);

                return {
                  ...item,
                  content: fullContent || item.content || "",
                };
              },
              SCRAPE_CONCURRENCY,
            );

            const batchInput = scrapedBatch.map((item) => ({
              title: item.title,
              content: item.content,
              source: feed.source,
              url: item.url,
              publishedAt: item.publishedAt,
            }));

            const aiResults = await AIService.processArticleBatch(batchInput);

            for (let j = 0; j < scrapedBatch.length; j++) {
              const item = scrapedBatch[j];
              const aiResult = aiResults[j];

              if (!aiResult) {
                continue;
              }

              const skills =
                Array.isArray(aiResult.skills) && aiResult.skills.length > 0
                  ? aiResult.skills
                  : feed.skills;

              collectedItems.push({
                title: aiResult.titleVi || item.title,
                titleEn: aiResult.titleEn || item.title,
                url: item.url,
                source: feed.source,
                publishedAt: item.publishedAt,
                summary: aiResult.summaryVi || item.content.slice(0, 300),
                summaryEn: aiResult.summaryEn || "",
                category: aiResult.category || feed.category,
                tags: Array.isArray(aiResult.tags) ? aiResult.tags : [],
                skills,
                importanceScore:
                  typeof aiResult.importanceScore === "number" ? aiResult.importanceScore : 50,
                importanceReason: aiResult.importanceReasonVi || "",
                importanceReasonEn: aiResult.importanceReasonEn || "",
              });
            }
          } catch (error) {
            console.error(`[NewsCollector] Lỗi khi xử lý batch của feed ${feed.source}:`, error);
          }
        }
      } catch (error) {
        console.error(
          `[NewsCollector] Thất bại khi thu thập dữ liệu RSS feed từ: ${feed.source}`,
          error,
        );
      }
    }

    if (collectedItems.length === 0) {
      return [];
    }

    await this.newsService.createManyIfNotExists(collectedItems);

    const urls = collectedItems.map((item) => item.url);

    return NewsModel.find({ url: { $in: urls } })
      .lean<NewsView[]>()
      .exec();
  }

  private async seedFeedsIfEmpty(): Promise<void> {
    const count = await FeedModel.countDocuments();

    if (count > 0) {
      return;
    }

    console.log(
      `[NewsCollector] CSDL chưa có feed nào. Tiến hành nạp ${feeds.length} feed tĩnh từ cấu hình.`,
    );

    await FeedModel.bulkWrite(
      feeds.map((feed) => ({
        updateOne: {
          filter: { url: feed.url },
          update: {
            $setOnInsert: {
              source: feed.source,
              url: feed.url,
              category: feed.category,
              skills: feed.skills,
              isActive: true,
            },
          },
          upsert: true,
        },
      })),
    );
  }

  private shouldSkipFeed(feedUrl: string, source: string): boolean {
    const now = Date.now();
    const lastFetch = this.lastFetchTimes.get(feedUrl) || 0;

    if (now - lastFetch < FEED_FETCH_COOLDOWN_MS) {
      console.log(`[NewsCollector] Bỏ qua nguồn ${source} vì vừa quét dưới 3 phút trước.`);

      return true;
    }

    return false;
  }

  private extractCandidates(items: RssItem[] = [], seenUrls: Set<string>): CandidateArticle[] {
    return items
      .map((item) => {
        const title = item.title?.trim();
        const url = this.normalizeUrl(item.link);

        if (!title || !url || seenUrls.has(url)) {
          return null;
        }

        seenUrls.add(url);

        return {
          title,
          url,
          content: item.contentSnippet?.trim() || item.content?.trim() || "",
          publishedAt: this.parseDate(item.isoDate || item.pubDate),
        };
      })
      .filter((item): item is CandidateArticle => item !== null);
  }

  private async filterNewCandidates(candidates: CandidateArticle[]): Promise<CandidateArticle[]> {
    const urls = candidates.map((item) => item.url);

    const existingItems = await NewsModel.find({
      url: { $in: urls },
    })
      .select("url")
      .lean<Array<{ url: string }>>()
      .exec();

    const existingUrls = new Set(existingItems.map((item) => item.url));

    return candidates.filter((item) => !existingUrls.has(item.url));
  }

  private normalizeUrl(value?: string): string {
    if (!value) {
      return "";
    }

    try {
      const url = new URL(value.trim());

      if (!["http:", "https:"].includes(url.protocol)) {
        return "";
      }

      url.hash = "";

      return url.toString();
    } catch {
      return "";
    }
  }

  /**
   * Xử lý song song với giới hạn concurrency.
   * Tránh gọi quá nhiều request cùng lúc gây rate limit.
   */
  private async processPool<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concurrency: number,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        const currentIndex = index++;

        try {
          results[currentIndex] = await fn(items[currentIndex]);
        } catch (error) {
          console.error(`[NewsCollector] Lỗi khi xử lý item song song:`, error);
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());

    await Promise.all(workers);

    return results.filter((item): item is R => item !== undefined);
  }

  private parseDate(value?: string): Date {
    if (!value) {
      return new Date();
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
}
