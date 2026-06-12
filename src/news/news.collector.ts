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
const FEED_FETCH_TIMEOUT_MS = 12_000;
const FEED_FETCH_CONCURRENCY = 8;
const MAX_RAW_ITEMS_PER_FEED = 20;
const MAX_ITEMS_PER_FEED = 3;
const MAX_AI_CANDIDATES_PER_RUN = 12;
const MAX_ARTICLES_PER_RUN = 10;
const RECENT_ARTICLE_WINDOW_MS = 48 * 60 * 60 * 1000;
const AI_BATCH_SIZE = 5;
const SCRAPE_CONCURRENCY = 3;

export class NewsCollector {
  private readonly parser = new Parser<RssFeed, RssItem>({
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    requestOptions: {
      rejectUnauthorized: false,
    },
  });

  private readonly redditParser = new Parser<RssFeed, RssItem>({
    headers: {
      "User-Agent": "Slackbot 1.0 (+https://api.slack.com/robots)",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    requestOptions: {
      rejectUnauthorized: false,
    },
  });

  private readonly lastFetchTimes = new Map<string, number>();

  constructor(private readonly newsService: NewsService) {}

  async collect(options?: { force?: boolean }): Promise<NewsView[]> {
    await this.seedFeedsIfEmpty();

    const activeFeeds = await FeedModel.find({ isActive: true }).lean().exec();
    console.log(`${LOG} Bắt đầu quét tin từ ${activeFeeds.length} nguồn đang hoạt động.`);

    const seenUrls = new Set<string>();

    // Bước 1: Tải RSS song song có giới hạn concurrency (tránh nghẽn threadpool/DNS)
    const fetchResults = await this.processPool(
      activeFeeds,
      async (feed) => {
        const items = await this.fetchFeedItems(feed, seenUrls, options?.force);
        return { feed, items };
      },
      FEED_FETCH_CONCURRENCY,
    );

    // Bước 2: Lọc và xếp hạng toàn cục trước khi scrape/AI.
    const scoredCandidates: Array<{
      feed: FeedDoc;
      item: CandidateArticle;
      score: number;
      category: string;
    }> = [];

    for (const { feed, items } of fetchResults) {
      if (items.length === 0) continue;

      for (const item of items) {
        const metadata = AIService.inferArticleMetadata(
          item.title,
          item.content,
          feed.source,
          item.publishedAt,
        );

        // Official/Engineering có độ tin cậy cao hơn, nhưng vẫn lọc các bài ít liên quan (score < 45)
        const isOfficialOrEng = feed.quality === "official" || feed.quality === "engineering";
        const minScore = isOfficialOrEng ? 45 : 55;

        // Chỉ gửi đến AI các bài viết thuộc các thể loại trọng tâm và đạt điểm tối thiểu
        const isRelevant = metadata.importanceScore >= minScore && metadata.category !== "other";
        if (!isRelevant) {
          console.log(
            `${LOG} [Pre-filter] Bỏ qua bài viết: "${item.title}" (score=${metadata.importanceScore}, cat=${metadata.category})`,
          );
          continue;
        }

        scoredCandidates.push({
          feed,
          item,
          score: metadata.importanceScore,
          category: metadata.category,
        });
      }
    }

    const selectedCandidates = scoredCandidates
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        const commentsA = a.item.commentCount ?? 0;
        const commentsB = b.item.commentCount ?? 0;
        if (commentsA !== commentsB) return commentsB - commentsA;
        return b.item.publishedAt.getTime() - a.item.publishedAt.getTime();
      })
      .slice(0, MAX_AI_CANDIDATES_PER_RUN);

    if (selectedCandidates.length === 0) return [];

    console.log(
      `${LOG} Chọn ${selectedCandidates.length}/${scoredCandidates.length} bài tốt nhất để scrape/AI.`,
    );

    const candidatesByFeed = new Map<string, { feed: FeedDoc; items: CandidateArticle[] }>();
    for (const candidate of selectedCandidates) {
      const group = candidatesByFeed.get(candidate.feed.url);
      if (group) {
        group.items.push(candidate.item);
      } else {
        candidatesByFeed.set(candidate.feed.url, {
          feed: candidate.feed,
          items: [candidate.item],
        });
      }
    }

    // Bước 3: Xử lý AI tuần tự theo feed (tránh rate limit)
    const collectedItems: CreateNewsInput[] = [];
    for (const { feed, items } of candidatesByFeed.values()) {
      try {
        collectedItems.push(...(await this.processFeedItems(items, feed)));
      } catch (error) {
        console.error(`${LOG} Thất bại khi xử lý AI cho feed: ${feed.source}`, error);
      }
    }

