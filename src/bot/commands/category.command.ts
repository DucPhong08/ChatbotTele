import { type Bot, type Context, InlineKeyboard } from "grammy";
import { SubscriberModel } from "../subscriber.model";
import { AIService } from "../../ai/ai.service";

const CATEGORY_KEYS = [
  "all",
  "ai",
  "backend",
  "frontend",
  "devops",
  "security",
  "mobile",
  "career",
  "other",
] as const;

type CategoryKey = (typeof CATEGORY_KEYS)[number];
type Language = "vi" | "en";

const MAX_CUSTOM_PROMPT_LENGTH = 300;

const CATEGORY_MAP_EN: Record<CategoryKey, string> = {
  all: "All",
  ai: "🤖 AI",
  backend: "💻 Backend",
  frontend: "🎨 Frontend",
  devops: "⚙️ DevOps",
  security: "🛡️ Security",
  mobile: "📱 Mobile",
  career: "💼 Career",
  other: "🌐 Other",
};

const CATEGORY_MAP_VI: Record<CategoryKey, string> = {
  all: "Tất cả",
  ai: "🤖 AI",
  backend: "💻 Backend",
  frontend: "🎨 Frontend",
  devops: "⚙️ DevOps",
  security: "🛡️ Security",
  mobile: "📱 Mobile",
  career: "💼 Career",
  other: "🌐 Khác",
};

