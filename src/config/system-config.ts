import { Schema, model } from "mongoose";

export interface ISystemConfig {
  feedSource: string;
  newsCron: string;
}

const systemConfigSchema = new Schema<ISystemConfig>(
  {
    feedSource: { type: String, default: "dev", trim: true },
    newsCron: { type: String, default: "*/30 * * * *", trim: true },
  },
  {
    timestamps: true,
  },
);

export const SystemConfigModel = model<ISystemConfig>("SystemConfig", systemConfigSchema);

const cachedConfig: ISystemConfig = {
  feedSource: "dev",
  newsCron: "*/30 * * * *",
};

export async function loadSystemConfig(): Promise<void> {
  try {
    let doc = await SystemConfigModel.findOne().exec();
    if (!doc) {
      doc = await SystemConfigModel.create({
        feedSource: "dev",
        newsCron: "*/30 * * * *",
      });
    }
    cachedConfig.feedSource = doc.feedSource || "dev";
    cachedConfig.newsCron = doc.newsCron || "*/30 * * * *";
    console.log(
      `[SystemConfig] Loaded config: feedSource=${cachedConfig.feedSource}, newsCron=${cachedConfig.newsCron}`,
    );
  } catch (err) {
    console.error("[SystemConfig] Failed to load system config from DB, using defaults:", err);
  }
}

export function getSystemConfig(): ISystemConfig {
  return cachedConfig;
}

export async function updateSystemConfig(update: Partial<ISystemConfig>): Promise<ISystemConfig> {
  let doc = await SystemConfigModel.findOne().exec();
  if (!doc) {
    doc = new SystemConfigModel();
  }
  if (update.feedSource !== undefined) {
    doc.feedSource = update.feedSource;
  }
  if (update.newsCron !== undefined) {
    doc.newsCron = update.newsCron;
  }
  await doc.save();
  cachedConfig.feedSource = doc.feedSource;
  cachedConfig.newsCron = doc.newsCron;
  console.log(
    `[SystemConfig] Updated config: feedSource=${cachedConfig.feedSource}, newsCron=${cachedConfig.newsCron}`,
  );
  return cachedConfig;
}