    if (collectedItems.length === 0) return [];

    const topItems = collectedItems
      .sort((a, b) => {
        const scoreA = Number.isInteger(a.importanceScore) ? a.importanceScore! : 0;
        const scoreB = Number.isInteger(b.importanceScore) ? b.importanceScore! : 0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        const commentsA = a.commentCount ?? 0;
        const commentsB = b.commentCount ?? 0;
        if (commentsA !== commentsB) return commentsB - commentsA;
        return b.publishedAt.getTime() - a.publishedAt.getTime();
      })
      .slice(0, MAX_ARTICLES_PER_RUN);

    await this.newsService.createManyIfNotExists(topItems);
    const urls = topItems.map((item) => item.url);
    return NewsModel.find({ url: { $in: urls } })
      .lean<NewsView[]>()
      .exec();
  }

  private async fetchFeedItems(
    feed: FeedDoc,
    seenUrls: Set<string>,
    force = false,
  ): Promise<CandidateArticle[]> {
    try {
      if (this.shouldSkipFeed(feed.url, feed.source, force)) return [];

      let targetUrl = feed.url;
      if (targetUrl.includes("reddit.com")) {
        if (
          !targetUrl.includes("/hot") &&
          !targetUrl.includes("/top") &&
          !targetUrl.includes("/new")
        ) {
          targetUrl = targetUrl.replace(/\/\.rss$/, "").replace(/\/$/, "") + "/hot/.rss";
        }

        let timeoutId: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Timeout khi tải feed Reddit (12s)")),
            FEED_FETCH_TIMEOUT_MS,
          );
        });

        const parsedFeed = await Promise.race([
          this.redditParser.parseURL(targetUrl),
          timeoutPromise,
        ]);

        if (timeoutId) clearTimeout(timeoutId);
        this.lastFetchTimes.set(feed.url, Date.now());
        return this.prepareCandidates(parsedFeed.items, seenUrls);
      }

      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Timeout khi tải feed RSS (12s)")),
          FEED_FETCH_TIMEOUT_MS,
        );
      });

      const parsedFeed = await Promise.race([this.parser.parseURL(targetUrl), timeoutPromise]);

      if (timeoutId) clearTimeout(timeoutId);
      this.lastFetchTimes.set(feed.url, Date.now());

      return this.prepareCandidates(parsedFeed.items, seenUrls);
    } catch (error: any) {
      console.warn(
        `${LOG} Thất bại khi tải nguồn "${feed.source}" (${feed.url}):`,
        error?.message || error,
      );
      return [];
    }
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
      isFallback: aiResult.isFallback,
    };
  }

  private async seedFeedsIfEmpty(): Promise<void> {
    console.log(`${LOG} Đồng bộ hóa ${feeds.length} nguồn tin từ cấu hình tĩnh vào CSDL.`);

    await FeedModel.bulkWrite(
      feeds.map((feed) => {
        const updateSet: Partial<FeedDoc & { isActive: boolean }> = {
          source: feed.source,
          url: feed.url,
          category: feed.category,
          skills: feed.skills,
          isActive: true,
        };
        if (feed.quality) updateSet.quality = feed.quality;
        if (typeof feed.minScore === "number") updateSet.minScore = feed.minScore;
        if (typeof feed.minComments === "number") updateSet.minComments = feed.minComments;

        return {
          updateOne: {
            filter: { url: feed.url },
            update: { $set: updateSet },
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

  private shouldSkipFeed(feedUrl: string, source: string, force = false): boolean {
    if (force) return false;
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

  private async prepareCandidates(
    items: RssItem[] = [],
    seenUrls: Set<string>,
  ): Promise<CandidateArticle[]> {
    const now = Date.now();
    const candidates = this.extractCandidates(items.slice(0, MAX_RAW_ITEMS_PER_FEED), seenUrls)
      .filter((item) => now - item.publishedAt.getTime() <= RECENT_ARTICLE_WINDOW_MS)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    if (candidates.length === 0) return [];

    const newCandidates = await this.filterNewCandidates(candidates);
    return newCandidates.slice(0, MAX_ITEMS_PER_FEED);
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
    const minScore = item.isFallback ? 45 : this.getMinScore(feed);

    if (score < minScore) {
      console.log(
        `${LOG} Loại bài "${item.title}" (score=${score}, min=${minScore}${item.isFallback ? ", fallback" : ""}) - không đủ mức đáng đọc.`,
      );
      return false;
    }

    return true;
  }

  private getMinScore(feed: FeedDoc): number {
    return typeof feed.minScore === "number" ? feed.minScore : env.notificationMinScore;
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
