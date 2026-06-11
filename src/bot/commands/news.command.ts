import { type Bot, type Context, InlineKeyboard } from "grammy";
import {
  formatNewsList,
  escapeHtml,
  formatNewsDetail,
  hasVietnamese,
} from "../../news/news.formatter";
import { NewsService } from "../../news/news.service";
import { fetchArticleContent } from "../../news/article.fetcher";
import { AIService } from "../../ai/ai.service";
import { NewsModel } from "../../news/news.model";

export function registerNewsCommand(bot: Bot<Context>, newsService: NewsService): void {
  // Lệnh /news hiển thị danh sách 5 tin tức mới nhất, hỗ trợ /news [page] để xem các trang tiếp theo
  bot.command("news", async (ctx) => {
    try {
      const args = String(ctx.match || "").trim();
      let page = 1;
      if (args) {
        const parsed = parseInt(args, 10);
        if (!isNaN(parsed) && parsed > 0) {
          page = parsed;
        }
      }

      const limit = 5;
      const skip = (page - 1) * limit;
      const latestNews = await newsService.getLatest(limit, skip);

      if (latestNews.length === 0) {
        await ctx.reply(`Không tìm thấy tin tức nào ở Trang ${page}.`);
        return;
      }

      const keyboard = new InlineKeyboard();
      if (page > 1) {
        keyboard.text("Trang trước", `news_page_${page - 1}`);
      }
      if (latestNews.length === limit) {
        keyboard.text("Trang sau", `news_page_${page + 1}`);
      }

      await ctx.reply(formatNewsList(latestNews, ctx.me.username, skip + 1), {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error("Lỗi khi xử lý lệnh /news:", error);
      await ctx.reply("Đã xảy ra lỗi khi lấy danh sách tin tức. Vui lòng thử lại sau!");
    }
  });

  // Xử lý chuyển trang tin tức qua nút bấm Next / Prev
  bot.callbackQuery(/news_page_(\d+)/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10);
    try {
      const limit = 5;
      const skip = (page - 1) * limit;
      const latestNews = await newsService.getLatest(limit, skip);

      if (latestNews.length === 0) {
        await ctx.answerCallbackQuery({ text: `Không có tin tức ở Trang ${page}.` });
        return;
      }

      const keyboard = new InlineKeyboard();
      if (page > 1) {
        keyboard.text("Trang trước", `news_page_${page - 1}`);
      }
      if (latestNews.length === limit) {
        keyboard.text("Trang sau", `news_page_${page + 1}`);
      }

      await ctx.editMessageText(formatNewsList(latestNews, ctx.me.username, skip + 1), {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      await ctx.answerCallbackQuery();
    } catch (error) {
      console.error("Lỗi khi chuyển trang tin tức:", error);
      await ctx.answerCallbackQuery({ text: "Lỗi khi chuyển trang." });
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

      // Tự động dịch sang tiếng Việt nếu dữ liệu cũ còn lưu tiếng Anh
      let updated = false;
      if (item.summary && !hasVietnamese(item.summary)) {
        console.log(`[On-the-fly Translate] Đang dịch tóm tắt cho bài: ${item.title}`);
        const shortSummary =
          item.summary.length > 600 ? item.summary.slice(0, 600).trim() + "..." : item.summary;
        const translated = await AIService.translateWithGoogle(shortSummary);
        if (translated && translated !== item.summary) {
          item.summary = translated;
          updated = true;
        }
      }

      if (item.title && !hasVietnamese(item.title)) {
        console.log(`[On-the-fly Translate] Đang dịch tiêu đề cho bài: ${item.title}`);
        const translated = await AIService.translateWithGoogle(item.title);
        if (translated && translated !== item.title) {
          item.title = translated;
          updated = true;
        }
      }

      if (item.importanceReason && !hasVietnamese(item.importanceReason)) {
        console.log(`[On-the-fly Translate] Đang dịch lý do đánh giá cho bài: ${item.title}`);
        const translated = await AIService.translateWithGoogle(item.importanceReason);
        if (translated && translated !== item.importanceReason) {
          item.importanceReason = translated;
          updated = true;
        }
      }

      if (updated) {
        await NewsModel.updateOne(
          { _id: item._id },
          {
            title: item.title,
            summary: item.summary,
            importanceReason: item.importanceReason,
          },
        );
      }

      const detailText = formatNewsDetail(item);

      const keyboard = new InlineKeyboard()
        .text("Xem tóm tắt chi tiết từ AI", `summarize_${newsId}`)
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

  // Xử lý khi click "Tóm tắt bài viết" - fetch nội dung gốc và AI tóm tắt
  bot.callbackQuery(/summarize_(.+)/, async (ctx) => {
    const newsId = ctx.match[1];
    try {
      await ctx.answerCallbackQuery({ text: "Đang tóm tắt bài viết..." });

      const item = await newsService.getById(newsId);
      if (!item) {
        await ctx.answerCallbackQuery({ text: "Không tìm thấy bài viết." });
        return;
      }

      const articleContent = await fetchArticleContent(item.url);
      if (!articleContent) {
        const keyboard = new InlineKeyboard().text("Quay lại", `detail_${newsId}`);
        await ctx.editMessageText(
          `<b>TÓM TẮT BÀI VIẾT</b>\n━━━━━━━━━━━━━━━━━━━━\nKhông thể truy cập nội dung bài viết từ nguồn gốc.\nVui lòng đọc trực tiếp tại: <a href="${item.url}">link gốc</a>`,
          {
            parse_mode: "HTML",
            reply_markup: keyboard,
            link_preview_options: { is_disabled: true },
          },
        );
        return;
      }

      const result = await AIService.summarizeFullArticle(articleContent);

      const summaryPointsText = result.summaryPoints.map((p) => `* ${escapeHtml(p)}`).join("\n");
      const actionsText = result.actions.map((a) => `* ${escapeHtml(a)}`).join("\n");
      const uncertaintySection =
        result.uncertainty && result.uncertainty !== "Không có"
          ? `\n<b>Cần kiểm chứng:</b>\n${escapeHtml(result.uncertainty)}\n`
          : "";

      const summaryText = [
        `📰 <b>${escapeHtml(result.title || item.title)}</b>\n`,
        `<b>Tóm tắt:</b>\n${summaryPointsText}\n`,
        `<b>Vì sao đáng chú ý:</b> ${escapeHtml(result.whyItMatters)}\n`,
        uncertaintySection,
        `<b>Dev nên làm gì:</b>\n${actionsText}\n`,
        `<b>Mức độ đáng đọc:</b> ${result.readabilityScore}/10`,
        `<b>Chủ đề:</b> ${result.topics.map((t) => `#${t.trim().replace(/\s+/g, "_")}`).join(", ")}`,
        `<b>Nguồn:</b> <a href="${item.url}">Đọc bài viết gốc tại nguồn</a>`,
      ].join("\n");

      const keyboard = new InlineKeyboard()
        .text("Quay lại chi tiết", `detail_${newsId}`)
        .text("Quay lại danh sách", "back_to_list");

      await ctx.editMessageText(summaryText, {
        parse_mode: "HTML",
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      console.error("Lỗi khi tóm tắt bài viết:", error);
      const keyboard = new InlineKeyboard().text("Quay lại chi tiết", `detail_${newsId}`);
      await ctx
        .editMessageText(
          "<b>Đã xảy ra lỗi khi tóm tắt bài viết bằng AI.</b>\nVui lòng thử lại sau.",
          {
            parse_mode: "HTML",
            reply_markup: keyboard,
          },
        )
        .catch(() => {});
    }
  });

  // Xử lý khi click quay lại danh sách
  bot.callbackQuery("back_to_list", async (ctx) => {
    try {
      const limit = 5;
      const latestNews = await newsService.getLatest(limit);
      const message = formatNewsList(latestNews, ctx.me.username);

      const keyboard = new InlineKeyboard();
      if (latestNews.length === limit) {
        keyboard.text("Trang sau", "news_page_2");
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
