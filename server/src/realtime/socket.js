import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { jwtSecret } from "../config.js";
import WheelRound from "../models/WheelRound.js";
import Bet from "../models/Bet.js";
import User from "../models/User.js";
import { debitWallet, creditWallet } from "../services/walletService.js";

const buildOpenRoundQuery = (now = new Date()) => ({
  status: "pending",
  endTime: { $gt: now },
  $or: [{ lockedAt: { $exists: false } }, { lockedAt: null }],
});

const buildOpenRoundByIdQuery = (roundId, now = new Date()) => ({
  roundId,
  ...buildOpenRoundQuery(now),
});

const setupSocket = (io, wheelEngine) => {
  io.on("connection", (socket) => {
    socket.emit("connected", { socketId: socket.id });

    socket.on("authenticate", (token) => {
      try {
        const decoded = jwt.verify(token, jwtSecret);
        socket.data.userId = decoded.id;
      } catch (err) {
        socket.emit("auth-error", { message: "Invalid token" });
      }
    });

    socket.on("join-rtc", () => {
      const peers = Array.from(io.sockets.sockets.keys()).filter(
        (id) => id !== socket.id
      );
      socket.emit("rtc-peers", peers);
      socket.broadcast.emit("rtc-peer-joined", { peerId: socket.id });
    });

    socket.on("webrtc-offer", ({ target, offer }) => {
      io.to(target).emit("webrtc-offer", { from: socket.id, offer });
    });

    socket.on("webrtc-answer", ({ target, answer }) => {
      io.to(target).emit("webrtc-answer", { from: socket.id, answer });
    });

    socket.on("webrtc-ice-candidate", ({ target, candidate }) => {
      io.to(target).emit("webrtc-ice-candidate", {
        from: socket.id,
        candidate,
      });
    });

    const sendAck = (ack, payload) => {
      if (typeof ack === "function") {
        ack(payload);
      }
    };

    const getActiveRound = async () => {
      const round = await WheelRound.findOne(buildOpenRoundQuery()).sort({
        createdAt: -1,
      });
      if (!round) {
        return { error: "Round closed" };
      }
      return { round };
    };

    socket.on("bet:place", async (payload, ack) => {
      if (!socket.data.userId) {
        sendAck(ack, { ok: false, message: "Unauthorized" });
        return;
      }
      try {
        const bets = payload?.bets;
        if (!Array.isArray(bets) || !bets.length) {
          sendAck(ack, { ok: false, message: "Provide bets array" });
          return;
        }

        const { round, error } = await getActiveRound();
        if (error) {
          sendAck(ack, { ok: false, message: error });
          return;
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
            sendAck(ack, { ok: false, message: "Invalid bet data" });
            return;
          }
        }

        const totalBet = cleanedBets.reduce((acc, b) => acc + b.amount, 0);
        if (totalBet <= 0) {
          sendAck(ack, { ok: false, message: "Bet amount must be positive" });
          return;
        }

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
          const freshUser = await User.findById(socket.data.userId).session(
            session
          );
          if (!freshUser) {
            throw new Error("User not found");
          }

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
          sendAck(ack, {
            ok: true,
            data: {
              walletBalance: freshUser.walletBalance,
              roundId: round.roundId,
            },
          });
        } catch (err) {
          await session.abortTransaction();
          sendAck(ack, { ok: false, message: err.message });
        } finally {
          session.endSession();
        }
      } catch (err) {
        sendAck(ack, { ok: false, message: err.message });
      }
    });

    socket.on("bet:undo", async (_payload, ack) => {
      if (!socket.data.userId) {
        sendAck(ack, { ok: false, message: "Unauthorized" });
        return;
      }
      try {
        const { round, error } = await getActiveRound();
        if (error) {
          sendAck(ack, { ok: false, message: error });
          return;
        }

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
          const bet = await Bet.findOne({
            user: socket.data.userId,
            roundId: round.roundId,
            status: "PENDING",
          })
            .sort({ createdAt: -1 })
            .session(session);
          if (!bet) {
            throw new Error("No bet to undo");
          }

          const freshUser = await User.findById(socket.data.userId).session(
            session
          );
          if (!freshUser) {
            throw new Error("User not found");
          }

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
          sendAck(ack, {
            ok: true,
            data: {
              walletBalance: freshUser.walletBalance,
              removedBet: { bets: bet.bets, totalBet: bet.totalBet },
            },
          });
        } catch (err) {
          await session.abortTransaction();
          sendAck(ack, { ok: false, message: err.message });
        } finally {
          session.endSession();
        }
      } catch (err) {
        sendAck(ack, { ok: false, message: err.message });
      }
    });

    socket.on("bet:clear", async (_payload, ack) => {
      if (!socket.data.userId) {
        sendAck(ack, { ok: false, message: "Unauthorized" });
        return;
      }
      try {
        const { round, error } = await getActiveRound();
        if (error) {
          sendAck(ack, { ok: false, message: error });
          return;
        }

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
          const bets = await Bet.find({
            user: socket.data.userId,
            roundId: round.roundId,
            status: "PENDING",
          }).session(session);
          if (!bets.length) {
            throw new Error("No bets to clear");
          }

          const totalRefund = bets.reduce(
            (sum, bet) => sum + (bet.totalBet || 0),
            0
          );

          const freshUser = await User.findById(socket.data.userId).session(
            session
          );
          if (!freshUser) {
            throw new Error("User not found");
          }

          await creditWallet(
            freshUser,
            totalRefund,
            `Clear bets for round ${round.roundId}`,
            session
          );

          await Bet.deleteMany({
            user: socket.data.userId,
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
          sendAck(ack, {
            ok: true,
            data: { walletBalance: freshUser.walletBalance },
          });
        } catch (err) {
          await session.abortTransaction();
          sendAck(ack, { ok: false, message: err.message });
        } finally {
          session.endSession();
        }
      } catch (err) {
        sendAck(ack, { ok: false, message: err.message });
      }
    });

    socket.on("disconnect", () => {
      socket.broadcast.emit("rtc-peer-left", { peerId: socket.id });
    });

    if (wheelEngine && wheelEngine.currentRound) {
      const payload =
        typeof wheelEngine.buildRoundStatePayload === "function"
          ? wheelEngine.buildRoundStatePayload(wheelEngine.currentRound)
          : {
              roundId: wheelEngine.currentRound.roundId,
              startTime: wheelEngine.currentRound.startTime,
              endTime: wheelEngine.currentRound.endTime,
            };
      socket.emit("round-start", payload);
      if (payload?.phase === "spinning") {
        socket.emit("round-spin-start", payload);
      }
    }
  });
};

export default setupSocket;
