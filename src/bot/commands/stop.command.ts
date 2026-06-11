import { type Bot, type Context } from "grammy";
import { SubscriberModel } from "../subscriber.model";

export function registerStopCommand(bot: Bot<Context>): void {
  bot.command("stop", async (ctx) => {
    const chatId = ctx.chat.id;

    try {
      const result = await SubscriberModel.deleteOne({ chatId });

      if (result.deletedCount > 0) {
        await ctx.reply("Bạn đã hủy nhận tin tự động thành công. Dùng /start để đăng ký lại khi cần.");
        return;
      }

      await ctx.reply("Bạn chưa đăng ký nhận tin tự động. Dùng /start để đăng ký.");
    } catch (error) {
      console.error("Lỗi khi hủy đăng ký người dùng:", error);
      await ctx.reply("Đã xảy ra lỗi khi hủy nhận tin. Vui lòng thử lại sau!");
    }
  });
}
