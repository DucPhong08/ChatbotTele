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
import { SubscriberModel } from "../subscriber.model";

export function registerNewsCommand(bot: Bot<Context>, newsService: NewsService): void {
  // Lệnh /news hiển thị danh sách 5 tin tức mới nhất, hỗ trợ /news [page] để xem các trang tiếp theo
  bot.command("news", async (ctx) => {
    try {
      await ctx.replyWithChatAction("typing");

      const args = String(ctx.match || "").trim();
      let page = 1;
      if (args) {
        const parsed = parseInt(args, 10);
        if (!isNaN(parsed) && parsed > 0) {
          page = parsed;
        }
      }

      const chatId = ctx.chat?.id;
      let categories: string[] = ["all"];
      let lang: "vi" | "en" = "vi";
      if (chatId) {
        const sub = await SubscriberModel.findOne({ chatId }).lean();
        if (sub) {
          if (sub.preferredCategories && sub.preferredCategories.length > 0) {
            categories = sub.preferredCategories;
          }
          if (sub.language) {
            lang = sub.language;
          }
        }
      }

      const limit = 5;
      const skip = (page - 1) * limit;
      const latestNews = await newsService.getLatest(limit, skip, categories);

      if (latestNews.length === 0) {
        const isEn = lang === "en";
        await ctx.reply(
          categories.includes("all")
            ? isEn
              ? `No news found on Page ${page}.`
              : `Không tìm thấy tin tức nào ở Trang ${page}.`
            : isEn
              ? `No news in selected categories on Page ${page}.`
              : `Không tìm thấy tin tức nào thuộc thể loại đã chọn ở Trang ${page}.`,
        );
        return;
      }

      const keyboard = new InlineKeyboard();
      const prevLabel = lang === "en" ? "◀️ Prev" : "◀️ Trước";
      const nextLabel = lang === "en" ? "▶️ Next" : "▶️ Sau";
      if (page > 1) {
        keyboard.text(prevLabel, `news_page_${page - 1}`);
      }
      if (latestNews.length === limit) {
        keyboard.text(nextLabel, `news_page_${page + 1}`);
      }

      await ctx.reply(formatNewsList(latestNews, ctx.me.username, skip + 1, categories, lang), {
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
    const chatId = ctx.chat?.id;
    try {
      let categories: string[] = ["all"];
      let lang: "vi" | "en" = "vi";
      if (chatId) {
        const sub = await SubscriberModel.findOne({ chatId }).lean();
        if (sub) {
          if (sub.preferredCategories && sub.preferredCategories.length > 0) {
            categories = sub.preferredCategories;
          }
          if (sub.language) {
            lang = sub.language;
          }
        }
      }

      const limit = 5;
      const skip = (page - 1) * limit;
      const latestNews = await newsService.getLatest(limit, skip, categories);

      const isEn = lang === "en";

      if (latestNews.length === 0) {
        await ctx.answerCallbackQuery({
          text: categories.includes("all")
            ? isEn
              ? `No news on Page ${page}.`
              : `Không có tin tức ở Trang ${page}.`
            : isEn
              ? `No news in selected categories on Page ${page}.`
              : `Không có tin tức thuộc thể loại đã chọn ở Trang ${page}.`,
        });
        return;
      }

      const keyboard = new InlineKeyboard();
      const prevLabel = isEn ? "◀️ Prev" : "◀️ Trước";
      const nextLabel = isEn ? "▶️ Next" : "▶️ Sau";
      if (page > 1) {
        keyboard.text(prevLabel, `news_page_${page - 1}`);
      }
      if (latestNews.length === limit) {
        keyboard.text(nextLabel, `news_page_${page + 1}`);
      }

      await ctx.editMessageText(
        formatNewsList(latestNews, ctx.me.username, skip + 1, categories, lang),
        {
          parse_mode: "HTML",
          reply_markup: keyboard,
        },
      );
      await ctx.answerCallbackQuery();
    } catch (error) {
      console.error("Lỗi khi chuyển trang tin tức:", error);
      await ctx.answerCallbackQuery({ text: "Lỗi khi chuyển trang." });
    }
  });

  // Xử lý khi click vào tiêu đề tin tức để xem chi tiết & tóm tắt
  bot.callbackQuery(/detail_(.+)/, async (ctx) => {
    const newsId = ctx.match[1];
    const chatId = ctx.chat?.id;
    try {
      await ctx.replyWithChatAction("typing");

      let lang: "vi" | "en" = "vi";
      if (chatId) {
        const sub = await SubscriberModel.findOne({ chatId }).lean();
        if (sub?.language) {
          lang = sub.language;
        }
      }

      const item = await newsService.getById(newsId);
      if (!item) {
        await ctx.answerCallbackQuery({
          text: lang === "en" ? "Article not found." : "Không tìm thấy bài viết này.",
        });
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
    const chatId = ctx.chat?.id;
    let lang: "vi" | "en" = "vi";
    if (chatId) {
      const sub = await SubscriberModel.findOne({ chatId }).lean();
      if (sub?.language) {
        lang = sub.language;
      }
    }

    const isEn = lang === "en";

    try {
      await ctx.answerCallbackQuery({
        text: isEn ? "Summarizing article..." : "Đang tóm tắt bài viết...",
      });
      await ctx.replyWithChatAction("typing");

      const item = await newsService.getById(newsId);
      if (!item) {
        await ctx.answerCallbackQuery({
          text: isEn ? "Article not found." : "Không tìm thấy bài viết.",
        });
        return;
      }

      const articleContent = await fetchArticleContent(item.url);
      if (!articleContent) {
        const backLabel = isEn ? "🔙 Back" : "🔙 Quay lại";
        const keyboard = new InlineKeyboard().text(backLabel, `detail_${newsId}`);
        const errMsg = isEn
          ? `<b>ARTICLE SUMMARY</b>\n────────────────\nCould not fetch original article content.\nPlease read directly at: <a href="${item.url}">original link</a>`
          : `<b>TÓM TẮT BÀI VIẾT</b>\n────────────────\nKhông thể truy cập nội dung bài viết từ nguồn gốc.\nVui lòng đọc trực tiếp tại: <a href="${item.url}">link gốc</a>`;
        await ctx.editMessageText(errMsg, {
          parse_mode: "HTML",
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        });
        return;
      }

      const result = await AIService.summarizeFullArticle(articleContent, lang);

      const summaryPointsText = result.summaryPoints.map((p) => `* ${escapeHtml(p)}`).join("\n");
      const actionsText = result.actions.map((a) => `* ${escapeHtml(a)}`).join("\n");

      let uncertaintySection = "";
      if (
        result.uncertainty &&
        result.uncertainty !== "Không có" &&
        result.uncertainty !== "None"
      ) {
        const uncertaintyTitle = isEn ? "Needs verification" : "Cần kiểm chứng";
        uncertaintySection = `\n<b>${uncertaintyTitle}:</b>\n${escapeHtml(result.uncertainty)}\n`;
      }

      const labels = isEn
        ? {
            summary: "Summary",
            whyRead: "Why read this",
            whatDevShouldDo: "What developers should do",
            readability: "Readability score",
            topics: "Topics",
            source: "Source",
            readOriginal: "Read original article at source",
            detailBtn: "🔙 Details",
            listBtn: "🔙 List",
          }
        : {
            summary: "Tóm tắt",
            whyRead: "Vì sao đáng chú ý",
            whatDevShouldDo: "Dev nên làm gì",
            readability: "Mức độ đáng đọc",
            topics: "Chủ đề",
            source: "Nguồn",
            readOriginal: "Đọc bài viết gốc tại nguồn",
            detailBtn: "🔙 Chi tiết",
            listBtn: "🔙 Danh sách",
          };

      const titleToUse = isEn
        ? item.titleEn || result.title || item.title
        : result.title || item.title;

      const summaryText = [
        `📰 <b>${escapeHtml(titleToUse)}</b>\n`,
        `<b>${labels.summary}:</b>\n${summaryPointsText}\n`,
        `<b>${labels.whyRead}:</b> ${escapeHtml(result.whyItMatters)}\n`,
        uncertaintySection,
        `<b>${labels.whatDevShouldDo}:</b>\n${actionsText}\n`,
        `<b>${labels.readability}:</b> ${result.readabilityScore}/10`,
        `<b>${labels.topics}:</b> ${result.topics.map((t) => `#${t.trim().replace(/\s+/g, "_")}`).join(", ")}`,
        `<b>${labels.source}:</b> <a href="${item.url}">${labels.readOriginal}</a>`,
      ].join("\n");

      const keyboard = new InlineKeyboard()
        .text(labels.detailBtn, `detail_${newsId}`)
        .text(labels.listBtn, "back_to_list");

      await ctx.editMessageText(summaryText, {
        parse_mode: "HTML",
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      console.error("Lỗi khi tóm tắt bài viết:", error);
      const isEn = lang === "en";
      const backBtnLabel = isEn ? "🔙 Details" : "🔙 Chi tiết";
      const keyboard = new InlineKeyboard().text(backBtnLabel, `detail_${newsId}`);
      const errMessage = isEn
        ? "<b>An error occurred while summarizing the article using AI.</b>\nPlease try again later."
        : "<b>Đã xảy ra lỗi khi tóm tắt bài viết bằng AI.</b>\nVui lòng thử lại sau.";
      await ctx
        .editMessageText(errMessage, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        })
        .catch(() => {});
    }
  });

  // Xử lý khi click quay lại danh sách
  bot.callbackQuery("back_to_list", async (ctx) => {
    const chatId = ctx.chat?.id;
    try {
      let categories: string[] = ["all"];
      let lang: "vi" | "en" = "vi";
      if (chatId) {
        const sub = await SubscriberModel.findOne({ chatId }).lean();
        if (sub) {
          if (sub.preferredCategories && sub.preferredCategories.length > 0) {
            categories = sub.preferredCategories;
          }
          if (sub.language) {
            lang = sub.language;
          }
        }
      }
      const limit = 5;
      const latestNews = await newsService.getLatest(limit, 0, categories);
      const message = formatNewsList(latestNews, ctx.me.username, 1, categories, lang);

      const keyboard = new InlineKeyboard();
      if (latestNews.length === limit) {
        const nextLabel = lang === "en" ? "▶️ Next" : "▶️ Sau";
        keyboard.text(nextLabel, "news_page_2");
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
