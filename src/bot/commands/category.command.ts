import { type Bot, type Context, InlineKeyboard } from "grammy";
import { SubscriberModel } from "../subscriber.model";
import { AIService } from "../../ai/ai.service";

const CATEGORY_MAP_EN: Record<string, string> = {
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

const CATEGORY_MAP_VI: Record<string, string> = {
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

function buildKeyboard(preferred: string[], lang: "vi" | "en" = "vi"): InlineKeyboard {
  const isAll = preferred.includes("all");
  const isEn = lang === "en";
  const map = isEn ? CATEGORY_MAP_EN : CATEGORY_MAP_VI;

  const label = (key: string, name: string) => {
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

export function registerCategoryCommand(bot: Bot<Context>): void {
  const handler = async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const prompt = String(ctx.match || "").trim();

    try {
      let subscriber = await SubscriberModel.findOne({ chatId });
      if (!subscriber) {
        subscriber = await SubscriberModel.create({ chatId, preferredCategories: ["all"] });
      }

      const lang = subscriber.language || "vi";
      const isEn = lang === "en";
      const map = isEn ? CATEGORY_MAP_EN : CATEGORY_MAP_VI;

      if (prompt) {
        // 1. Lưu trực tiếp văn bản yêu cầu gốc vào DB trước
        await SubscriberModel.updateOne(
          { chatId },
          { $set: { customPrompt: prompt } },
          { upsert: true },
        );

        // 2. Phân tích thể loại
        let matchedCats: string[] = [];
        try {
          matchedCats = await AIService.parsePreferredCategories(prompt);
        } catch (error) {
          console.warn("AI phân tích thể loại thất bại, sử dụng fallback:", error);
          matchedCats = AIService.parsePreferencesFallback(prompt);
        }

        // 3. Cập nhật danh mục tương ứng vào DB
        await SubscriberModel.updateOne(
          { chatId },
          { $set: { preferredCategories: matchedCats } },
          { upsert: true },
        );

        const names = matchedCats.map((c) => map[c] || c).join(", ");
        const responseText = isEn
          ? [
              "<b>CATEGORY PREFERENCE UPDATED!</b>",
              "────────────────",
              `• <b>Your request:</b> <i>"${prompt}"</i>`,
              `• <b>Matching categories:</b> <b>${names}</b>`,
              "",
              "The bot will filter and customize your news feed accordingly.",
            ].join("\n")
          : [
              "<b>CẬP NHẬT SỞ THÍCH THÀNH CÔNG!</b>",
              "────────────────",
              `• <b>Yêu cầu của bạn:</b> <i>"${prompt}"</i>`,
              `• <b>Thể loại phù hợp:</b> <b>${names}</b>`,
              "",
              "Bot sẽ gửi và lọc tin tức theo yêu cầu ngữ nghĩa của bạn.",
            ].join("\n");

        await ctx.reply(responseText, { parse_mode: "HTML" });
        return;
      }

      // Xử lý bằng bàn phím Toggle
      const currentPref = subscriber.preferredCategories || ["all"];
      const currentPrefNames = currentPref.map((c) => map[c] || c).join(", ");

      const promptSection = subscriber.customPrompt
        ? isEn
          ? `• Written preference: <i>"${subscriber.customPrompt}"</i>\n`
          : `• Yêu cầu bằng văn bản: <i>"${subscriber.customPrompt}"</i>\n`
        : "";

      const message = isEn
        ? [
            "<b>CHOOSE NEWS CATEGORIES TO PRIORITIZE</b>",
            "────────────────",
            `• Current active categories: <b>${currentPrefNames}</b>`,
            promptSection,
            "Click the buttons below to toggle preferred categories. Click <b>All</b> to receive everything.",
            "",
            "💡 <i>Tip: You can type your interest directly, e.g. <code>/category show me AI and security</code></i>",
          ]
            .filter((line) => line !== null)
            .join("\n")
        : [
            "<b>CHỌN THỂ LOẠI TIN TỨC BẠN MUỐN XUẤT HIỆN NHẤT</b>",
            "────────────────",
            `• Thể loại ưu tiên hiện tại: <b>${currentPrefNames}</b>`,
            promptSection,
            "Bấm vào các nút dưới đây để bật/tắt (Toggle) các thể loại tin tức bạn muốn nhận. Bấm <b>Tất cả</b> để nhận toàn bộ tin tức.",
            "",
            "💡 <i>Mẹo: Bạn có thể nhập text tự do bằng tiếng Việt để AI cấu hình tự động, ví dụ: <code>/theloai tôi thích AI và bảo mật</code></i>",
          ]
            .filter((line) => line !== null)
            .join("\n");

      await ctx.reply(message, {
        parse_mode: "HTML",
        reply_markup: buildKeyboard(currentPref, lang),
      });
    } catch (error) {
      console.error("Lỗi khi xử lý lệnh thể loại:", error);
      await ctx.reply(
        ctx.chat &&
          (await SubscriberModel.findOne({ chatId: ctx.chat.id }).lean())?.language === "en"
          ? "An error occurred. Please try again later!"
          : "Đã xảy ra lỗi. Vui lòng thử lại sau!",
      );
    }
  };

  bot.command("category", handler);
  bot.command("theloai", handler);

  // Callback query listener for category toggling
  bot.callbackQuery(/toggle_pref_(.+)/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const category = ctx.match[1];

    try {
      const subscriber = await SubscriberModel.findOne({ chatId });
      const lang = subscriber?.language || "vi";
      const isEn = lang === "en";
      const map = isEn ? CATEGORY_MAP_EN : CATEGORY_MAP_VI;

      if (category !== "all" && !map[category]) {
        await ctx.answerCallbackQuery({
          text: isEn ? "Invalid category." : "Thể loại không hợp lệ.",
        });
        return;
      }

      let currentPref = subscriber?.preferredCategories || ["all"];

      if (category === "all") {
        currentPref = ["all"];
      } else {
        // Xóa "all" nếu đang có
        currentPref = currentPref.filter((c) => c !== "all");

        if (currentPref.includes(category)) {
          // Toggle off: xóa category
          currentPref = currentPref.filter((c) => c !== category);
        } else {
          // Toggle on: thêm category
          currentPref.push(category);
        }

        // Nếu mảng rỗng thì mặc định về "all"
        if (currentPref.length === 0) {
          currentPref = ["all"];
        }
      }

      await SubscriberModel.updateOne(
        { chatId },
        {
          $set: { preferredCategories: currentPref },
          $unset: { customPrompt: "" },
        },
        { upsert: true },
      );

      const prefNames = currentPref.map((c) => map[c] || c).join(", ");

      const updatedMessage = isEn
        ? [
            "<b>CHOOSE NEWS CATEGORIES TO PRIORITIZE</b>",
            "────────────────",
            `Current active categories: <b>${prefNames}</b>`,
            "",
            "Click the buttons below to toggle preferred categories. Click <b>All</b> to receive everything.",
            "",
            "💡 <i>Tip: You can type your interest directly, e.g. <code>/category show me AI and security</code></i>",
          ].join("\n")
        : [
            "<b>CHỌN THỂ LOẠI TIN TỨC BẠN MUỐN XUẤT HIỆN NHẤT</b>",
            "────────────────",
            `Thể loại ưu tiên hiện tại: <b>${prefNames}</b>`,
            "",
            "Bấm vào các nút dưới đây để bật/tắt (Toggle) các thể loại tin tức bạn muốn nhận. Bấm <b>Tất cả</b> để nhận toàn bộ tin tức.",
            "",
            "💡 <i>Mẹo: Bạn có thể nhập text tự do bằng tiếng Việt để AI cấu hình tự động, ví dụ: <code>/theloai tôi thích AI và bảo mật</code></i>",
          ].join("\n");

      await ctx.editMessageText(updatedMessage, {
        parse_mode: "HTML",
        reply_markup: buildKeyboard(currentPref, lang),
      });

      const matchedName = map[category];
      const answerText = isEn ? `Toggled: ${matchedName}` : `Đã thay đổi: ${matchedName}`;
      await ctx.answerCallbackQuery({ text: answerText });
    } catch (error) {
      console.error("Lỗi khi lưu tùy chọn thể loại:", error);
      const subscriber = await SubscriberModel.findOne({ chatId });
      const lang = subscriber?.language || "vi";
      await ctx.answerCallbackQuery({
        text: lang === "en" ? "System error saving preference." : "Lỗi hệ thống khi lưu tùy chọn.",
      });
    }
  });
}
