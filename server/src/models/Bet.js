import mongoose from "mongoose";

const betDetailSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, min: 0, max: 9 },
    amount: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const betSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userId: { type: String, required: true, index: true },
    roundId: { type: String, required: true, index: true },
    bets: { type: [betDetailSchema], required: true },
    totalBet: { type: Number, required: true },
    status: {
      type: String,
      enum: ["PENDING", "WIN", "LOSE"],
      default: "PENDING",
    },
    winAmount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

betSchema.index({ createdAt: -1 });

export default mongoose.model("Bet", betSchema);
