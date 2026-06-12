import { type Bot, type Context, InlineKeyboard } from "grammy";
import { SubscriberModel } from "./subscriber.model";
import { SentLogModel } from "./sent-log.model";
import { formatArticlesBatch } from "../news/news.formatter";
import { AIService } from "../ai/ai.service";
import { type NewsView } from "../types/news";
import { type Subscriber } from "../types/subscriber";

/**
 * Telegram Bot API thường có giới hạn global khoảng 30 msg/s.
 * 40ms tương đương khoảng 25 msg/s, nhưng thực tế vẫn nên giữ thấp hơn nếu bot nhiều user.
 */
const BROADCAST_DELAY_MS = 40;
const MAX_ARTICLES_PER_USER = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BroadcastResult {
  sent: number;
  failed: number;
  skipped: number;
  deactivated: number;
}

export async function broadcastToSubscribers(
  bot: Bot<Context>,
  articles: NewsView[],
  topArticles: NewsView[],
  botUsername: string,
  subscriberFilter: Record<string, unknown> = { isActiveAI: { $ne: false } },
): Promise<BroadcastResult> {
  const subscribers = await SubscriberModel.find(subscriberFilter).lean<Subscriber[]>().exec();

  const result: BroadcastResult = {
    sent: 0,
    failed: 0,
    skipped: 0,
    deactivated: 0,
  };

  if (subscribers.length === 0) {
    return result;
  }

  // Truy vấn gộp toàn bộ lịch sử gửi tin 1 lần thay vì N lần (N+1 query fix)
  const allArticleIds = articles.filter((a) => Boolean(a._id)).map((a) => a._id);
  const allChatIds = subscribers.map((s) => s.chatId);

  const sentLogs = await SentLogModel.find({
    chatId: { $in: allChatIds },
    articleId: { $in: allArticleIds },
  })
    .select("chatId articleId")
    .lean<Array<{ chatId: number | string; articleId: unknown }>>()
    .exec();

  const sentSet = new Set(sentLogs.map((log) => `${log.chatId}_${log.articleId}`));

  console.log(
    `[Broadcaster] Đang gửi tin tới ${subscribers.length} subscriber ` +
      `(delay ${BROADCAST_DELAY_MS}ms/tin)...`,
  );

  for (const sub of subscribers) {
    try {
      const userArticles = await getUnsentArticlesForUser(sub, articles, topArticles, sentSet);

      if (userArticles.length === 0) {
        result.skipped++;
        continue;
      }

      const lang = sub.language === "en" ? "en" : "vi";
      const preferred = getPreferredCategories(sub);

      const message = formatArticlesBatch(userArticles, botUsername, preferred, lang);

      const replyMarkup = buildBroadcastKeyboard(userArticles, lang);

      await bot.api.sendMessage(sub.chatId, message, {
        parse_mode: "HTML",
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        link_preview_options: { is_disabled: true },
      });

      await insertSentLogs(sub.chatId, userArticles);

      result.sent++;
      await sleep(BROADCAST_DELAY_MS);
    } catch (err: unknown) {
      if (isTelegramBlockedError(err)) {
        console.log(`[Broadcaster] Subscriber ${sub.chatId} đã chặn bot → isActiveAI=false`);

        await SubscriberModel.updateOne(
          { chatId: sub.chatId },
          {
            $set: {
              isActiveAI: false,
              deactivatedAt: new Date(),
            },
          },
        );

        result.deactivated++;
        continue;
      }

      console.error(
        `[Broadcaster] Lỗi gửi tin tới ${sub.chatId}:`,
        err instanceof Error ? err.message : err,
      );

      result.failed++;
    }
  }

  console.log(
    `[Broadcaster] Hoàn tất: ${result.sent} gửi, ${result.skipped} bỏ qua, ` +
      `${result.failed} lỗi, ${result.deactivated} đã vô hiệu hóa`,
  );

  return result;
}

async function getUnsentArticlesForUser(
  sub: Subscriber,
  allArticles: NewsView[],
  topArticles: NewsView[],
  sentSet: Set<string>,
): Promise<NewsView[]> {
  let userArticles = await filterArticlesForUser(sub, allArticles, topArticles);

  userArticles = userArticles.filter((article) => Boolean(article._id));

  if (userArticles.length === 0) {
    return [];
  }

  return userArticles
    .filter((article) => !sentSet.has(`${sub.chatId}_${article._id}`))
    .slice(0, MAX_ARTICLES_PER_USER);
}

function getPreferredCategories(sub: Subscriber): string[] {
  if (sub.preferredCategories && sub.preferredCategories.length > 0) {
    return sub.preferredCategories;
  }

  return ["all"];
}

function buildBroadcastKeyboard(
  userArticles: NewsView[],
  lang: "vi" | "en",
): InlineKeyboard | undefined {
  if (userArticles.length < MAX_ARTICLES_PER_USER) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();
  const nextLabel = lang === "en" ? "▶️ Next" : "▶️ Sau";

  keyboard.text(nextLabel, "news_page:2");

  return keyboard;
}

async function insertSentLogs(chatId: number | string, articles: NewsView[]): Promise<void> {
  const logsToInsert = articles
    .filter((article) => Boolean(article._id))
    .map((article) => ({
      chatId,
      articleId: article._id,
      sentAt: new Date(),
    }));

  if (logsToInsert.length === 0) {
    return;
  }

  try {
    await SentLogModel.insertMany(logsToInsert, { ordered: false });
  } catch (err: any) {
    /**
     * Duplicate key: bỏ qua được nếu user đã từng nhận bài.
     * Lỗi khác thì cần log, không nên nuốt sạch.
     */
    if (err?.code === 11000) {
      return;
    }

    console.error(`[Broadcaster] Lỗi khi lưu sent logs:`, err?.message || err);
  }
}

function isTelegramBlockedError(err: unknown): boolean {
  const error = err as {
    code?: number;
    error_code?: number;
    description?: string;
    message?: string;
  };

  const description = `${error?.description || ""} ${error?.message || ""}`.toLowerCase();

  return (
    error?.code === 403 ||
    error?.error_code === 403 ||
    description.includes("blocked") ||
    description.includes("chat not found") ||
    description.includes("bot was blocked")
  );
}

/**
 * Lọc bài viết phù hợp với sở thích của từng subscriber.
 */
async function filterArticlesForUser(
  sub: Subscriber,
  allArticles: NewsView[],
  topArticles: NewsView[],
): Promise<NewsView[]> {
  const preferred = getPreferredCategories(sub);

  let userArticles = topArticles;

  if (!preferred.includes("all")) {
    const lowerPreferred = preferred.map((p) => p.toLowerCase());

    const filtered = allArticles.filter(
      (article) => article.category && lowerPreferred.includes(article.category.toLowerCase()),
    );

    if (filtered.length === 0) {
      return [];
    }

    userArticles = [...filtered]
      .sort((a, b) => {
        const scoreA = Number.isInteger(a.importanceScore) ? a.importanceScore! : 50;
        const scoreB = Number.isInteger(b.importanceScore) ? b.importanceScore! : 50;

        return scoreB - scoreA;
      })
      .slice(0, MAX_ARTICLES_PER_USER);
  }

  /**
   * Cảnh báo:
   * Chỗ này có thể tốn quota nếu nhiều user có customPrompt.
   * MVP giữ được, nhưng sau nên cache theo customPrompt + articleIds.
   */
  if (sub.customPrompt && !preferred.includes("all")) {
    return AIService.filterArticlesByPrompt(userArticles, sub.customPrompt);
  }

  return userArticles;
}
