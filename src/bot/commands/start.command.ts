import { type Bot, type Context, InlineKeyboard } from "grammy";
import { SubscriberModel } from "../subscriber.model";
import { NewsService } from "../../news/news.service";
import { NewsModel } from "../../news/news.model";
import { formatNewsDetail, hasVietnamese } from "../../news/news.formatter";
import { AIService } from "../../ai/ai.service";
import { env } from "../../config/env";

export function registerStartCommand(bot: Bot<Context>, newsService: NewsService): void {
  bot.command("start", async (ctx) => {
    // Show typing status for a lively but clean UX
    await ctx.replyWithChatAction("typing");

    const chatId = ctx.chat.id;
    const parameter = String(ctx.match || "").trim();

    let sub = await SubscriberModel.findOne({ chatId });
    const lang = sub?.language || "vi";

    // Nếu start đi kèm tham số detail_[newsId] (người dùng click vào tiêu đề)
    if (parameter.startsWith("detail_")) {
      const newsId = parameter.replace("detail_", "");
      if (!newsId) {
        await ctx.reply(
          lang === "en"
            ? "Article not found. Please type /news to list recent articles."
            : "Không tìm thấy bài viết này. Vui lòng gõ lệnh /news để lấy danh sách mới và thử lại.",
        );
        return;
      }
      try {
        const item = await newsService.getById(newsId);
        if (!item) {
          await ctx.reply(lang === "en" ? "Article not found." : "Không tìm thấy bài viết này.");
          return;
        }

        // Tự động dịch sang ngôn ngữ của người dùng nếu dữ liệu còn thiếu
        let updated = false;
        if (lang === "vi") {
          if (item.summary && !hasVietnamese(item.summary)) {
            console.log(`[On-the-fly Translate] Đang dịch tóm tắt cho bài: ${item.title}`);
            const shortSummary =
              item.summary.length > 600 ? item.summary.slice(0, 600).trim() + "..." : item.summary;
            const translated = await AIService.translateWithGoogle(shortSummary, "vi");
            if (translated && translated !== item.summary) {
              item.summary = translated;
              updated = true;
            }
          }

          if (item.title && !hasVietnamese(item.title)) {
            console.log(`[On-the-fly Translate] Đang dịch tiêu đề cho bài: ${item.title}`);
            const translated = await AIService.translateWithGoogle(item.title, "vi");
            if (translated && translated !== item.title) {
              item.title = translated;
              updated = true;
            }
          }

          if (item.importanceReason && !hasVietnamese(item.importanceReason)) {
            console.log(`[On-the-fly Translate] Đang dịch lý do đánh giá cho bài: ${item.title}`);
            const translated = await AIService.translateWithGoogle(item.importanceReason, "vi");
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
        } else {
          // lang === "en"
          if (!item.titleEn) {
            console.log(`[On-the-fly Translate] Translate title to EN: ${item.title}`);
            const translated = await AIService.translateWithGoogle(item.title, "en");
            if (translated) {
              item.titleEn = translated;
              updated = true;
            }
          }
          if (!item.summaryEn && item.summary) {
            console.log(`[On-the-fly Translate] Translate summary to EN: ${item.title}`);
            const shortSummary =
              item.summary.length > 600 ? item.summary.slice(0, 600).trim() + "..." : item.summary;
            const translated = await AIService.translateWithGoogle(shortSummary, "en");
            if (translated) {
              item.summaryEn = translated;
              updated = true;
            }
          }
          if (!item.importanceReasonEn && item.importanceReason) {
            console.log(`[On-the-fly Translate] Translate reason to EN: ${item.title}`);
            const translated = await AIService.translateWithGoogle(item.importanceReason, "en");
            if (translated) {
              item.importanceReasonEn = translated;
              updated = true;
            }
          }

          if (updated) {
            await NewsModel.updateOne(
              { _id: item._id },
              {
                titleEn: item.titleEn,
                summaryEn: item.summaryEn,
                importanceReasonEn: item.importanceReasonEn,
              },
            );
          }
        }

        const detailText = formatNewsDetail(item, lang);

        const summarizeLabel = lang === "en" ? "🧠 AI Summary" : "🧠 Tóm tắt AI";
        const backLabel = lang === "en" ? "🔙 Back" : "🔙 Quay lại";

        const keyboard = new InlineKeyboard()
          .text(summarizeLabel, `summarize_${newsId}`)
          .text(backLabel, "back_to_list");

        await ctx.reply(detailText, {
          parse_mode: "HTML",
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        });
      } catch (error) {
        console.error("Lỗi khi tải chi tiết bài viết từ link deep-link:", error);
        await ctx.reply(
          lang === "en"
            ? "An error occurred while loading article details."
            : "Đã xảy ra lỗi khi tải thông tin chi tiết bài viết.",
        );
      }
      return;
    }

    try {
      // Đăng ký nhận tin bằng cách lưu chatId vào database
      if (!sub) {
        sub = await SubscriberModel.create({
          chatId,
          language: "vi",
          username: ctx.from?.username || "",
          firstName: ctx.from?.first_name || "",
          lastName: ctx.from?.last_name || "",
          isActiveAI: true,
        });
      } else {
        sub.username = ctx.from?.username || "";
        sub.firstName = ctx.from?.first_name || "";
        sub.lastName = ctx.from?.last_name || "";
        sub.isActiveAI = true;
        await sub.save();
      }

      const isEn = lang === "en";
      const welcomeMessage = isEn
        ? `<b>WELCOME TO TECHDEVNEWS BOT</b>\n` +
          `────────────────\n` +
          `You have subscribed to automated updates! The bot will send you the latest tech articles.\n\n` +
          `<b>COMMANDS:</b>\n` +
          `- /news - View latest news (e.g., /news 2).\n` +
          `- /category <code>[topic]</code> - Filter categories using AI.\n` +
          `- /settings - Configure language & digest preferences.\n` +
          `- /submitfeed <code>[url]</code> - Suggest a new RSS source.\n` +
          `- /feedback <code>[message]</code> - Send feedback to the administrators.\n` +
          `- /stop - Stop receiving automated news.\n` +
          `- /start - Show help guide.` +
          (env.adminChatIds.includes(chatId)
            ? `\n\n<b>ADMIN:</b>\n` +
              `- /addfeed <code>[url]</code> - Monitor RSS source instantly.\n` +
              `- /sync - Force crawl & broadcast now.\n` +
              `- /stats - View system statistics.\n` +
              `- /ping - Check health status.`
            : "")
        : `<b>CHÀO MỪNG BẠN ĐẾN VỚI TECHDEVNEWS BOT</b>\n` +
          `────────────────\n` +
          `Bạn đã đăng ký nhận tin tự động! Bot sẽ gửi các bài viết công nghệ mới nhất cho bạn.\n\n` +
          `<b>CÁC LỆNH HỖ TRỢ:</b>\n` +
          `- /news - Xem tin mới nhất (VD: /news 2).\n` +
          `- /category <code>[chủ đề]</code> - Lọc thể loại tin bằng AI.\n` +
          `- /settings - Cấu hình ngôn ngữ & bản tin tổng hợp.\n` +
          `- /submitfeed <code>[url]</code> - Đề xuất thêm nguồn RSS mới.\n` +
          `- /feedback <code>[góp ý]</code> - Gửi góp ý, phản hồi cho quản trị viên.\n` +
          `- /stop - Hủy nhận tin tự động.\n` +
          `- /start - Đăng ký lại và xem hướng dẫn.` +
          (env.adminChatIds.includes(chatId)
            ? `\n\n<b>LỆNH ADMIN:</b>\n` +
              `- /addfeed <code>[url]</code> - Thêm nguồn RSS ngay lập tức.\n` +
              `- /sync - Cào tin & gửi tin tức thì.\n` +
              `- /stats - Xem thống kê hệ thống.\n` +
              `- /ping - Kiểm tra hoạt động của bot.`
            : "");

      await ctx.reply(welcomeMessage, { parse_mode: "HTML" });
    } catch (error) {
      console.error("Lỗi khi đăng ký người dùng:", error);
      await ctx.reply(
        lang === "en"
          ? "An error occurred while subscribing. Please try again later!"
          : "Đã xảy ra lỗi khi đăng ký nhận tin. Vui lòng thử lại sau!",
      );
    }
  });
}
