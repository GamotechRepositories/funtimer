/* eslint-disable @next/next/no-img-element */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useEffect, useRef, useState } from "react";
import SimplePeer from "simple-peer";
import io, { Socket } from "socket.io-client";
import {
  type ContinuousSpinState,
  type FinalSettleState,
  isFinalSettleComplete,
  rotationAtContinuousSpin,
  rotationAtFinalSettle,
  rotationModMatchesResult,
  snapRotationToResult,
} from "../../lib/wheelRotation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
const SOCKET_URL = API_BASE.replace(/\/api$/, "");
const DEFAULT_SPIN_MS = 5000;
const FINAL_SETTLE_FALLBACK_SPEED = 520;
const MIN_FINAL_SETTLE_MS = 850;
const FREE_SPIN_DEGREES_PER_SECOND = 540;
const WHEEL_NUMBER_RADIUS = 35;
const NUMBER_TILE_CLASSES = [
  "bg-gradient-to-b from-neutral-700 to-black text-white",
  "bg-gradient-to-b from-slate-50 to-slate-300 text-slate-900",
  "bg-gradient-to-b from-red-400 to-red-800 text-white",
  "bg-gradient-to-b from-amber-200 to-amber-700 text-slate-900",
  "bg-gradient-to-b from-blue-300 to-blue-800 text-white",
  "bg-gradient-to-b from-violet-300 to-violet-800 text-white",
  "bg-gradient-to-b from-emerald-300 to-emerald-800 text-white",
  "bg-gradient-to-b from-cyan-200 to-cyan-700 text-slate-900",
  "bg-gradient-to-b from-lime-200 to-lime-700 text-slate-900",
  "bg-gradient-to-b from-orange-200 to-orange-700 text-slate-900",
];

type SyncMessage = { event: string; payload: any; ts?: number };
type WheelMotionEase = "linear";

