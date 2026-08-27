import express from "express";
import http from "http";
import cors from "cors";
import bcrypt from "bcryptjs";
import { Server } from "socket.io";
import connectDB from "./db.js";
import { port, adminSeedEmail, adminSeedPassword, allowedOrigins } from "./config.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import buildPlayerRouter from "./routes/player.js";
import RTCHub from "./realtime/rtcHub.js";
import WheelEngine from "./services/wheelEngine.js";
import setupSocket from "./realtime/socket.js";
import User from "./models/User.js";

const start = async () => {
  await connectDB();

  const app = express();
  const server = http.createServer(app);
  const corsOptions = {
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
  };

  const io = new Server(server, {
    cors: corsOptions,
  });

  const rtcHub = new RTCHub(io);
  const wheelEngine = new WheelEngine(io, rtcHub);
  setupSocket(io, wheelEngine);

  if (typeof adminRoutes.setWheelEngine === "function") {
    adminRoutes.setWheelEngine(wheelEngine);
  }

  app.use(cors(corsOptions));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/player", buildPlayerRouter(wheelEngine));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  await seedAdmin();
  await wheelEngine.init();

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
};

const seedAdmin = async () => {
  const existing = await User.findOne({ role: "admin" });
  if (existing) return;
  const hashed = await bcrypt.hash(adminSeedPassword, 10);
  await User.create({
    userId: "admin",
    name: "Casino Admin",
    phone: "0000000000",
    district: "HQ",
    state: "HQ",
    email: adminSeedEmail,
    password: hashed,
    role: "admin",
    walletBalance: 0,
  });
  console.log("Seeded default admin user");
};

start().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
