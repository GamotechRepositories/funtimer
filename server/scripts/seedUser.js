import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../src/models/User.js";
import dotenv from "dotenv";

dotenv.config();

const MONGODB_URI =
  process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/funtimer";

async function seedUser() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB");

    const phone = "9898989898";
    const email = "player@funtimer.local";

    const existingUser = await User.findOne({ $or: [{ phone }, { email }] });
    if (existingUser) {
      console.log("User already exists:", {
        phone: existingUser.phone,
        email: existingUser.email,
        id: existingUser._id,
      });
      process.exit(0);
    }

    const hashed = await bcrypt.hash("123456", 10);
    const user = await User.create({
      userId: "player-9898989898",
      name: "Seed Player",
      phone,
      district: "Demo",
      state: "Demo",
      email,
      password: hashed,
      walletBalance: 100000,
      role: "player",
    });

    console.log("User seeded successfully:", {
      phone: user.phone,
      email: user.email,
      userId: user.userId,
      walletBalance: user.walletBalance,
      id: user._id,
    });

    process.exit(0);
  } catch (error) {
    console.error("Error seeding user:", error);
    process.exit(1);
  }
}

seedUser();
