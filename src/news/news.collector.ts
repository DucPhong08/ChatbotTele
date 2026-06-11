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

type FeedDoc = {
  url: string;
  source: string;
  category: string;
  skills: string[];
};

const LOG = "[NewsCollector]";
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
    await this.seedFeedsIfEmpty();

    const activeFeeds = await FeedModel.find({ isActive: true }).lean().exec();
    console.log(`${LOG} Bắt đầu quét tin từ ${activeFeeds.length} nguồn đang hoạt động.`);

    const seenUrls = new Set<string>();
    const collectedItems: CreateNewsInput[] = [];

    for (const feed of activeFeeds) {
      try {
        const items = await this.fetchFeedItems(feed, seenUrls);
        if (items.length === 0) continue;

        const processed = await this.processFeedItems(items, feed);
        collectedItems.push(...processed);
      } catch (error) {
        console.error(`${LOG} Thất bại khi thu thập dữ liệu RSS feed từ: ${feed.source}`, error);
      }
    }

    if (collectedItems.length === 0) return [];

    await this.newsService.createManyIfNotExists(collectedItems);

    const urls = collectedItems.map((item) => item.url);
    return NewsModel.find({ url: { $in: urls } })
      .lean<NewsView[]>()
      .exec();
  }

  /**
   * Fetch và lọc các bài mới từ một feed, trả về candidates chưa có trong DB.
   * Trả về mảng rỗng nếu feed bị skip hoặc không có bài mới.
   */
  private async fetchFeedItems(feed: FeedDoc, seenUrls: Set<string>): Promise<CandidateArticle[]> {
    if (this.shouldSkipFeed(feed.url, feed.source)) return [];

    const parsedFeed = await this.parser.parseURL(feed.url);
    this.lastFetchTimes.set(feed.url, Date.now());

    const candidates = this.extractCandidates(parsedFeed.items, seenUrls);
    if (candidates.length === 0) return [];

    return this.filterNewCandidates(candidates);
  }

  /**
   * Scrape + AI-process toàn bộ candidates của một feed theo batch.
   */
  private async processFeedItems(
    candidates: CandidateArticle[],
    feed: FeedDoc,
  ): Promise<CreateNewsInput[]> {
    const results: CreateNewsInput[] = [];

    for (let i = 0; i < candidates.length; i += AI_BATCH_SIZE) {
      const batch = candidates.slice(i, i + AI_BATCH_SIZE);

      try {
        const scrapedBatch = await this.scrapeBatch(batch);
        const batchResults = await this.processAiBatch(scrapedBatch, feed);
        results.push(...batchResults);
      } catch (error) {
        console.error(`${LOG} Lỗi khi xử lý batch của feed ${feed.source}:`, error);
      }
    }

    return results;
  }

  /**
   * Scrape nội dung đầy đủ cho từng bài trong batch, chạy song song với SCRAPE_CONCURRENCY.
   */
  private async scrapeBatch(batch: CandidateArticle[]): Promise<CandidateArticle[]> {
    return this.processPool(
      batch,
      async (item) => {
        console.log(`${LOG} Đang cào chi tiết bài viết: ${item.url}`);
        const fullContent = await scrapeArticleContent(item.url);
        return { ...item, content: fullContent || item.content || "" };
      },
      SCRAPE_CONCURRENCY,
    );
  }

  /**
   * Gửi batch cho AI và map kết quả về CreateNewsInput.
   */
  private async processAiBatch(
    scrapedBatch: CandidateArticle[],
    feed: FeedDoc,
  ): Promise<CreateNewsInput[]> {
    const batchInput = scrapedBatch.map((item) => ({
      title: item.title,
      content: item.content,
      source: feed.source,
      url: item.url,
      publishedAt: item.publishedAt,
    }));

    const aiResults = await AIService.processArticleBatch(batchInput);
    const collected: CreateNewsInput[] = [];

    for (let j = 0; j < scrapedBatch.length; j++) {
      const item = scrapedBatch[j];
      const aiResult = aiResults[j];
      if (!aiResult) continue;

      collected.push(this.buildNewsInput(item, aiResult, feed));
    }

    return collected;
  }

  private buildNewsInput(
    item: CandidateArticle,
    aiResult: Awaited<ReturnType<typeof AIService.processArticleBatch>>[number],
    feed: FeedDoc,
  ): CreateNewsInput {
    const skills =
      Array.isArray(aiResult.skills) && aiResult.skills.length > 0 ? aiResult.skills : feed.skills;

    return {
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
      importanceScore: typeof aiResult.importanceScore === "number" ? aiResult.importanceScore : 50,
      importanceReason: aiResult.importanceReasonVi || "",
      importanceReasonEn: aiResult.importanceReasonEn || "",
    };
  }

  private async seedFeedsIfEmpty(): Promise<void> {
    const count = await FeedModel.countDocuments();
    if (count > 0) return;

    console.log(
      `${LOG} CSDL chưa có feed nào. Tiến hành nạp ${feeds.length} feed tĩnh từ cấu hình.`,
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
    const lastFetch = this.lastFetchTimes.get(feedUrl) ?? 0;
    if (Date.now() - lastFetch < FEED_FETCH_COOLDOWN_MS) {
      console.log(`${LOG} Bỏ qua nguồn ${source} vì vừa quét dưới 3 phút trước.`);
      return true;
    }
    return false;
  }

  private extractCandidates(items: RssItem[] = [], seenUrls: Set<string>): CandidateArticle[] {
    return items
      .map((item) => {
        const title = item.title?.trim();
        const url = this.normalizeUrl(item.link);
        if (!title || !url || seenUrls.has(url)) return null;
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
    const existing = await NewsModel.find({ url: { $in: urls } })
      .select("url")
      .lean<Array<{ url: string }>>()
      .exec();
    const existingUrls = new Set(existing.map((item) => item.url));
    return candidates.filter((item) => !existingUrls.has(item.url));
  }

  private normalizeUrl(value?: string): string {
    if (!value) return "";
    try {
      const url = new URL(value.trim());
      if (!["http:", "https:"].includes(url.protocol)) return "";
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  /**
   * Xử lý song song với giới hạn concurrency.
   * Dùng sentinel object để phân biệt "lỗi" vs "kết quả hợp lệ là undefined".
   */
  private async processPool<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concurrency: number,
  ): Promise<R[]> {
    const FAILED = Symbol("failed");
    const results: (R | typeof FAILED)[] = new Array(items.length);
    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        const i = index++;
        try {
          results[i] = await fn(items[i]);
        } catch (error) {
          console.error(`${LOG} Lỗi khi xử lý item song song:`, error);
          results[i] = FAILED;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

    return results.filter((r): r is R => r !== FAILED);
  }

  private parseDate(value?: string): Date {
    if (!value) return new Date();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
}
