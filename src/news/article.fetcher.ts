import { scrapeArticleContent } from "../utils/scraper";

type FetchArticleContentOptions = {
  maxLength?: number;
  timeoutMs?: number;
  minParagraphLength?: number;
};

/**
 * Fetch nội dung bài viết từ URL gốc, trích xuất text thuần bằng Cheerio Scraper.
 * Trả về chuỗi rỗng nếu thất bại.
 */
export async function fetchArticleContent(
  url: string,
  options: FetchArticleContentOptions = {},
): Promise<string> {
  return scrapeArticleContent(url, {
    maxChars: options.maxLength ?? 3000,
    timeoutMs: options.timeoutMs ?? 8000,
    minTextLength: options.minParagraphLength ?? 40,
  });
}
