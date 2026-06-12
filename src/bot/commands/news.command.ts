import { type Bot, type Context, InlineKeyboard } from "grammy";
import {
  formatNewsList,
  formatNewsDetail,
  hasVietnamese,
  escapeHtml,
} from "../../news/news.formatter";
import { NewsService } from "../../news/news.service";
import { fetchArticleContent } from "../../news/article.fetcher";
import { AIService } from "../../ai/ai.service";
import { NewsModel } from "../../news/news.model";
import { SubscriberModel } from "../subscriber.model";
import { type NewsView } from "../../types/news";

const summaryCache = new Map<
  string,
  { text: string; keyboard: InlineKeyboard; timestamp: number }
>();
const activeSummaries = new Set<string>();

const SUMMARY_CACHE_TTL = 5 * 60 * 1000;

function makeCacheKey(newsId: string, lang: string): string {
  return `${newsId}_${lang}`;
}

async function getSubscriberPrefs(
  chatId: number | undefined,
): Promise<{ categories: string[]; lang: "vi" | "en" }> {
  const defaults = { categories: ["all"] as string[], lang: "vi" as "vi" | "en" };
  if (!chatId) return defaults;
  const sub = await SubscriberModel.findOne({ chatId }).lean<any>().exec();
  if (!sub) return defaults;
  return {
    categories:
      sub.preferredCategories && sub.preferredCategories.length > 0
        ? sub.preferredCategories
        : defaults.categories,
    lang: sub.language ?? defaults.lang,
  };
}

async function getNewsForUser(
  newsService: NewsService,
  limit: number,
  skip: number,
  categories: string[],
): Promise<{ items: NewsView[]; hasMore: boolean }> {
  const items = await newsService.getLatest(limit, skip, categories);
  const nextBatch = await newsService.getLatest(1, skip + limit, categories);
  return { items, hasMore: nextBatch.length > 0 };
}

function buildPaginationKeyboard(
  page: number,
  hasMore: boolean,
  lang: "vi" | "en",
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (page > 1) keyboard.text(lang === "en" ? "◀️ Prev" : "◀️ Trước", `news_page_${page - 1}`);
  if (hasMore) keyboard.text(lang === "en" ? "▶️ Next" : "▶️ Sau", `news_page_${page + 1}`);
  return keyboard;
}

const LABELS = {
  vi: {
    summary: "Tóm tắt",
    whyRead: "Vì sao đáng chú ý",
    whatDevShouldDo: "Dev nên làm gì",
    readability: "Mức độ đáng đọc",
    topics: "Chủ đề",
    source: "Nguồn",
    readOriginal: "Đọc bài viết gốc tại nguồn",
    detailBtn: "🔙 Chi tiết",
    listBtn: "🔙 Danh sách",
  },
  en: {
    summary: "Summary",
    whyRead: "Why read this",
    whatDevShouldDo: "What developers should do",
    readability: "Readability score",
    topics: "Topics",
    source: "Source",
    readOriginal: "Read original article at source",
    detailBtn: "🔙 Details",
    listBtn: "🔙 List",
  },
} as const;

