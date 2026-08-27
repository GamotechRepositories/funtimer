import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import WheelRound from "../models/WheelRound.js";
import Bet from "../models/Bet.js";
import User from "../models/User.js";
import RTPConfig from "../models/RTPConfig.js";
import RoundResultRule from "../models/RoundResultRule.js";
import AdminAction from "../models/AdminAction.js";
import { chooseWinningNumber } from "./rtpEngine.js";
import { creditWallet } from "./walletService.js";
import {
  roundDurationMs,
  postCloseSpinMs,
  defaultRtp,
  fixedWinMultiplier,
} from "../config.js";

const RULE_TIMEZONE = "Asia/Kolkata";
const SETTLEMENT_MAX_RETRIES = 5;
const SETTLEMENT_BASE_BACKOFF_MS = 50;
const SETTLEMENT_STALE_LOCK_MS = 30_000;
const SETTLEMENT_SCHEDULER_RETRY_MS = 1_000;
const hhmmFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: RULE_TIMEZONE,
});

const toTimeKey = (value) => hhmmFormatter.format(new Date(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settlementRetryDelayMs = (attempt) =>
  SETTLEMENT_BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1)) +
  Math.floor(Math.random() * SETTLEMENT_BASE_BACKOFF_MS);
const hasErrorLabel = (err, label) =>
  (typeof err?.hasErrorLabel === "function" && err.hasErrorLabel(label)) ||
  (err?.errorLabelSet instanceof Set && err.errorLabelSet.has(label)) ||
  (Array.isArray(err?.errorResponse?.errorLabels) &&
    err.errorResponse.errorLabels.includes(label));
const isRetryableSettlementError = (err) =>
  hasErrorLabel(err, "TransientTransactionError") ||
  hasErrorLabel(err, "UnknownTransactionCommitResult") ||
  err?.code === 112 ||
  err?.codeName === "WriteConflict";

class WheelEngine {
  constructor(io, rtcHub) {
    this.io = io;
    this.rtcHub = rtcHub;
    this.currentRound = null;
    this.countdownInterval = null;
    this.closeTimer = null;
    this.settleTimer = null;
    this.spinStartedRoundId = null;
  }

  async init() {
    await this.ensureRtpConfig();
    await this.restoreOrCreateRound();
  }

  async ensureRtpConfig() {
    const existing = await RTPConfig.findOne({ key: "global" }).sort({
      updatedAt: -1,
      createdAt: -1,
    });
    if (!existing) {
      await RTPConfig.create({
        key: "global",
        targetRtpPercent: defaultRtp,
        multiplier: fixedWinMultiplier,
        roundDurationSeconds: Math.max(5, Math.round(roundDurationMs / 1000)),
      });
      return;
    }
    if (existing.multiplier !== fixedWinMultiplier) {
      existing.multiplier = fixedWinMultiplier;
    }
    if (typeof existing.roundDurationSeconds !== "number") {
      existing.roundDurationSeconds = Math.max(
        5,
        Math.round(roundDurationMs / 1000)
      );
    }
    if (existing.isModified("multiplier") || existing.isModified("roundDurationSeconds")) {
      await existing.save();
    }
  }

  async restoreOrCreateRound() {
    const ongoing = await WheelRound.findOne({ status: "pending" }).sort({
      createdAt: -1,
    });
    if (ongoing) {
      this.currentRound = ongoing;
      this.startCountdownLoop();
      this.scheduleRoundClose();
      this.scheduleSettlement();
      return;
    }
    await this.startNewRound();
  }

  getSettlementTime(round = this.currentRound) {
    if (!round?.endTime) return null;
    return new Date(new Date(round.endTime).getTime() + postCloseSpinMs);
  }

  buildRoundStatePayload(round = this.currentRound, nowValue = Date.now()) {
    if (!round) return null;
    const now =
      typeof nowValue === "number" ? nowValue : new Date(nowValue).getTime();
    const endMs = new Date(round.endTime).getTime();
    const settleAt = this.getSettlementTime(round);
    const settleMs = settleAt ? settleAt.getTime() : endMs;
    const remainingMs = Math.max(0, endMs - now);
    const settlementRemainingMs = Math.max(0, settleMs - now);

    return {
      roundId: round.roundId,
      startTime: round.startTime,
      endTime: round.endTime,
      settleAt,
      durationMs: Math.max(0, endMs - new Date(round.startTime).getTime()),
      remainingMs,
      settlementRemainingMs,
      spinWindowMs: postCloseSpinMs,
      locked: remainingMs <= 0,
      phase:
        settlementRemainingMs <= 0
          ? "settling"
          : remainingMs > 0
            ? "betting"
            : "spinning",
    };
  }

