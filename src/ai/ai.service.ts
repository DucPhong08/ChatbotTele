import { env, type AiProvider } from "../config/env";
import { type AIProcessedResult, type ArticleCategory } from "../types/ai";
import { type NewsView } from "../types/news";
import { TECH_NEWS_PROMPT, SUMMARIZE_PROMPT, PARSE_PREFERENCES_PROMPT } from "./prompts";

export interface DetailedSummaryResult {
  title: string;
  summaryPoints: string[];
  whyItMatters: string;
  uncertainty: string;
  actions: string[];
  readabilityScore: number;
  topics: string[];
}

const CATEGORY_OPTIONS = [
  "ai",
  "backend",
  "frontend",
  "devops",
  "security",
  "mobile",
  "career",
  "other",
] as const;

type InferredMetadata = Pick<
  AIProcessedResult,
  "category" | "tags" | "importanceScore" | "importanceReason"
>;

type KeywordRule = {
  category: ArticleCategory;
  tag: string;
  keywords: string[];
  score: number;
};

type GoogleTranslateResponse = Array<Array<[string, ...unknown[]]>>;

const SOURCE_SCORES: Record<string, number> = {
  "OpenAI Blog": 18,
  "GitHub Blog": 16,
  "React Blog": 16,
  "Cloudflare Changelog": 16,
  "AWS What's New": 15,
  "Hugging Face Blog": 15,
  "Hacker News": 12,
  "Dev.to": 9,
};

const KEYWORD_RULES: KeywordRule[] = [
  {
    category: "security",
    tag: "security",
    keywords: ["security", "vulnerability", "cve", "exploit", "zero-day", "patch", "breach"],
    score: 14,
  },
  {
    category: "ai",
    tag: "ai",
    keywords: ["ai", "llm", "agent", "model", "inference", "fine-tuning", "rag", "embedding"],
    score: 10,
  },
  {
    category: "backend",
    tag: "backend",
    keywords: [
      "node.js",
      "nodejs",
      "api",
      "database",
      "postgres",
      "mongodb",
      "redis",
      "runtime",
      "queue",
    ],
    score: 9,
  },
  {
    category: "frontend",
    tag: "frontend",
    keywords: [
      "react",
      "next.js",
      "nextjs",
      "javascript",
      "typescript",
      "css",
      "browser",
      "web app",
    ],
    score: 8,
  },
  {
    category: "devops",
    tag: "devops",
    keywords: [
      "cloud",
      "aws",
      "cloudflare",
      "deployment",
      "docker",
      "kubernetes",
      "ci/cd",
      "serverless",
    ],
    score: 8,
  },
  {
    category: "backend",
    tag: "performance",
    keywords: [
      "performance",
      "benchmark",
      "latency",
      "throughput",
      "memory leak",
      "garbage collection",
    ],
    score: 8,
  },
  {
    category: "other",
    tag: "release",
    keywords: [
      "release",
      "released",
      "stable",
      "beta",
      "rc",
      "changelog",
      "breaking change",
      "migration",
    ],
    score: 7,
  },
  {
    category: "career",
    tag: "career",
    keywords: [
      "career",
      "hiring",
      "interview",
      "salary",
      "developer productivity",
      "developer experience",
    ],
    score: 5,
  },
];

export class AIService {
  public static async translateWithGoogle(text: string): Promise<string> {
    if (!text.trim()) {
      return "";
    }

    try {
      console.log(`[Google Translate] Đang dịch: "${text.slice(0, 50)}..."`);
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`Google Translate status: ${res.status}`);
      }

      const json = (await res.json()) as unknown;
      if (this.isGoogleTranslateResponse(json)) {
        return this.normalizeDevTerms(json[0].map((item) => item[0]).join(""));
      }

