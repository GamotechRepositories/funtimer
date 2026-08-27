import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import Bet from "../models/Bet.js";
import WheelRound from "../models/WheelRound.js";
import WalletTransaction from "../models/WalletTransaction.js";
import RTPConfig from "../models/RTPConfig.js";
import AdminAction from "../models/AdminAction.js";
import RoundResultRule from "../models/RoundResultRule.js";
import { authMiddleware, requireAdmin } from "../middleware/auth.js";
import { creditWallet, debitWallet } from "../services/walletService.js";
import { fixedWinMultiplier } from "../config.js";

let wheelEngineRef = null;

const router = express.Router();
const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RULE_TIMEZONE = "Asia/Kolkata";
const hhmmFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: RULE_TIMEZONE,
});
const toTimeKey = (value) => hhmmFormatter.format(new Date(value));
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REPORTS_PAGE_SIZE = 100;

const parseReportDate = (value, boundary) => {
  if (!value) return null;
  if (DATE_ONLY_REGEX.test(String(value))) {
    const suffix =
      boundary === "end" ? "T23:59:59.999+05:30" : "T00:00:00.000+05:30";
    return new Date(`${value}${suffix}`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const normalizeBlockedNumbers = (input) => {
  if (!Array.isArray(input)) return null;
  const set = new Set();
  for (const item of input) {
    const value = Number(item);
    if (!Number.isInteger(value) || value < 0 || value > 9) {
      return null;
    }
    set.add(value);
  }
  return Array.from(set).sort((a, b) => a - b);
};
const normalizeSingleDigit = (input) => {
  if (input === null || typeof input === "undefined") return null;
  if (typeof input === "string" && !input.trim()) return null;
  const value = Number(input);
  if (!Number.isInteger(value) || value < 0 || value > 9) {
    return null;
  }
  return value;
};

router.use(authMiddleware, requireAdmin);

router.post("/users", async (req, res) => {
  const {
    userId,
    name,
    phone,
    district,
    state,
    email,
    password,
    initialBalance = 0,
  } = req.body;

  if (
    !userId ||
    !name ||
    !phone ||
    !district ||
    !state ||
    !email ||
    !password
  ) {
    return res.status(400).json({ message: "All fields are required" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const existing = await User.findOne({ $or: [{ userId }, { email }] });
    if (existing) {
      throw new Error("User already exists with the same ID or email");
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create(
      [
        {
          userId,
          name,
          phone,
          district,
          state,
          email,
          password: hashed,
          walletBalance: 0,
          role: "player",
        },
      ],
      { session }
    );

    const userDoc = user[0];

    if (initialBalance > 0) {
      await creditWallet(
        userDoc,
        Number(initialBalance),
        "Initial wallet funding",
        session
      );
    }

    await AdminAction.create(
      [
        {
          actorUserId: req.user.userId,
          type: "create-user",
          payload: { userId, email, initialBalance },
        },
      ],
      { session }
    );

    await session.commitTransaction();
    res.json({ message: "User created", userId: userDoc.userId });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    session.endSession();
  }
});

router.get("/users", async (_req, res) => {
  const users = await User.find({ role: { $ne: "admin" } })
    .sort({ createdAt: -1 })
    .lean();
  res.json(users);
});

router.patch("/users/:userId/password", async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ message: "Password is required" });
  }
  const user = await User.findOne({
    userId: req.params.userId,
    role: { $ne: "admin" },
  });
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  user.password = await bcrypt.hash(password, 10);
  await user.save();

  await AdminAction.create({
    actorUserId: req.user.userId,
    type: "update-password",
    payload: { userId: user.userId },
  });

  res.json({ message: "Password updated" });
});

router.delete("/users/:userId", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findOne({
      userId: req.params.userId,
      role: { $ne: "admin" },
    }).session(session);
    if (!user) {
      throw new Error("User not found");
    }

    await Bet.deleteMany({ userId: user.userId }).session(session);
    await WalletTransaction.deleteMany({ userId: user.userId }).session(
      session
    );
    await user.deleteOne({ session });
    await AdminAction.create(
      [
        {
          actorUserId: req.user.userId,
          type: "delete-user",
          payload: { userId: user.userId },
        },
      ],
      { session }
    );

    await session.commitTransaction();
    res.json({ message: "User deleted" });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    session.endSession();
  }
});

