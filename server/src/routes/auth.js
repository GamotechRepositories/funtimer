import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { authMiddleware } from "../middleware/auth.js";
import { jwtSecret } from "../config.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, jwtSecret, {
      expiresIn: "7d",
    });

    res.json({
      token,
      user: {
        id: user._id,
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        walletBalance: user.walletBalance,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Login failed" });
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  res.json({
    id: req.user._id,
    userId: req.user.userId,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    walletBalance: req.user.walletBalance,
  });
});

export default router;
