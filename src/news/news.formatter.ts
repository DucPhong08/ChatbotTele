import { type NewsView } from "../types/news";

type Language = "vi" | "en";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const DEFAULT_SUMMARY_LIMIT = 200;
const DEFAULT_DETAIL_SUMMARY_LIMIT = 800;

export function escapeHtml(text = ""): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const hasVietnamese = (text: string): boolean =>
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text);

function truncateText(text: string, maxLength: number): string {
  const normalized = text.trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const sliced = normalized.slice(0, maxLength);
  const lastSpaceIndex = sliced.lastIndexOf(" ");

  if (lastSpaceIndex > maxLength * 0.8) {
    return sliced.slice(0, lastSpaceIndex).trim() + "...";
  }

  return sliced.trim() + "...";
}

function safeUrl(url?: string): string {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function safeBotUsername(botUsername: string): string {
  return botUsername.replace(/^@/, "").trim();
}

function buildDetailLink(botUsername: string, articleId?: unknown): string {
  const username = safeBotUsername(botUsername);
  const id = articleId?.toString();

  if (!username || !id) {
    return "";
  }

  return `https://t.me/${username}?start=detail_${encodeURIComponent(id)}`;
}

function formatHashtag(value: string): string {
  const cleanValue = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/[\s-]+/g, "_");

  return cleanValue ? `#${escapeHtml(cleanValue)}` : "";
}

function formatCode(value: string): string {
  return `<code>${escapeHtml(value.trim())}</code>`;
}

function getTitle(item: NewsView, language: Language): string {
  if (language === "en") {
    return item.titleEn || item.title || "Untitled";
  }

  return item.title || item.titleEn || "Không có tiêu đề";
}

function getSummary(item: NewsView, language: Language): string {
  if (language === "en") {
    return item.summaryEn || item.summary || "";
  }

  return item.summary || item.summaryEn || "";
}

function getImportanceReason(item: NewsView, language: Language): string {
  if (language === "en") {
    return item.importanceReasonEn || item.importanceReason || "";
  }

  return item.importanceReason || item.importanceReasonEn || "";
}

function getCategoryLabel(categories: string | string[], language: Language): string {
  const cats = Array.isArray(categories) ? categories : [categories];

  if (cats.includes("all")) {
    return language === "en" ? "All" : "Tất cả";
  }

  return cats.map((category) => category.toUpperCase()).join(", ");
}

function formatNewsPreviewItem(
  item: NewsView,
  index: number,
  botUsername: string,
  language: Language,
): string {
  const isEn = language === "en";

  const title = getTitle(item, language);
  const summary = truncateText(getSummary(item, language), DEFAULT_SUMMARY_LIMIT);

  const detailLink = buildDetailLink(botUsername, item._id);
  const originalUrl = safeUrl(item.url);

  const sourceLabel = isEn ? "Source" : "Nguồn";
  const linkLabel = isEn ? "Original link" : "Link gốc";

  const titleLine = detailLink
    ? `<b>${index}. <a href="${detailLink}">${escapeHtml(title)}</a></b>`
    : `<b>${index}. ${escapeHtml(title)}</b>`;

  const sourceText = escapeHtml(item.source || "Unknown");

  const sourceLine = originalUrl
    ? `${sourceLabel}: ${sourceText} | <a href="${originalUrl}">${linkLabel}</a>`
    : `${sourceLabel}: ${sourceText}`;

  return [titleLine, summary ? `<i>${escapeHtml(summary)}</i>` : "", sourceLine]
    .filter(Boolean)
    .join("\n");
}

function trimTelegramMessage(message: string): string {
  if (message.length <= TELEGRAM_MESSAGE_LIMIT) {
    return message;
  }

  return truncateText(message, TELEGRAM_MESSAGE_LIMIT - 20);
}

