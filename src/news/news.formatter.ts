import { type NewsView } from "../types/news";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const hasVietnamese = (text: string): boolean =>
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text);

export function formatNewsList(items: NewsView[], botUsername: string): string {
  if (items.length === 0) {
    return "Chưa có tin tức nào được lưu. Vui lòng đợi tiến trình thu thập tin chạy.";
  }

  return items
    .map((item, index) => {
      let cleanSummary = item.summary ? item.summary.trim() : "";
      if (cleanSummary.length > 200) {
        cleanSummary = cleanSummary.slice(0, 200).trim() + "...";
      }
      const summaryText = cleanSummary ? `\n<i>${escapeHtml(cleanSummary)}</i>` : "";
      const detailLink = `https://t.me/${botUsername}?start=detail_${item._id?.toString() || ""}`;
      return [
        `<b>${index + 1}. <a href="${detailLink}">${escapeHtml(item.title)}</a></b>${summaryText}`,
        `Nguồn: ${item.source} | <a href="${item.url}">Đọc bài viết gốc</a>`,
      ].join("\n");
    })
    .join("\n\n");
}

export function formatNewsDetail(item: NewsView): string {
  let displaySummary = item.summary || "Chưa có tóm tắt chi tiết.";
  if (displaySummary.length > 800) {
    displaySummary = displaySummary.slice(0, 800).trim() + "...";
  }

  return [
    `<b>CHI TIẾT & TÓM TẮT TIN TỨC</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `<b>Tiêu đề:</b> ${escapeHtml(item.title)}`,
    `<b>Nguồn:</b> ${item.source} | <b>Đánh giá:</b> ${item.importanceScore || 50}/100`,
    item.importanceReason ? `<b>Lý do đánh giá:</b> ${escapeHtml(item.importanceReason)}` : "",
    item.category ? `<b>Danh mục:</b> #_${item.category.toUpperCase()}` : "",
    item.tags && item.tags.length > 0 ? `<b>Thẻ (Tags):</b> ${item.tags.map(t => `#${t}`).join(", ")}` : "",
    item.skills && item.skills.length > 0 ? `<b>Kỹ năng (Skills):</b> ${item.skills.map(s => `<code>${s}</code>`).join(", ")}` : "",
    `━━━━━━━━━━━━━━━━━━━━`,
    `<b>Mô tả ngắn gọn:</b>\n${displaySummary}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `<a href="${item.url}">Đọc bài viết gốc tại nguồn</a>`
  ].filter(Boolean).join("\n");
}

export function formatArticlesBatch(articles: NewsView[], botUsername: string): string {
  const header = "<b>TIN CÔNG NGHỆ MỚI NHẤT</b>\n\n";
  const body = articles
    .map((article, index) => {
      let cleanSummary = article.summary ? article.summary.trim() : "";
      if (cleanSummary.length > 300) {
        cleanSummary = cleanSummary.slice(0, 300).trim() + "...";
      }
      const detailLink = `https://t.me/${botUsername}?start=detail_${article._id?.toString() || ""}`;
      return [
        `<b>${index + 1}. <a href="${detailLink}">${escapeHtml(article.title)}</a></b>`,
        cleanSummary ? `\n<i>${escapeHtml(cleanSummary)}</i>` : "",
        `<i>Nguồn: ${article.source}</i> | <a href="${article.url}">Đọc bài viết gốc tại nguồn</a>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return header + body;
}
