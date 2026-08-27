import express from "express";
import mongoose from "mongoose";
import { authMiddleware } from "../middleware/auth.js";
import WheelRound from "../models/WheelRound.js";
import Bet from "../models/Bet.js";
import { debitWallet, creditWallet } from "../services/walletService.js";
import User from "../models/User.js";
import { fixedWinMultiplier } from "../config.js";

const buildOpenRoundQuery = (now = new Date()) => ({
  status: "pending",
  endTime: { $gt: now },
  $or: [{ lockedAt: { $exists: false } }, { lockedAt: null }],
});

const buildOpenRoundByIdQuery = (roundId, now = new Date()) => ({
  roundId,
  ...buildOpenRoundQuery(now),
});

const buildPlayerRouter = (wheelEngine) => {
  const router = express.Router();

  router.use(authMiddleware);

  router.get("/current-round", async (_req, res) => {
    let round = wheelEngine.currentRound;
    if (!round) {
      round = await WheelRound.findOne({ status: "pending" }).sort({
        createdAt: -1,
      });
    }
    if (!round) {
      return res.status(404).json({ message: "No active round" });
    }
    const state =
      typeof wheelEngine?.buildRoundStatePayload === "function"
        ? wheelEngine.buildRoundStatePayload(round)
        : {
            roundId: round.roundId,
            endTime: round.endTime,
            remainingMs: Math.max(
              0,
              new Date(round.endTime).getTime() - Date.now()
            ),
            locked: new Date(round.endTime).getTime() <= Date.now(),
            phase:
              new Date(round.endTime).getTime() > Date.now()
                ? "betting"
                : "spinning",
          };
    res.json({
      ...state,
      multiplier: fixedWinMultiplier,
    });
  });

  router.post("/bet", async (req, res) => {
    const { bets } = req.body;
    if (!Array.isArray(bets) || !bets.length) {
      return res.status(400).json({ message: "Provide bets array" });
    }

    const round = await WheelRound.findOne(buildOpenRoundQuery()).sort({
      createdAt: -1,
    });
    if (!round) {
      return res.status(400).json({ message: "Round closed" });
    }

    const cleanedBets = bets.map((b) => ({
      number: Number(b.number),
      amount: Number(b.amount),
    }));

    for (const b of cleanedBets) {
      if (
        !Number.isInteger(b.number) ||
        b.number < 0 ||
        b.number > 9 ||
        !Number.isFinite(b.amount) ||
        b.amount <= 0
      ) {
        return res.status(400).json({ message: "Invalid bet data" });
      }
    }

    const totalBet = cleanedBets.reduce((acc, b) => acc + b.amount, 0);
    if (totalBet <= 0) {
      return res.status(400).json({ message: "Bet amount must be positive" });
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const freshUser = await User.findById(req.user._id).session(session);

      await debitWallet(
        freshUser,
        totalBet,
        `Round ${round.roundId} bet`,
        session
      );

      await Bet.create(
        [
          {
            user: freshUser._id,
            userId: freshUser.userId,
            roundId: round.roundId,
            bets: cleanedBets,
            totalBet,
          },
        ],
        { session }
      );

      const updateResult = await WheelRound.updateOne(
        buildOpenRoundByIdQuery(round.roundId),
        { $inc: { totalBet } },
        { session }
      );
      if (updateResult.matchedCount !== 1) {
        throw new Error("Round closed");
      }

      await session.commitTransaction();

      res.json({
        message: "Bet placed",
        walletBalance: freshUser.walletBalance,
        roundId: round.roundId,
      });
    } catch (err) {
      await session.abortTransaction();
      res.status(400).json({ message: err.message });
    } finally {
      session.endSession();
    }
  });

  router.post("/bet/undo", async (req, res) => {
    const round = await WheelRound.findOne(buildOpenRoundQuery()).sort({
      createdAt: -1,
    });
    if (!round) {
      return res.status(400).json({ message: "Round closed" });
    }

    const bet = await Bet.findOne({
      user: req.user._id,
      roundId: round.roundId,
      status: "PENDING",
    }).sort({ createdAt: -1 });
    if (!bet) {
      return res.status(404).json({ message: "No bet to undo" });
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const freshUser = await User.findById(req.user._id).session(session);

      await creditWallet(
        freshUser,
        bet.totalBet,
        `Undo bet for round ${round.roundId}`,
        session
      );

      await Bet.deleteOne({ _id: bet._id }).session(session);

      const updateResult = await WheelRound.updateOne(
        buildOpenRoundByIdQuery(round.roundId),
        { $inc: { totalBet: -bet.totalBet } },
        { session }
      );
      if (updateResult.matchedCount !== 1) {
        throw new Error("Round closed");
      }

      await session.commitTransaction();

      res.json({
        message: "Bet undone",
        walletBalance: freshUser.walletBalance,
        removedBet: { bets: bet.bets, totalBet: bet.totalBet },
      });
    } catch (err) {
      await session.abortTransaction();
      res.status(400).json({ message: err.message });
    } finally {
      session.endSession();
    }
  });

  router.post("/bet/clear", async (req, res) => {
    const round = await WheelRound.findOne(buildOpenRoundQuery()).sort({
      createdAt: -1,
    });
    if (!round) {
      return res.status(400).json({ message: "Round closed" });
    }

    const bets = await Bet.find({
      user: req.user._id,
      roundId: round.roundId,
      status: "PENDING",
    });
    if (!bets.length) {
      return res.status(404).json({ message: "No bets to clear" });
    }

    const totalRefund = bets.reduce(
      (sum, bet) => sum + (bet.totalBet || 0),
      0
    );

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const freshUser = await User.findById(req.user._id).session(session);

      await creditWallet(
        freshUser,
        totalRefund,
        `Clear bets for round ${round.roundId}`,
        session
      );

      await Bet.deleteMany({
        user: req.user._id,
        roundId: round.roundId,
        status: "PENDING",
      }).session(session);

      const updateResult = await WheelRound.updateOne(
        buildOpenRoundByIdQuery(round.roundId),
        { $inc: { totalBet: -totalRefund } },
        { session }
      );
      if (updateResult.matchedCount !== 1) {
        throw new Error("Round closed");
      }

      await session.commitTransaction();

      res.json({
        message: "Bets cleared",
        walletBalance: freshUser.walletBalance,
        removedTotal: totalRefund,
      });
    } catch (err) {
      await session.abortTransaction();
      res.status(400).json({ message: err.message });
    } finally {
      session.endSession();
    }
  });

  router.get("/bets", async (req, res) => {
    const bets = await Bet.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(bets);
  });

  router.get("/wallet", async (req, res) => {
    const user = await User.findById(req.user._id);
    res.json({ balance: user.walletBalance });
  });

  router.get("/results", async (_req, res) => {
    const recent = await WheelRound.find({ status: "settled" })
      .sort({ createdAt: -1 })
      .limit(10)
      .select("roundId resultNumber createdAt")
      .lean();
    res.json(recent);
  });

  return router;
};

export default buildPlayerRouter;
