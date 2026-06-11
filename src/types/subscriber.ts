export interface Subscriber {
  chatId: number;
  preferredCategories?: string[];
  customPrompt?: string;
  createdAt: Date;
  updatedAt: Date;
}
