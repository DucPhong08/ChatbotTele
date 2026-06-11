const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type FetchArticleContentOptions = {
  maxLength?: number;
  timeoutMs?: number;
  minParagraphLength?: number;
};

/**
 * Fetch nội dung bài viết từ URL gốc, trích xuất text thuần.
 * Trả về chuỗi rỗng nếu thất bại.
 */
export async function fetchArticleContent(
  url: string,
  options: FetchArticleContentOptions = {},
): Promise<string> {
  const { maxLength = 3000, timeoutMs = 8000, minParagraphLength = 40 } = options;

  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const parsedUrl = new URL(url);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return "";
    }

    const controller = new AbortController();

    timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      return "";
    }

    const contentType = response.headers.get("content-type") || "";

    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      return "";
    }

    const html = await response.text();

    if (!html || html.length < 100) {
      return "";
    }

    const mainHtml = extractMainHtml(html);
    const cleanedHtml = removeNoiseHtml(mainHtml);
    const paragraphs = extractParagraphs(cleanedHtml, minParagraphLength);

    const text = paragraphs.length > 0 ? paragraphs.join("\n\n") : htmlToPlainText(cleanedHtml);

    const normalized = normalizeText(text);

    if (!normalized) {
      return "";
    }

    return truncateText(normalized, maxLength);
  } catch {
    return "";
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/**
 * Ưu tiên lấy phần <article>, nếu không có thì lấy <main>, cuối cùng lấy <body>.
 */
function extractMainHtml(html: string): string {
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch?.[1]) {
    return articleMatch[1];
  }

  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch?.[1]) {
    return mainMatch[1];
  }

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) {
    return bodyMatch[1];
  }

  return html;
}

/**
 * Loại bỏ các vùng nhiễu thường gặp.
 */
function removeNoiseHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<pre[\s\S]*?<\/pre>/gi, " ");
}

/**
 * Ưu tiên lấy text trong các thẻ nội dung.
 */
function extractParagraphs(html: string, minParagraphLength: number): string[] {
  const regex = /<(p|h1|h2|h3|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const paragraphs: string[] = [];

  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const raw = match[2];

    if (!raw) {
      continue;
    }

    const text = normalizeText(htmlToPlainText(raw));

    if (!isUsefulText(text, minParagraphLength)) {
      continue;
    }

    paragraphs.push(text);
  }

  return dedupeParagraphs(paragraphs);
}

/**
 * Chuyển HTML thành text thuần.
 */
function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  );
}

/**
 * Decode một số HTML entities phổ biến.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

/**
 * Chuẩn hóa khoảng trắng.
 */
function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lọc text rác thường gặp.
 */
function isUsefulText(text: string, minLength: number): boolean {
  if (!text || text.length < minLength) {
    return false;
  }

  const lower = text.toLowerCase();

  const blockedTexts = [
    "accept cookies",
    "cookie policy",
    "privacy policy",
    "terms of service",
    "subscribe",
    "sign up",
    "newsletter",
    "advertisement",
    "sponsored",
    "share this",
    "follow us",
    "read more",
    "all rights reserved",
    "enable javascript",
    "login",
    "log in",
    "register",
  ];

  return !blockedTexts.some((item) => lower.includes(item));
}

/**
 * Chống lặp đoạn.
 */
function dedupeParagraphs(paragraphs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const paragraph of paragraphs) {
    const key = paragraph.toLowerCase().replace(/\s+/g, " ").trim();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(paragraph);
  }

  return result;
}

/**
 * Cắt text, tránh cắt cụt giữa từ quá xấu.
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const sliced = text.slice(0, maxLength);
  const lastSpaceIndex = sliced.lastIndexOf(" ");

  if (lastSpaceIndex > maxLength * 0.8) {
    return sliced.slice(0, lastSpaceIndex).trim() + "...";
  }

  return sliced.trim() + "...";
}
