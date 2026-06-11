import { type NewsView } from "../types/news";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const hasVietnamese = (text: string): boolean =>
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text);

export function formatNewsList(
  items: NewsView[],
  botUsername: string,
  startIndex = 1,
  categories: string | string[] = "all",
  language: "vi" | "en" = "vi",
): string {
  const isEn = language === "en";

  if (items.length === 0) {
    return isEn
      ? "No new articles. Please check back later!"
      : "Chưa có tin tức nào mới. Vui lòng quay lại sau!";
  }

  const page = Math.floor((startIndex - 1) / 5) + 1;
  const cats = Array.isArray(categories) ? categories : [categories];

  let categoryStr = "";
  if (cats.includes("all")) {
    categoryStr = isEn ? "All" : "Tất cả";
  } else {
    categoryStr = cats.map((c) => c.toUpperCase()).join(", ");
  }

  const header = isEn
    ? `⚡ <b>Latest Tech News</b> (Page ${page} | ${categoryStr})\n────────────────\n`
    : `⚡ <b>Tin Công Nghệ Mới</b> (Trang ${page} | ${categoryStr})\n────────────────\n`;

  const body = items
    .map((item, index) => {
      const title = isEn ? item.titleEn || item.title : item.title;
      let summary = isEn ? item.summaryEn || item.summary || "" : item.summary || "";

      let cleanSummary = summary.trim();
      if (cleanSummary.length > 200) {
        cleanSummary = cleanSummary.slice(0, 200).trim() + "...";
      }
      const detailLink = `https://t.me/${botUsername}?start=detail_${item._id?.toString() || ""}`;

      const sourceLabel = isEn ? "Source" : "Nguồn";
      const linkLabel = isEn ? "Original link" : "Link gốc";

      return [
        `<b>${startIndex + index}. <a href="${detailLink}">${escapeHtml(title)}</a></b>`,
        cleanSummary ? `<i>${escapeHtml(cleanSummary)}</i>` : "",
        `${sourceLabel}: ${item.source} | <a href="${item.url}">${linkLabel}</a>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return header + body;
}

export function formatNewsDetail(item: NewsView, language: "vi" | "en" = "vi"): string {
  const isEn = language === "en";

  const title = isEn ? item.titleEn || item.title : item.title;
  const summary = isEn ? item.summaryEn || item.summary || "" : item.summary || "";
  const importanceReason = isEn
    ? item.importanceReasonEn || item.importanceReason || ""
    : item.importanceReason || "";

  let displaySummary =
    summary || (isEn ? "No detailed summary available." : "Chưa có tóm tắt chi tiết.");
  if (displaySummary.length > 800) {
    displaySummary = displaySummary.slice(0, 800).trim() + "...";
  }

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
      };

  return [
    labels.section,
    `────────────────`,
    `<b>${labels.title}:</b> ${escapeHtml(title)}`,
    `<b>${labels.source}:</b> ${item.source} | <b>${labels.rating}:</b> ${item.importanceScore || 50}/100`,
    importanceReason ? `<b>${labels.whyRead}:</b> <i>${escapeHtml(importanceReason)}</i>` : "",
    item.category ? `<b>${labels.category}:</b> #_${item.category.toUpperCase()}` : "",
    item.tags && item.tags.length > 0
      ? `<b>Tags:</b> ${item.tags.map((t) => `#${t}`).join(", ")}`
      : "",
    item.skills && item.skills.length > 0
      ? `<b>${labels.skills}:</b> ${item.skills.map((s) => `<code>${s}</code>`).join(", ")}`
      : "",
    `────────────────`,
    `<b>${labels.summary}:</b>\n${displaySummary}`,
    `────────────────`,
    `🔗 <a href="${item.url}">${labels.originalLink}</a>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatArticlesBatch(
  articles: NewsView[],
  botUsername: string,
  categories: string | string[] = "all",
  language: "vi" | "en" = "vi",
): string {
  const isEn = language === "en";
  const cats = Array.isArray(categories) ? categories : [categories];

  let categoryStr = "";
  if (!cats.includes("all")) {
    categoryStr = ` (${cats.map((c) => c.toUpperCase()).join(", ")})`;
  }

  const header = isEn
    ? `⚡ <b>LATEST TECH NEWS${categoryStr}</b>\n────────────────\n`
    : `⚡ <b>BẢN TIN MỚI NHẤT${categoryStr}</b>\n────────────────\n`;

  const body = articles
    .map((article, index) => {
      const title = isEn ? article.titleEn || article.title : article.title;
      let summary = isEn ? article.summaryEn || article.summary || "" : article.summary || "";

      let cleanSummary = summary.trim();
      if (cleanSummary.length > 200) {
        cleanSummary = cleanSummary.slice(0, 200).trim() + "...";
      }
      const detailLink = `https://t.me/${botUsername}?start=detail_${article._id?.toString() || ""}`;

      const sourceLabel = isEn ? "Source" : "Nguồn";
      const linkLabel = isEn ? "Original link" : "Link gốc";

      return [
        `<b>${index + 1}. <a href="${detailLink}">${escapeHtml(title)}</a></b>`,
        cleanSummary ? `<i>${escapeHtml(cleanSummary)}</i>` : "",
        `${sourceLabel}: ${article.source} | <a href="${article.url}">${linkLabel}</a>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return header + body;
}
