import WalletTransaction from "../models/WalletTransaction.js";
import User from "../models/User.js";

const adjustWallet = async (user, amountDelta, type, reason, session) => {
  const updatedBalance = (user.walletBalance || 0) + amountDelta;
  if (updatedBalance < 0) {
    throw new Error("Insufficient balance");
  }

  user.walletBalance = updatedBalance;
  await user.save({ session });

  await WalletTransaction.create(
    [
      {
        user,
        userId: user.userId,
        amount: Math.abs(amountDelta),
        type,
        reason,
        balanceAfter: updatedBalance,
      },
    ],
    { session }
  );

  return updatedBalance;
};

export const creditWallet = async (user, amount, reason, session) => {
  return adjustWallet(user, Math.abs(amount), "credit", reason, session);
};

export const debitWallet = async (user, amount, reason, session) => {
  return adjustWallet(user, -Math.abs(amount), "debit", reason, session);
};

export { adjustWallet };
