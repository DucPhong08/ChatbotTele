import { type Bot, type Context, InlineKeyboard } from "grammy";
import { formatNewsList, escapeHtml } from "../../news/news.formatter";
import { NewsService } from "../../news/news.service";

export function registerNewsCommand(
  bot: Bot<Context>,
  newsService: NewsService,
): void {
  // Lệnh /news hiển thị danh sách 10 tin tức mới nhất kèm bàn phím chọn chi tiết
  bot.command("news", async (ctx) => {
    try {
      const latestNews = await newsService.getLatest(10);

      const keyboard = new InlineKeyboard();
      if (latestNews.length > 0) {
        latestNews.forEach((item, index) => {
          keyboard.text(`${index + 1}`, `detail_${item._id?.toString() || ""}`);
          if ((index + 1) % 5 === 0) {
            keyboard.row();
          }
        });
      }

      await ctx.reply(formatNewsList(latestNews), {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error("Lỗi khi xử lý lệnh /news:", error);
      await ctx.reply("Đã xảy ra lỗi khi lấy danh sách tin tức. Vui lòng thử lại sau!");
    }
  });

  // Xử lý khi click vào nút số thứ tự tin tức để xem chi tiết & tóm tắt
  bot.callbackQuery(/detail_(.+)/, async (ctx) => {
    const newsId = ctx.match[1];
    try {
      const item = await newsService.getById(newsId);
      if (!item) {
        await ctx.answerCallbackQuery({ text: "Không tìm thấy bài viết này." });
        return;
      }

      // Định dạng chi tiết bài viết kèm theo các gạch đầu dòng tóm tắt và skills
      const detailText = [
        `<b>CHI TIẾT & TÓM TẮT TIN TỨC</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `<b>Tiêu đề:</b> ${escapeHtml(item.title)}`,
        `<b>Nguồn:</b> ${item.source} | <b>Đánh giá:</b> ${item.importanceScore || 50}/100`,
        item.importanceReason ? `<b>Lý do đánh giá:</b> ${escapeHtml(item.importanceReason)}` : "",
        item.category ? `<b>Danh mục:</b> #_${item.category.toUpperCase()}` : "",
        item.tags && item.tags.length > 0 ? `<b>Thẻ (Tags):</b> ${item.tags.map(t => `#${t}`).join(", ")}` : "",
        item.skills && item.skills.length > 0 ? `<b>Kỹ năng (Skills):</b> ${item.skills.map(s => `<code>${s}</code>`).join(", ")}` : "",
        `━━━━━━━━━━━━━━━━━━━━`,
        `<b>Tóm tắt nội dung chính:</b>\n${item.summary || "Chưa có tóm tắt chi tiết."}`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `<a href="${item.url}">Đọc bài viết gốc tại nguồn</a>`
      ].filter(Boolean).join("\n");

      const keyboard = new InlineKeyboard()
        .text("Quay lại danh sách", "back_to_list");

      await ctx.editMessageText(detailText, {
        parse_mode: "HTML",
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
      await ctx.answerCallbackQuery();
    } catch (error) {
      console.error("Lỗi khi xem chi tiết tin tức:", error);
      await ctx.answerCallbackQuery({ text: "Đã xảy ra lỗi khi tải thông tin chi tiết." });
    }
  });

  // Xử lý khi click quay lại danh sách
  bot.callbackQuery("back_to_list", async (ctx) => {
    try {
      const latestNews = await newsService.getLatest(10);
      const message = formatNewsList(latestNews);

      const keyboard = new InlineKeyboard();
      if (latestNews.length > 0) {
        latestNews.forEach((item, index) => {
          keyboard.text(`${index + 1}`, `detail_${item._id?.toString() || ""}`);
          if ((index + 1) % 5 === 0) {
            keyboard.row();
          }
        });
      }

      await ctx.editMessageText(message, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      await ctx.answerCallbackQuery();
    } catch (error) {
      console.error("Lỗi khi quay lại danh sách tin tức:", error);
      await ctx.answerCallbackQuery({ text: "Đã xảy ra lỗi khi quay lại danh sách." });
    }
  });
}
