/* Script to create or update the FunTimer admin user */
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import connectDB from "../src/db.js";
import User from "../src/models/User.js";

dotenv.config();

const ADMIN_EMAIL = "admin@funtimer.in";
const ADMIN_PASSWORD = "Admin12345678";
const ADMIN_USER_ID = "admin-funtimer";

const main = async () => {
  await connectDB();

  const existing = await User.findOne({ email: ADMIN_EMAIL });
  const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);

  if (existing) {
    existing.password = hashed;
    existing.role = "admin";
    existing.name = existing.name || "FunTimer Admin";
    existing.userId = existing.userId || ADMIN_USER_ID;
    await existing.save();
    console.log(`Updated admin user ${ADMIN_EMAIL}`);
  } else {
    await User.create({
      userId: ADMIN_USER_ID,
      name: "FunTimer Admin",
      phone: "0000000000",
      district: "HQ",
      state: "HQ",
      email: ADMIN_EMAIL,
      password: hashed,
      role: "admin",
      walletBalance: 0,
    });
    console.log(`Created admin user ${ADMIN_EMAIL}`);
  }
};

main()
  .catch((err) => {
    console.error("Failed to create admin user", err);
    process.exit(1);
  })
  .finally(() => mongoose.connection.close());