function escapeHtml(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getCategoryMap(lang: Language): Record<CategoryKey, string> {
  return lang === "en" ? CATEGORY_MAP_EN : CATEGORY_MAP_VI;
}

function isCategoryKey(value: string): value is CategoryKey {
  return CATEGORY_KEYS.includes(value as CategoryKey);
}

function normalizeCategories(values: unknown): CategoryKey[] {
  if (!Array.isArray(values)) {
    return ["all"];
  }

  const normalized = values
    .map((value) => String(value).trim().toLowerCase())
    .filter(isCategoryKey);

  if (normalized.length === 0 || normalized.includes("all")) {
    return ["all"];
  }

  return Array.from(new Set(normalized));
}

function getLanguage(value: unknown): Language {
  return value === "en" ? "en" : "vi";
}

function getChatId(ctx: Context): number | undefined {
  return ctx.chat?.id ?? ctx.from?.id;
}

async function getOrCreateSubscriber(chatId: number) {
  let subscriber = await SubscriberModel.findOne({ chatId });

  if (!subscriber) {
    subscriber = await SubscriberModel.create({
      chatId,
      preferredCategories: ["all"],
      language: "vi",
    });
  }

  return subscriber;
}

function formatCategoryNames(categories: CategoryKey[], lang: Language): string {
  const map = getCategoryMap(lang);
  return categories.map((category) => map[category] || category).join(", ");
}

function buildKeyboard(preferred: CategoryKey[], lang: Language = "vi"): InlineKeyboard {
  const isAll = preferred.includes("all");
  const isEn = lang === "en";
  const map = getCategoryMap(lang);

  const label = (key: CategoryKey, name: string) => {
    return preferred.includes(key) && !isAll ? `✅ ${name}` : name;
  };

  return new InlineKeyboard()
    .text(label("ai", map.ai), "toggle_pref_ai")
    .text(label("backend", map.backend), "toggle_pref_backend")
    .row()
    .text(label("frontend", map.frontend), "toggle_pref_frontend")
    .text(label("devops", map.devops), "toggle_pref_devops")
    .row()
    .text(label("security", map.security), "toggle_pref_security")
    .text(label("mobile", map.mobile), "toggle_pref_mobile")
    .row()
    .text(label("career", map.career), "toggle_pref_career")
    .text(label("other", map.other), "toggle_pref_other")
    .row()
    .text(
      isAll ? (isEn ? "✅ ✨ All" : "✅ ✨ Tất cả") : isEn ? "✨ All" : "✨ Tất cả",
      "toggle_pref_all",
    );
}

function buildCategoryMessage(
  preferred: CategoryKey[],
  lang: Language,
  customPrompt?: string,
): string {
  const isEn = lang === "en";
  const currentPrefNames = escapeHtml(formatCategoryNames(preferred, lang));

  const promptSection = customPrompt
    ? isEn
      ? `• Written preference: <i>"${escapeHtml(customPrompt)}"</i>\n`
      : `• Yêu cầu bằng văn bản: <i>"${escapeHtml(customPrompt)}"</i>\n`
    : "";

  return isEn
    ? [
        "<b>CHOOSE NEWS CATEGORIES TO PRIORITIZE</b>",
        "────────────────",
        `• Current active categories: <b>${currentPrefNames}</b>`,
        promptSection,
        "Click the buttons below to toggle preferred categories. Click <b>All</b> to receive everything.",
        "",
        "💡 <i>Tip: You can type your interest directly, e.g. <code>/category show me AI and security</code></i>",
      ].join("\n")
    : [
        "<b>CHỌN THỂ LOẠI TIN TỨC BẠN MUỐN XUẤT HIỆN NHẤT</b>",
        "────────────────",
        `• Thể loại ưu tiên hiện tại: <b>${currentPrefNames}</b>`,
        promptSection,
        "Bấm vào các nút dưới đây để bật/tắt các thể loại tin tức bạn muốn nhận. Bấm <b>Tất cả</b> để nhận toàn bộ tin tức.",
        "",
        "💡 <i>Mẹo: Bạn có thể nhập text tự do, ví dụ: <code>/theloai tôi thích AI và bảo mật</code></i>",
      ].join("\n");
}

function toggleCategory(current: CategoryKey[], category: CategoryKey): CategoryKey[] {
  if (category === "all") {
    return ["all"];
  }

  let next = current.filter((item) => item !== "all");

  if (next.includes(category)) {
    next = next.filter((item) => item !== category);
  } else {
    next.push(category);
  }

  return next.length > 0 ? next : ["all"];
}

export function registerCategoryCommand(bot: Bot<Context>): void {
  const handler = async (ctx: Context) => {
    const chatId = getChatId(ctx);

    if (!chatId) {
      return;
    }

    const rawPrompt = String(ctx.match || "").trim();
    const prompt = rawPrompt.slice(0, MAX_CUSTOM_PROMPT_LENGTH);

    try {
      const subscriber = await getOrCreateSubscriber(chatId);
      const lang = getLanguage(subscriber.language);

      if (prompt) {
        let matchedCats: CategoryKey[] = ["all"];

        try {
          const aiCategories = await AIService.parsePreferredCategories(prompt);
          matchedCats = normalizeCategories(aiCategories);
        } catch (error) {
          console.warn("[CategoryCommand] AI phân tích thể loại thất bại, dùng fallback:", error);

          const fallbackCategories = AIService.parsePreferencesFallback(prompt);
          matchedCats = normalizeCategories(fallbackCategories);
        }

        await SubscriberModel.updateOne(
          { chatId },
          {
            $set: {
              customPrompt: prompt,
              preferredCategories: matchedCats,
            },
          },
          { upsert: true },
        );

        const names = escapeHtml(formatCategoryNames(matchedCats, lang));

        const responseText =
          lang === "en"
            ? [
                "<b>CATEGORY PREFERENCE UPDATED!</b>",
                "────────────────",
                `• <b>Your request:</b> <i>"${escapeHtml(prompt)}"</i>`,
                `• <b>Matching categories:</b> <b>${names}</b>`,
                "",
                "The bot will filter and customize your news feed accordingly.",
              ].join("\n")
            : [
                "<b>CẬP NHẬT SỞ THÍCH THÀNH CÔNG!</b>",
                "────────────────",
                `• <b>Yêu cầu của bạn:</b> <i>"${escapeHtml(prompt)}"</i>`,
                `• <b>Thể loại phù hợp:</b> <b>${names}</b>`,
                "",
                "Bot sẽ gửi và lọc tin tức theo yêu cầu ngữ nghĩa của bạn.",
              ].join("\n");

        await ctx.reply(responseText, { parse_mode: "HTML" });
        return;
      }

      const currentPref = normalizeCategories(subscriber.preferredCategories);
      const message = buildCategoryMessage(currentPref, lang, subscriber.customPrompt);

      await ctx.reply(message, {
        parse_mode: "HTML",
        reply_markup: buildKeyboard(currentPref, lang),
      });
    } catch (error) {
      console.error("[CategoryCommand] Lỗi khi xử lý lệnh thể loại:", error);

      await ctx.reply("Đã xảy ra lỗi. Vui lòng thử lại sau.");
    }
  };

  bot.command("category", handler);
  bot.command("theloai", handler);

  bot.callbackQuery(/toggle_pref_(.+)/, async (ctx) => {
    const chatId = getChatId(ctx);

    if (!chatId) {
      return;
    }

    const rawCategory = String(ctx.match[1] || "")
      .trim()
      .toLowerCase();

    try {
      const subscriber = await getOrCreateSubscriber(chatId);
      const lang = getLanguage(subscriber.language);
      const map = getCategoryMap(lang);

      if (!isCategoryKey(rawCategory)) {
        await ctx.answerCallbackQuery({
          text: lang === "en" ? "Invalid category." : "Thể loại không hợp lệ.",
        });
        return;
      }

      const category = rawCategory;
      const currentPref = normalizeCategories(subscriber.preferredCategories);
      const nextPref = toggleCategory(currentPref, category);

      const currentKey = currentPref.join(",");
      const nextKey = nextPref.join(",");

      if (currentKey === nextKey) {
        await ctx.answerCallbackQuery({
          text: lang === "en" ? "No change." : "Không có thay đổi.",
        });
        return;
      }

      await SubscriberModel.updateOne(
        { chatId },
        {
          $set: {
            preferredCategories: nextPref,
          },
          $unset: {
            customPrompt: "",
          },
        },
        { upsert: true },
      );

      const updatedMessage = buildCategoryMessage(nextPref, lang);

      await ctx.editMessageText(updatedMessage, {
        parse_mode: "HTML",
        reply_markup: buildKeyboard(nextPref, lang),
      });

      const matchedName = map[category];

      await ctx.answerCallbackQuery({
        text: lang === "en" ? `Toggled: ${matchedName}` : `Đã thay đổi: ${matchedName}`,
      });
    } catch (error) {
      console.error("[CategoryCommand] Lỗi khi lưu tùy chọn thể loại:", error);

      await ctx.answerCallbackQuery({
        text: "Lỗi hệ thống khi lưu tùy chọn.",
      });
    }
  });
}
