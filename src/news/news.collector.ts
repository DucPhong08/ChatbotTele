import Parser from "rss-parser";
import { type CreateNewsInput, NewsService } from "./news.service";
import { NewsModel } from "./news.model";
import { AIService } from "../ai/ai.service";

type FeedConfig = {
  source: string;
  url: string;
  category: string;
  skills: string[];
};

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

const feeds: FeedConfig[] = [
  // Tổng hợp tin dev
  {
    source: "Hacker News",
    url: "https://hnrss.org/frontpage",
    category: "general",
    skills: ["startup", "engineering", "programming", "ai"],
  },
  {
    source: "Dev.to",
    url: "https://dev.to/feed",
    category: "general",
    skills: ["javascript", "typescript", "web", "backend"],
  },
  {
    source: "GitHub Blog",
    url: "https://github.blog/feed/",
    category: "general",
    skills: ["github", "open-source", "developer-tools", "ai"],
  },

  // JavaScript / TypeScript / Node.js
  // {
  //   source: "Node.js Blog",
  //   url: "https://nodejs.org/en/feed/blog.xml",
  //   category: "backend",
  //   skills: ["nodejs", "javascript", "backend", "runtime"],
  // },
  // {
  //   source: "JavaScript Weekly",
  //   url: "https://javascriptweekly.com/rss",
  //   category: "backend",
  //   skills: ["javascript", "typescript", "web"],
  // },

  // Frontend
  {
    source: "React Blog",
    url: "https://react.dev/blog/rss.xml",
    category: "frontend",
    skills: ["react", "frontend", "javascript"],
  },
  {
    source: "Vercel Blog",
    url: "https://vercel.com/blog/rss",
    category: "frontend",
    skills: ["nextjs", "frontend", "deployment", "web"],
  },

  // Cloud / DevOps
  {
    source: "Cloudflare Changelog",
    url: "https://developers.cloudflare.com/changelog/rss.xml",
    category: "devops",
    skills: ["cloudflare", "edge", "security", "deployment"],
  },
  {
    source: "AWS What's New",
    url: "https://aws.amazon.com/about-aws/whats-new/recent/feed/",
    category: "devops",
    skills: ["aws", "cloud", "infrastructure"],
  },

  // AI / LLM
  {
    source: "OpenAI Blog",
    url: "https://openai.com/news/rss.xml",
    category: "ai",
    skills: ["ai", "llm", "agents", "api"],
  },
  {
    source: "Hugging Face Blog",
    url: "https://huggingface.co/blog/feed.xml",
    category: "ai",
    skills: ["ai", "machine-learning", "open-source-models"],
  },
];

export class NewsCollector {
  private readonly parser = new Parser<RssFeed, RssItem>();
  private readonly lastFetchTimes = new Map<string, number>();

  constructor(private readonly newsService: NewsService) {}

  async collect(): Promise<CreateNewsInput[]> {
    const collectedItems: CreateNewsInput[] = [];
    const seenUrls = new Set<string>();

    for (const feed of feeds) {
      try {
        const now = Date.now();
        const lastFetch = this.lastFetchTimes.get(feed.url) || 0;
        if (now - lastFetch < 5 * 60 * 1000) {
          console.log(
            `Bỏ qua quét nguồn ${feed.source} do vừa mới quét cách đây ít hơn 5 phút (tránh Rate Limit 429).`,
          );
          continue;
        }
        this.lastFetchTimes.set(feed.url, now);

        const parsedFeed = await this.parser.parseURL(feed.url);

        for (const item of parsedFeed.items) {
          const title = item.title?.trim();
          const url = item.link?.trim();

          if (!title || !url || seenUrls.has(url)) {
            continue;
          }

          // Kiểm tra xem url đã tồn tại trong database chưa
          const exists = await NewsModel.exists({ url });
          if (exists) {
            continue;
          }

          seenUrls.add(url);

          const content =
            item.contentSnippet?.trim() || item.content?.trim() || "";

          // Xử lý bài viết bằng AI
          const aiResult = await AIService.processArticle(
            title,
            content,
            feed.source,
            url,
          );

          collectedItems.push({
            title: aiResult.titleVi,
            url,
            source: feed.source,
            publishedAt: this.parseDate(item.isoDate || item.pubDate),
            summary: aiResult.summaryVi,
            category: aiResult.category,
            tags: aiResult.tags,
            skills: feed.skills,
            importanceScore: aiResult.importanceScore,
          });
        }
      } catch (error) {
        console.error(
          `Thất bại khi thu thập dữ liệu RSS feed từ: ${feed.source}`,
          error,
        );
      }
    }

    await this.newsService.createManyIfNotExists(collectedItems);
    return collectedItems;
  }

  private parseDate(value?: string): Date {
    if (!value) {
      return new Date();
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
}