      return text;
    } catch (error) {
      console.error("Lỗi Google Translate:", error);
      return text;
    }
  }

  /**
   * Tóm tắt bài viết từ nội dung đầy đủ bằng AI.
   * Trả về cấu trúc DetailedSummaryResult.
   */
  static async summarizeFullArticle(content: string): Promise<DetailedSummaryResult> {
    const truncated = content.length > 3000 ? content.slice(0, 3000) + "..." : content;
    const prompt = `${SUMMARIZE_PROMPT}\n\nArticle content:\n${truncated}`;

    const primaryProvider = env.aiProvider;
    const providersToTry: AiProvider[] = [primaryProvider];
    const allProviders: AiProvider[] = ["gemini", "openai", "groq", "openrouter"];
    for (const p of allProviders) {
      if (p !== primaryProvider && this.isProviderConfigured(p)) {
        providersToTry.push(p);
      }
    }
    console.log("[Summarize] Providers to try:", providersToTry);

    for (const provider of providersToTry) {
      try {
        console.log(`[Summarize] Đang thử provider: ${provider}`);
        let rawResult: unknown;
        switch (provider) {
          case "openai":
            rawResult = await this.callChatCompletion(
              "https://api.openai.com/v1/chat/completions",
              env.openaiApiKey,
              env.openaiModel,
              prompt,
              SUMMARIZE_PROMPT,
            );
            break;
          case "groq":
            rawResult = await this.callChatCompletion(
              "https://api.groq.com/openai/v1/chat/completions",
              env.groqApiKey,
              env.groqModel,
              prompt,
              SUMMARIZE_PROMPT,
            );
            break;
          case "openrouter":
            try {
              rawResult = await this.callChatCompletion(
                "https://openrouter.ai/api/v1/chat/completions",
                env.openrouterApiKey,
                env.openrouterModel,
                prompt,
                SUMMARIZE_PROMPT,
                {
                  "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
                  "X-Title": "Chatbot News Telegram",
                },
              );
            } catch (error) {
              if (
                env.openrouterFallbackModel &&
                env.openrouterFallbackModel !== env.openrouterModel
              ) {
                console.warn(
                  `[Summarize OpenRouter] Thất bại với model ${env.openrouterModel}. Đang thử fallback model: ${env.openrouterFallbackModel}. Lỗi: ${(error as Error).message}`,
                );
                rawResult = await this.callChatCompletion(
                  "https://openrouter.ai/api/v1/chat/completions",
                  env.openrouterApiKey,
                  env.openrouterFallbackModel,
                  prompt,
                  SUMMARIZE_PROMPT,
                  {
                    "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
                    "X-Title": "Chatbot News Telegram",
                  },
                );
              } else {
                throw error;
              }
            }
            break;
          case "gemini":
          default:
            rawResult = await this.callGeminiBatch(prompt);
            break;
        }

        const raw = this.isRecord(rawResult) ? rawResult : {};
        const title = typeof raw.title === "string" ? raw.title.trim() : "";
        const summaryPoints = Array.isArray(raw.summaryPoints)
          ? raw.summaryPoints.map((p: unknown) => String(p).trim())
          : [];
        const whyItMatters = typeof raw.whyItMatters === "string" ? raw.whyItMatters.trim() : "";
        const uncertainty = typeof raw.uncertainty === "string" ? raw.uncertainty.trim() : "";
        const actions = Array.isArray(raw.actions)
          ? raw.actions.map((a: unknown) => String(a).trim())
          : [];
        const readabilityScore =
          typeof raw.readabilityScore === "number" ? raw.readabilityScore : 7;
        const topics = Array.isArray(raw.topics)
          ? raw.topics.map((t: unknown) => String(t).trim().toLowerCase())
          : [];

        if (summaryPoints.length > 0) {
          const hasVietnamese = (text: string) =>
            /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text);

          let finalTitle = title;
          if (finalTitle && !hasVietnamese(finalTitle)) {
            finalTitle = await this.translateWithGoogle(finalTitle);
          }

          const finalPoints = [...summaryPoints];
          for (let i = 0; i < finalPoints.length; i++) {
            if (!hasVietnamese(finalPoints[i])) {
              finalPoints[i] = await this.translateWithGoogle(finalPoints[i]);
            }
          }

          let finalWhy = whyItMatters;
          if (finalWhy && !hasVietnamese(finalWhy)) {
            finalWhy = await this.translateWithGoogle(finalWhy);
          }

          let finalUncertainty = uncertainty;
          if (
            finalUncertainty &&
            finalUncertainty !== "Không có" &&
            !hasVietnamese(finalUncertainty)
          ) {
            finalUncertainty = await this.translateWithGoogle(finalUncertainty);
          }

          const finalActions = [...actions];
          for (let i = 0; i < finalActions.length; i++) {
            if (!hasVietnamese(finalActions[i])) {
              finalActions[i] = await this.translateWithGoogle(finalActions[i]);
            }
          }

          return {
            title: this.normalizeDevTerms(finalTitle),
            summaryPoints: finalPoints.map((p) => this.normalizeDevTerms(p)),
            whyItMatters: this.normalizeDevTerms(finalWhy),
            uncertainty: this.normalizeDevTerms(finalUncertainty),
            actions: finalActions.map((a) => this.normalizeDevTerms(a)),
            readabilityScore,
            topics,
          };
        }
      } catch (error) {
        console.warn(`[Summarize] Thất bại với ${provider}:`, (error as Error).message);
      }
    }

    return {
      title: "Không thể tải chi tiết bài viết.",
      summaryPoints: ["Đã xảy ra sự cố khi xử lý bài viết bằng AI.", "Vui lòng thử lại sau."],
      whyItMatters: "Không có thông tin.",
      uncertainty: "Không có",
      actions: ["Đọc trực tiếp bài viết từ nguồn gốc."],
      readabilityScore: 0,
      topics: ["error"],
    };
  }

  /**
   * Phân tích câu lệnh của người dùng để trích xuất các thể loại tin tức mong muốn bằng AI.
   */
  static async parsePreferredCategories(userPrompt: string): Promise<string[]> {
    if (!userPrompt.trim()) {
      return ["all"];
    }

    const prompt = `User request: "${userPrompt}"`;
    const primaryProvider = env.aiProvider;
    const providersToTry: AiProvider[] = [primaryProvider];
    const allProviders: AiProvider[] = ["gemini", "openai", "groq", "openrouter"];
    for (const p of allProviders) {
      if (p !== primaryProvider && this.isProviderConfigured(p)) {
        providersToTry.push(p);
      }
    }

    const systemPrompt = PARSE_PREFERENCES_PROMPT;

    for (const provider of providersToTry) {
      try {
        console.log(`[ParsePreferences] Đang thử provider: ${provider}`);
        let rawResult: unknown;
        switch (provider) {
          case "openai":
            rawResult = await this.callChatCompletion(
              "https://api.openai.com/v1/chat/completions",
              env.openaiApiKey,
              env.openaiModel,
              prompt,
              systemPrompt,
            );
            break;
          case "groq":
            rawResult = await this.callChatCompletion(
              "https://api.groq.com/openai/v1/chat/completions",
              env.groqApiKey,
              env.groqModel,
              prompt,
              systemPrompt,
            );
            break;
          case "openrouter":
            rawResult = await this.callChatCompletion(
              "https://openrouter.ai/api/v1/chat/completions",
              env.openrouterApiKey,
              env.openrouterModel,
              prompt,
              systemPrompt,
              {
                "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
                "X-Title": "Chatbot News Telegram",
              },
            );
            break;
          case "gemini":
          default:
            rawResult = await this.callGeminiBatch(`${systemPrompt}\n\n${prompt}`);
            break;
        }

        // Kiểm tra xem kết quả trả về có phải là mảng hợp lệ không
        if (Array.isArray(rawResult)) {
          const validCategories = [
            "all",
            "ai",
            "backend",
            "frontend",
            "devops",
            "security",
            "mobile",
            "career",
            "other",
          ];
          const result = rawResult
            .map((item) => String(item).toLowerCase().trim())
            .filter((item) => validCategories.includes(item));
          if (result.length > 0) {
            return result;
          }
        }
      } catch (error) {
        console.warn(`[ParsePreferences] Thất bại với ${provider}:`, (error as Error).message);
      }
    }

    // Luật fallback nếu tất cả các nhà cung cấp AI đều lỗi
    return this.parsePreferencesFallback(userPrompt);
  }

  public static parsePreferencesFallback(prompt: string): string[] {
    const clean = prompt.toLowerCase();
    const categories: string[] = [];

    if (
      clean.includes("ai") ||
      clean.includes("trí tuệ nhân tạo") ||
      clean.includes("intelligence") ||
      clean.includes("llm") ||
      clean.includes("gpt")
    ) {
      categories.push("ai");
    }
    if (
      clean.includes("backend") ||
      clean.includes("hậu kỳ") ||
      clean.includes("database") ||
      clean.includes("cơ sở dữ liệu") ||
      clean.includes("api") ||
      clean.includes("nodejs")
    ) {
      categories.push("backend");
    }
    if (
      clean.includes("frontend") ||
      clean.includes("giao diện") ||
      clean.includes("web") ||
      clean.includes("react") ||
      clean.includes("html") ||
      clean.includes("css")
    ) {
      categories.push("frontend");
    }
    if (
      clean.includes("devops") ||
      clean.includes("cloud") ||
      clean.includes("aws") ||
      clean.includes("docker") ||
      clean.includes("kubernetes") ||
      clean.includes("ci/cd")
    ) {
      categories.push("devops");
    }
    if (
      clean.includes("security") ||
      clean.includes("bảo mật") ||
      clean.includes("an ninh") ||
      clean.includes("lỗ hổng") ||
      clean.includes("cve")
    ) {
      categories.push("security");
    }
    if (
      clean.includes("mobile") ||
      clean.includes("di động") ||
      clean.includes("android") ||
      clean.includes("ios") ||
      clean.includes("flutter")
    ) {
      categories.push("mobile");
    }
    if (
      clean.includes("career") ||
      clean.includes("sự nghiệp") ||
      clean.includes("tuyển dụng") ||
      clean.includes("phỏng vấn") ||
      clean.includes("lương")
    ) {
      categories.push("career");
    }
    if (clean.includes("khác") || clean.includes("other")) {
      categories.push("other");
    }
    if (
      clean.includes("tất cả") ||
      clean.includes("hết") ||
      clean.includes("mọi tin") ||
      clean.includes("all")
    ) {
      return ["all"];
    }

    return categories.length > 0 ? categories : ["all"];
  }

  /**
   * Lọc danh sách bài viết bằng AI dựa trên prompt sở thích của người dùng.
   */
  static async filterArticlesByPrompt(
    articles: NewsView[],
    userPrompt: string,
  ): Promise<NewsView[]> {
    if (articles.length === 0 || !userPrompt.trim()) {
      return articles;
    }

    const candidateList = articles.map((a, idx) => ({
      index: idx,
      title: a.title || "",
      category: a.category || "other",
      tags: a.tags || [],
      summary: a.summary || "",
    }));

    const systemPrompt = `You are a helpful assistant filtering tech articles based on user preferences.
The user's preference prompt is: "${userPrompt}"
Below is a list of candidate articles in JSON format.
Your job is to return a JSON array containing the indices (0-based) of the articles that are relevant or interesting according to the user's prompt.
If no articles are relevant, return an empty array [].
If all are relevant, return all indices.

Return ONLY a valid JSON array of numbers, e.g. [0, 2]. Do not include markdown code fences, comments, or extra text.`;

    const prompt = JSON.stringify(candidateList, null, 2);

    const primaryProvider = env.aiProvider;
    const providersToTry: AiProvider[] = [primaryProvider];
    const allProviders: AiProvider[] = ["gemini", "openai", "groq", "openrouter"];
    for (const p of allProviders) {
      if (p !== primaryProvider && this.isProviderConfigured(p)) {
        providersToTry.push(p);
      }
    }

    for (const provider of providersToTry) {
      try {
        console.log(`[FilterArticles] Đang thử provider: ${provider}`);
        let rawResult: unknown;
        switch (provider) {
          case "openai":
            rawResult = await this.callChatCompletion(
              "https://api.openai.com/v1/chat/completions",
              env.openaiApiKey,
              env.openaiModel,
              prompt,
              systemPrompt,
            );
            break;
          case "groq":
            rawResult = await this.callChatCompletion(
              "https://api.groq.com/openai/v1/chat/completions",
              env.groqApiKey,
              env.groqModel,
              prompt,
              systemPrompt,
            );
            break;
          case "openrouter":
            rawResult = await this.callChatCompletion(
              "https://openrouter.ai/api/v1/chat/completions",
              env.openrouterApiKey,
              env.openrouterModel,
              prompt,
              systemPrompt,
              {
                "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
                "X-Title": "Chatbot News Telegram",
              },
            );
            break;
          case "gemini":
          default:
            rawResult = await this.callGeminiBatch(`${systemPrompt}\n\nCandidate list:\n${prompt}`);
            break;
        }

        // Kiểm tra xem kết quả trả về có phải là mảng chỉ số hợp lệ không
        if (Array.isArray(rawResult)) {
          const matchedIndices = rawResult
            .map((item) => Number(item))
            .filter((idx) => !isNaN(idx) && idx >= 0 && idx < articles.length);

          if (matchedIndices.length > 0) {
            console.log(
              `[FilterArticles] AI tìm thấy ${matchedIndices.length}/${articles.length} bài viết phù hợp với prompt: "${userPrompt}"`,
            );
            return matchedIndices.map((idx) => articles[idx]);
          }
        }
      } catch (error) {
        console.warn(`[FilterArticles] Thất bại với ${provider}:`, (error as Error).message);
      }
    }

    // Nếu AI fail hoặc không tìm thấy gì, trả về toàn bộ bài viết (fallback)
    return articles;
  }

  static async getFallback(
    title: string,
    content: string,
    source = "Unknown",
    publishedAt = new Date(),
  ): Promise<AIProcessedResult> {
    const baseline = this.inferArticleMetadata(title, content, source, publishedAt);
    const cleanContent = this.cleanContent(content);
    const summarySeed = cleanContent
      ? this.truncate(cleanContent, 350)
      : "Bài viết không cung cấp mô tả chi tiết trong RSS.";

    const [titleVi, translatedSummary] = await Promise.all([
      this.translateWithGoogle(title),
      this.translateWithGoogle(summarySeed),
    ]);

    return {
      titleVi: titleVi || title,
      summaryVi: this.formatFallbackSummary(translatedSummary, source, baseline),
      ...baseline,
      skills: [],
    };
  }

  private static isProviderConfigured(provider: AiProvider): boolean {
    switch (provider) {
      case "gemini":
        return !!env.geminiApiKey;
      case "openai":
        return !!env.openaiApiKey;
      case "groq":
        return !!env.groqApiKey;
      case "openrouter":
        return !!env.openrouterApiKey;
      default:
        return false;
    }
  }

  static async processArticle(
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt = new Date(),
  ): Promise<AIProcessedResult> {
    const primaryProvider = env.aiProvider;
    const providersToTry: AiProvider[] = [primaryProvider];

    const allProviders: AiProvider[] = ["gemini", "openai", "groq", "openrouter"];
    for (const p of allProviders) {
      if (p !== primaryProvider && this.isProviderConfigured(p)) {
        providersToTry.push(p);
      }
    }

    console.log(`[AI Failover] Thứ tự thử nghiệm các AI: ${providersToTry.join(" -> ")}`);

    for (const provider of providersToTry) {
      try {
        console.log(`[AI] Đang xử lý bài viết "${title.slice(0, 45)}..." bằng: ${provider}`);
        let result: AIProcessedResult;
        switch (provider) {
          case "openai":
            result = await this.processWithOpenAI(title, content, source, url, publishedAt);
            break;
          case "groq":
            result = await this.processWithGroq(title, content, source, url, publishedAt);
            break;
          case "openrouter":
            result = await this.processWithOpenRouter(title, content, source, url, publishedAt);
            break;
          case "gemini":
          default:
            result = await this.processWithGemini(title, content, source, url, publishedAt);
            break;
        }
        console.log(`[AI Failover] Xử lý thành công bằng: ${provider}`);
        return {
          ...result,
          titleVi: this.normalizeDevTerms(result.titleVi),
          summaryVi: this.normalizeDevTerms(result.summaryVi),
        };
      } catch (error) {
        console.warn(`[AI Failover] Thất bại với ${provider}. Lỗi: ${(error as Error).message}`);
      }
    }

    console.warn(
      "[AI Failover] Tất cả các nhà cung cấp AI đều thất bại. Sử dụng rule-based fallback.",
    );
    return this.getFallback(title, content, source, publishedAt);
  }

  /**
   * Xử lý nhiều bài viết trong một lần gọi AI duy nhất.
   * Tiết kiệm API quota bằng cách gộp tối đa 5 bài/prompt.
   * Nếu batch thất bại, sẽ fallback về xử lý từng bài riêng lẻ.
   */
  static async processArticleBatch(
    articles: Array<{
      title: string;
      content: string;
      source: string;
      url: string;
      publishedAt: Date;
    }>,
  ): Promise<AIProcessedResult[]> {
    if (articles.length === 0) return [];
    if (articles.length === 1) {
      const a = articles[0];
      return [await this.processArticle(a.title, a.content, a.source, a.url, a.publishedAt)];
    }

    const batchPrompt = this.buildBatchPrompt(articles);

    const primaryProvider = env.aiProvider;
    const providersToTry: AiProvider[] = [primaryProvider];
    const allProviders: AiProvider[] = ["gemini", "openai", "groq", "openrouter"];
    for (const p of allProviders) {
      if (p !== primaryProvider && this.isProviderConfigured(p)) {
        providersToTry.push(p);
      }
    }

    console.log(
      `[AI Batch] Xử lý ${articles.length} bài cùng lúc. Thứ tự: ${providersToTry.join(" -> ")}`,
    );

    for (const provider of providersToTry) {
      try {
        console.log(`[AI Batch] Đang gửi batch ${articles.length} bài tới: ${provider}`);
        let rawResult: unknown;

        switch (provider) {
          case "openai":
            rawResult = await this.callChatCompletion(
              "https://api.openai.com/v1/chat/completions",
              env.openaiApiKey,
              env.openaiModel,
              batchPrompt,
            );
            break;
          case "groq":
            rawResult = await this.callChatCompletion(
              "https://api.groq.com/openai/v1/chat/completions",
              env.groqApiKey,
              env.groqModel,
              batchPrompt,
            );
            break;
          case "openrouter":
            try {
              rawResult = await this.callChatCompletion(
                "https://openrouter.ai/api/v1/chat/completions",
                env.openrouterApiKey,
                env.openrouterModel,
                batchPrompt,
                TECH_NEWS_PROMPT,
                {
                  "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
                  "X-Title": "Chatbot News Telegram",
                },
              );
            } catch (error) {
              if (
                env.openrouterFallbackModel &&
                env.openrouterFallbackModel !== env.openrouterModel
              ) {
                console.warn(
                  `[AI Batch OpenRouter] Thất bại với model ${env.openrouterModel}. Đang thử fallback model: ${env.openrouterFallbackModel}. Lỗi: ${(error as Error).message}`,
                );
                rawResult = await this.callChatCompletion(
                  "https://openrouter.ai/api/v1/chat/completions",
                  env.openrouterApiKey,
                  env.openrouterFallbackModel,
                  batchPrompt,
                  TECH_NEWS_PROMPT,
                  {
                    "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
                    "X-Title": "Chatbot News Telegram",
                  },
                );
              } else {
                throw error;
              }
            }
            break;
          case "gemini":
          default:
            rawResult = await this.callGeminiBatch(batchPrompt);
            break;
        }

        const parsed = this.parseBatchResult(rawResult, articles);
        if (parsed) {
          console.log(`[AI Batch] Batch xử lý thành công bằng: ${provider}.`);
          return parsed.map((result) => ({
            ...result,
            titleVi: this.normalizeDevTerms(result.titleVi),
            summaryVi: this.normalizeDevTerms(result.summaryVi),
          }));
        }
      } catch (error) {
        console.warn(`[AI Batch] Thất bại với ${provider}. Lỗi: ${(error as Error).message}`);
      }
    }

    // Fallback: xử lý từng bài riêng lẻ
    console.warn("[AI Batch] Batch thất bại. Chuyển sang xử lý từng bài riêng lẻ.");
    const results: AIProcessedResult[] = [];
    for (const a of articles) {
      results.push(await this.processArticle(a.title, a.content, a.source, a.url, a.publishedAt));
    }
    return results;
  }

  private static buildBatchPrompt(
    articles: Array<{ title: string; content: string; source: string; url: string }>,
  ): string {
    const articlesJson = articles.map((a, i) => ({
      index: i,
      title: a.title,
      content: this.truncate(this.cleanContent(a.content), 500),
      source: a.source,
      url: a.url,
    }));

    return `${TECH_NEWS_PROMPT}

Process ALL of the following ${articles.length} articles and return a JSON object with key "articles" containing an array of results in the SAME order.
Each element must match the schema: { title, summary, category, tags, importanceScore, importanceReason }.

Articles:
${JSON.stringify(articlesJson, null, 2)}`;
  }

  private static async callChatCompletion(
    endpoint: string,
    apiKey: string,
    model: string,
    prompt: string,
    systemPrompt: string = TECH_NEWS_PROMPT,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    if (!apiKey) throw new Error(`API key chưa được cấu hình cho ${endpoint}`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API returned status ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Không nhận được nội dung từ API.");
    return JSON.parse(content);
  }

  private static async callGeminiBatch(prompt: string): Promise<unknown> {
    if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY chưa được cấu hình.");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.3,
          },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API returned status ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Không nhận được nội dung từ Gemini API.");
    return JSON.parse(text);
  }

  private static parseBatchResult(
    raw: unknown,
    articles: Array<{ title: string; content: string; source: string; publishedAt: Date }>,
  ): AIProcessedResult[] | null {
    if (!this.isRecord(raw)) return null;
    const arr = Array.isArray(raw.articles) ? raw.articles : null;
    if (!arr || arr.length !== articles.length) return null;

    return arr.map((item: unknown, i: number) => {
      return this.validateAndNormalizeResult(
        item,
        articles[i].title,
        articles[i].content,
        articles[i].source,
        articles[i].publishedAt,
      );
    });
  }

  private static async processWithGemini(
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt: Date,
  ): Promise<AIProcessedResult> {
    if (!env.geminiApiKey) {
      throw new Error("GEMINI_API_KEY chưa được cấu hình.");
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: this.buildArticlePrompt(title, content, source, url),
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  titleVi: { type: "STRING" },
                  summaryVi: { type: "STRING" },
                  category: {
                    type: "STRING",
                    enum: CATEGORY_OPTIONS,
                  },
                  tags: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                  },
                  importanceScore: { type: "INTEGER" },
                  importanceReason: { type: "STRING" },
                },
                required: [
                  "titleVi",
                  "summaryVi",
                  "category",
                  "tags",
                  "importanceScore",
                  "importanceReason",
                ],
              },
              temperature: 0.3,
            },
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API returned status ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        throw new Error("Không nhận được nội dung văn bản từ Gemini API.");
      }

      const result = JSON.parse(responseText) as unknown;
      return this.validateAndNormalizeResult(result, title, content, source, publishedAt);
    } catch (error) {
      console.error(`Lỗi khi xử lý bài viết bằng Gemini (${env.geminiModel}):`, error);
      throw error;
    }
  }

  private static async processWithOpenAI(
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt: Date,
  ): Promise<AIProcessedResult> {
    if (!env.openaiApiKey) {
      throw new Error("OPENAI_API_KEY chưa được cấu hình.");
    }

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: env.openaiModel,
          messages: [
            {
              role: "system",
              content: TECH_NEWS_PROMPT,
            },
            {
              role: "user",
              content: JSON.stringify({ title, content, source, url }),
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API returned status ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const choiceContent = data.choices?.[0]?.message?.content;
      if (!choiceContent) {
        throw new Error("Không nhận được nội dung từ OpenAI API.");
      }

      const result = JSON.parse(choiceContent) as unknown;
      return this.validateAndNormalizeResult(result, title, content, source, publishedAt);
    } catch (error) {
      console.error(`Lỗi khi xử lý bài viết bằng OpenAI (${env.openaiModel}):`, error);
      throw error;
    }
  }

  private static async processWithGroq(
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt: Date,
  ): Promise<AIProcessedResult> {
    if (!env.groqApiKey) {
      throw new Error("GROQ_API_KEY chưa được cấu hình.");
    }

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.groqApiKey}`,
        },
        body: JSON.stringify({
          model: env.groqModel,
          messages: [
            {
              role: "system",
              content: TECH_NEWS_PROMPT,
            },
            {
              role: "user",
              content: JSON.stringify({ title, content, source, url }),
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API returned status ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const choiceContent = data.choices?.[0]?.message?.content;
      if (!choiceContent) {
        throw new Error("Không nhận được nội dung từ Groq API.");
      }

      const result = JSON.parse(choiceContent) as unknown;
      return this.validateAndNormalizeResult(result, title, content, source, publishedAt);
    } catch (error) {
      console.error(`Lỗi khi xử lý bài viết bằng Groq (${env.groqModel}):`, error);
      throw error;
    }
  }

  private static async processWithOpenRouter(
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt: Date,
  ): Promise<AIProcessedResult> {
    if (!env.openrouterApiKey) {
      throw new Error("OPENROUTER_API_KEY chưa được cấu hình.");
    }

    const callWithModel = async (modelName: string) => {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.openrouterApiKey}`,
          "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
          "X-Title": "Chatbot News Telegram",
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: "system",
              content: TECH_NEWS_PROMPT,
            },
            {
              role: "user",
              content: this.buildArticlePrompt(title, content, source, url),
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API returned status ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const choiceContent = data.choices?.[0]?.message?.content;
      if (!choiceContent) {
        throw new Error("Không nhận được nội dung từ OpenRouter API.");
      }

      const result = JSON.parse(choiceContent) as unknown;
      return this.validateAndNormalizeResult(result, title, content, source, publishedAt);
    };

    try {
      return await callWithModel(env.openrouterModel);
    } catch (error) {
      if (env.openrouterFallbackModel && env.openrouterFallbackModel !== env.openrouterModel) {
        console.warn(
          `[OpenRouter] Thất bại với model ${env.openrouterModel}. Đang thử fallback model: ${env.openrouterFallbackModel}. Lỗi: ${(error as Error).message}`,
        );
        try {
          return await callWithModel(env.openrouterFallbackModel);
        } catch (fallbackError) {
          console.error(
            `[OpenRouter] Thất bại với cả fallback model ${env.openrouterFallbackModel}:`,
            fallbackError,
          );
          throw fallbackError;
        }
      }
      throw error;
    }
  }

  private static buildArticlePrompt(
    title: string,
    content: string,
    source: string,
    url: string,
  ): string {
    return `${TECH_NEWS_PROMPT}\n\nArticle details to process:\nTitle: ${title}\nContent: ${content}\nSource: ${source}\nURL: ${url}`;
  }

  private static validateAndNormalizeResult(
    result: unknown,
    title: string,
    content: string,
    source: string,
    publishedAt: Date,
  ): AIProcessedResult {
    const baseline = this.inferArticleMetadata(title, content, source, publishedAt);
    const raw = this.isRecord(result) ? result : {};
    const category = this.isCategory(raw.category) ? raw.category : baseline.category;
    const aiScore = this.readScore(raw.importanceScore);
    const importanceScore =
      aiScore === null
        ? baseline.importanceScore
        : this.clampScore(aiScore, baseline.importanceScore - 25, baseline.importanceScore + 25);

    // AI trả trường summary (có thể là array các gạch đầu dòng hoặc string đơn lẻ)
    let summaryStr = "";
    if (Array.isArray(raw.summary)) {
      summaryStr = raw.summary
        .map((s) => String(s).trim())
        .filter(Boolean)
        .map((s) => (s.startsWith("-") || s.startsWith("*") ? s : `- ${s}`))
        .join("\n");
    } else if (typeof raw.summary === "string") {
      summaryStr = raw.summary.trim();
    }

    if (
      !summaryStr ||
      summaryStr.toLowerCase().includes("article url:") ||
      summaryStr.startsWith("http")
    ) {
      summaryStr =
        this.truncate(this.cleanContent(content), 300) || "No detailed description available.";
    } else {
      summaryStr = this.truncate(summaryStr, 600);
    }

    let titleEn = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : title;
    titleEn = this.truncate(titleEn, 120);

    const tags = Array.from(new Set([...this.normalizeTags(raw.tags), ...baseline.tags])).slice(
      0,
      10,
    );
    const skills = this.normalizeTags(raw.skills);
    let importanceReason =
      typeof raw.importanceReason === "string" && raw.importanceReason.trim()
        ? raw.importanceReason.trim()
        : baseline.importanceReason;
    importanceReason = this.truncate(importanceReason, 150);

    return {
      titleVi: titleEn,
      summaryVi: summaryStr,
      category,
      tags,
      skills,
      importanceScore,
      importanceReason,
    };
  }

  private static inferArticleMetadata(
    title: string,
    content: string,
    source: string,
    publishedAt: Date,
  ): InferredMetadata {
    const text = `${title} ${this.cleanContent(content)}`.toLowerCase();
    const tags = new Set<string>();
    const categoryScores = new Map<ArticleCategory, number>();
    let keywordScore = 0;

    for (const rule of KEYWORD_RULES) {
      if (rule.keywords.some((keyword) => this.includesKeyword(text, keyword))) {
        tags.add(rule.tag);
        keywordScore += rule.score;
        categoryScores.set(rule.category, (categoryScores.get(rule.category) || 0) + rule.score);
      }
    }

    const category = this.pickCategory(source, categoryScores);
    const sourceScore = SOURCE_SCORES[source] ?? 8;
    const freshnessScore = this.getFreshnessScore(publishedAt);
    const categoryBoost =
      category === "security"
        ? 10
        : category === "ai"
          ? 8
          : ["backend", "devops"].includes(category)
            ? 5
            : 0;
    const importanceScore = this.clampScore(
      25 + sourceScore + Math.min(keywordScore, 35) + freshnessScore + categoryBoost,
    );

    if (tags.size === 0 && category !== "other") {
      tags.add(category);
    }

    return {
      category,
      tags: Array.from(tags).slice(0, 8),
      importanceScore,
      importanceReason: this.buildImportanceReason(
        source,
        category,
        Array.from(tags),
        freshnessScore,
      ),
    };
  }

  private static pickCategory(
    source: string,
    categoryScores: Map<ArticleCategory, number>,
  ): ArticleCategory {
    let bestCategory: ArticleCategory = this.categoryFromSource(source);
    let bestScore = 0;

    for (const [category, score] of categoryScores.entries()) {
      if (category !== "other" && score > bestScore) {
        bestCategory = category;
        bestScore = score;
      }
    }

    return bestCategory;
  }

  private static categoryFromSource(source: string): ArticleCategory {
    if (["OpenAI Blog", "Hugging Face Blog"].includes(source)) {
      return "ai";
    }

    if (["React Blog", "Vercel Blog"].includes(source)) {
      return "frontend";
    }

    if (["Cloudflare Changelog", "AWS What's New", "GitHub Blog"].includes(source)) {
      return "devops";
    }

    return "other";
  }

  private static getFreshnessScore(publishedAt: Date): number {
    const ageMs = Date.now() - publishedAt.getTime();
    const ageHours = ageMs / (60 * 60 * 1000);

    if (!Number.isFinite(ageHours) || ageHours < 0) {
      return 10;
    }

    if (ageHours <= 24) {
      return 12;
    }

    if (ageHours <= 72) {
      return 8;
    }

    if (ageHours <= 168) {
      return 4;
    }

    return 0;
  }

  private static buildImportanceReason(
    source: string,
    category: ArticleCategory,
    tags: string[],
    freshnessScore: number,
  ): string {
    const reasons = [`Nguồn ${source} có độ liên quan với developer`];

    if (category !== "other") {
      reasons.push(`bài thuộc nhóm ${category}`);
    }

    if (tags.length > 0) {
      reasons.push(`có tín hiệu về ${tags.slice(0, 3).join(", ")}`);
    }

    if (freshnessScore >= 8) {
      reasons.push("tin còn mới");
    }

    return `${reasons.join(", ")}.`;
  }

  private static formatFallbackSummary(
    summary: string,
    source: string,
    metadata: InferredMetadata,
  ): string {
    const detail = summary.trim() || "Bài viết không cung cấp mô tả chi tiết trong RSS.";
    const tags = metadata.tags.length > 0 ? metadata.tags.join(", ") : "chưa xác định";

    return [
      `- ${detail}`,
      `- Nguồn: ${source}; phân loại tạm: ${metadata.category}; tags: ${tags}.`,
      "- Tóm tắt này được tạo bằng fallback rule-based vì AI không khả dụng hoặc trả lỗi.",
    ].join("\n");
  }

  private static cleanContent(content: string): string {
    return content
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static truncate(text: string, maxLength: number): string {
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
  }

  private static normalizeTags(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((tag) => String(tag).trim().toLowerCase().replace(/\s+/g, "-"))
      .filter(Boolean)
      .slice(0, 8);
  }

  private static normalizeDevTerms(text: string): string {
    const replacements: Array<[RegExp, string]> = [
      [/khung làm việc/gi, "framework"],
      [/thời gian chạy/gi, "runtime"],
      [/kho lưu trữ/gi, "repository"],
      [/yêu cầu kéo/gi, "pull request"],
      [/bộ nhớ đệm/gi, "cache"],
      [/thu gom rác/gi, "garbage collection"],
      [/rò rỉ bộ nhớ/gi, "memory leak"],
      [/không máy chủ/gi, "serverless"],
    ];

    return replacements.reduce((current, [pattern, replacement]) => {
      return current.replace(pattern, replacement);
    }, text);
  }

  private static includesKeyword(text: string, keyword: string): boolean {
    if (keyword.length <= 3) {
      return new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, "i").test(text);
    }

    return text.includes(keyword.toLowerCase());
  }

  private static escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private static readScore(value: unknown): number | null {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return null;
    }

    return this.clampScore(value);
  }

  private static clampScore(value: number, min = 1, max = 100): number {
    return Math.min(Math.max(Math.round(value), min), max);
  }

  private static isCategory(value: unknown): value is ArticleCategory {
    return typeof value === "string" && CATEGORY_OPTIONS.includes(value as ArticleCategory);
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private static isGoogleTranslateResponse(value: unknown): value is GoogleTranslateResponse {
    return (
      Array.isArray(value) &&
      Array.isArray(value[0]) &&
      value[0].every((item) => Array.isArray(item) && typeof item[0] === "string")
    );
  }
}
