import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    userId: { type: String, unique: true, required: true, index: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    district: { type: String, required: true },
    state: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    walletBalance: { type: Number, required: true, default: 0 },
    role: { type: String, enum: ["player", "admin"], default: "player" },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