  emitRoundSpinStart(round = this.currentRound) {
    if (!round) return;
    if (this.spinStartedRoundId === round.roundId) return;
    const payload = this.buildRoundStatePayload(round);
    if (!payload || payload.phase !== "spinning") return;
    this.spinStartedRoundId = round.roundId;
    this.io.emit("round-spin-start", payload);
    this.rtcHub.broadcast("round-spin-start", payload);
  }

  async startNewRound() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
    }
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
    }

    const rtpConfig =
      (await RTPConfig.findOne({ key: "global" }).sort({
        updatedAt: -1,
        createdAt: -1,
      })) ||
      new RTPConfig({
        key: "global",
        targetRtpPercent: defaultRtp,
        multiplier: fixedWinMultiplier,
      });
    const now = new Date();
    const durationMs = Math.max(
      5_000,
      Math.round((rtpConfig.roundDurationSeconds || 0) * 1000) ||
        roundDurationMs
    );
    const endTime = new Date(now.getTime() + durationMs);

    this.currentRound = await WheelRound.create({
      roundId: uuidv4(),
      startTime: now,
      endTime,
      status: "pending",
    });
    this.spinStartedRoundId = null;

    const payload = this.buildRoundStatePayload(this.currentRound, now.getTime());

    this.io.emit("round-start", payload);
    this.rtcHub.broadcast("round-start", payload);

    this.startCountdownLoop();
    this.scheduleRoundClose();
    this.scheduleSettlement();
  }

  async updateRoundDurationSeconds(roundDurationSeconds) {
    if (!this.currentRound) return null;
    if (this.currentRound.status && this.currentRound.status !== "pending") {
      return null;
    }
    if (new Date(this.currentRound.endTime).getTime() <= Date.now()) {
      return null;
    }

    const durationMs = Math.max(
      5_000,
      Math.round(Number(roundDurationSeconds) * 1000)
    );
    if (!Number.isFinite(durationMs)) return null;

    const startTime = new Date(this.currentRound.startTime);
    const endTime = new Date(startTime.getTime() + durationMs);

    this.currentRound.endTime = endTime;
    await WheelRound.updateOne(
      { roundId: this.currentRound.roundId },
      { $set: { endTime } }
    );

    this.startCountdownLoop();
    this.spinStartedRoundId = null;
    this.scheduleRoundClose();
    this.scheduleSettlement();

    return this.buildRoundStatePayload(this.currentRound, Date.now());
  }

  startCountdownLoop() {
    if (!this.currentRound) return;
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    this.countdownInterval = setInterval(() => {
      if (!this.currentRound) return;
      const countdownPayload = this.buildRoundStatePayload(
        this.currentRound,
        Date.now()
      );
      if (!countdownPayload) return;
      this.io.emit("round-countdown", countdownPayload);
      this.rtcHub.broadcast("round-countdown", countdownPayload);

      if (countdownPayload.phase === "spinning") {
        this.emitRoundSpinStart(this.currentRound);
      }

      if (countdownPayload.settlementRemainingMs <= 0) {
        clearInterval(this.countdownInterval);
      }
    }, 1000);
  }

  scheduleRoundClose(delayOverrideMs = null) {
    if (!this.currentRound) return;
    const delay =
      typeof delayOverrideMs === "number"
        ? delayOverrideMs
        : new Date(this.currentRound.endTime).getTime() - new Date().getTime();

    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
    }

    const scheduledRoundId = this.currentRound.roundId;
    this.closeTimer = setTimeout(() => {
      if (
        this.currentRound?.roundId === scheduledRoundId &&
        this.currentRound?.status === "pending"
      ) {
        this.emitRoundSpinStart(this.currentRound);
      }
    }, Math.max(0, delay));
  }

  scheduleSettlement(delayOverrideMs = null) {
    if (!this.currentRound) return;
    const delay =
      typeof delayOverrideMs === "number"
        ? delayOverrideMs
        : this.getSettlementTime(this.currentRound).getTime() -
          new Date().getTime();
    const scheduledRoundId = this.currentRound.roundId;

    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
    }

    this.settleTimer = setTimeout(() => {
      this.settleCurrentRound().catch((err) => {
        console.error("Failed to settle round", {
          roundId: scheduledRoundId,
          retryable: isRetryableSettlementError(err),
          code: err?.code,
          codeName: err?.codeName,
          message: err?.message,
        });
        if (
          this.currentRound?.roundId === scheduledRoundId &&
          this.currentRound?.status === "pending"
        ) {
          this.scheduleSettlement(SETTLEMENT_SCHEDULER_RETRY_MS);
        }
      });
    }, Math.max(0, delay));
  }

  async acquireRoundSettlementLock(roundId) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - SETTLEMENT_STALE_LOCK_MS);
    const lockedRound = await WheelRound.findOneAndUpdate(
      {
        roundId,
        status: "pending",
        $or: [
          { lockedAt: { $exists: false } },
          { lockedAt: null },
          { lockedAt: { $lt: staleBefore } },
        ],
      },
      { $set: { lockedAt: now } },
      { new: true }
    );
    if (lockedRound) {
      return { acquired: true, lockedAt: now };
    }

    const pendingRound = await WheelRound.findOne({ roundId, status: "pending" })
      .select("roundId lockedAt")
      .lean();
    if (!pendingRound) {
      return { acquired: false, reason: "round_not_pending_or_missing" };
    }
    return { acquired: false, reason: "already_locked" };
  }

  async releaseRoundSettlementLock(roundId) {
    await WheelRound.updateOne(
      { roundId, status: "pending" },
      { $unset: { lockedAt: 1 } }
    );
  }

  async fetchHistoryTotals() {
    const totals = await WheelRound.aggregate([
      { $match: { status: "settled" } },
      {
        $group: {
          _id: null,
          totalBet: { $sum: "$totalBet" },
          totalWin: { $sum: "$totalWin" },
        },
      },
    ]);
    if (!totals.length) {
      return { totalBet: 0, totalWin: 0 };
    }
    return { totalBet: totals[0].totalBet || 0, totalWin: totals[0].totalWin || 0 };
  }

  async resolveRoundResultRules(round) {
    const roundId = round?.roundId;
    const timeKey = toTimeKey(round?.endTime || Date.now());
    const [roundOnceFixedRule, dailyFixedRule, blockedRules] = await Promise.all([
      RoundResultRule.findOne({
        ruleType: "fixed_result",
        scope: "round_once",
        roundId,
        enabled: true,
      }).sort({ updatedAt: -1, createdAt: -1 }),
      RoundResultRule.findOne({
        ruleType: "fixed_result",
        scope: "daily_time",
        timeKey,
        enabled: true,
      }).sort({ updatedAt: -1, createdAt: -1 }),
      RoundResultRule.find({
        ruleType: "blocked_numbers",
        enabled: true,
        $or: [
          { scope: "daily_time", timeKey },
          { scope: "round_once", roundId },
        ],
      }).sort({ updatedAt: -1, createdAt: -1 }),
    ]);

    const excludedSet = new Set();
    blockedRules.forEach((rule) => {
      (rule.blockedNumbers || []).forEach((number) => {
        if (Number.isInteger(number) && number >= 0 && number <= 9) {
          excludedSet.add(number);
        }
      });
    });

    const fixedRule = roundOnceFixedRule || dailyFixedRule || null;
    const fixedSource = roundOnceFixedRule ? "round_once" : dailyFixedRule ? "daily_time" : null;

    return {
      roundId,
      timeKey,
      fixedRule,
      fixedSource,
      blockedRules,
      excludedNumbers: Array.from(excludedSet),
    };
  }

  async settleCurrentRound() {
    if (!this.currentRound) return;
    const roundId = this.currentRound.roundId;
    const lockState = await this.acquireRoundSettlementLock(roundId);
    if (!lockState.acquired) {
      console.info("Skipping settlement lock acquisition", {
          roundId,
          reason: lockState.reason,
      });
      return;
    }
    this.currentRound.lockedAt = lockState.lockedAt;

    let settledSuccessfully = false;
    try {
      const rtpConfigDoc = await RTPConfig.findOne({ key: "global" }).sort({
        updatedAt: -1,
        createdAt: -1,
      });
      const rtpConfig = rtpConfigDoc || {
        targetRtpPercent: defaultRtp,
        multiplier: fixedWinMultiplier,
      };
      const betsForDecision = await Bet.find({ roundId, status: "PENDING" });

      const roundTotal = betsForDecision.reduce(
        (sum, bet) => sum + (bet.totalBet || 0),
        0
      );
      const historyTotals = await this.fetchHistoryTotals();
      const ruleContext = await this.resolveRoundResultRules(this.currentRound);
      const excludedNumbers = ruleContext.excludedNumbers || [];

      let winningNumber;
      if (
        ruleContext.fixedRule &&
        Number.isInteger(ruleContext.fixedRule.fixedNumber)
      ) {
        winningNumber = ruleContext.fixedRule.fixedNumber;
        if (excludedNumbers.includes(winningNumber)) {
          await AdminAction.create({
            actorUserId: "system",
            type: "result-rule-conflict",
            payload: {
              roundId,
              timeKey: ruleContext.timeKey,
              fixedNumber: winningNumber,
              fixedSource: ruleContext.fixedSource,
              excludedNumbers,
              decision: "fixed_result_precedence",
            },
          });
        }
      } else {
        winningNumber = chooseWinningNumber({
          bets: betsForDecision,
          rtpConfig,
          historyTotals,
          roundTotal,
          excludedNumbers,
        });
        if (winningNumber === null) {
          await AdminAction.create({
            actorUserId: "system",
            type: "result-rule-fallback",
            payload: {
              roundId,
              timeKey: ruleContext.timeKey,
              excludedNumbers,
              reason: "all_numbers_excluded",
            },
          });
          winningNumber = chooseWinningNumber({
            bets: betsForDecision,
            rtpConfig,
            historyTotals,
            roundTotal,
          });
        }
      }

      if (
        !Number.isInteger(winningNumber) ||
        winningNumber < 0 ||
        winningNumber > 9
      ) {
        winningNumber = Math.floor(Math.random() * 10);
      }

      let totalWinPaid = 0;
      let settledRoundTotal = roundTotal;
      let lastError = null;

      for (let attempt = 1; attempt <= SETTLEMENT_MAX_RETRIES; attempt += 1) {
        const session = await mongoose.startSession();
        session.startTransaction();
        let retryDelay = 0;
        try {
          const roundDoc = await WheelRound.findOne({
            roundId,
            status: "pending",
          }).session(session);
          if (!roundDoc) {
            throw new Error("Round not found while settling");
          }

          const bets = await Bet.find({ roundId, status: "PENDING" }).session(session);
          let attemptRoundTotal = 0;
          let attemptTotalWinPaid = 0;

          for (const bet of bets) {
            attemptRoundTotal += bet.totalBet || 0;
            const winBetAmount = bet.bets
              .filter((entry) => entry.number === winningNumber)
              .reduce((acc, entry) => acc + entry.amount, 0);
            const winAmount =
              winBetAmount * fixedWinMultiplier;

            bet.winAmount = winAmount;
            bet.status = winAmount > 0 ? "WIN" : "LOSE";
            await bet.save({ session });

            if (winAmount > 0) {
              const user = await User.findById(bet.user).session(session);
              if (user) {
                await creditWallet(
                  user,
                  winAmount,
                  `Round ${roundId} payout`,
                  session
                );
              }
              attemptTotalWinPaid += winAmount;
            }
          }

          roundDoc.resultNumber = winningNumber;
          roundDoc.totalBet = attemptRoundTotal;
          roundDoc.totalWin = attemptTotalWinPaid;
          roundDoc.status = "settled";
          roundDoc.lockedAt = undefined;
          await roundDoc.save({ session });

          await session.commitTransaction();
          totalWinPaid = attemptTotalWinPaid;
          settledRoundTotal = attemptRoundTotal;
          settledSuccessfully = true;
          this.currentRound.status = "settled";
          this.currentRound.lockedAt = undefined;
          break;
        } catch (err) {
          await session.abortTransaction().catch(() => null);
          const retryable = isRetryableSettlementError(err);
          console.error("Settlement transaction attempt failed", {
            roundId,
            attempt,
            maxAttempts: SETTLEMENT_MAX_RETRIES,
            retryable,
            code: err?.code,
            codeName: err?.codeName,
            message: err?.message,
          });
          if (retryable && attempt < SETTLEMENT_MAX_RETRIES) {
            retryDelay = settlementRetryDelayMs(attempt);
          } else {
            lastError = err;
          }
        } finally {
          session.endSession();
        }

        if (retryDelay > 0) {
          await sleep(retryDelay);
        } else {
          break;
        }
      }

      if (!settledSuccessfully) {
        throw lastError || new Error("Round settlement failed");
      }

      await Promise.all([
        RoundResultRule.deleteMany({
          ruleType: "blocked_numbers",
          scope: "round_once",
          roundId,
        }),
        RoundResultRule.deleteMany({
          ruleType: "fixed_result",
          scope: "round_once",
          roundId,
        }),
      ]);

      const resultPayload = {
        roundId,
        result: winningNumber,
        totalBet: settledRoundTotal,
        totalWin: totalWinPaid,
      };

      this.io.emit("round-result", resultPayload);
      this.rtcHub.broadcast("round-result", resultPayload);

      await this.startNewRound();
    } catch (err) {
      if (!settledSuccessfully) {
        await this.releaseRoundSettlementLock(roundId).catch(() => null);
      }
      throw err;
    }
  }
}

export default WheelEngine;