router.get("/dashboard", async (_req, res) => {
  const totalUsers = await User.countDocuments({ role: { $ne: "admin" } });
  const roundsAgg = await WheelRound.aggregate([
    {
      $group: {
        _id: null,
        totalBetAmount: { $sum: "$totalBet" },
        totalWinnings: { $sum: "$totalWin" },
      },
    },
  ]);
  const totalBetAmount = roundsAgg[0]?.totalBetAmount || 0;
  const totalWinnings = roundsAgg[0]?.totalWinnings || 0;
  const totalBets = await Bet.countDocuments({});
  const netProfit = totalBetAmount - totalWinnings;

  const userStatsAgg = await Bet.aggregate([
    {
      $group: {
        _id: "$userId",
        totalBets: { $sum: 1 },
        totalBetAmount: { $sum: "$totalBet" },
        totalWins: {
          $sum: {
            $cond: [{ $gt: ["$winAmount", 0] }, 1, 0],
          },
        },
        totalWinningAmount: { $sum: "$winAmount" },
      },
    },
  ]);

  const usersMap = await User.find({})
    .select("userId walletBalance name email")
    .lean()
    .then((list) =>
      list.reduce((acc, u) => {
        acc[u.userId] = u;
        return acc;
      }, {})
    );

  const userStats = userStatsAgg.map((stat) => ({
    userId: stat._id,
    totalBets: stat.totalBets,
    totalBetAmount: stat.totalBetAmount,
    totalWins: stat.totalWins,
    totalWinningAmount: stat.totalWinningAmount,
    walletBalance: usersMap[stat._id]?.walletBalance || 0,
    name: usersMap[stat._id]?.name,
    email: usersMap[stat._id]?.email,
  }));

  res.json({
    totals: {
      totalUsers,
      totalBetAmount,
      totalWinnings,
      totalBets,
      netProfit,
    },
    userStats,
  });
});

