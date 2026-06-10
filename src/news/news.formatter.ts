import { type NewsView } from "./news.service";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatNewsList(items: NewsView[]): string {
  if (items.length === 0) {
    return "Chưa có tin tức nào được lưu. Vui lòng đợi tiến trình thu thập tin chạy.";
  }

  return items
    .map((item, index) => {
      return [
        `<b>${index + 1}. ${escapeHtml(item.title)}</b>`,
        `Nguồn: ${item.source}`,
        `👉 <a href="${item.url}">Đọc bài viết tại đây</a>`,
      ].join("\n");
    })
    .join("\n\n");
}

export function formatArticlesBatch(articles: NewsView[]): string {
  const header = "🔥 <b>TIN CÔNG NGHỆ MỚI NHẤT</b> 🔥\n\n";
  const body = articles
    .map((article, index) => {
      return [
        `<b>${index + 1}. ${escapeHtml(article.title)}</b>`,
        article.summary ? `${escapeHtml(article.summary)}` : "",
        `<i>Nguồn: ${article.source}</i> | 👉 <a href="${article.url}">Đọc bài viết tại đây</a>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return header + body;
}