export default function WheelPage() {
  const [token, setToken] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [status, setStatus] = useState("");
  const [currentRound, setCurrentRound] = useState<any>(null);
  const [countdown, setCountdown] = useState(90);
  const [history, setHistory] = useState<{ roundId: string; result: number }[]>([]);
  const [spinRotation, setSpinRotation] = useState(0);
  const [wheelTransitionMs, setWheelTransitionMs] = useState(0);
  const [wheelTransitionTiming, setWheelTransitionTiming] = useState("linear");
  const [isSpinning, setIsSpinning] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [highlightNumber, setHighlightNumber] = useState<number | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef(token);
  const peersRef = useRef<Map<string, any>>(new Map());
  const initialWheelAlignedRef = useRef(false);
  const resultTimerRef = useRef<NodeJS.Timeout | null>(null);
  const spinEndRef = useRef<number | null>(null);
  const spinRevealDoneRef = useRef(false);
  const spinAudioRef = useRef<HTMLAudioElement | null>(null);
  const rotationRef = useRef(0);
  const angularVelocityRef = useRef(FREE_SPIN_DEGREES_PER_SECOND / 1000);
  const wheelMotionRef = useRef({
    from: 0,
    to: 0,
    startedAt: 0,
    durationMs: 0,
    easing: "linear" as WheelMotionEase,
  });
  const wheelMotionFrameRef = useRef<number | null>(null);
  const spinLoopFrameRef = useRef<number | null>(null);
  const finalSettleFrameRef = useRef<number | null>(null);
  const activeSpinRoundIdRef = useRef<string | null>(null);
  const roundStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const continuousSpinRef = useRef<ContinuousSpinState | null>(null);
  const finalSettleRef = useRef<FinalSettleState | null>(null);
  const pendingRevealRef = useRef<{
    revealAtMs: number;
    targetRotation: number;
    onReveal: () => void;
  } | null>(null);
  const highlightNumberRef = useRef<number | null>(null);
  const isSpinningRef = useRef(false);

  const commitWheelRotation = (nextRotation: number) => {
    rotationRef.current = nextRotation;
    setSpinRotation(nextRotation);
  };

  const stopContinuousSpinLoop = () => {
    if (continuousSpinRef.current) {
      commitWheelRotation(
        rotationAtContinuousSpin(continuousSpinRef.current)
      );
      continuousSpinRef.current = null;
    }
    if (spinLoopFrameRef.current !== null) {
      cancelAnimationFrame(spinLoopFrameRef.current);
      spinLoopFrameRef.current = null;
    }
  };

  const stopFinalSettleLoop = () => {
    if (finalSettleRef.current) {
      const settled = rotationAtFinalSettle(finalSettleRef.current);
      commitWheelRotation(settled);
      if (isFinalSettleComplete(finalSettleRef.current)) {
        finalSettleRef.current = null;
      }
    }
    if (finalSettleFrameRef.current !== null) {
      cancelAnimationFrame(finalSettleFrameRef.current);
      finalSettleFrameRef.current = null;
    }
  };

  const getSpinAudio = () => {
    if (!spinAudioRef.current) {
      const nextAudio = new Audio("/audio.mp3");
      nextAudio.preload = "auto";
      spinAudioRef.current = nextAudio;
    }
    return spinAudioRef.current;
  };

  const stopSpinAudio = () => {
    if (!spinAudioRef.current) return;
    spinAudioRef.current.pause();
    spinAudioRef.current.currentTime = 0;
  };

  const alignSpinAudioToRemainingTime = (
    audio: HTMLAudioElement,
    remainingSpinMs: number
  ) => {
    const clampedRemainingMs = Math.max(
      0,
      Math.min(DEFAULT_SPIN_MS, remainingSpinMs)
    );
    const progress = 1 - clampedRemainingMs / DEFAULT_SPIN_MS;

    const applySeek = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const seekTime = Math.min(
        audio.duration * progress,
        Math.max(0, audio.duration - 0.05)
      );
      audio.currentTime = Math.max(0, seekTime);
    };

    if (audio.readyState >= 1 && Number.isFinite(audio.duration)) {
      applySeek();
      return;
    }

    const handleLoadedMetadata = () => {
      applySeek();
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata, {
      once: true,
    });
  };

  const getCurrentWheelRotation = () => {
    if (finalSettleRef.current) {
      return rotationAtFinalSettle(finalSettleRef.current);
    }
    if (continuousSpinRef.current) {
      return rotationAtContinuousSpin(continuousSpinRef.current);
    }
    const motion = wheelMotionRef.current;
    if (!motion.durationMs || motion.durationMs <= 0) {
      return motion.to;
    }

    const elapsed = Date.now() - motion.startedAt;
    if (elapsed <= 0) {
      return motion.from;
    }
    if (elapsed >= motion.durationMs) {
      return motion.to;
    }
    const progress = elapsed / motion.durationMs;
    return motion.from + (motion.to - motion.from) * Math.min(1, Math.max(0, progress));
  };

  const applyPendingRevealIfDue = () => {
    const pending = pendingRevealRef.current;
    if (!pending || Date.now() < pending.revealAtMs) return;

    stopFinalSettleLoop();
    stopContinuousSpinLoop();
    finalSettleRef.current = null;
    continuousSpinRef.current = null;
    commitWheelRotation(pending.targetRotation);
    wheelMotionRef.current = {
      from: pending.targetRotation,
      to: pending.targetRotation,
      startedAt: Date.now(),
      durationMs: 0,
      easing: "linear",
    };
    pending.onReveal();
    pendingRevealRef.current = null;
  };

  const syncWheelFromClock = () => {
    const nextRotation = getCurrentWheelRotation();
    commitWheelRotation(nextRotation);
    applyPendingRevealIfDue();

    const highlighted = highlightNumberRef.current;
    if (
      highlighted !== null &&
      !isSpinningRef.current &&
      !pendingRevealRef.current &&
      !rotationModMatchesResult(nextRotation, highlighted)
    ) {
      const snapped = snapRotationToResult(nextRotation, highlighted);
      commitWheelRotation(snapped);
      wheelMotionRef.current = {
        from: snapped,
        to: snapped,
        startedAt: Date.now(),
        durationMs: 0,
        easing: "linear",
      };
    }
  };

  const startContinuousSpinLoop = () => {
    stopContinuousSpinLoop();
    stopFinalSettleLoop();
    finalSettleRef.current = null;
    if (wheelMotionFrameRef.current !== null) {
      cancelAnimationFrame(wheelMotionFrameRef.current);
      wheelMotionFrameRef.current = null;
    }
    setWheelTransitionMs(0);
    setWheelTransitionTiming("linear");

    const startRotation = getCurrentWheelRotation();
    continuousSpinRef.current = {
      startMs: Date.now(),
      startRotation,
      degPerMs: FREE_SPIN_DEGREES_PER_SECOND / 1000,
    };
    angularVelocityRef.current = FREE_SPIN_DEGREES_PER_SECOND / 1000;

    const tick = () => {
      if (!continuousSpinRef.current) return;
      commitWheelRotation(
        rotationAtContinuousSpin(continuousSpinRef.current)
      );
      spinLoopFrameRef.current = requestAnimationFrame(tick);
    };

    spinLoopFrameRef.current = requestAnimationFrame(tick);
  };

  const startFinalSettleLoop = (distanceDeg: number) => {
    stopContinuousSpinLoop();
    stopFinalSettleLoop();
    continuousSpinRef.current = null;
    if (wheelMotionFrameRef.current !== null) {
      cancelAnimationFrame(wheelMotionFrameRef.current);
      wheelMotionFrameRef.current = null;
    }

    const fromRotation = getCurrentWheelRotation();
    let safeDistance = Math.max(0, distanceDeg);
    const startVelocity = Math.max(
      angularVelocityRef.current,
      FINAL_SETTLE_FALLBACK_SPEED / 1000
    );

    if (safeDistance <= 0.0001) {
      commitWheelRotation(fromRotation);
      angularVelocityRef.current = 0;
      return { durationMs: 0, targetRotation: fromRotation };
    }

    const minDistanceForSmoothStop = (startVelocity * MIN_FINAL_SETTLE_MS) / 2;
    while (safeDistance < minDistanceForSmoothStop) {
      safeDistance += 360;
    }

    const durationMs = Math.max(
      MIN_FINAL_SETTLE_MS,
      (2 * safeDistance) / startVelocity
    );
    const acceleration = -(startVelocity * startVelocity) / (2 * safeDistance);

    finalSettleRef.current = {
      startMs: Date.now(),
      fromRotation,
      distance: safeDistance,
      durationMs,
      startVelocity,
      acceleration,
    };

    setWheelTransitionMs(0);
    setWheelTransitionTiming("linear");

    const tick = () => {
      if (!finalSettleRef.current) return;
      const state = finalSettleRef.current;
      commitWheelRotation(rotationAtFinalSettle(state));
      if (isFinalSettleComplete(state)) {
        angularVelocityRef.current = 0;
        finalSettleFrameRef.current = null;
        return;
      }
      angularVelocityRef.current = Math.max(
        0,
        state.startVelocity +
          state.acceleration * Math.max(0, Date.now() - state.startMs)
      );
      finalSettleFrameRef.current = requestAnimationFrame(tick);
    };

    finalSettleFrameRef.current = requestAnimationFrame(tick);
    return { durationMs, targetRotation: fromRotation + safeDistance };
  };

  const startSpinWindow = (payload: any) => {
    const roundId =
      typeof payload?.roundId === "string" && payload.roundId
        ? payload.roundId
        : currentRound?.roundId;
    if (!roundId) return;

    const settlementRemainingMs = Number(payload?.settlementRemainingMs);
    const spinMs = Number.isFinite(settlementRemainingMs)
      ? Math.max(600, Math.round(settlementRemainingMs))
      : DEFAULT_SPIN_MS;

    if (
      activeSpinRoundIdRef.current === roundId &&
      spinEndRef.current &&
      spinEndRef.current > Date.now()
    ) {
      setCountdown(0);
      return;
    }

    activeSpinRoundIdRef.current = roundId;
    spinRevealDoneRef.current = false;
    setCountdown(0);
    setHighlightNumber(null);
    setIsSpinning(true);
    spinEndRef.current = Date.now() + spinMs;

    rotationRef.current = getCurrentWheelRotation();
    setSpinRotation(rotationRef.current);
    startContinuousSpinLoop();

    const audio = getSpinAudio();
    audio.muted = !soundOn;
    audio.pause();
    alignSpinAudioToRemainingTime(audio, spinMs);
    audio.play().catch(() => {
      // autoplay can fail until the user interacts with the page
    });
  };

  const handleSyncEvent = (msg: SyncMessage) => {
    const applyRoundStart = (payload: any) => {
      setCurrentRound(payload);
      const remainingMs = Number(payload?.remainingMs);
      const nextCountdownSeconds = Number.isFinite(remainingMs)
        ? Math.max(0, Math.floor(remainingMs / 1000))
        : Math.max(
            0,
            Math.floor((new Date(payload.endTime).getTime() - Date.now()) / 1000)
          );
      setCountdown(nextCountdownSeconds);
      if (payload?.phase !== "spinning") {
        activeSpinRoundIdRef.current = null;
        spinEndRef.current = null;
        stopContinuousSpinLoop();
        stopFinalSettleLoop();
        setIsSpinning(false);
        stopSpinAudio();
      }
      if (payload?.phase === "spinning") {
        startSpinWindow(payload);
      }
    };

    if (msg.event === "round-start") {
      if (roundStartTimeoutRef.current) {
        clearTimeout(roundStartTimeoutRef.current);
        roundStartTimeoutRef.current = null;
      }
      const now = Date.now();
      const remainingSpinMs =
        spinEndRef.current && spinEndRef.current > now ? spinEndRef.current - now : 0;
      const delay = remainingSpinMs > 0 ? remainingSpinMs + 250 : 0;
      if (delay > 0) {
        roundStartTimeoutRef.current = setTimeout(() => {
          applyRoundStart(msg.payload);
          roundStartTimeoutRef.current = null;
        }, delay);
      } else {
        applyRoundStart(msg.payload);
      }
    }

    if (msg.event === "round-countdown") {
      setCountdown(Math.max(0, Math.floor((msg.payload.remainingMs || 0) / 1000)));
      if (msg.payload?.phase === "spinning") {
        startSpinWindow(msg.payload);
      }
    }

    if (msg.event === "round-spin-start") {
      startSpinWindow(msg.payload);
    }

    if (msg.event === "round-result") {
      setHighlightNumber(null);
      setIsSpinning(true);
      if (activeSpinRoundIdRef.current !== msg.payload.roundId) {
        startSpinWindow({
          roundId: msg.payload.roundId,
          settlementRemainingMs: DEFAULT_SPIN_MS,
        });
      }
      spinRevealDoneRef.current = false;

      const currentRotation = getCurrentWheelRotation();
      const currentMod = ((currentRotation % 360) + 360) % 360;
      let neededDelta = -(msg.payload.result * 36) - currentMod;
      while (neededDelta <= 0) {
        neededDelta += 360;
      }
      const { durationMs: finalSettleMs, targetRotation } =
        startFinalSettleLoop(neededDelta);
      spinEndRef.current = Date.now() + finalSettleMs;

      if (resultTimerRef.current) {
        clearTimeout(resultTimerRef.current);
      }

      const revealResult = () => {
        if (spinRevealDoneRef.current) return;
        spinRevealDoneRef.current = true;
        stopFinalSettleLoop();
        stopContinuousSpinLoop();
        finalSettleRef.current = null;
        continuousSpinRef.current = null;
        pendingRevealRef.current = null;
        commitWheelRotation(targetRotation);
        wheelMotionRef.current = {
          from: targetRotation,
          to: targetRotation,
          startedAt: Date.now(),
          durationMs: 0,
          easing: "linear",
        };
        setIsSpinning(false);
        setHighlightNumber(msg.payload.result);
        setHistory((prev) =>
          [
            { roundId: msg.payload.roundId, result: msg.payload.result },
            ...prev.filter((entry) => entry.roundId !== msg.payload.roundId),
          ].slice(0, 10)
        );
        activeSpinRoundIdRef.current = null;
        spinEndRef.current = null;
        stopSpinAudio();
        if (tokenRef.current) {
          loadResults(tokenRef.current);
        }
        if (resultTimerRef.current) {
          clearTimeout(resultTimerRef.current);
          resultTimerRef.current = null;
        }
      };

      pendingRevealRef.current = {
        revealAtMs: Date.now() + finalSettleMs,
        targetRotation,
        onReveal: revealResult,
      };

      resultTimerRef.current = setTimeout(() => {
        applyPendingRevealIfDue();
      }, finalSettleMs);
    }
  };

  const broadcastToPeers = (msg: SyncMessage) => {
    peersRef.current.forEach((peer) => {
      if (peer.connected) {
        peer.send(JSON.stringify(msg));
      }
    });
  };

  const setupWebRTC = (socket: Socket) => {
    const createPeer = (peerId: string, initiator: boolean) => {
      if (peersRef.current.has(peerId)) return;
      const peer = new SimplePeer({ initiator, trickle: true });
      peer.on("signal", (data: any) => {
        if ("type" in data && data.type === "offer") {
          socket.emit("webrtc-offer", { target: peerId, offer: data });
        } else if ("type" in data && data.type === "answer") {
          socket.emit("webrtc-answer", { target: peerId, answer: data });
        } else {
          socket.emit("webrtc-ice-candidate", {
            target: peerId,
            candidate: data,
          });
        }
      });
      peer.on("data", (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          handleSyncEvent(msg);
        } catch {
          // ignore invalid rtc payloads
        }
      });
      peer.on("error", () => peersRef.current.delete(peerId));
      peer.on("close", () => peersRef.current.delete(peerId));
      peersRef.current.set(peerId, peer);
      return peer;
    };

    socket.on("rtc-peers", (peerIds: string[]) => {
      peerIds.forEach((id) => createPeer(id, true));
    });
    socket.on("rtc-peer-joined", ({ peerId }) => createPeer(peerId, true));
    socket.on("rtc-peer-left", ({ peerId }) => {
      const peer = peersRef.current.get(peerId);
      if (peer) peer.destroy();
      peersRef.current.delete(peerId);
    });
    socket.on("webrtc-offer", ({ from, offer }) => {
      const peer = peersRef.current.get(from) || createPeer(from, false);
      const targetPeer = peersRef.current.get(from) || peer;
      targetPeer?.signal(offer);
    });
    socket.on("webrtc-answer", ({ from, answer }) => {
      const peer = peersRef.current.get(from);
      peer?.signal(answer);
    });
    socket.on("webrtc-ice-candidate", ({ from, candidate }) => {
      const peer = peersRef.current.get(from);
      peer?.signal(candidate);
    });
  };

  const handleAuthExpired = () => {
    localStorage.removeItem("player-token");
    localStorage.removeItem("player-email");
    sessionStorage.setItem(
      "auth-expired-message",
      "Session expired. Please log in again."
    );
    socketRef.current?.disconnect();
    setToken("");
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  const connectSocket = (authToken: string) => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      peersRef.current.forEach((peer) => peer.destroy());
      peersRef.current.clear();
    }
    const socket = io(SOCKET_URL, { transports: ["websocket"] });
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("authenticate", authToken);
      socket.emit("join-rtc");
      loadResults(authToken);
    });
    socket.on("auth-error", () => {
      handleAuthExpired();
    });
    socket.on("round-start", (payload) => {
      const msg = { event: "round-start", payload, ts: Date.now() };
      handleSyncEvent(msg);
      broadcastToPeers(msg);
    });
    socket.on("round-countdown", (payload) => {
      const msg = { event: "round-countdown", payload, ts: Date.now() };
      handleSyncEvent(msg);
      broadcastToPeers(msg);
    });
    socket.on("round-spin-start", (payload) => {
      const msg = { event: "round-spin-start", payload, ts: Date.now() };
      handleSyncEvent(msg);
      broadcastToPeers(msg);
    });
    socket.on("round-result", (payload) => {
      const msg = { event: "round-result", payload, ts: Date.now() };
      handleSyncEvent(msg);
      broadcastToPeers(msg);
    });
    socket.on("rtc-relay", (msg: SyncMessage) => {
      handleSyncEvent(msg);
      broadcastToPeers(msg);
    });
    setupWebRTC(socket);
  };

  const apiFetch = async (authToken: string, path: string) => {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
    });
    if (res.status === 401) {
      handleAuthExpired();
      throw new Error("Session expired. Please log in again.");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || "Request failed");
    }
    return res.json();
  };

  const loadRound = async (authToken: string) => {
    try {
      const data = await apiFetch(authToken, "/player/current-round");
      setCurrentRound(data);
      setCountdown(Math.floor(data.remainingMs / 1000));
      if (data?.phase === "spinning") {
        startSpinWindow(data);
      }
    } catch (err: any) {
      setStatus(err.message || "Failed to load round");
    }
  };

  const loadResults = async (authToken: string) => {
    try {
      const data = await apiFetch(authToken, "/player/results");
      setHistory(
        data.slice(0, 10).map((r: any) => ({
          roundId: r.roundId,
          result: r.resultNumber,
        }))
      );
      if (data.length) {
        const latestResult = data[0].resultNumber;
        if (!initialWheelAlignedRef.current) {
          const alignedRotation = -(latestResult * 36);
          setSpinRotation(alignedRotation);
          rotationRef.current = alignedRotation;
          wheelMotionRef.current = {
            from: alignedRotation,
            to: alignedRotation,
            startedAt: Date.now(),
            durationMs: 0,
            easing: "linear",
          };
          initialWheelAlignedRef.current = true;
        }
        if (!isSpinning) {
          setHighlightNumber(latestResult);
        }
      }
    } catch (err: any) {
      setStatus(err.message || "Failed to load results");
    }
  };

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    highlightNumberRef.current = highlightNumber;
  }, [highlightNumber]);

  useEffect(() => {
    isSpinningRef.current = isSpinning;
  }, [isSpinning]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) return;
      syncWheelFromClock();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", syncWheelFromClock);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", syncWheelFromClock);
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("player-token");
    if (saved) {
      setToken(saved);
    }
    setAuthReady(true);
  }, []);

  useEffect(() => {
    const audio = new Audio("/audio.mp3");
    audio.preload = "auto";
    audio.load();
    spinAudioRef.current = audio;
    return () => {
      audio.pause();
    };
  }, []);

  useEffect(() => {
    if (spinAudioRef.current) {
      spinAudioRef.current.muted = !soundOn;
    }
    if (!soundOn && spinAudioRef.current) {
      spinAudioRef.current.pause();
      spinAudioRef.current.currentTime = 0;
    }
  }, [soundOn]);

  useEffect(() => {
    if (!token) return;
    connectSocket(token);
    loadRound(token);
    loadResults(token);

    return () => {
      socketRef.current?.disconnect();
      peersRef.current.forEach((peer) => peer.destroy());
      peersRef.current.clear();
      stopContinuousSpinLoop();
      stopFinalSettleLoop();
      stopSpinAudio();
      if (resultTimerRef.current) {
        clearTimeout(resultTimerRef.current);
        resultTimerRef.current = null;
      }
      if (roundStartTimeoutRef.current) {
        clearTimeout(roundStartTimeoutRef.current);
        roundStartTimeoutRef.current = null;
      }
      if (wheelMotionFrameRef.current !== null) {
        cancelAnimationFrame(wheelMotionFrameRef.current);
        wheelMotionFrameRef.current = null;
      }
    };
  }, [token]);

  const countdownLabel = String(Math.max(0, Math.floor(countdown)));
  const centerResultNumber =
    !isSpinning && highlightNumber !== null ? highlightNumber : null;
  const recentHistory = history.slice(-10).reverse();
  const historyCellClass = (n: number) =>
    NUMBER_TILE_CLASSES[n] || NUMBER_TILE_CLASSES[0];

  const pageBackground = (
    <div className="absolute inset-0 -z-10">
      <div
        className="absolute inset-0 scale-[1.14]"
        style={{
          backgroundImage:
            "url('/casinoImg.jpg'), radial-gradient(circle at 15% 25%, rgba(255,180,120,0.65), transparent 42%), radial-gradient(circle at 70% 10%, rgba(160,120,255,0.65), transparent 46%), radial-gradient(circle at 85% 70%, rgba(60,210,255,0.38), transparent 48%), radial-gradient(circle at 10% 90%, rgba(255,110,110,0.48), transparent 46%), linear-gradient(130deg, #5b2572 0%, #7a2b8f 32%, #aa3b72 62%, #6a2450 100%)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(28px) brightness(1.24) saturate(1.18)",
        }}
      />
      <div className="absolute inset-0 bg-black/15" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.12),transparent_58%)]" />
    </div>
  );

  if (!authReady) {
    return (
      <div className="relative min-h-[100dvh] overflow-hidden text-white">
        {pageBackground}
        <div className="flex min-h-[100dvh] items-center justify-center px-6">
          <p className="text-sm font-semibold text-white/60">Loading wheel...</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="relative min-h-[100dvh] overflow-hidden text-white">
        {pageBackground}
        <div className="flex min-h-[100dvh] items-center justify-center px-6">
          <div className="rounded-3xl border border-white/15 bg-black/35 px-6 py-5 text-center shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-md">
            <p className="text-sm font-semibold text-white/85">
              Login on the home page to sync this wheel view.
            </p>
            <a
              href="/"
              className="mt-4 inline-block rounded-xl bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 px-4 py-2 text-sm font-semibold text-slate-900"
            >
              Go to Login
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden text-white">
      {pageBackground}

      <div className="absolute right-4 top-4 z-50 sm:right-6 sm:top-6">
        <button
          type="button"
          onClick={() =>
            setSoundOn((prev) => {
              const next = !prev;
              const audio = spinAudioRef.current;
              if (audio) {
                audio.muted = !next;
                if (!next) {
                  audio.pause();
                  audio.currentTime = 0;
                } else if (spinEndRef.current && spinEndRef.current > Date.now()) {
                  audio.play().catch(() => {});
                }
              }
              return next;
            })
          }
          className={`h-10 w-10 rounded-full border backdrop-blur-sm transition ${
            soundOn
              ? "border-emerald-300/60 bg-emerald-500/10 text-emerald-200"
              : "border-white/20 bg-white/5 text-pink-100/70 hover:bg-white/10"
          }`}
          aria-label={soundOn ? "Mute wheel sound" : "Unmute wheel sound"}
          title={soundOn ? "Sound on" : "Sound off"}
        >
          {soundOn ? (
            <svg
              viewBox="0 0 24 24"
              className="mx-auto h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 10h4l5-4v12l-5-4H3z" />
              <path d="M16 8c1.5 1.5 1.5 6 0 7.5" />
              <path d="M19 5c3 3 3 11 0 14" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="mx-auto h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 10h4l5-4v12l-5-4H3z" />
              <path d="M16 9l5 5" />
              <path d="M21 9l-5 5" />
            </svg>
          )}
        </button>
      </div>

      <div className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-6">
        <div className="flex w-full max-w-[min(100%,720px)] flex-col items-center gap-4 sm:gap-6 md:gap-8">
          <div className="flex w-full flex-col items-center">
            <div className="relative w-[min(92vw,calc(100dvh-17rem),620px)] max-w-full aspect-square">
              <div
                className="absolute inset-[13%] overflow-hidden rounded-full shadow-[0_26px_70px_rgba(0,0,0,0.55)]"
                style={{
                  transform: `rotate(${spinRotation}deg)`,
                  transition: `transform ${wheelTransitionMs}ms ${wheelTransitionTiming}`,
                  transformOrigin: "50% 50%",
                  background:
                    "radial-gradient(circle at 50% 45%, #0b5e1c 0%, #0a6f1f 42%, #14ae34 76%, #0d8f28 100%)",
                }}
              >
                <div
                  className="absolute inset-0 opacity-85"
                  style={{
                    background:
                      "repeating-conic-gradient(from -90deg, rgba(0,0,0,0.12) 0deg 1.5deg, transparent 1.5deg 36deg), repeating-conic-gradient(from -90deg, #1bb240 0deg 18deg, #13972f 18deg 36deg)",
                  }}
                />
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      "repeating-conic-gradient(from -90deg, transparent 0deg 35deg, rgba(0,0,0,0.3) 35deg 36deg)",
                    mixBlendMode: "multiply",
                  }}
                />
                <div
                  className="absolute inset-[6%] rounded-full pointer-events-none"
                  style={{
                    boxShadow:
                      "inset 0 0 30px rgba(0,0,0,0.28), 0 0 14px rgba(0,0,0,0.25)",
                  }}
                />
                <div className="absolute inset-0 pointer-events-none">
                  {[...Array(10).keys()].map((n) => {
                    const angleDeg = n * 36;
                    const isHit = highlightNumber === n;
                    const angleRad = (angleDeg * Math.PI) / 180;
                    const radiusPercent = WHEEL_NUMBER_RADIUS;
                    const leftPercent = 50 + radiusPercent * Math.sin(angleRad);
                    const topPercent = 50 - radiusPercent * Math.cos(angleRad);
                    return (
                      <div
                        key={n}
                        className="absolute"
                        style={{
                          left: `${leftPercent}%`,
                          top: `${topPercent}%`,
                          transform: `translate(-50%, -50%) rotate(${-spinRotation}deg)`,
                        }}
                      >
                        <span
                          className={`block text-[clamp(0.95rem,4.8vmin,2.75rem)] font-black leading-none drop-shadow-[0_6px_12px_rgba(0,0,0,0.6)] transition-transform ${
                            isHit ? "text-yellow-200 scale-110" : "text-white"
                          }`}
                          style={{
                            textShadow: isHit
                              ? "0 0 10px rgba(255,214,10,0.8), 0 0 22px rgba(255,214,10,0.7)"
                              : "0 0 2px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.7)",
                          }}
                        >
                          {n}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <img
                src="/OuterWheelRing.png"
                alt="Wheel frame"
                className="pointer-events-none absolute inset-0 z-30 h-full w-full select-none object-contain drop-shadow-[0_26px_48px_rgba(0,0,0,0.6)]"
              />

              {centerResultNumber !== null && (
                <div
                  className="pointer-events-none absolute left-1/2 top-1/2 z-40 flex h-[24%] w-[24%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-amber-200/90 shadow-[0_14px_30px_rgba(0,0,0,0.55)]"
                  style={{
                    background:
                      "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.32), rgba(255,230,150,0.18) 55%, rgba(0,0,0,0.45) 100%), linear-gradient(145deg, rgba(255,255,255,0.15), rgba(0,0,0,0.65))",
                    boxShadow:
                      "inset 0 0 20px rgba(0,0,0,0.4), 0 12px 28px rgba(0,0,0,0.65)",
                  }}
                >
                  <span className="text-[clamp(1.5rem,7vmin,3.25rem)] font-black leading-none text-yellow-200 drop-shadow-[0_8px_14px_rgba(0,0,0,0.8)]">
                    {centerResultNumber}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-4 w-full max-w-[min(100%,420px)] sm:mt-5">
              <div className="rounded-2xl border border-amber-200/40 bg-black/45 px-4 py-2.5 shadow-[0_12px_22px_rgba(0,0,0,0.35)] backdrop-blur-sm sm:px-6 sm:py-3">
                <div className="text-[clamp(0.625rem,2.2vw,0.75rem)] font-bold uppercase tracking-[0.28em] text-amber-200/70 text-center">
                  Time Left
                </div>
                <div className="text-[clamp(2rem,10vw,3.75rem)] font-black text-amber-300 drop-shadow-[0_0_12px_rgba(251,191,36,0.55)] text-center leading-none">
                  {countdownLabel}
                </div>
              </div>
            </div>
          </div>

          <div
            className="w-full rounded-2xl border-2 border-amber-200/45 px-2 py-2 sm:px-3 sm:py-2.5"
            style={{
              background:
                "linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0.55))",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.12), 0 14px 24px rgba(0,0,0,0.35)",
            }}
          >
            <div className="overflow-x-auto overflow-y-hidden [touch-action:pan-x] no-scrollbar">
              <div className="flex min-w-full items-center justify-center gap-[clamp(0.25rem,1.2vw,0.625rem)]">
                {recentHistory.map((h, idx) => (
                  <div
                    key={`${h.roundId}-${h.result}-${idx}`}
                    className={`flex aspect-square h-[clamp(2rem,8vw,2.75rem)] min-w-[clamp(2rem,8vw,2.75rem)] flex-none items-center justify-center rounded-md border border-black/30 text-[clamp(1.15rem,4.8vw,2rem)] font-black leading-[0.8] tracking-[-0.08em] shadow-[0_10px_14px_rgba(0,0,0,0.45)] sm:rounded-lg ${historyCellClass(
                      h.result
                    )}`}
                  >
                    {h.result}
                  </div>
                ))}
                {!recentHistory.length && (
                  <div className="px-2 py-1 text-sm font-semibold text-white/70">
                    No previous results yet
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {status && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2">
          <div className="rounded-full border border-amber-300/40 bg-black/70 px-4 py-2 text-center text-sm text-amber-200 shadow-[0_12px_24px_rgba(0,0,0,0.35)] backdrop-blur-sm">
            {status}
          </div>
        </div>
      )}
    </div>
  );
}
