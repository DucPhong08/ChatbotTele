export interface Subscriber {
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  isActiveAI?: boolean;
  preferredCategories?: string[];
  customPrompt?: string;
  language?: "vi" | "en";
  createdAt: Date;
  updatedAt: Date;
}
