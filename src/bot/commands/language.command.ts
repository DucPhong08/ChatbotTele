import { type Bot, InlineKeyboard } from "grammy";
import { SubscriberModel } from "../subscriber.model";

export function registerLanguageCommand(bot: Bot) {
  // Command handler
  const handler = async (ctx: any) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    let sub = await SubscriberModel.findOne({ chatId });
    if (!sub) {
      sub = await SubscriberModel.create({ chatId, language: "vi" });
    }

    const currentLang = sub.language || "vi";
    const currentLangText = currentLang === "en" ? "🇺🇸 English" : "🇻🇳 Tiếng Việt";

    const message = [
      `🌐 <b>CHOOSE YOUR LANGUAGE / CHỌN NGÔN NGỮ</b>`,
      `────────────────`,
      `Preferred language / Ngôn ngữ lựa chọn:`,
      `🇺🇸 English | 🇻🇳 Tiếng Việt`,
      ``,
      `Current / Hiện tại: <b>${currentLangText}</b>`,
    ].join("\n");

    const keyboard = new InlineKeyboard()
      .text("🇻🇳 Tiếng Việt", "set_lang_vi")
      .text("🇺🇸 English", "set_lang_en");

    await ctx.reply(message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  };

  bot.command(["language", "lang", "ngonngu"], handler);

  // Callback query set to Vietnamese
  bot.callbackQuery("set_lang_vi", async (ctx) => {
    const chatId = ctx.from?.id;
    if (!chatId) return;

    await SubscriberModel.updateOne({ chatId }, { $set: { language: "vi" } }, { upsert: true });

    const message = [
      `🌐 <b>CHỌN NGÔN NGỮ</b>`,
      `────────────────`,
      `Cài đặt ngôn ngữ: <b>🇻🇳 Tiếng Việt</b> thành công!`,
      ``,
      `Từ bây giờ các tin tức và bản tin tự động sẽ được gửi bằng Tiếng Việt.`,
    ].join("\n");

    try {
      await ctx.editMessageText(message, { parse_mode: "HTML" });
    } catch (err) {
      // Message might be identical, ignore edit errors
    }
    await ctx.answerCallbackQuery({ text: "Đã đổi sang Tiếng Việt" });
  });

  // Callback query set to English
  bot.callbackQuery("set_lang_en", async (ctx) => {
    const chatId = ctx.from?.id;
    if (!chatId) return;

    await SubscriberModel.updateOne({ chatId }, { $set: { language: "en" } }, { upsert: true });

    const message = [
      `🌐 <b>CHOOSE YOUR LANGUAGE</b>`,
      `────────────────`,
      `Language preference set to: <b>🇺🇸 English</b> successfully!`,
      ``,
      `From now on, all news items and automated pushes will be delivered in English.`,
    ].join("\n");

    try {
      await ctx.editMessageText(message, { parse_mode: "HTML" });
    } catch (err) {
      // Message might be identical, ignore edit errors
    }
    await ctx.answerCallbackQuery({ text: "Switched to English" });
  });
}
