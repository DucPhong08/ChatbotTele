import { type Bot, type Context } from "grammy";
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
const MAX_ARTICLES_PER_USER = 10;

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
      const preferredCategories = getPreferredCategories(sub);

      const message = formatArticlesBatch(userArticles, botUsername, preferredCategories, lang);

      await bot.api.sendMessage(sub.chatId, message, {
        parse_mode: "HTML",
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

  if (preferred.includes("all")) {
    return topArticles.slice(0, MAX_ARTICLES_PER_USER);
  }

  const lowerPreferred = preferred.map((p) => p.toLowerCase());
  const mergedArticles: NewsView[] = [];
  const seenIds = new Set<string>();
  const LIMIT_PER_CATEGORY = 10;

  for (const cat of lowerPreferred) {
    const catArticles = allArticles
      .filter((article) => article.category && article.category.toLowerCase() === cat)
      .sort((a, b) => {
        const scoreA = Number.isInteger(a.importanceScore) ? a.importanceScore! : 50;
        const scoreB = Number.isInteger(b.importanceScore) ? b.importanceScore! : 50;
        return scoreB - scoreA;
      })
      .slice(0, LIMIT_PER_CATEGORY);

    for (const art of catArticles) {
      const artId = art._id?.toString();
      if (artId && !seenIds.has(artId)) {
        seenIds.add(artId);
        mergedArticles.push(art);
      }
    }
  }

  // Nếu chưa đủ số lượng, bổ sung từ topArticles (đã đạt chuẩn điểm)
  if (mergedArticles.length < MAX_ARTICLES_PER_USER) {
    for (const art of topArticles) {
      const artId = art._id?.toString();
      if (artId && !seenIds.has(artId)) {
        seenIds.add(artId);
        mergedArticles.push(art);
        if (mergedArticles.length >= MAX_ARTICLES_PER_USER) {
          break;
        }
      }
    }
  }

  if (mergedArticles.length === 0) {
    return [];
  }

  // Sắp xếp bài viết: Ưu tiên thể loại yêu thích của user trước, sau đó là điểm importanceScore
  let userArticles = mergedArticles.sort((a, b) => {
    const aIsPreferred = a.category && lowerPreferred.includes(a.category.toLowerCase()) ? 1 : 0;
    const bIsPreferred = b.category && lowerPreferred.includes(b.category.toLowerCase()) ? 1 : 0;
    if (aIsPreferred !== bIsPreferred) {
      return bIsPreferred - aIsPreferred; // Preferred đầu tiên
    }

    const scoreA = Number.isInteger(a.importanceScore) ? a.importanceScore! : 50;
    const scoreB = Number.isInteger(b.importanceScore) ? b.importanceScore! : 50;
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    const commentsA = Number.isInteger(a.commentCount) ? a.commentCount! : 0;
    const commentsB = Number.isInteger(b.commentCount) ? b.commentCount! : 0;
    if (commentsA !== commentsB) {
      return commentsB - commentsA;
    }

    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  if (sub.customPrompt) {
    userArticles = await AIService.filterArticlesByPrompt(userArticles, sub.customPrompt);
  }

  return userArticles;
}
