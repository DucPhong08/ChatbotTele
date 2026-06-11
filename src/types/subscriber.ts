export interface Subscriber {
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  isActiveAI?: boolean;
  preferredCategories?: string[];
  customPrompt?: string;
  language?: "vi" | "en";
  createdAt: Date;
  updatedAt: Date;
}
