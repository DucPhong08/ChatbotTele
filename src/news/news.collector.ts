import Parser from "rss-parser";
import { NewsService } from "./news.service";
import { type CreateNewsInput, type NewsView } from "../types/news";
import { type FeedQuality } from "../types/feed";
import { NewsModel } from "./news.model";
import { AIService } from "../ai/ai.service";
import { env } from "../config/env";
import { feeds as devFeeds } from "./feed/feeds-dev.config";
import { feeds as mxhFeeds } from "./feed/feeds-mxh.config";
import { FeedModel } from "./feed.model";
import { scrapeArticleContent } from "../utils/scraper";

const FETCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": FETCH_USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} khi tải ${url}`);
  }
  return response.text();
}

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
  comments?: string;
  "slash:comments"?: string | number;
  "content:encoded"?: string;
};

type RedditListing = {
  data?: {
    children?: Array<{
      data?: {
        title?: string;
        url?: string;
        permalink?: string;
        selftext?: string;
        created_utc?: number;
        num_comments?: number;
      };
    }>;
  };
};

type CandidateArticle = {
  title: string;
  url: string;
  content: string;
  publishedAt: Date;
  commentCount: number | undefined;
};

type FeedDoc = {
  url: string;
  source: string;
  category: string;
  skills: string[];
  quality?: FeedQuality;
  minScore?: number;
  minComments?: number;
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
    requestOptions: {
      rejectUnauthorized: false,
    },
  });

  private readonly lastFetchTimes = new Map<string, number>();

  constructor(private readonly newsService: NewsService) {}

  async collect(): Promise<NewsView[]> {
    await this.seedFeedsIfEmpty();

    const activeFeeds = await FeedModel.find({ isActive: true }).lean().exec();
    console.log(`${LOG} Bắt đầu quét tin từ ${activeFeeds.length} nguồn đang hoạt động.`);

    const seenUrls = new Set<string>();

    // Bước 1: Tải RSS/JSON song song từ tất cả các nguồn
    const fetchResults = await Promise.allSettled(
      activeFeeds.map(async (feed) => ({
        feed,
        items: await this.fetchFeedItems(feed, seenUrls),
      })),
    );

    // Bước 2: Xử lý AI tuần tự (tránh rate limit)
    const collectedItems: CreateNewsInput[] = [];
    for (const result of fetchResults) {
      if (result.status === "rejected") {
        console.error(`${LOG} Thất bại khi tải feed:`, result.reason);
        continue;
      }
      const { feed, items } = result.value;
      if (items.length === 0) continue;
      try {
        collectedItems.push(...(await this.processFeedItems(items, feed)));
      } catch (error) {
        console.error(`${LOG} Thất bại khi xử lý AI cho feed: ${feed.source}`, error);
      }
    }

    if (collectedItems.length === 0) return [];

    await this.newsService.createManyIfNotExists(collectedItems);
    const urls = collectedItems.map((item) => item.url);
    return NewsModel.find({ url: { $in: urls } })
      .lean<NewsView[]>()
      .exec();
  }

  private async fetchFeedItems(feed: FeedDoc, seenUrls: Set<string>): Promise<CandidateArticle[]> {
    if (this.shouldSkipFeed(feed.url, feed.source)) return [];

    let targetUrl = feed.url;
    if (targetUrl.includes("reddit.com")) {
      if (
        !targetUrl.includes("/hot") &&
        !targetUrl.includes("/top") &&
        !targetUrl.includes("/new")
      ) {
        targetUrl = targetUrl.replace(/\/\.rss$/, "").replace(/\/$/, "") + "/hot/.rss";
      }

      const candidates = await this.fetchRedditCandidates(targetUrl, seenUrls);
      this.lastFetchTimes.set(feed.url, Date.now());
      return this.filterNewCandidates(candidates);
    }

    const parsedFeed = await this.parser.parseURL(targetUrl);
    this.lastFetchTimes.set(feed.url, Date.now());

    const candidates = this.extractCandidates(parsedFeed.items, seenUrls);
    return candidates.length === 0 ? [] : this.filterNewCandidates(candidates);
  }

  private async processFeedItems(
    candidates: CandidateArticle[],
    feed: FeedDoc,
  ): Promise<CreateNewsInput[]> {
    const results: CreateNewsInput[] = [];

    for (let i = 0; i < candidates.length; i += AI_BATCH_SIZE) {
      try {
        const scrapedBatch = await this.scrapeBatch(candidates.slice(i, i + AI_BATCH_SIZE));
        results.push(...(await this.processAiBatch(scrapedBatch, feed)));
      } catch (error) {
        console.error(`${LOG} Lỗi khi xử lý batch của feed ${feed.source}:`, error);
      }
    }

    return results;
  }

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

  private async processAiBatch(
    scrapedBatch: CandidateArticle[],
    feed: FeedDoc,
  ): Promise<CreateNewsInput[]> {
    const aiResults = await AIService.processArticleBatch(
      scrapedBatch.map((item) => ({
        title: item.title,
        content: item.content,
        source: feed.source,
        url: item.url,
        publishedAt: item.publishedAt,
        commentCount: item.commentCount,
      })),
    );

    return scrapedBatch
      .map((item, j) => aiResults[j] && this.buildNewsInput(item, aiResults[j], feed))
      .filter((item): item is CreateNewsInput => !!item && this.shouldKeepArticle(item, feed));
  }

  private buildNewsInput(
    item: CandidateArticle,
    aiResult: Awaited<ReturnType<typeof AIService.processArticleBatch>>[number],
    feed: FeedDoc,
  ): CreateNewsInput {
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
      skills:
        Array.isArray(aiResult.skills) && aiResult.skills.length > 0
          ? aiResult.skills
          : feed.skills,
      commentCount: item.commentCount,
      importanceScore: typeof aiResult.importanceScore === "number" ? aiResult.importanceScore : 50,
      importanceReason: aiResult.importanceReasonVi || "",
      importanceReasonEn: aiResult.importanceReasonEn || "",
    };
  }

  private async seedFeedsIfEmpty(): Promise<void> {
    console.log(`${LOG} Đồng bộ hóa ${feeds.length} nguồn tin từ cấu hình tĩnh vào CSDL.`);

    await FeedModel.bulkWrite(
      feeds.map((feed) => {
        const updateSet: Partial<FeedDoc> = {
          source: feed.source,
          url: feed.url,
          category: feed.category,
          skills: feed.skills,
        };
        if (feed.quality) updateSet.quality = feed.quality;
        if (typeof feed.minScore === "number") updateSet.minScore = feed.minScore;
        if (typeof feed.minComments === "number") updateSet.minComments = feed.minComments;

        return {
          updateOne: {
            filter: { url: feed.url },
            update: { $set: updateSet, $setOnInsert: { isActive: true } },
            upsert: true,
          },
        };
      }),
    );

    await FeedModel.updateMany(
      { url: { $nin: feeds.map((f) => f.url) }, isActive: true },
      { $set: { isActive: false } },
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
          commentCount: this.extractCommentCount(item),
        };
      })
      .filter((item): item is CandidateArticle => item !== null);
  }

  private async fetchRedditCandidates(
    targetUrl: string,
    seenUrls: Set<string>,
  ): Promise<CandidateArticle[]> {
    try {
      const raw = await fetchUrl(this.toRedditJsonUrl(targetUrl));
      const listing = JSON.parse(raw) as RedditListing;
      return (listing.data?.children ?? [])
        .map((child) => {
          const post = child.data;
          const title = post?.title?.trim();
          const url =
            this.normalizeUrl(post?.url) ||
            this.normalizeUrl(post?.permalink ? "https://www.reddit.com" + post.permalink : "");

          if (!title || !url || seenUrls.has(url)) return null;
          seenUrls.add(url);
          return {
            title,
            url,
            content: post?.selftext?.trim() || "",
            publishedAt: this.parseUnixDate(post?.created_utc),
            commentCount: this.normalizeCount(post?.num_comments),
          };
        })
        .filter((item): item is CandidateArticle => item !== null);
    } catch (error) {
      console.warn(
        `${LOG} Lỗi khi tải JSON Reddit trực tiếp (${targetUrl}), thử qua RSS2JSON fallback... Chi tiết: ${(error as Error).message}`,
      );
      try {
        const fallbackUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(targetUrl)}`;
        const raw = await fetchUrl(fallbackUrl);
        const rssData = JSON.parse(raw);
        if (rssData.status === "ok" && Array.isArray(rssData.items)) {
          return rssData.items
            .map((item: any) => {
              const title = item.title?.trim();
              const url = this.normalizeUrl(item.link);
              if (!title || !url || seenUrls.has(url)) return null;
              seenUrls.add(url);
              return {
                title,
                url,
                content: item.content || item.description || "",
                publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
                commentCount: 0,
              };
            })
            .filter((item: any): item is CandidateArticle => item !== null);
        }
      } catch (fallbackError) {
        console.error(`${LOG} Fallback RSS2JSON cũng thất bại cho ${targetUrl}:`, fallbackError);
      }
      return [];
    }
  }

  private toRedditJsonUrl(targetUrl: string): string {
    return targetUrl.replace(/\/\.rss$/, ".json").replace(/\.rss$/, ".json");
  }

  private extractCommentCount(item: RssItem): number | undefined {
    const directCount = this.normalizeCount(item["slash:comments"]);
    if (directCount !== undefined) return directCount;

    const text = [item.contentSnippet, item.content, item["content:encoded"], item.comments]
      .filter((v): v is string => typeof v === "string")
      .join(" ");

    const match = text.match(/#?\s*comments?:\s*(\d+)/i) || text.match(/(\d+)\s+comments?/i);
    return this.normalizeCount(match?.[1]);
  }

  private shouldKeepArticle(item: CreateNewsInput, feed: FeedDoc): boolean {
    const score = Number.isInteger(item.importanceScore) ? item.importanceScore! : 0;
    const minScore = this.getMinScore(feed);

    if (score < minScore) {
      console.log(
        `${LOG} Loại bài "${item.title}" (score=${score}, min=${minScore}) - không đủ mức đáng đọc.`,
      );
      return false;
    }

    return true;
  }

  private getMinScore(feed: FeedDoc): number {
    return env.notificationMinScore;
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

  private parseUnixDate(value?: number): Date {
    if (typeof value !== "number" || !Number.isFinite(value)) return new Date();
    return new Date(value * 1000);
  }

  private normalizeCount(value: unknown): number | undefined {
    const count = Number(value);
    return Number.isInteger(count) && count >= 0 ? count : undefined;
  }

  private parseDate(value?: string): Date {
    if (!value) return new Date();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
}
