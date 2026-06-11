import { type NewsView } from "../types/news";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const hasVietnamese = (text: string): boolean =>
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text);

export function formatNewsList(items: NewsView[], botUsername: string, startIndex = 1): string {
  if (items.length === 0) {
    return "Chưa có tin tức nào được lưu. Vui lòng đợi tiến trình thu thập tin chạy.";
  }

  const page = Math.floor((startIndex - 1) / 5) + 1;
  const header = `<b>DANH SÁCH TIN TỨC MỚI NHẤT (Trang ${page})</b>\n\n`;

  const body = items
    .map((item, index) => {
      let cleanSummary = item.summary ? item.summary.trim() : "";
      if (cleanSummary.length > 300) {
        cleanSummary = cleanSummary.slice(0, 300).trim() + "...";
      }
      const detailLink = `https://t.me/${botUsername}?start=detail_${item._id?.toString() || ""}`;
      return [
        `<b>${startIndex + index}. <a href="${detailLink}">${escapeHtml(item.title)}</a></b>`,
        cleanSummary ? `<i>${escapeHtml(cleanSummary)}</i>` : "",
        `Nguồn: ${item.source} | <a href="${item.url}">Đọc bài viết gốc tại nguồn</a>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return header + body;
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
    item.tags && item.tags.length > 0
      ? `<b>Thẻ (Tags):</b> ${item.tags.map((t) => `#${t}`).join(", ")}`
      : "",
    item.skills && item.skills.length > 0
      ? `<b>Kỹ năng (Skills):</b> ${item.skills.map((s) => `<code>${s}</code>`).join(", ")}`
      : "",
    `━━━━━━━━━━━━━━━━━━━━`,
    `<b>Mô tả ngắn gọn:</b>\n${displaySummary}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `<a href="${item.url}">Đọc bài viết gốc tại nguồn</a>`,
  ]
    .filter(Boolean)
    .join("\n");
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
        cleanSummary ? `<i>${escapeHtml(cleanSummary)}</i>` : "",
        `Nguồn: ${article.source} | <a href="${article.url}">Đọc bài viết gốc tại nguồn</a>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return header + body;
}