router.get("/reports", async (req, res) => {
  const { startDate, endDate, date, timeSlot } = req.query;
  const requestedPage = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const requestedLimit = Math.max(1, Number.parseInt(req.query.limit, 10) || 25);
  const limit = Math.min(requestedLimit, MAX_REPORTS_PAGE_SIZE);
  const match = {};

  if (date) {
    const start = parseReportDate(date, "start");
    const end = parseReportDate(date, "end");
    if (start && end) {
      match.createdAt = {
        ...(match.createdAt || {}),
        $gte: start,
        $lte: end,
      };
    }
  } else {
    if (startDate) {
      const start = parseReportDate(startDate, "start");
      if (start) {
        match.createdAt = { ...(match.createdAt || {}), $gte: start };
      }
    }
    if (endDate) {
      const end = parseReportDate(endDate, "end");
      if (end) {
        match.createdAt = { ...(match.createdAt || {}), $lte: end };
      }
    }
  }

  if (timeSlot && timeSlot !== "all") {
    const slotMap = {
      morning: [6, 12],
      afternoon: [12, 18],
      evening: [18, 24],
      night: [0, 6],
    };
    const range = slotMap[String(timeSlot).toLowerCase()];
    if (range) {
      const [startHour, endHour] = range;
      match.$expr = {
        $let: {
          vars: {
            parts: {
              $dateToParts: { date: "$createdAt", timezone: "Asia/Kolkata" },
            },
          },
          in: {
            $and: [
              { $gte: ["$$parts.hour", startHour] },
              { $lt: ["$$parts.hour", endHour] },
            ],
          },
        },
      };
    }
  }

  const [totalItems, summaryAgg] = await Promise.all([
    Bet.countDocuments(match),
    Bet.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalBetAmount: { $sum: "$totalBet" },
          totalWinAmount: { $sum: "$winAmount" },
          totalBets: { $sum: 1 },
          totalWins: {
            $sum: { $cond: [{ $gt: ["$winAmount", 0] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * limit;

  const bets = await Bet.find(match)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const roundIds = Array.from(new Set(bets.map((b) => b.roundId)));
  const rounds = await WheelRound.find({ roundId: { $in: roundIds } })
    .select("roundId resultNumber")
    .lean();
  const roundResultMap = rounds.reduce((acc, r) => {
    acc[r.roundId] = r.resultNumber;
    return acc;
  }, {});
  const betsWithResult = bets.map((b) => ({
    ...b,
    resultNumber: roundResultMap[b.roundId] ?? null,
  }));

  const summary = summaryAgg[0] || {
    totalBetAmount: 0,
    totalWinAmount: 0,
    totalBets: 0,
    totalWins: 0,
  };
  summary.netProfit = summary.totalBetAmount - summary.totalWinAmount;

  res.json({
    summary,
    bets: betsWithResult,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages,
    },
  });
});

router.get("/rounds", async (_req, res) => {
  const rounds = await WheelRound.find({})
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json(rounds);
});

router.get("/rounds/:roundId", async (req, res) => {
  const { roundId } = req.params;
  const [bets, round] = await Promise.all([
    Bet.find({ roundId }).lean(),
    WheelRound.findOne({ roundId }).lean(),
  ]);
  res.json({
    roundId,
    resultNumber: round?.resultNumber ?? null,
    bets,
  });
});

router.post("/wallet/:userId/credit", async (req, res) => {
  const { userId } = req.params;
  const { amount, reason } = req.body;
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ message: "Amount must be positive" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findOne({ userId }).session(session);
    if (!user) throw new Error("User not found");
    const balance = await creditWallet(
      user,
      Number(amount),
      reason || "Admin credit",
      session
    );
    await AdminAction.create(
      [
        {
          actorUserId: req.user.userId,
          type: "credit",
          payload: { userId, amount, reason },
        },
      ],
      { session }
    );
    await session.commitTransaction();
    res.json({ balance });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    session.endSession();
  }
});

router.post("/wallet/:userId/debit", async (req, res) => {
  const { userId } = req.params;
  const { amount, reason } = req.body;
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ message: "Amount must be positive" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findOne({ userId }).session(session);
    if (!user) throw new Error("User not found");
    const balance = await debitWallet(
      user,
      Number(amount),
      reason || "Admin debit",
      session
    );
    await AdminAction.create(
      [
        {
          actorUserId: req.user.userId,
          type: "debit",
          payload: { userId, amount, reason },
        },
      ],
      { session }
    );
    await session.commitTransaction();
    res.json({ balance });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    session.endSession();
  }
});

router.get("/wallet/history/:userId", async (req, res) => {
  const { userId } = req.params;
  const history = await WalletTransaction.find({ userId })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json(history);
});

router.get("/rtp", async (_req, res) => {
  let config = await RTPConfig.findOne({ key: "global" }).sort({
    updatedAt: -1,
    createdAt: -1,
  });
  if (!config) {
    config = await RTPConfig.create({ key: "global" });
  }
  if (config.multiplier !== fixedWinMultiplier) {
    config.multiplier = fixedWinMultiplier;
  }
  if (typeof config.roundDurationSeconds !== "number") {
    config.roundDurationSeconds = 90;
  }
  if (config.isModified("multiplier") || config.isModified("roundDurationSeconds")) {
    await config.save();
  }
  res.json(config.toObject());
});

router.post("/rtp", async (req, res) => {
  const { targetRtpPercent, roundDurationSeconds } = req.body;
  const targetRtpPercentNum = Number(targetRtpPercent);
  const roundDurationSecondsNum =
    roundDurationSeconds === undefined ? undefined : Number(roundDurationSeconds);
  const roundDurationSecondsFinal =
    roundDurationSecondsNum === undefined
      ? undefined
      : Math.round(roundDurationSecondsNum);

  if (!Number.isFinite(targetRtpPercentNum)) {
    return res.status(400).json({ message: "RTP percent is required" });
  }
  if (
    roundDurationSecondsNum !== undefined &&
    (!Number.isFinite(roundDurationSecondsNum) ||
      roundDurationSecondsNum < 10 ||
      roundDurationSecondsNum > 600)
  ) {
    return res.status(400).json({ message: "Invalid round duration seconds" });
  }

  const update = {
    targetRtpPercent: targetRtpPercentNum,
    multiplier: fixedWinMultiplier,
  };
  if (roundDurationSecondsFinal !== undefined) {
    update.roundDurationSeconds = roundDurationSecondsFinal;
  }

  await RTPConfig.updateMany(
    { key: "global" },
    { $set: update, $setOnInsert: { key: "global" } },
    {
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );
  const updated = await RTPConfig.findOne({ key: "global" }).sort({
    updatedAt: -1,
    createdAt: -1,
  });

  if (
    roundDurationSecondsFinal !== undefined &&
    wheelEngineRef &&
    typeof wheelEngineRef.updateRoundDurationSeconds === "function"
  ) {
    await wheelEngineRef.updateRoundDurationSeconds(roundDurationSecondsFinal);
  }

  await AdminAction.create({
    actorUserId: req.user.userId,
    type: "update-rtp",
    payload: {
      targetRtpPercent: targetRtpPercentNum,
      multiplier: fixedWinMultiplier,
      roundDurationSeconds: roundDurationSecondsFinal,
    },
  });

  res.json(updated);
});

router.get("/result-rules", async (_req, res) => {
  const [dailyFixedRules, dailyBlockedRules] = await Promise.all([
    RoundResultRule.find({
      ruleType: "fixed_result",
      scope: "daily_time",
    })
      .sort({ timeKey: 1 })
      .lean(),
    RoundResultRule.find({
      ruleType: "blocked_numbers",
      scope: "daily_time",
    })
      .sort({ timeKey: 1 })
      .lean(),
  ]);

  let activeRound =
    wheelEngineRef?.currentRound ||
    (await WheelRound.findOne({ status: "pending" }).sort({ createdAt: -1 }));
  if (activeRound?.toObject) {
    activeRound = activeRound.toObject();
  }
  const [currentRoundOneOffBlocks, currentRoundOneOffFixed] = activeRound
    ? await Promise.all([
        RoundResultRule.find({
          ruleType: "blocked_numbers",
          scope: "round_once",
          roundId: activeRound.roundId,
        })
          .sort({ createdAt: -1 })
          .lean(),
        RoundResultRule.findOne({
          ruleType: "fixed_result",
          scope: "round_once",
          roundId: activeRound.roundId,
        })
          .sort({ createdAt: -1 })
          .lean(),
      ])
    : [[], null];
  const activeRoundState =
    activeRound && typeof wheelEngineRef?.buildRoundStatePayload === "function"
      ? wheelEngineRef.buildRoundStatePayload(activeRound)
      : null;

  res.json({
    dailyFixedRules,
    dailyBlockedRules,
    activeRound: activeRound
      ? {
          roundId: activeRound.roundId,
          endTime: activeRound.endTime,
          timeKey: toTimeKey(activeRound.endTime),
          settleAt: activeRoundState?.settleAt || null,
          remainingMs: activeRoundState?.remainingMs ?? null,
          settlementRemainingMs: activeRoundState?.settlementRemainingMs ?? null,
          locked: activeRoundState?.locked ?? null,
          phase: activeRoundState?.phase || null,
        }
      : null,
    currentRoundOneOffBlocks,
    currentRoundOneOffFixed: currentRoundOneOffFixed || null,
  });
});

router.post("/result-rules/fixed", async (req, res) => {
  const { timeKey, fixedNumber, enabled = true, notes = "" } = req.body || {};
  const parsedNumber = Number(fixedNumber);
  if (!HHMM_REGEX.test(String(timeKey || ""))) {
    return res.status(400).json({ message: "Invalid timeKey. Expected HH:mm." });
  }
  if (!Number.isInteger(parsedNumber) || parsedNumber < 0 || parsedNumber > 9) {
    return res.status(400).json({ message: "fixedNumber must be an integer 0-9." });
  }

  const updated = await RoundResultRule.findOneAndUpdate(
    { ruleType: "fixed_result", scope: "daily_time", timeKey },
    {
      $set: {
        fixedNumber: parsedNumber,
        enabled: Boolean(enabled),
        notes: String(notes || "").trim(),
      },
      $setOnInsert: {
        ruleType: "fixed_result",
        scope: "daily_time",
        timeKey,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  await AdminAction.create({
    actorUserId: req.user.userId,
    type: "result-rule-fixed-upsert",
    payload: {
      timeKey,
      fixedNumber: parsedNumber,
      enabled: Boolean(enabled),
    },
  });

  res.json(updated);
});

router.post("/result-rules/fixed/current-round", async (req, res) => {
  const { fixedNumber, notes = "" } = req.body || {};
  const parsedNumber = Number(fixedNumber);
  if (!Number.isInteger(parsedNumber) || parsedNumber < 0 || parsedNumber > 9) {
    return res.status(400).json({ message: "fixedNumber must be an integer 0-9." });
  }

  const activeRound =
    wheelEngineRef?.currentRound ||
    (await WheelRound.findOne({ status: "pending" }).sort({ createdAt: -1 }));
  if (!activeRound) {
    return res.status(409).json({ message: "No active round found." });
  }

  const updated = await RoundResultRule.findOneAndUpdate(
    {
      ruleType: "fixed_result",
      scope: "round_once",
      roundId: activeRound.roundId,
    },
    {
      $set: {
        fixedNumber: parsedNumber,
        enabled: true,
        notes: String(notes || "").trim(),
      },
      $setOnInsert: {
        ruleType: "fixed_result",
        scope: "round_once",
        roundId: activeRound.roundId,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  await AdminAction.create({
    actorUserId: req.user.userId,
    type: "result-rule-fixed-current-round-upsert",
    payload: { roundId: activeRound.roundId, fixedNumber: parsedNumber },
  });

  res.json(updated);
});

router.delete("/result-rules/fixed/current-round", async (req, res) => {
  const activeRound =
    wheelEngineRef?.currentRound ||
    (await WheelRound.findOne({ status: "pending" }).sort({ createdAt: -1 }));
  if (!activeRound) {
    return res.status(409).json({ message: "No active round found." });
  }

  await RoundResultRule.deleteOne({
    ruleType: "fixed_result",
    scope: "round_once",
    roundId: activeRound.roundId,
  });

  await AdminAction.create({
    actorUserId: req.user.userId,
    type: "result-rule-fixed-current-round-delete",
    payload: { roundId: activeRound.roundId },
  });

  res.json({ ok: true });
});

router.delete("/result-rules/fixed/:timeKey", async (req, res) => {
  const { timeKey } = req.params;
  if (!HHMM_REGEX.test(String(timeKey || ""))) {
    return res.status(400).json({ message: "Invalid timeKey. Expected HH:mm." });
  }
  await RoundResultRule.deleteOne({
    ruleType: "fixed_result",
    scope: "daily_time",
    timeKey,
  });
  await AdminAction.create({
    actorUserId: req.user.userId,
    type: "result-rule-fixed-delete",
    payload: { timeKey },
  });
  res.json({ ok: true });
});

router.post("/result-rules/blocked/daily", async (req, res) => {
  const { timeKey, blockedNumbers, enabled = true, notes = "" } = req.body || {};
  if (!HHMM_REGEX.test(String(timeKey || ""))) {
    return res.status(400).json({ message: "Invalid timeKey. Expected HH:mm." });
  }
  const normalized = normalizeBlockedNumbers(blockedNumbers);
  if (!normalized || !normalized.length) {
    return res
      .status(400)
      .json({ message: "blockedNumbers must be a non-empty array of 0-9." });
  }

  const updated = await RoundResultRule.findOneAndUpdate(
    { ruleType: "blocked_numbers", scope: "daily_time", timeKey },
    {
      $set: {
        blockedNumbers: normalized,
        enabled: Boolean(enabled),
        notes: String(notes || "").trim(),
      },
      $setOnInsert: {
        ruleType: "blocked_numbers",
        scope: "daily_time",
        timeKey,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  await AdminAction.create({
    actorUserId: req.user.userId,
    type: "result-rule-blocked-daily-upsert",
    payload: { timeKey, blockedNumbers: normalized, enabled: Boolean(enabled) },
  });

  res.json(updated);
});

router.delete("/result-rules/blocked/daily/:timeKey", async (req, res) => {
  const { timeKey } = req.params;
  if (!HHMM_REGEX.test(String(timeKey || ""))) {
    return res.status(400).json({ message: "Invalid timeKey. Expected HH:mm." });
  }
  await RoundResultRule.deleteOne({
    ruleType: "blocked_numbers",
    scope: "daily_time",
    timeKey,
  });
  await AdminAction.create({
    actorUserId: req.user.userId,
    type: "result-rule-blocked-daily-delete",
    payload: { timeKey },
  });
  res.json({ ok: true });
});

router.post("/result-rules/blocked/current-round", async (req, res) => {
  const { blockedNumbers, excludedNumber, notes = "" } = req.body || {};
  const normalizedSingle = normalizeSingleDigit(excludedNumber);
  const normalized =
    normalizedSingle !== null
      ? [normalizedSingle]
      : normalizeBlockedNumbers(blockedNumbers);
  if (!normalized || !normalized.length) {
    return res
      .status(400)
      .json({
        message:
          "Provide excludedNumber (0-9) or blockedNumbers as a non-empty array of 0-9.",
      });
  }

  const activeRound =
    wheelEngineRef?.currentRound ||
    (await WheelRound.findOne({ status: "pending" }).sort({ createdAt: -1 }));
  if (!activeRound) {
    return res.status(409).json({ message: "No active round found." });
  }

  const updated = await RoundResultRule.findOneAndUpdate(
    {
      ruleType: "blocked_numbers",
      scope: "round_once",
      roundId: activeRound.roundId,
    },
    {
      $set: {
        blockedNumbers: normalized,
        enabled: true,
        notes: String(notes || "").trim(),
      },
      $setOnInsert: {
        ruleType: "blocked_numbers",
        scope: "round_once",
        roundId: activeRound.roundId,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  await AdminAction.create({
    actorUserId: req.user.userId,
    type: "result-rule-blocked-current-round-upsert",
    payload: { roundId: activeRound.roundId, blockedNumbers: normalized },
  });

  res.json(updated);
});

router.delete("/result-rules/blocked/current-round", async (req, res) => {
  const activeRound =
    wheelEngineRef?.currentRound ||
    (await WheelRound.findOne({ status: "pending" }).sort({ createdAt: -1 }));
  if (!activeRound) {
    return res.status(409).json({ message: "No active round found." });
  }

  await RoundResultRule.deleteOne({
    ruleType: "blocked_numbers",
    scope: "round_once",
    roundId: activeRound.roundId,
  });

  await AdminAction.create({
    actorUserId: req.user.userId,
    type: "result-rule-blocked-current-round-delete",
    payload: { roundId: activeRound.roundId },
  });

  res.json({ ok: true });
});

router.setWheelEngine = (wheelEngine) => {
  wheelEngineRef = wheelEngine || null;
};

export default router;
