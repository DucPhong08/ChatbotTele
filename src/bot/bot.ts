import { Bot } from "grammy";
import { env } from "../config/env";
import { NewsService } from "../news/news.service";
import { NewsCollector } from "../news/news.collector";
import { registerNewsCommand } from "./commands/news.command";
import { registerPingCommand } from "./commands/ping.command";
import { registerStartCommand } from "./commands/start.command";
import { registerStatsCommand } from "./commands/stats.command";
import { registerStopCommand } from "./commands/stop.command";
import { registerSyncCommand } from "./commands/sync.command";
import { handleBotError } from "./middlewares/error.middleware";

export function createBot(
  newsService: NewsService,
  newsCollector: NewsCollector,
): Bot {
  const bot = new Bot(env.botToken);

  registerStartCommand(bot, newsService);
  registerStopCommand(bot);
  registerNewsCommand(bot, newsService);
  registerSyncCommand(bot, newsCollector);
  registerPingCommand(bot);
  registerStatsCommand(bot);
  bot.catch(handleBotError);

  return bot;
}

