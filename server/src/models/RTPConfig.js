import mongoose from "mongoose";

const rtpConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    targetRtpPercent: { type: Number, required: true, default: 90 },
    multiplier: { type: Number, required: true, default: 9 },
    roundDurationSeconds: { type: Number, required: true, default: 90 },
  },
  { timestamps: true }
);

export default mongoose.model("RTPConfig", rtpConfigSchema);
