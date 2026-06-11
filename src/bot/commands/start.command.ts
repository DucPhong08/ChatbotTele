import { type Bot, type Context, InlineKeyboard } from "grammy";
import { SubscriberModel } from "../subscriber.model";
import { NewsService } from "../../news/news.service";
import { NewsModel } from "../../news/news.model";
import { formatNewsDetail, hasVietnamese } from "../../news/news.formatter";
import { AIService } from "../../ai/ai.service";
import { env } from "../../config/env";

export function registerStartCommand(bot: Bot<Context>, newsService: NewsService): void {
  bot.command("start", async (ctx) => {
    const chatId = ctx.chat.id;
    const parameter = String(ctx.match || "").trim();

    // Nếu start đi kèm tham số detail_[newsId] (người dùng click vào tiêu đề)
    if (parameter.startsWith("detail_")) {
      const newsId = parameter.replace("detail_", "");
      if (!newsId) {
        await ctx.reply(
          "Không tìm thấy bài viết này (liên kết cũ không chứa mã ID). Vui lòng gõ lệnh /news để lấy danh sách mới và thử lại.",
        );
        return;
      }
      try {
        const item = await newsService.getById(newsId);
        if (!item) {
          await ctx.reply("Không tìm thấy bài viết này.");
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
          .text("Xem tóm tắt chi tiết từ AI 🤖", `summarize_${newsId}`)
          .text("Quay lại danh sách", "back_to_list");

        await ctx.reply(detailText, {
          parse_mode: "HTML",
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        });
      } catch (error) {
        console.error("Lỗi khi tải chi tiết bài viết từ link deep-link:", error);
        await ctx.reply("Đã xảy ra lỗi khi tải thông tin chi tiết bài viết.");
      }
      return;
    }

    try {
      // Đăng ký nhận tin bằng cách lưu chatId vào database
      await SubscriberModel.updateOne({ chatId }, { $setOnInsert: { chatId } }, { upsert: true });

      const isAdmin = env.adminChatIds.includes(chatId);

      let welcomeMessage =
        "🤖 <b>CHÀO MỪNG BẠN ĐẾN VỚI TECHDEVNEWS BOT</b>\n" +
        "━━━━━━━━━━━━━━━━━━━━\n" +
        "Bạn đã đăng ký nhận tin tự động thành công! Bot sẽ tự động gửi các bài viết công nghệ mới nhất cho bạn.\n\n" +
        "📌 <b>CÁC LỆNH DÀNH CHO BẠN:</b>\n" +
        "• <code>/news</code> - Xem 5 bài viết mới nhất.\n" +
        "• <code>/news [trang]</code> - Xem tin ở các trang tiếp theo (ví dụ: <code>/news 2</code>).\n" +
        "• <code>/stop</code> - Hủy nhận tin tức tự động.\n" +
        "• <code>/start</code> - Đăng ký lại và hiển thị hướng dẫn này.";

      if (isAdmin) {
        welcomeMessage +=
          "\n\n⚙️ <b>CÁC LỆNH DÀNH CHO ADMIN:</b>\n" +
          "• <code>/sync</code> - Quét nguồn tin tức mới và phát sóng (broadcast) ngay lập tức.\n" +
          "• <code>/stats</code> - Xem thống kê hệ thống (tổng số bài viết, subscriber, model AI, môi trường).\n" +
          "• <code>/ping</code> - Kiểm tra trạng thái hoạt động của bot và môi trường.";
      }

      await ctx.reply(welcomeMessage, { parse_mode: "HTML" });
    } catch (error) {
      console.error("Lỗi khi đăng ký người dùng:", error);
      await ctx.reply("Đã xảy ra lỗi khi đăng ký nhận tin. Vui lòng thử lại sau!");
    }
  });
}
