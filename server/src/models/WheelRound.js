import mongoose from "mongoose";

const wheelRoundSchema = new mongoose.Schema(
  {
    roundId: { type: String, required: true, unique: true, index: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    lockedAt: { type: Date },
    resultNumber: { type: Number, min: 0, max: 9 },
    totalBet: { type: Number, default: 0 },
    totalWin: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["pending", "settled"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

wheelRoundSchema.index({ createdAt: -1 });

export default mongoose.model("WheelRound", wheelRoundSchema);
