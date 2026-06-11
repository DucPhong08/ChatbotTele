import { type Bot, type Context } from "grammy";
import { SubscriberModel } from "../subscriber.model";

export function registerStopCommand(bot: Bot<Context>): void {
  bot.command("stop", async (ctx) => {
    const chatId = ctx.chat.id;

    let lang = "vi";
    try {
      const sub = await SubscriberModel.findOne({ chatId }).lean();
      if (sub?.language) {
        lang = sub.language;
      }
    } catch (err) {
      // Ignore database check error
    }
    const isEn = lang === "en";

    try {
      const result = await SubscriberModel.deleteOne({ chatId });

      if (result.deletedCount > 0) {
        await ctx.reply(
          isEn
            ? "You have successfully unsubscribed from automated news. Use /start to subscribe again."
            : "Bạn đã hủy nhận tin tự động thành công. Dùng /start để đăng ký lại khi cần.",
        );
        return;
      }

      await ctx.reply(
        isEn
          ? "You are not currently subscribed. Use /start to subscribe."
          : "Bạn chưa đăng ký nhận tin tự động. Dùng /start để đăng ký.",
      );
    } catch (error) {
      console.error("Lỗi khi hủy đăng ký người dùng:", error);
      await ctx.reply(
        isEn
          ? "An error occurred while unsubscribing. Please try again later!"
          : "Đã xảy ra lỗi khi hủy nhận tin. Vui lòng thử lại sau!",
      );
    }
  });
}
