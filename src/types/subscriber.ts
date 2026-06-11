export interface Subscriber {
  chatId: number;
  preferredCategories?: string[];
  customPrompt?: string;
  language?: "vi" | "en";
  createdAt: Date;
  updatedAt: Date;
}
