import mongoose from "mongoose";

const walletTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    type: { type: String, enum: ["credit", "debit"], required: true },
    reason: { type: String, default: "" },
    balanceAfter: { type: Number, required: true },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ createdAt: -1 });

export default mongoose.model("WalletTransaction", walletTransactionSchema);
