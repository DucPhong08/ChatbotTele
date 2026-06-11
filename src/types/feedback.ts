export interface Feedback {
  chatId: number;
  username?: string;
  name?: string;
  message: string;
  status: "pending" | "processed";
  reply?: string;
  repliedBy?: number;
  repliedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
