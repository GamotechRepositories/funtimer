import mongoose from "mongoose";
import { mongoUri } from "./config.js";

mongoose.set("strictQuery", true);

const connectDB = async () => {
  await mongoose.connect(mongoUri, {
    autoIndex: true,
  });
  console.log("Connected to MongoDB");
};

export default connectDB;
