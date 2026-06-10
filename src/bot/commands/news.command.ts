import { type Bot, type Context } from "grammy";
import { formatNewsList } from "../../news/news.formatter";
import { NewsService } from "../../news/news.service";

export function registerNewsCommand(
  bot: Bot<Context>,
  newsService: NewsService,
): void {
  bot.command("news", async (ctx) => {
    const latestNews = await newsService.getLatest(10);

    await ctx.reply(formatNewsList(latestNews), {
      parse_mode: "HTML",
    });
  });
}