export function formatNewsList(
  items: NewsView[],
  botUsername: string,
  startIndex = 1,
  categories: string | string[] = "all",
  language: Language = "vi",
): string {
  const isEn = language === "en";

  if (items.length === 0) {
    return isEn
      ? "No new articles. Please check back later!"
      : "Chưa có tin tức nào mới. Vui lòng quay lại sau!";
  }

  const page = Math.floor((startIndex - 1) / 5) + 1;
  const categoryStr = getCategoryLabel(categories, language);

  const header = isEn
    ? `⚡ <b>Latest Tech News</b> (Page ${page} | ${escapeHtml(categoryStr)})\n────────────────\n`
    : `⚡ <b>Tin Công Nghệ Mới</b> (Trang ${page} | ${escapeHtml(categoryStr)})\n────────────────\n`;

  const body = items
    .map((item, index) => formatNewsPreviewItem(item, startIndex + index, botUsername, language))
    .join("\n\n");

  return trimTelegramMessage(header + body);
}

export function formatNewsDetail(item: NewsView, language: Language = "vi"): string {
  const isEn = language === "en";

  const title = getTitle(item, language);
  const summary = getSummary(item, language);
  const importanceReason = getImportanceReason(item, language);

  const displaySummary = truncateText(
    summary || (isEn ? "No detailed summary available." : "Chưa có tóm tắt chi tiết."),
    DEFAULT_DETAIL_SUMMARY_LIMIT,
  );

  const originalUrl = safeUrl(item.url);

  const labels = isEn
    ? {
        section: "🔹 <b>ARTICLE DETAILS</b>",
        title: "Title",
        source: "Source",
        rating: "Rating",
        whyRead: "Why read this",
        category: "Category",
        skills: "Skills",
        summary: "Short summary",
        originalLink: "Read original article here",
        tags: "Tags",
      }
    : {
        section: "🔹 <b>CHI TIẾT BÀI VIẾT</b>",
        title: "Tiêu đề",
        source: "Nguồn",
        rating: "Đánh giá",
        whyRead: "Tại sao cần đọc",
        category: "Thể loại",
        skills: "Kỹ năng",
        summary: "Tóm tắt ngắn",
        originalLink: "Đọc bài viết gốc tại nguồn",
        tags: "Tags",
      };

  const rating = typeof item.importanceScore === "number" ? item.importanceScore : 50;

  const categoryLine = item.category
    ? `<b>${labels.category}:</b> ${formatHashtag(item.category)}`
    : "";

  const tagsLine =
    item.tags && item.tags.length > 0
      ? `<b>${labels.tags}:</b> ${item.tags.map(formatHashtag).filter(Boolean).join(", ")}`
      : "";

  const skillsLine =
    item.skills && item.skills.length > 0
      ? `<b>${labels.skills}:</b> ${item.skills.map(formatCode).join(", ")}`
      : "";

  const originalLinkLine = originalUrl
    ? `🔗 <a href="${originalUrl}">${labels.originalLink}</a>`
    : "";

  const message = [
    labels.section,
    "────────────────",
    `<b>${labels.title}:</b> ${escapeHtml(title)}`,
    `<b>${labels.source}:</b> ${escapeHtml(item.source || "Unknown")} | <b>${labels.rating}:</b> ${rating}/100`,
    importanceReason ? `<b>${labels.whyRead}:</b> <i>${escapeHtml(importanceReason)}</i>` : "",
    categoryLine,
    tagsLine,
    skillsLine,
    "────────────────",
    `<b>${labels.summary}:</b>\n${escapeHtml(displaySummary)}`,
    "────────────────",
    originalLinkLine,
  ]
    .filter(Boolean)
    .join("\n");

  return trimTelegramMessage(message);
}

export function formatArticlesBatch(
  articles: NewsView[],
  botUsername: string,
  categories: string | string[] = "all",
  language: Language = "vi",
): string {
  const isEn = language === "en";
  const cats = Array.isArray(categories) ? categories : [categories];

  const categoryStr = !cats.includes("all")
    ? ` (${cats.map((c) => c.toUpperCase()).join(", ")})`
    : "";

  const header = isEn
    ? `⚡ <b>LATEST TECH NEWS${escapeHtml(categoryStr)}</b>\n────────────────\n`
    : `⚡ <b>BẢN TIN MỚI NHẤT${escapeHtml(categoryStr)}</b>\n────────────────\n`;

  const body = articles
    .map((article, index) => formatNewsPreviewItem(article, index + 1, botUsername, language))
    .join("\n\n");

  return trimTelegramMessage(header + body);
}
