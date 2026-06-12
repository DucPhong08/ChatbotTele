import * as cheerio from "cheerio";
import { Agent } from "undici";

type ScrapeArticleOptions = {
  timeoutMs?: number;
  maxChars?: number;
  minTextLength?: number;
};

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const customAgent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

const DEFAULT_OPTIONS: Required<ScrapeArticleOptions> = {
  timeoutMs: 8000,
  maxChars: 5000,
  minTextLength: 40,
};

/**
 * Helper cào nội dung văn bản thuần từ URL bài viết công nghệ.
 *
 * Mục tiêu:
 * - Lấy nội dung chính của bài viết.
 * - Loại bỏ script, style, menu, footer, quảng cáo, cookie banner.
 * - Ưu tiên article/main/content container.
 * - Trả về text sạch để đưa vào AI summarization.
 */
export async function scrapeArticleContent(
  url: string,
  options: ScrapeArticleOptions = {},
): Promise<string> {
  const config = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  try {
    const parsedUrl = validateUrl(url);
    const html = await fetchHtml(parsedUrl.toString(), config.timeoutMs);

    if (!html || html.length < 100) {
      return "";
    }

    const $ = cheerio.load(html);

    removeNoiseElements($);

    const mainContent = extractMainContent($, config.minTextLength);

    if (!mainContent) {
      return "";
    }

    return normalizeText(mainContent).slice(0, config.maxChars);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[WebScraper] Lỗi khi cào nội dung từ URL: ${url}. Chi tiết: ${message}`);
    return "";
  }
}

/**
 * Validate URL để tránh fetch linh tinh.
 */
function validateUrl(url: string): URL {
  const parsedUrl = new URL(url);

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error(`URL protocol không hợp lệ: ${parsedUrl.protocol}`);
  }

  return parsedUrl;
}

/**
 * Fetch HTML với timeout.
 */
async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
      },
      signal: controller.signal,
      dispatcher: customAgent,
    } as any);

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";

    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error(`Content-Type không phải HTML: ${contentType}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Xóa các thành phần gây nhiễu.
 */
function removeNoiseElements($: cheerio.CheerioAPI): void {
  const noiseSelectors = [
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "form",
    "input",
    "button",
    "select",
    "textarea",

    "header",
    "footer",
    "nav",
    "aside",

    ".ad",
    ".ads",
    ".advertisement",
    ".banner",
    ".cookie",
    ".cookie-banner",
    ".newsletter",
    ".subscribe",
    ".subscription",
    ".social",
    ".share",
    ".sharing",
    ".related",
    ".recommend",
    ".recommended",
    ".comments",
    ".comment",
    ".sidebar",
    ".menu",
    ".navbar",
    ".breadcrumb",
    ".promo",

    "#comments",
    "#sidebar",
    "#footer",
    "#header",
    "#nav",
  ];

  $(noiseSelectors.join(",")).remove();

  /**
   * Xóa code block dài.
   * Inline code vẫn có thể giữ lại trong đoạn văn vì bài công nghệ thường có term kỹ thuật.
   */
  $("pre").remove();

  $("code").each((_, el) => {
    const text = $(el).text().trim();

    if (text.length > 120) {
      $(el).remove();
    }
  });
}

/**
 * Tìm nội dung chính.
 */
function extractMainContent($: cheerio.CheerioAPI, minTextLength: number): string {
  const candidateSelectors = [
    "article",
    "main",
    "[role='main']",

    ".article",
    ".article-content",
    ".article-body",
    ".post",
    ".post-content",
    ".post-body",
    ".entry",
    ".entry-content",
    ".story",
    ".story-content",
    ".content",
    ".main-content",

    "#article",
    "#article-content",
    "#content",
    "#main",
  ];

  let bestText = "";
  let bestScore = 0;

  for (const selector of candidateSelectors) {
    $(selector).each((_, el) => {
      const element = $(el);
      const text = extractReadableTextFromElement($, element, minTextLength);
      const score = scoreContentBlock($, element, text);

      if (score > bestScore && text.length > bestText.length * 0.7) {
        bestScore = score;
        bestText = text;
      }
    });
  }

  if (bestText.length >= 300) {
    return bestText;
  }

  /**
   * Fallback:
   * Nếu không tìm thấy article/main rõ ràng, lấy từ body.
   */
  const bodyText = extractReadableTextFromElement($, $("body"), minTextLength);

  if (bodyText.length >= bestText.length) {
    return bodyText;
  }

  return bestText;
}

/**
 * Tính điểm block nội dung.
 */
function scoreContentBlock(
  $: cheerio.CheerioAPI,
  element: cheerio.Cheerio<any>,
  text: string,
): number {
  const textLength = text.length;
  const paragraphCount = element.find("p").length;
  const headingCount = element.find("h1,h2,h3").length;
  const listItemCount = element.find("li").length;

  const linkTextLength = element.find("a").text().length;
  const linkDensity = textLength > 0 ? linkTextLength / textLength : 0;

  const classAndId = `${element.attr("class") || ""} ${element.attr("id") || ""}`.toLowerCase();

  let penalty = 0;

  if (
    /comment|sidebar|footer|header|nav|menu|cookie|ad|promo|related|share|social/.test(classAndId)
  ) {
    penalty += 500;
  }

  return (
    textLength +
    paragraphCount * 120 +
    headingCount * 80 +
    listItemCount * 20 -
    linkDensity * 800 -
    penalty
  );
}

/**
 * Trích text dễ đọc từ một element.
 */
function extractReadableTextFromElement(
  $: cheerio.CheerioAPI,
  element: cheerio.Cheerio<any>,
  minTextLength: number,
): string {
  const chunks: string[] = [];

  element.find("h1,h2,h3,p,li,blockquote").each((_, el) => {
    const rawText = $(el).text();
    const text = normalizeText(rawText);

    if (!isUsefulText(text, minTextLength)) {
      return;
    }

    chunks.push(text);
  });

  const uniqueChunks = dedupeLines(chunks);

  return uniqueChunks.join("\n\n");
}

/**
 * Lọc text rác.
 */
function isUsefulText(text: string, minTextLength: number): boolean {
  if (!text) return false;
  if (text.length < minTextLength) return false;

  const lower = text.toLowerCase();

  const blockedPatterns = [
    "accept cookies",
    "cookie policy",
    "privacy policy",
    "terms of service",
    "sign up",
    "subscribe",
    "newsletter",
    "advertisement",
    "sponsored",
    "share this",
    "follow us",
    "read more",
    "all rights reserved",
    "enable javascript",
    "please enable",
    "log in",
    "login",
    "register",
  ];

  if (blockedPatterns.some((pattern) => lower.includes(pattern))) {
    return false;
  }

  /**
   * Loại text có quá nhiều ký tự điều hướng/UI.
   */
  const symbolRatio = countSymbols(text) / text.length;

  if (symbolRatio > 0.35) {
    return false;
  }

  return true;
}

/**
 * Normalize text.
 */
function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Chống duplicate paragraph.
 */
function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const key = line.toLowerCase().replace(/\s+/g, " ").trim();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(line);
  }

  return result;
}

/**
 * Đếm ký tự ít giá trị nội dung.
 */
function countSymbols(text: string): number {
  const matches = text.match(/[|•·=_~<>[\]{}#$%^*]/g);
  return matches ? matches.length : 0;
}