export function registerNewsCommand(bot: Bot<Context>, newsService: NewsService): void {
  const LIMIT = 5;

  // /news [page] — hiển thị danh sách tin tức
  bot.command("news", async (ctx) => {
    try {
      await ctx.replyWithChatAction("typing");

      const args = String(ctx.match || "").trim();
      const parsed = parseInt(args, 10);
      const page = !isNaN(parsed) && parsed > 0 ? parsed : 1;
      const skip = (page - 1) * LIMIT;

      const { categories, lang } = await getSubscriberPrefs(ctx.chat?.id);
      const { items: latestNews, hasMore } = await getNewsForUser(
        newsService,
        LIMIT,
        skip,
        categories,
      );

      if (latestNews.length === 0) {
        const isAll = categories.includes("all");
        await ctx.reply(
          lang === "en"
            ? isAll
              ? `No news found on Page ${page}.`
              : `No news in selected categories on Page ${page}.`
            : isAll
              ? `Không tìm thấy tin tức nào ở Trang ${page}.`
              : `Không tìm thấy tin tức nào thuộc thể loại đã chọn ở Trang ${page}.`,
        );
        return;
      }

      await ctx.reply(formatNewsList(latestNews, ctx.me.username, skip + 1, categories, lang), {
        parse_mode: "HTML",
        reply_markup: buildPaginationKeyboard(page, hasMore, lang),
      });
    } catch (error) {
      console.error("Lỗi khi xử lý lệnh /news:", error);
      await ctx.reply("Đã xảy ra lỗi khi lấy danh sách tin tức. Vui lòng thử lại sau!");
    }
  });

  // Chuyển trang qua nút Next / Prev
  bot.callbackQuery(/news_page_(\d+)/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10);
    try {
      const { categories, lang } = await getSubscriberPrefs(ctx.chat?.id);
      const skip = (page - 1) * LIMIT;
      const { items: latestNews, hasMore } = await getNewsForUser(
        newsService,
        LIMIT,
        skip,
        categories,
      );
      const isEn = lang === "en";

      if (latestNews.length === 0) {
        const isAll = categories.includes("all");
        await ctx
          .answerCallbackQuery({
            text: isEn
              ? isAll
                ? `No news on Page ${page}.`
                : `No news in selected categories on Page ${page}.`
              : isAll
                ? `Không có tin tức ở Trang ${page}.`
                : `Không có tin tức thuộc thể loại đã chọn ở Trang ${page}.`,
          })
          .catch(() => {});
        return;
      }

      await ctx.editMessageText(
        formatNewsList(latestNews, ctx.me.username, skip + 1, categories, lang),
        {
          parse_mode: "HTML",
          reply_markup: buildPaginationKeyboard(page, hasMore, lang),
        },
      );
      await ctx.answerCallbackQuery().catch(() => {});
    } catch (error) {
      console.error("Lỗi khi chuyển trang tin tức:", error);
      await ctx.answerCallbackQuery({ text: "Lỗi khi chuyển trang." }).catch(() => {});
    }
  });

  // Xem chi tiết bài viết
  bot.callbackQuery(/detail_(.+)/, async (ctx) => {
    const newsId = ctx.match[1];
    let lang: "vi" | "en" = "vi";
    try {
      await ctx.replyWithChatAction("typing");
      // Trả lời callback query ngay lập tức để tránh spinner timeout
      await ctx.answerCallbackQuery().catch(() => {});

      const prefs = await getSubscriberPrefs(ctx.chat?.id);
      lang = prefs.lang;

      const item = await newsService.getById(newsId);
      if (!item) {
        await ctx
          .editMessageText(lang === "en" ? "Article not found." : "Không tìm thấy bài viết này.")
          .catch(() => {});
        return;
      }

      // Dịch on-the-fly nếu thiếu dữ liệu theo ngôn ngữ
      let updated = false;

      if (lang === "vi") {
        if (item.summary && !hasVietnamese(item.summary)) {
          console.log(`[On-the-fly Translate] Đang dịch tóm tắt cho bài: ${item.title}`);
          const short =
            item.summary.length > 600 ? item.summary.slice(0, 600).trim() + "..." : item.summary;
          const t = await AIService.translateWithGoogle(short, "vi");
          if (t && t !== item.summary) {
            item.summary = t;
            updated = true;
          }
        }
        if (item.title && !hasVietnamese(item.title)) {
          console.log(`[On-the-fly Translate] Đang dịch tiêu đề cho bài: ${item.title}`);
          const t = await AIService.translateWithGoogle(item.title, "vi");
          if (t && t !== item.title) {
            item.title = t;
            updated = true;
          }
        }
        if (item.importanceReason && !hasVietnamese(item.importanceReason)) {
          console.log(`[On-the-fly Translate] Đang dịch lý do đánh giá cho bài: ${item.title}`);
          const t = await AIService.translateWithGoogle(item.importanceReason, "vi");
          if (t && t !== item.importanceReason) {
            item.importanceReason = t;
            updated = true;
          }
        }
        if (updated) {
          await NewsModel.updateOne(
            { _id: item._id },
            { title: item.title, summary: item.summary, importanceReason: item.importanceReason },
          );
        }
      } else {
        if (!item.titleEn) {
          console.log(`[On-the-fly Translate] Translate title to EN: ${item.title}`);
          const t = await AIService.translateWithGoogle(item.title, "en");
          if (t) {
            item.titleEn = t;
            updated = true;
          }
        }
        if (!item.summaryEn && item.summary) {
          console.log(`[On-the-fly Translate] Translate summary to EN: ${item.title}`);
          const short =
            item.summary.length > 600 ? item.summary.slice(0, 600).trim() + "..." : item.summary;
          const t = await AIService.translateWithGoogle(short, "en");
          if (t) {
            item.summaryEn = t;
            updated = true;
          }
        }
        if (!item.importanceReasonEn && item.importanceReason) {
          console.log(`[On-the-fly Translate] Translate reason to EN: ${item.title}`);
          const t = await AIService.translateWithGoogle(item.importanceReason, "en");
          if (t) {
            item.importanceReasonEn = t;
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

      const keyboard = new InlineKeyboard()
        .text(lang === "en" ? "🧠 AI Summary" : "🧠 Tóm tắt AI", `summarize_${newsId}`)
        .text(lang === "en" ? "🔙 Back" : "🔙 Quay lại", "back_to_list");

      await ctx.editMessageText(formatNewsDetail(item, lang), {
        parse_mode: "HTML",
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      console.error("Lỗi khi xem chi tiết tin tức:", error);
      await ctx
        .editMessageText(
          lang === "en"
            ? "An error occurred while loading article details."
            : "Đã xảy ra lỗi khi tải thông tin chi tiết bài viết.",
        )
        .catch(() => {});
    }
  });

  // Tóm tắt bài viết bằng AI
  bot.callbackQuery(/summarize_(.+)/, async (ctx) => {
    const newsId = ctx.match[1];
    const { lang } = await getSubscriberPrefs(ctx.chat?.id);
    const isEn = lang === "en";
    const cacheKey = makeCacheKey(newsId, lang);
    const labels = LABELS[lang];

    // Trả cache nếu còn hạn
    const cached = summaryCache.get(cacheKey);
    if (cached) {
      if (Date.now() - cached.timestamp <= SUMMARY_CACHE_TTL) {
        await ctx
          .editMessageText(cached.text, {
            parse_mode: "HTML",
            reply_markup: cached.keyboard,
            link_preview_options: { is_disabled: true },
          })
          .catch(() => {});
        await ctx.answerCallbackQuery().catch(() => {});
        return;
      }
      summaryCache.delete(cacheKey);
    }

    if (activeSummaries.has(cacheKey)) {
      await ctx
        .answerCallbackQuery({
          text: isEn ? "Summary is already generating..." : "Đang tiến hành tóm tắt rồi...",
        })
        .catch(() => {});
      return;
    }

    activeSummaries.add(cacheKey);

    try {
      await ctx
        .answerCallbackQuery({ text: isEn ? "Summarizing article..." : "Đang tóm tắt bài viết..." })
        .catch(() => {});
      await ctx
        .editMessageText(
          isEn
            ? "⏳ <i>Summarizing article with AI, please wait...</i>"
            : "⏳ <i>Đang tóm tắt bài viết bằng AI, vui lòng chờ trong giây lát...</i>",
          { parse_mode: "HTML" },
        )
        .catch(() => {});
      await ctx.replyWithChatAction("typing").catch(() => {});

      const item = await newsService.getById(newsId);
      if (!item) {
        const keyboard = new InlineKeyboard().text(labels.detailBtn, `detail_${newsId}`);
        await ctx
          .editMessageText(isEn ? "Article not found." : "Không tìm thấy bài viết.", {
            reply_markup: keyboard,
          })
          .catch(() => {});
        return;
      }

      let articleContent = await fetchArticleContent(item.url);
      if (!articleContent) {
        // Fallback to database summary/importanceReason if scraping fails
        const fallbackParts: string[] = [];
        const titleText = isEn ? item.titleEn || item.title : item.title || item.titleEn;
        if (titleText) {
          fallbackParts.push(`Title: ${titleText}`);
        }
        const summaryText = isEn ? item.summaryEn || item.summary : item.summary || item.summaryEn;
        if (summaryText) {
          fallbackParts.push(`Summary: ${summaryText}`);
        }
        const reasonText = isEn
          ? item.importanceReasonEn || item.importanceReason
          : item.importanceReason || item.importanceReasonEn;
        if (reasonText) {
          fallbackParts.push(`Importance Reason: ${reasonText}`);
        }

        if (fallbackParts.length > 0) {
          articleContent = fallbackParts.join("\n\n");
          console.log(
            `[Summarize Fallback] Scraper failed for URL: ${item.url}. Using database fields as fallback.`,
          );
        }
      }

      if (!articleContent) {
        const keyboard = new InlineKeyboard().text(
          isEn ? "🔙 Back" : "🔙 Quay lại",
          `detail_${newsId}`,
        );
        const errMsg = isEn
          ? `<b>ARTICLE SUMMARY</b>\n────────────────\nCould not fetch original article content.\nPlease read directly at: <a href="${item.url}">original link</a>`
          : `<b>TÓM TẮT BÀI VIẾT</b>\n────────────────\nKhông thể truy cập nội dung bài viết từ nguồn gốc.\nVui lòng đọc trực tiếp tại: <a href="${item.url}">link gốc</a>`;
        await ctx
          .editMessageText(errMsg, {
            parse_mode: "HTML",
            reply_markup: keyboard,
            link_preview_options: { is_disabled: true },
          })
          .catch(() => {});
        return;
      }

      const result = await AIService.summarizeFullArticle(articleContent, lang);

      const summaryPointsText = result.summaryPoints.map((p) => `* ${escapeHtml(p)}`).join("\n");
      const actionsText = result.actions.map((a) => `* ${escapeHtml(a)}`).join("\n");

      const uncertaintySection =
        result.uncertainty && result.uncertainty !== "Không có" && result.uncertainty !== "None"
          ? `\n<b>${isEn ? "Needs verification" : "Cần kiểm chứng"}:</b>\n${escapeHtml(result.uncertainty)}\n`
          : "";

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

      summaryCache.set(cacheKey, { text: summaryText, keyboard, timestamp: Date.now() });

      await ctx
        .editMessageText(summaryText, {
          parse_mode: "HTML",
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        })
        .catch(() => {});
    } catch (error) {
      console.error("Lỗi khi tóm tắt bài viết:", error);
      const keyboard = new InlineKeyboard().text(labels.detailBtn, `detail_${newsId}`);
      await ctx
        .editMessageText(
          isEn
            ? "<b>An error occurred while summarizing the article using AI.</b>\nPlease try again later."
            : "<b>Đã xảy ra lỗi khi tóm tắt bài viết bằng AI.</b>\nVui lòng thử lại sau.",
          { parse_mode: "HTML", reply_markup: keyboard },
        )
        .catch(() => {});
    } finally {
      activeSummaries.delete(cacheKey);
    }
  });

  // Quay lại danh sách
  bot.callbackQuery("back_to_list", async (ctx) => {
    try {
      const { categories, lang } = await getSubscriberPrefs(ctx.chat?.id);
      const { items: latestNews, hasMore } = await getNewsForUser(
        newsService,
        LIMIT,
        0,
        categories,
      );

      await ctx.editMessageText(formatNewsList(latestNews, ctx.me.username, 1, categories, lang), {
        parse_mode: "HTML",
        reply_markup: buildPaginationKeyboard(1, hasMore, lang),
      });
      await ctx.answerCallbackQuery().catch(() => {});
    } catch (error) {
      console.error("Lỗi khi quay lại danh sách tin tức:", error);
      await ctx
        .answerCallbackQuery({ text: "Đã xảy ra lỗi khi quay lại danh sách." })
        .catch(() => {});
    }
  });
}
