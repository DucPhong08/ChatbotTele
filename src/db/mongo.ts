import mongoose from "mongoose";

export async function connectMongo(uri: string): Promise<void> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("Kết nối MongoDB thành công");
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
