/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @next/next/no-img-element */
/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SimplePeer from "simple-peer";
import io, { Socket } from "socket.io-client";


const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
const SOCKET_URL = API_BASE.replace(/\/api$/, "");
const CHIPS = [10, 50, 100, 500, 1000, 5000, 10000, 25000, 50000];
const DEFAULT_SPIN_MS = 5000;
const FINAL_SETTLE_FALLBACK_SPEED = 520;
const MIN_FINAL_SETTLE_MS = 850;
const FREE_SPIN_DEGREES_PER_SECOND = 540;
const NUMBER_RING_OFFSET = "clamp(58px, 14vw, 106px)";
const CHIP_IMAGES = [
  "/redship.png",
  "/bluechip.png",
  "/greenchip.png",
  "/blackchip.png",
  "/purplechip.png",
  "/yellowchip.png",
  "/orangechip.png",
  "/lightbluechip.png",
  "/pinkchip.png",
];
const NUMBER_TILE_CLASSES = [
  "bg-gradient-to-b from-neutral-700 to-black text-white", // 0
  "bg-gradient-to-b from-slate-50 to-slate-300 text-slate-900", // 1
  "bg-gradient-to-b from-red-400 to-red-800 text-white", // 2
  "bg-gradient-to-b from-amber-200 to-amber-700 text-slate-900", // 3
  "bg-gradient-to-b from-blue-300 to-blue-800 text-white", // 4
  "bg-gradient-to-b from-violet-300 to-violet-800 text-white", // 5
  "bg-gradient-to-b from-emerald-300 to-emerald-800 text-white", // 6
  "bg-gradient-to-b from-cyan-200 to-cyan-700 text-slate-900", // 7
  "bg-gradient-to-b from-lime-200 to-lime-700 text-slate-900", // 8
  "bg-gradient-to-b from-orange-200 to-orange-700 text-slate-900", // 9
];

const NUMBER_BUTTON_THEMES = [
  {
    // 0: Charcoal
    bg: "linear-gradient(180deg, #37373f 0%, #1a1a1f 100%)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    textColor: "#ffffff",
    boxShadow: "inset 0 -6px 0px rgba(0, 0, 0, 0.4), 0 4px 6px rgba(0,0,0,0.3)",
  },
  {
    // 1: Pearl/Silver
    bg: "linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%)",
    border: "1px solid rgba(255, 255, 255, 0.8)",
    textColor: "#0f172a",
    boxShadow: "inset 0 -6px 0px rgba(148, 163, 184, 0.5), 0 4px 6px rgba(0,0,0,0.3)",
  },
  {
    // 2: Crimson Red
    bg: "linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)",
    border: "1px solid rgba(254, 205, 211, 0.4)",
    textColor: "#ffffff",
    boxShadow: "inset 0 -6px 0px rgba(153, 27, 27, 0.6), 0 4px 6px rgba(0,0,0,0.3)",
  },
  {
    // 3: Golden Amber
    bg: "linear-gradient(180deg, #f59e0b 0%, #b45309 100%)",
    border: "1px solid rgba(253, 230, 138, 0.4)",
    textColor: "#0f172a",
    boxShadow: "inset 0 -6px 0px rgba(120, 53, 15, 0.5), 0 4px 6px rgba(0,0,0,0.3)",
  },
  {
    // 4: Electric Blue
    bg: "linear-gradient(180deg, #38bdf8 0%, #0284c7 100%)",
    border: "1px solid rgba(186, 230, 253, 0.4)",
    textColor: "#ffffff",
    boxShadow: "inset 0 -6px 0px rgba(3, 105, 161, 0.6), 0 4px 6px rgba(0,0,0,0.3)",
  },
  {
    // 5: Vivid Purple
    bg: "linear-gradient(180deg, #c084fc 0%, #7e22ce 100%)",
    border: "1px solid rgba(233, 213, 255, 0.4)",
    textColor: "#ffffff",
    boxShadow: "inset 0 -6px 0px rgba(88, 28, 135, 0.6), 0 4px 6px rgba(0,0,0,0.3)",
  },
  {
    // 6: Emerald Green
    bg: "linear-gradient(180deg, #34d399 0%, #059669 100%)",
    border: "1px solid rgba(167, 243, 208, 0.4)",
    textColor: "#ffffff",
    boxShadow: "inset 0 -6px 0px rgba(4, 120, 87, 0.6), 0 4px 6px rgba(0,0,0,0.3)",
  },
  {
    // 7: Bright Cyan
    bg: "linear-gradient(180deg, #22d3ee 0%, #0891b2 100%)",
    border: "1px solid rgba(165, 243, 252, 0.4)",
    textColor: "#0f172a",
    boxShadow: "inset 0 -6px 0px rgba(22, 78, 99, 0.5), 0 4px 6px rgba(0,0,0,0.3)",
  },
  {
    // 8: Fresh Lime Green
    bg: "linear-gradient(180deg, #a3e635 0%, #65a30d 100%)",
    border: "1px solid rgba(217, 249, 157, 0.4)",
    textColor: "#0f172a",
    boxShadow: "inset 0 -6px 0px rgba(77, 124, 15, 0.5), 0 4px 6px rgba(0,0,0,0.3)",
  },
  {
    // 9: Radiant Orange
    bg: "linear-gradient(180deg, #fb923c 0%, #ea580c 100%)",
    border: "1px solid rgba(254, 215, 170, 0.4)",
    textColor: "#ffffff",
    boxShadow: "inset 0 -6px 0px rgba(154, 52, 18, 0.6), 0 4px 6px rgba(0,0,0,0.3)",
  },
];

const formatClock = (input: string | number | Date) =>
  new Date(input).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

type SyncMessage = { event: string; payload: any; ts?: number };
type WheelMotionEase = "linear";
type BetLogEntry = {
  number: number;
  amount: number;
  chipIdx: number;
  actionId: number;
};

const initialBets = () =>
  Array.from({ length: 10 }, (_, number) => ({
    number,
    amount: 0,
    lastChipIdx: 0,
  }));

export default function Game() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<any>(null);
  const [wallet, setWallet] = useState(0);
  const [bets, setBets] = useState(initialBets());
  const [selectedChip, setSelectedChip] = useState(CHIPS[0]);
  const [status, setStatus] = useState("");
  const [currentRound, setCurrentRound] = useState<any>(null);
  const [countdown, setCountdown] = useState(90);
  const [locked, setLocked] = useState(false);
  const [history, setHistory] = useState<{ roundId: string; result: number }[]>(
    []
  );
  const [lastResult, setLastResult] = useState<number | null>(null);
  const [pendingResult, setPendingResult] = useState<{
    number: number;
    roundId: string;
  } | null>(null);
  const [resultOutcome, setResultOutcome] = useState<{
    status: string;
    winAmount: number;
  } | null>(null);
  const [betToast, setBetToast] = useState<string | null>(null);
  const [resultToast, setResultToast] = useState<string | null>(null);
  const resultTimerRef = useRef<NodeJS.Timeout | null>(null);
  const betToastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const resultToastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [spinRotation, setSpinRotation] = useState(0);
  const [wheelTransitionMs, setWheelTransitionMs] = useState(0);
  const [wheelTransitionTiming, setWheelTransitionTiming] = useState("linear");
  const [wheelKey, setWheelKey] = useState(0);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [isSpinning, setIsSpinning] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [copiedGameId, setCopiedGameId] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, any>>(new Map());
  const initialWheelAlignedRef = useRef(false);
  const [highlightNumber, setHighlightNumber] = useState<number | null>(null);
  const [lastPlacedBets, setLastPlacedBets] = useState<BetLogEntry[]>([]);
  const [lastPlacedTotal, setLastPlacedTotal] = useState(0);
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
  const spinLoopStateRef = useRef({
    lastTime: 0,
  });
  const activeSpinRoundIdRef = useRef<string | null>(null);
  const roundStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const betActionIdRef = useRef(0);
  const betQueueRef = useRef(Promise.resolve());

  const activeBets = useMemo(() => bets.filter((b) => b.amount > 0), [bets]);
  const totalBet = useMemo(
    () => bets.reduce((acc, b) => acc + b.amount, 0),
    [bets]
  );

  const apiFetch = useMemo(
    () =>
      async (path: string, options: RequestInit = {}) => {
        if (!token) throw new Error("Missing token");
        const res = await fetch(`${API_BASE}${path}`, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
          },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || "Request failed");
        }
        return res.json();
      },
    [token]
  );

  function emitSocketRequest<T>(event: string, payload?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        reject(new Error("Socket not connected"));
        return;
      }
      socket.emit(event, payload ?? {}, (response: any) => {
        if (!response?.ok) {
          reject(new Error(response?.message || "Request failed"));
          return;
        }
        resolve(response.data as T);
      });
    });
  }

  function queueBetRequest<T>(task: () => Promise<T>): Promise<T> {
    const run = betQueueRef.current.then(task);
    betQueueRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

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

  const getMotionProgress = (easing: WheelMotionEase, t: number) => {
    const progress = Math.min(1, Math.max(0, t));
    return progress;
  };

  const getMotionTiming = (_easing: WheelMotionEase) => "linear";

  const getCurrentWheelRotation = () => {
    if (spinLoopFrameRef.current !== null) {
      return rotationRef.current;
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
    return (
      motion.from +
      (motion.to - motion.from) * getMotionProgress(motion.easing, progress)
    );
  };

  const runWheelMotion = (
    targetRotation: number,
    durationMs: number,
    easing: WheelMotionEase = "linear"
  ) => {
    const fromRotation = getCurrentWheelRotation();
    if (wheelMotionFrameRef.current !== null) {
      cancelAnimationFrame(wheelMotionFrameRef.current);
      wheelMotionFrameRef.current = null;
    }
    if (spinLoopFrameRef.current !== null) {
      cancelAnimationFrame(spinLoopFrameRef.current);
      spinLoopFrameRef.current = null;
    }

    wheelMotionRef.current = {
      from: fromRotation,
      to: fromRotation,
      startedAt: Date.now(),
      durationMs: 0,
      easing: "linear",
    };
    setWheelTransitionMs(0);
    setWheelTransitionTiming("linear");
    setSpinRotation(fromRotation);
    rotationRef.current = fromRotation;

    const safeDurationMs = Math.max(0, Math.round(durationMs));
    if (safeDurationMs === 0) {
      wheelMotionRef.current = {
        from: targetRotation,
        to: targetRotation,
        startedAt: Date.now(),
        durationMs: 0,
        easing,
      };
      setSpinRotation(targetRotation);
      rotationRef.current = targetRotation;
      return;
    }

    wheelMotionFrameRef.current = requestAnimationFrame(() => {
      wheelMotionRef.current = {
        from: fromRotation,
        to: targetRotation,
        startedAt: Date.now(),
        durationMs: safeDurationMs,
        easing,
      };
      setWheelTransitionTiming(getMotionTiming(easing));
      setWheelTransitionMs(safeDurationMs);
      setSpinRotation(targetRotation);
      rotationRef.current = targetRotation;
      wheelMotionFrameRef.current = null;
    });
  };

  const stopContinuousSpinLoop = () => {
    if (spinLoopFrameRef.current !== null) {
      cancelAnimationFrame(spinLoopFrameRef.current);
      spinLoopFrameRef.current = null;
    }
  };

  const stopFinalSettleLoop = () => {
    if (finalSettleFrameRef.current !== null) {
      cancelAnimationFrame(finalSettleFrameRef.current);
      finalSettleFrameRef.current = null;
    }
  };

  const startContinuousSpinLoop = () => {
    stopContinuousSpinLoop();
    stopFinalSettleLoop();
    if (wheelMotionFrameRef.current !== null) {
      cancelAnimationFrame(wheelMotionFrameRef.current);
      wheelMotionFrameRef.current = null;
    }
    setWheelTransitionMs(0);
    setWheelTransitionTiming("linear");

    const now = performance.now();
    spinLoopStateRef.current = {
      lastTime: now,
    };
    angularVelocityRef.current = FREE_SPIN_DEGREES_PER_SECOND / 1000;

    const tick = (ts: number) => {
      const state = spinLoopStateRef.current;
      const delta = Math.max(0, ts - state.lastTime);
      state.lastTime = ts;
      const speed = angularVelocityRef.current;
      const nextRotation = rotationRef.current + speed * delta;

      rotationRef.current = nextRotation;
      setSpinRotation(nextRotation);

      spinLoopFrameRef.current = requestAnimationFrame(tick);
    };

    spinLoopFrameRef.current = requestAnimationFrame(tick);
  };

  const startFinalSettleLoop = (distanceDeg: number) => {
    stopContinuousSpinLoop();
    stopFinalSettleLoop();
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
      rotationRef.current = fromRotation;
      setSpinRotation(fromRotation);
      angularVelocityRef.current = 0;
      return 0;
    }

    const minDistanceForSmoothStop =
      (startVelocity * MIN_FINAL_SETTLE_MS) / 2;
    while (safeDistance < minDistanceForSmoothStop) {
      safeDistance += 360;
    }

    const durationMs = Math.max(MIN_FINAL_SETTLE_MS, (2 * safeDistance) / startVelocity);
    const acceleration = -(startVelocity * startVelocity) / (2 * safeDistance);
    const startedAt = performance.now();

    setWheelTransitionMs(0);
    setWheelTransitionTiming("linear");

    const tick = (ts: number) => {
      const elapsed = Math.max(0, ts - startedAt);
      const clampedElapsed = Math.min(durationMs, elapsed);
      const traveled =
        startVelocity * clampedElapsed +
        0.5 * acceleration * clampedElapsed * clampedElapsed;
      const nextRotation = fromRotation + Math.max(0, Math.min(safeDistance, traveled));

      rotationRef.current = nextRotation;
      setSpinRotation(nextRotation);

      if (clampedElapsed >= durationMs) {
        rotationRef.current = fromRotation + safeDistance;
        setSpinRotation(fromRotation + safeDistance);
        angularVelocityRef.current = 0;
        finalSettleFrameRef.current = null;
        return;
      }

      angularVelocityRef.current = Math.max(
        0,
        startVelocity + acceleration * clampedElapsed
      );
      finalSettleFrameRef.current = requestAnimationFrame(tick);
    };

    finalSettleFrameRef.current = requestAnimationFrame(tick);
    return durationMs;
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
      setLocked(true);
      setCountdown(0);
      return;
    }

    activeSpinRoundIdRef.current = roundId;
    spinRevealDoneRef.current = false;
    setLocked(true);
    setCountdown(0);
    setPendingResult(null);
    setResultOutcome(null);
    setHighlightNumber(null);
    setIsSpinning(true);
    spinEndRef.current = Date.now() + spinMs;

    rotationRef.current = getCurrentWheelRotation();
    setSpinRotation(rotationRef.current);
    startContinuousSpinLoop();

    const audio = getSpinAudio();
    audio.muted = !soundOn;
    audio.pause();
    audio.currentTime = 0;
    audio.play().catch(() => {
      // autoplay might fail; motion still continues
    });
  };

  const betStorageKey = (roundId?: string) =>
    roundId ? `pending-bets:${roundId}` : "";

  const setBetLogSnapshot = (entries: BetLogEntry[]) => {
    const { nextBets, total } = buildBetsFromLog(entries);
    setBets(nextBets);
    setLastPlacedBets(entries);
    setLastPlacedTotal(total);
  };

  const restoreBetLogFromStorage = (roundId?: string) => {
    if (!roundId) return;
    try {
      const raw = localStorage.getItem(betStorageKey(roundId));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setBetLogSnapshot(parsed as BetLogEntry[]);
      }
    } catch {
      // ignore storage errors
    }
  };

  const persistBetLogToStorage = (
    roundId: string | undefined,
    entries: BetLogEntry[]
  ) => {
    if (!roundId) return;
    try {
      localStorage.setItem(betStorageKey(roundId), JSON.stringify(entries));
    } catch {
      // ignore storage errors
    }
  };

  const buildBetsFromLog = (log: BetLogEntry[]) => {
    const nextBets = initialBets();
    log.forEach((entry) => {
      const target = nextBets[entry.number];
      if (!target) return;
      target.amount += entry.amount;
      target.lastChipIdx = entry.chipIdx;
    });
    const total = log.reduce((sum, entry) => sum + entry.amount, 0);
    return { nextBets, total };
  };

  const applyBetLogUpdate = (
    updateFn: (prev: BetLogEntry[]) => BetLogEntry[]
  ) => {
    setLastPlacedBets((prev) => {
      const prevTotal = prev.reduce((sum, entry) => sum + entry.amount, 0);
      const next = updateFn(prev);
      const { nextBets, total } = buildBetsFromLog(next);
      setBets(nextBets);
      setLastPlacedTotal(total);
      const delta = total - prevTotal;
      if (delta !== 0) {
        setWallet((prevWallet) => prevWallet - delta);
      }
      persistBetLogToStorage(currentRound?.roundId, next);
      return next;
    });
  };

  const loadPendingBets = async (roundId?: string) => {
    if (!roundId) {
      setBetLogSnapshot([]);
      return;
    }
    try {
      const bets = await apiFetch("/player/bets");
      const pending = bets.filter(
        (b: any) => b.roundId === roundId && b.status === "PENDING"
      );
      let actionId = betActionIdRef.current;
      const entries: BetLogEntry[] = [];
      pending.forEach((bet: any) => {
        const groupId = actionId++;
        bet.bets.forEach((entry: any) => {
          const chipIdx = Math.max(0, CHIPS.indexOf(entry.amount));
          entries.push({
            number: entry.number,
            amount: entry.amount,
            chipIdx,
            actionId: groupId,
          });
        });
      });
      betActionIdRef.current = Math.max(betActionIdRef.current, actionId);
      setBetLogSnapshot(entries);
      persistBetLogToStorage(roundId, entries);
    } catch (err: any) {
      setStatus(err.message || "Failed to load bets");
    }
  };

  const handleSyncEvent = (msg: SyncMessage) => {
    const applyRoundStart = (payload: any) => {
      const isSameRound = currentRound?.roundId === payload.roundId;
      setCurrentRound(payload);
      const remainingMs = Number(payload?.remainingMs);
      const nextCountdownSeconds = Number.isFinite(remainingMs)
        ? Math.max(0, Math.floor(remainingMs / 1000))
        : Math.max(
            0,
            Math.floor((new Date(payload.endTime).getTime() - Date.now()) / 1000)
          );
      setCountdown(nextCountdownSeconds);
      setLocked(Boolean(payload.locked));
      if (payload?.phase !== "spinning") {
        activeSpinRoundIdRef.current = null;
        spinEndRef.current = null;
        stopContinuousSpinLoop();
        stopFinalSettleLoop();
        setIsSpinning(false);
        stopSpinAudio();
      }
      if (!isSameRound) {
        setBetLogSnapshot([]);
      }
      restoreBetLogFromStorage(payload.roundId);
      loadPendingBets(payload.roundId);
      // If a spin result is still being revealed, keep it visible; otherwise reset UI for a fresh round.
      if (!resultTimerRef.current) {
        setPendingResult(null);
        setResultOutcome(null);
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
        spinEndRef.current && spinEndRef.current > now
          ? spinEndRef.current - now
          : 0;
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
      setLocked(Boolean(msg.payload.locked));
      if (msg.payload?.phase === "spinning") {
        startSpinWindow(msg.payload);
      }
    }
    if (msg.event === "round-spin-start") {
      startSpinWindow(msg.payload);
    }
    if (msg.event === "round-result") {
      setResultOutcome(null);
      setPendingResult({
        number: msg.payload.result,
        roundId: msg.payload.roundId,
      });
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
      const finalSettleMs = Math.round(startFinalSettleLoop(neededDelta));
      spinEndRef.current = Date.now() + finalSettleMs;

      if (resultTimerRef.current) {
        clearTimeout(resultTimerRef.current);
      }

      const revealResult = () => {
        if (spinRevealDoneRef.current) return;
        spinRevealDoneRef.current = true;
        setIsSpinning(false);
        setLastResult(msg.payload.result);
        setHighlightNumber(msg.payload.result);
        activeSpinRoundIdRef.current = null;
        fetchOutcomeForRound(msg.payload.roundId);
        loadWallet();
        loadResults();
        setBets(initialBets());
        stopSpinAudio();
        if (resultTimerRef.current) {
          clearTimeout(resultTimerRef.current);
          resultTimerRef.current = null;
        }
        spinEndRef.current = null;
      };

      resultTimerRef.current = setTimeout(revealResult, finalSettleMs);
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
        } catch (err) {
          console.error("Invalid RTC data", err);
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

  useEffect(() => {
    const saved = localStorage.getItem("player-token");
    const savedEmail = localStorage.getItem("player-email");
    if (saved) {
      setToken(saved);
      setLoginForm((f) => ({ ...f, email: savedEmail || f.email }));
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    connectSocket();
    loadMe();
    loadWallet();
    loadRound();
    loadResults();
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
      if (betToastTimerRef.current) {
        clearTimeout(betToastTimerRef.current);
        betToastTimerRef.current = null;
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

  const connectSocket = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      peersRef.current.forEach((peer) => peer.destroy());
      peersRef.current.clear();
    }
    const socket = io(SOCKET_URL, { transports: ["websocket"] });
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("authenticate", token);
      socket.emit("join-rtc");
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

  const loadMe = async () => {
    try {
      const data = await apiFetch("/auth/me");
      setUser(data);
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const loadWallet = async () => {
    try {
      const data = await apiFetch("/player/wallet");
      setWallet(data.balance);
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const loadRound = async () => {
    try {
      const data = await apiFetch("/player/current-round");
      setCurrentRound(data);
      setLocked(Boolean(data.locked));
      setCountdown(Math.floor(data.remainingMs / 1000));
      restoreBetLogFromStorage(data.roundId);
      loadPendingBets(data.roundId);
      if (data?.phase === "spinning") {
        startSpinWindow(data);
      }
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const loadResults = async () => {
    try {
      const data = await apiFetch("/player/results");
      setHistory(
        data.slice(0, 10).map((r: any) => ({
          roundId: r.roundId,
          result: r.resultNumber,
        }))
      );
      if (data.length) {
        const latestResult = data[0].resultNumber;
        setLastResult(latestResult);
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
        setHighlightNumber(latestResult);
      }
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const fetchOutcomeForRound = async (roundId: string) => {
    try {
      const bets = await apiFetch("/player/bets");
      const matches = bets.filter((b: any) => b.roundId === roundId);
      if (matches.length) {
        const winTotal = matches.reduce(
          (sum: number, bet: any) => sum + (bet.winAmount || 0),
          0
        );
        setResultOutcome({
          status: winTotal > 0 ? "WIN" : "LOSE",
          winAmount: winTotal,
        });
      } else {
        setResultOutcome(null);
      }
    } catch {
      setResultOutcome(null);
    }
  };

  const login = async () => {
    setStatus("");
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      if (!res.ok) throw new Error("Invalid credentials");
      const data = await res.json();
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("player-token", data.token);
      localStorage.setItem("player-email", loginForm.email);
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const logout = () => {
    socketRef.current?.disconnect();
    peersRef.current.forEach((peer) => peer.destroy());
    peersRef.current.clear();
    if (resultTimerRef.current) {
      clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
    if (betToastTimerRef.current) {
      clearTimeout(betToastTimerRef.current);
      betToastTimerRef.current = null;
    }
    if (resultToastTimerRef.current) {
      clearTimeout(resultToastTimerRef.current);
      resultToastTimerRef.current = null;
    }
    if (roundStartTimeoutRef.current) {
      clearTimeout(roundStartTimeoutRef.current);
      roundStartTimeoutRef.current = null;
    }
    if (wheelMotionFrameRef.current !== null) {
      cancelAnimationFrame(wheelMotionFrameRef.current);
      wheelMotionFrameRef.current = null;
    }
    stopContinuousSpinLoop();
    stopFinalSettleLoop();
    stopSpinAudio();
    setToken("");
    setUser(null);
    setWallet(0);
    setBets(initialBets());
    setStatus("");
    setCurrentRound(null);
    setCountdown(90);
    setLocked(false);
    setHistory([]);
    setLastResult(null);
    setPendingResult(null);
    setResultOutcome(null);
    setResultToast(null);
    setHighlightNumber(null);
    setBetLogSnapshot([]);
    localStorage.removeItem("player-token");
    localStorage.removeItem("player-email");
  };

  const placeInstantBet = async (number: number) => {
    if (isSpinning || (spinEndRef.current && spinEndRef.current > Date.now())) {
      setStatus("Wheel is spinning");
      return;
    }
    const chipIdx = Math.max(0, CHIPS.indexOf(selectedChip));
    const betAmount = selectedChip;
    const actionId = betActionIdRef.current++;
    setStatus("");
    applyBetLogUpdate((prev) => [
      ...prev,
      { number, amount: betAmount, chipIdx, actionId },
    ]);
    try {
      const data = await queueBetRequest(() =>
        emitSocketRequest<{
          walletBalance?: number;
          roundId?: string;
        }>("bet:place", { bets: [{ number, amount: betAmount }] })
      );
      if (betToastTimerRef.current) {
        clearTimeout(betToastTimerRef.current);
      }
      setBetToast(`Bet placed: ₹${betAmount.toLocaleString()}`);
      betToastTimerRef.current = setTimeout(() => {
        setBetToast(null);
        betToastTimerRef.current = null;
      }, 2500);
      if (typeof data?.walletBalance === "number") {
        setWallet(data.walletBalance);
      } else {
        loadWallet();
      }
    } catch (err: any) {
      applyBetLogUpdate((prev) =>
        prev.filter((entry) => entry.actionId !== actionId)
      );
      setStatus(err.message || "Failed to place bet");
    }
  };

  const undoBet = async () => {
    if (isSpinning) {
      setStatus("Wheel is spinning");
      return;
    }
    if (!lastPlacedBets.length) {
      setStatus("No bet to undo");
      return;
    }
    let removedEntries: BetLogEntry[] = [];
    let removedActionId: number | null = null;
    setStatus("");
    applyBetLogUpdate((prev) => {
      if (!prev.length) return prev;
      removedActionId = prev[prev.length - 1].actionId;
      removedEntries = prev.filter(
        (entry) => entry.actionId === removedActionId
      );
      return prev.filter((entry) => entry.actionId !== removedActionId);
    });
    try {
      const data = await queueBetRequest(() =>
        emitSocketRequest<{
          walletBalance?: number;
          removedBet?: {
            bets?: { number: number; amount: number }[];
            totalBet?: number;
          };
        }>("bet:undo")
      );
      if (typeof data?.walletBalance === "number") {
        setWallet(data.walletBalance);
      } else {
        loadWallet();
      }
    } catch (err: any) {
      if (removedEntries.length && removedActionId !== null) {
        applyBetLogUpdate((prev) => {
          const merged = [...prev, ...removedEntries];
          merged.sort((a, b) => a.actionId - b.actionId);
          return merged;
        });
      }
      setStatus(err.message || "Failed to undo bet");
    }
  };

  const clearBets = async () => {
    if (isSpinning) {
      setStatus("Wheel is spinning");
      return;
    }
    if (!lastPlacedBets.length) {
      setStatus("No bets to clear");
      return;
    }
    setStatus("");
    let clearedSnapshot: BetLogEntry[] = [];
    applyBetLogUpdate((prev) => {
      clearedSnapshot = prev;
      return [];
    });
    try {
      const data = await queueBetRequest(() =>
        emitSocketRequest<{ walletBalance?: number }>("bet:clear")
      );
      if (typeof data?.walletBalance === "number") {
        setWallet(data.walletBalance);
      } else {
        loadWallet();
      }
    } catch (err: any) {
      if (clearedSnapshot.length) {
        applyBetLogUpdate((prev) => {
          const merged = [...prev, ...clearedSnapshot];
          merged.sort((a, b) => a.actionId - b.actionId);
          return merged;
        });
      }
      setStatus(err.message || "Failed to clear bets");
    }
  };

  const doubleBets = async () => {
    if (isSpinning) {
      setStatus("Wheel is spinning");
      return;
    }
    if (!activeBets.length) {
      setStatus("Place a chip to bet");
      return;
    }
    const betsToSend = activeBets.map(({ number, amount }) => ({
      number,
      amount,
    }));
    const chipIdxByNumber = new Map(bets.map((b) => [b.number, b.lastChipIdx]));
    const actionId = betActionIdRef.current++;
    setStatus("");
    applyBetLogUpdate((prev) => [
      ...prev,
      ...betsToSend.map((bet) => ({
        number: bet.number,
        amount: bet.amount,
        chipIdx: chipIdxByNumber.get(bet.number) ?? 0,
        actionId,
      })),
    ]);
    try {
      const data = await queueBetRequest(() =>
        emitSocketRequest<{ walletBalance?: number }>("bet:place", {
          bets: betsToSend,
        })
      );
      if (typeof data?.walletBalance === "number") {
        setWallet(data.walletBalance);
      } else {
        loadWallet();
      }
    } catch (err: any) {
      applyBetLogUpdate((prev) =>
        prev.filter((entry) => entry.actionId !== actionId)
      );
      setStatus(err.message || "Failed to double bets");
    }
  };

  useEffect(() => {
    const audio = new Audio("/audio.mp3");
    audio.preload = "auto";
    audio.load();
    spinAudioRef.current = audio;
    return () => {
      stopContinuousSpinLoop();
      stopFinalSettleLoop();
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
    if (!resultOutcome || resultOutcome.status !== "WIN") return;
    const payout = resultOutcome.winAmount || 0;
    setResultToast(`Payout: ₹${payout.toLocaleString()}`);
    if (resultToastTimerRef.current) {
      clearTimeout(resultToastTimerRef.current);
    }
    resultToastTimerRef.current = setTimeout(() => {
      setResultToast(null);
      resultToastTimerRef.current = null;
    }, 5000);
  }, [resultOutcome]);

  const drawTimeLabel = currentRound?.endTime
    ? formatClock(currentRound.endTime)
    : "--:--";
  const roundIdLabel = currentRound?.roundId
    ? String(currentRound.roundId).toUpperCase()
    : "----";
  const countdownLabel = String(Math.max(0, Math.floor(countdown)));
  const winAmount = resultOutcome?.winAmount || 0;
  const recentHistory = history.slice(-10).reverse();
  const centerResultNumber =
    !isSpinning && highlightNumber !== null ? highlightNumber : null;

  if (!token) {
    return (
      <div className="min-h-[100dvh] relative overflow-hidden bg-gradient-to-br from-[#1C0838] to-[#120524] flex items-center justify-center px-4 py-8 text-white">
        <div className="relative z-10 w-full max-w-md rounded-[26px] border border-amber-200/30 bg-black/55 p-5 sm:p-8 shadow-[0_30px_80px_rgba(10,0,20,0.8)]">
          <p className="text-xs uppercase tracking-[0.4em] text-amber-200/70 text-center">
            Welcome
          </p>
          <h1 className="mb-6 text-center text-2xl font-black tracking-wide sm:text-3xl">
            FunTimer
          </h1>
          <div className="space-y-4">
            <input
              className="w-full rounded-xl bg-black/40 px-4 py-3 border border-white/20 focus:border-amber-300 outline-none"
              placeholder="Email"
              value={loginForm.email}
              onChange={(e) =>
                setLoginForm({ ...loginForm, email: e.target.value })
              }
            />
            <input
              className="w-full rounded-xl bg-black/40 px-4 py-3 border border-white/20 focus:border-amber-300 outline-none"
              placeholder="Password"
              type="password"
              value={loginForm.password}
              onChange={(e) =>
                setLoginForm({ ...loginForm, password: e.target.value })
              }
            />
            <button
              className="w-full rounded-xl bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 py-3 font-semibold text-slate-900 shadow-lg shadow-amber-500/40"
              onClick={login}
            >
              Enter Game
            </button>
            {status && (
              <p className="text-center text-sm text-amber-200">{status}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const potentialWin = totalBet > 0 ? totalBet * 9 : winAmount;

  const handleCopyGameId = () => {
    if (!currentRound?.roundId) return;
    navigator.clipboard?.writeText(String(currentRound.roundId));
    setCopiedGameId(true);
    setTimeout(() => setCopiedGameId(false), 2000);
  };

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden text-white [touch-action:pan-y] select-none">
      {/* Clean Purple Background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#250d47] to-[#120524] pointer-events-none" />

      <div className="relative z-10 mx-auto flex min-h-[100dvh] lg:h-[100dvh] w-full max-w-[1440px] flex-col justify-between px-3 py-2 sm:px-4 sm:py-2.5 lg:px-5 lg:py-3 lg:overflow-hidden">
        {/* TOP BAR / HUD */}
        <header className="flex w-full items-center justify-between gap-2 sm:gap-4 shrink-0">
          {/* LEFT: BALANCE */}
          <div className="flex items-center gap-2 sm:gap-2.5 rounded-2xl border border-[#462373] bg-[#16082B] px-3 py-1.5 sm:px-4 sm:py-1.5 shadow-md">
            <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-xl bg-amber-400/20 text-amber-300 shadow-inner">
              <svg viewBox="0 0 24 24" className="h-4 w-4 sm:h-5 sm:w-5" fill="currentColor">
                <path d="M21 7.28V5c0-1.1-.9-2-2-2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-2.28c.59-.35 1-.99 1-1.72V9c0-.73-.41-1.37-1-1.72zM20 9v6h-7V9h7zM5 19V5h14v2h-6c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h6v2H5z" />
                <circle cx="16" cy="12" r="1.5" />
              </svg>
            </div>
            <div>
              <div className="text-[9px] sm:text-[10px] font-bold tracking-wider text-purple-200/70 uppercase leading-none">
                BALANCE
              </div>
              <div className="text-sm sm:text-base font-black text-amber-300 leading-tight mt-0.5">
                ₹{wallet.toLocaleString()}
              </div>
            </div>
          </div>

          {/* CENTER: GAME ID PILL */}
          <div className="flex items-center gap-2 rounded-full border border-[#462373] bg-[#16082B] px-3.5 py-1.5 sm:px-5 sm:py-1.5 shadow-md max-w-[45%] sm:max-w-none">
            <span className="hidden sm:inline text-[11px] font-bold text-purple-200/70">
              GAME ID:
            </span>
            <span className="text-[10px] sm:text-xs font-black tracking-wider text-white truncate max-w-[120px] sm:max-w-[280px]">
              {roundIdLabel}
            </span>
            <button
              type="button"
              onClick={handleCopyGameId}
              className="shrink-0 p-1 text-purple-300 hover:text-white transition active:scale-95"
              title="Copy Game ID"
            >
              {copiedGameId ? (
                <span className="text-[9px] font-black text-emerald-400">COPIED</span>
              ) : (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>

          {/* RIGHT: DRAW TIME, SOUND, LOGOUT */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* DRAW TIME */}
            <div className="flex items-center gap-1.5 sm:gap-2 rounded-2xl border border-[#462373] bg-[#16082B] px-3 py-1.5 sm:px-3.5 sm:py-1.5 shadow-md">
              <svg viewBox="0 0 24 24" className="h-4 w-4 sm:h-5 sm:w-5 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <div>
                <div className="text-[8px] sm:text-[9px] font-bold tracking-wider text-purple-200/70 uppercase leading-none">
                  DRAW TIME
                </div>
                <div className="text-xs sm:text-sm font-black text-amber-300 leading-tight mt-0.5">
                  {drawTimeLabel}
                </div>
              </div>
            </div>

            {/* SOUND TOGGLE */}
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
                    } else if (
                      spinEndRef.current &&
                      spinEndRef.current > Date.now()
                    ) {
                      audio.play().catch(() => {});
                    }
                  }
                  return next;
                })
              }
              className={`flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl border transition shadow-md ${
                soundOn
                  ? "border-[#462373] bg-[#16082B] text-purple-200 hover:text-white"
                  : "border-red-400/40 bg-[#1f091b] text-red-300"
              }`}
              title={soundOn ? "Mute sound" : "Unmute sound"}
            >
              {soundOn ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 10h4l5-4v12l-5-4H3z" />
                  <path d="M16 8c1.5 1.5 1.5 6 0 7.5" />
                  <path d="M19 5c3 3 3 11 0 14" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 10h4l5-4v12l-5-4H3z" />
                  <path d="M16 9l5 5" />
                  <path d="M21 9l-5 5" />
                </svg>
              )}
            </button>

            {/* EXIT / LOGOUT BUTTON */}
            <button
              type="button"
              onClick={logout}
              className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl border border-[#462373] bg-[#16082B] text-purple-200 hover:text-white transition shadow-md"
              title="Logout"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        {/* MAIN GAME CONTAINER: 2 Balanced Columns without empty gaps */}
        <div className="mt-3 flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4 items-stretch">
          {/* LEFT COLUMN: All user controls compactly stacked */}
          <div className="order-2 lg:order-1 flex flex-col gap-3 lg:gap-4 h-full min-h-0">
            {/* 1. CHOOSE A NUMBER CARD */}
            <div className="rounded-2xl border border-[#462373] bg-[#16082B] p-3 xl:p-4 shadow-lg flex flex-col justify-center">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base xl:text-lg font-black tracking-wider uppercase leading-tight">
                    CHOOSE A <span className="text-amber-400">NUMBER</span>
                  </h2>
                  <p className="text-[11px] xl:text-xs text-purple-200/60 mt-0.5">
                    Select any number from 0 - 9 and place your chips
                  </p>
                </div>
              </div>

              {/* UNIFIED 5-COLS GRID */}
              <div className="grid grid-cols-5 gap-1.5 sm:gap-2 xl:gap-2.5 mt-3 xl:mt-4 w-full place-items-center">
                {bets.map((bet) => {
                  const theme = NUMBER_BUTTON_THEMES[bet.number] || NUMBER_BUTTON_THEMES[0];
                  const chipImage = CHIP_IMAGES[bet.lastChipIdx] || CHIP_IMAGES[0];
                  return (
                    <button
                      key={bet.number}
                      type="button"
                      onClick={() => placeInstantBet(bet.number)}
                      disabled={isSpinning}
                      className="chiclet-btn relative flex flex-col items-center justify-center w-full max-w-[75px] aspect-square rounded-xl xl:rounded-2xl hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                      style={{
                        background: theme.bg,
                        border: theme.border,
                        color: theme.textColor,
                        boxShadow: theme.boxShadow,
                      }}
                    >
                      <span className="text-2xl xl:text-3xl font-black drop-shadow-md">
                        {bet.number}
                      </span>
                      {/* Placed Bet Badge */}
                      {bet.amount > 0 && (
                        <div className="absolute bottom-1 inset-x-1 flex items-center justify-center gap-1 rounded-full bg-black/85 border border-amber-300/70 px-1 py-0.2 shadow-md">
                          <div
                            className="h-3 w-3 shrink-0 rounded-full border border-amber-300/60"
                            style={{
                              backgroundImage: `url(${chipImage})`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }}
                          />
                          <span className="text-[9px] xl:text-[10px] font-black text-amber-300 truncate">
                            ₹{bet.amount.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. SELECT YOUR CHIPS CARD */}
            <div className="rounded-2xl border border-[#462373] bg-[#16082B] p-3 xl:p-4 shadow-lg shrink-0">
              <h2 className="text-sm xl:text-base font-black tracking-wider uppercase leading-none">
                SELECT YOUR <span className="text-amber-400">CHIPS</span>
              </h2>

              <div className="mt-2.5 flex items-center justify-between gap-3">
                {/* CHIPS RACK (2 Rows: 5 in top row, 4 in bottom row) */}
                <div className="flex-1 space-y-2">
                  {/* Row 1: 10, 50, 100, 500, 1,000 */}
                  <div className="grid grid-cols-5 gap-1.5 sm:gap-2 justify-items-center">
                    {CHIPS.slice(0, 5).map((chip, idx) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setSelectedChip(chip)}
                        className={`relative flex h-11 w-11 sm:h-12 sm:w-12 xl:h-14 xl:w-14 items-center justify-center rounded-full transition-transform active:scale-95 ${
                          selectedChip === chip
                            ? "scale-110 ring-4 ring-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.7)] z-10"
                            : "hover:scale-105 opacity-90 hover:opacity-100"
                        }`}
                        style={{
                          backgroundImage: `url(${CHIP_IMAGES[idx]})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                          filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.5))",
                        }}
                      >
                        <span className="text-[10px] xl:text-xs font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                          {chip.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Row 2: 5,000, 10,000, 25,000, 50,000 */}
                  <div className="flex items-center justify-center gap-3 sm:gap-4 xl:gap-5">
                    {CHIPS.slice(5).map((chip, idx) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setSelectedChip(chip)}
                        className={`relative flex h-11 w-11 sm:h-12 sm:w-12 xl:h-14 xl:w-14 items-center justify-center rounded-full transition-transform active:scale-95 ${
                          selectedChip === chip
                            ? "scale-110 ring-4 ring-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.7)] z-10"
                            : "hover:scale-105 opacity-90 hover:opacity-100"
                        }`}
                        style={{
                          backgroundImage: `url(${CHIP_IMAGES[idx + 5]})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                          filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.5))",
                        }}
                      >
                        <span className="text-[9px] xl:text-[10px] font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                          {chip.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ACTION BUTTONS (DOUBLE, UNDO, CLEAR) */}
                <div className="flex flex-col gap-1.5 xl:gap-2 w-28 sm:w-32 xl:w-36 shrink-0">
                  {/* DOUBLE */}
                  <button
                    type="button"
                    onClick={doubleBets}
                    disabled={isSpinning || totalBet === 0}
                    className="chiclet-btn w-full h-8 xl:h-9 rounded-xl flex items-center justify-center gap-1.5 font-black text-xs text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: "linear-gradient(180deg, #fcd34d 0%, #d97706 100%)",
                      border: "1px solid rgba(253, 230, 138, 0.4)",
                      boxShadow: "inset 0 -4px 0px rgba(120, 53, 15, 0.4), 0 2px 4px rgba(0,0,0,0.3)",
                    }}
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-900 text-[9px] font-black">
                      2x
                    </span>
                    <span>DOUBLE</span>
                  </button>

                  {/* UNDO */}
                  <button
                    type="button"
                    onClick={undoBet}
                    disabled={isSpinning || lastPlacedBets.length === 0}
                    className="chiclet-btn w-full h-8 xl:h-9 rounded-xl flex items-center justify-center gap-1.5 font-black text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: "linear-gradient(180deg, #4ade80 0%, #16a34a 100%)",
                      border: "1px solid rgba(187, 247, 208, 0.4)",
                      boxShadow: "inset 0 -4px 0px rgba(21, 128, 61, 0.4), 0 2px 4px rgba(0,0,0,0.3)",
                    }}
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 10h10a5 5 0 0 1 5 5v2" />
                      <polyline points="7 6 3 10 7 14" />
                    </svg>
                    <span>UNDO</span>
                  </button>

                  {/* CLEAR */}
                  <button
                    type="button"
                    onClick={clearBets}
                    disabled={isSpinning || lastPlacedBets.length === 0}
                    className="chiclet-btn w-full h-8 xl:h-9 rounded-xl flex items-center justify-center gap-1.5 font-black text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: "linear-gradient(180deg, #f87171 0%, #dc2626 100%)",
                      border: "1px solid rgba(254, 202, 202, 0.4)",
                      boxShadow: "inset 0 -4px 0px rgba(153, 27, 27, 0.4), 0 2px 4px rgba(0,0,0,0.3)",
                    }}
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                    <span>CLEAR</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 3. RECENT NUMBERS & STATS */}
            <div className="flex flex-col gap-3 lg:gap-4 shrink-0">
              {/* RECENT NUMBERS */}
              <div className="rounded-2xl border border-[#462373] bg-[#16082B] p-2.5 xl:p-3 shadow-md flex flex-col justify-center">
                <div className="text-[10px] xl:text-[11px] font-bold uppercase tracking-wider text-purple-200/70 mb-1 leading-none">
                  RECENT NUMBERS
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                  {recentHistory.map((h, idx) => {
                    const theme = NUMBER_BUTTON_THEMES[h.result] || NUMBER_BUTTON_THEMES[0];
                    return (
                      <div
                        key={`${h.roundId}-${h.result}-${idx}`}
                        className="flex h-7 w-7 xl:h-8 xl:w-8 shrink-0 items-center justify-center rounded-lg font-black text-sm xl:text-base shadow-sm border"
                        style={{
                          background: theme.bg,
                          borderColor: theme.border,
                          color: theme.textColor,
                          boxShadow: theme.boxShadow,
                        }}
                      >
                        {h.result}
                      </div>
                    );
                  })}
                  {!recentHistory.length && (
                    <span className="text-xs text-purple-200/40">No rounds yet</span>
                  )}
                </div>
              </div>

              {/* STATS: TOTAL BET & POTENTIAL WIN */}
              <div className="grid grid-cols-2 gap-3 lg:gap-4 w-full">
                {/* TOTAL BET */}
                <div className="rounded-2xl border border-[#462373] bg-[#16082B] p-2.5 xl:p-3 shadow-md flex items-center gap-2.5">
                  <div className="flex h-9 w-9 xl:h-10 xl:w-10 shrink-0 items-center justify-center rounded-full border-2 border-white/60 bg-neutral-900 text-white shadow-md">
                    <div className="h-6 w-6 rounded-full border border-dashed border-white/70 flex items-center justify-center text-[9px] font-black">
                      00
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] xl:text-[10px] font-bold tracking-wider text-purple-200/70 uppercase leading-none">
                      TOTAL BET
                    </div>
                    <div className="text-sm xl:text-lg font-black text-white leading-tight mt-0.5">
                      ₹{totalBet.toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* POTENTIAL WIN */}
                <div className="rounded-2xl border border-[#462373] bg-[#16082B] p-2.5 xl:p-3 shadow-md flex items-center gap-2.5">
                  <div className="flex h-9 w-9 xl:h-10 xl:w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/20 text-amber-400 shadow-md">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 xl:h-6 xl:w-6" fill="currentColor">
                      <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-[9px] xl:text-[10px] font-bold tracking-wider text-purple-200/70 uppercase leading-none">
                      POTENTIAL WIN
                    </div>
                    <div className="text-sm xl:text-lg font-black text-white leading-tight mt-0.5">
                      ₹{potentialWin.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Banner, Wheel, and Bottom Stats perfectly unified */}
          <div className="order-1 lg:order-2 flex flex-col items-center justify-between gap-1.5 xl:gap-2 h-full min-h-0">
            {/* MOBILE BANNER WITH CROWN (Visible only on < lg screens) */}
            <div className="flex lg:hidden flex-col items-center w-full mb-1 relative shrink-0">
              <div className="text-amber-400 drop-shadow-[0_4px_10px_rgba(251,191,36,0.6)] mb-0.5">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                  <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .55-.45 1-1 1H6c-.55 0-1-.45-1-1v-1h14v1z" />
                </svg>
              </div>
              <h2
                className="text-3xl font-black tracking-wider text-center drop-shadow-[0_6px_12px_rgba(0,0,0,0.8)]"
                style={{
                  backgroundImage: "linear-gradient(180deg, #fffbeb 0%, #fde047 35%, #eab308 65%, #ca8a04 100%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  WebkitTextStroke: "1px rgba(120, 53, 15, 0.6)",
                }}
              >
                FUN TIMER
              </h2>
              <div className="relative -mt-1 rounded-full border border-amber-300/80 bg-gradient-to-r from-purple-800 via-purple-600 to-purple-800 px-5 py-0.5 shadow-[0_6px_14px_rgba(0,0,0,0.5)]">
                <span className="text-[11px] font-black tracking-widest text-amber-200 uppercase">
                  SPIN YOUR LUCK!
                </span>
              </div>
              <div className="absolute left-1 top-4 -rotate-6 max-w-[80px] text-left text-[9px] font-bold text-pink-300/90 leading-tight drop-shadow-md">
                Pick your number<br />Play &amp; Win!
              </div>
              <div className="absolute right-1 top-4 rotate-6 max-w-[80px] text-right text-[9px] font-bold text-pink-300/90 leading-tight drop-shadow-md">
                Big Wins<br />Await!
              </div>
            </div>

            {/* DESKTOP ARCHED BANNER WITH DIAMOND GEMS (lg+ screens) */}
            <div className="hidden lg:flex flex-col items-center w-full relative shrink-0 pt-1">
              <div className="relative flex items-center justify-center">
                {/* Arched Gold Banner Plate */}
                <div
                  className="relative flex items-center justify-center rounded-2xl border-[2px] border-amber-300/90 px-8 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.65),inset_0_2px_4px_rgba(255,255,255,0.4)]"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(60, 15, 90, 0.95) 0%, rgba(30, 5, 50, 0.95) 100%)",
                  }}
                >
                  <div className="absolute -left-2 h-3.5 w-3.5 rotate-45 border-2 border-amber-300 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                  <div className="absolute -right-2 h-3.5 w-3.5 rotate-45 border-2 border-amber-300 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />

                  <h2
                    className="text-3xl xl:text-4xl font-black tracking-widest text-center"
                    style={{
                      backgroundImage:
                        "linear-gradient(180deg, #fffbeb 0%, #fde047 30%, #f59e0b 65%, #b45309 100%)",
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                      filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.8))",
                    }}
                  >
                    FUN TIMER
                  </h2>
                </div>

                {/* Purple Gemstone Pointer pointing down at wheel */}
                <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 z-40">
                  <div className="h-5 w-5 rotate-45 rounded-sm border-2 border-amber-300 bg-gradient-to-br from-fuchsia-400 via-purple-600 to-indigo-800 shadow-[0_0_12px_rgba(217,70,239,0.8)]" />
                </div>

                {/* Pink Script Arrow: SPIN YOUR LUCK! */}
                <div className="absolute -right-24 top-2 rotate-12 flex flex-col items-center">
                  <span className="text-[11px] font-black text-pink-400 tracking-wider drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] leading-tight">
                    SPIN<br />YOUR LUCK!
                  </span>
                  <svg viewBox="0 0 40 40" className="h-7 w-7 text-pink-400 -rotate-45" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M10 10 C 20 20, 25 30, 20 35 M 20 35 L 28 32 M 20 35 L 22 25" />
                  </svg>
                </div>
              </div>
            </div>

            {/* WHEEL CONTAINER */}
            <div className="relative mx-auto flex flex-col items-center justify-center flex-1 min-h-0 w-full py-1">
              {/* Mobile pointer */}
              <div className="lg:hidden pointer-events-none absolute left-1/2 -top-2 z-40 -translate-x-1/2">
                <div className="h-6 w-6 rotate-45 rounded-[6px] border-2 border-amber-300 bg-gradient-to-br from-fuchsia-400 via-purple-600 to-indigo-800 shadow-[0_0_12px_rgba(217,70,239,0.8)]" />
              </div>

              {/* WHEEL DISK CONTAINER: Perfectly proportional to viewport */}
              <div className="relative mx-auto h-[min(50vh,350px)] w-[min(50vh,350px)] sm:h-[min(55vh,400px)] sm:w-[min(55vh,400px)] lg:h-[min(60vh,480px)] lg:w-[min(60vh,480px)] xl:h-[min(70vh,580px)] xl:w-[min(70vh,580px)] overflow-visible">
                {/* Rotating Segmented Disk */}
                <div
                  className="absolute inset-[12%] overflow-hidden rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.65)] sm:inset-[11%] md:inset-[50px]"
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
                      return (
                        <div
                          key={n}
                          className="absolute inset-0"
                          style={{
                            transform: `rotate(${angleDeg}deg)`,
                          }}
                        >
                          <div 
                            className="absolute left-1/2 top-[6%] sm:top-[8%] -translate-x-1/2 flex items-center justify-center"
                            style={{
                              transform: `rotate(${-(angleDeg + spinRotation)}deg)`
                            }}
                          >
                            <span
                              className={`block text-2xl font-black drop-shadow-[0_6px_12px_rgba(0,0,0,0.6)] transition-transform sm:text-3xl xl:text-4xl ${
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
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Outer Wheel Ring Frame */}
                <img
                  src="/OuterWheelRing.png"
                  alt="Wheel frame"
                  className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 select-none object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.65)] sm:h-[118%] sm:w-[118%] md:h-[116%] md:w-[116%]"
                />

                {/* Center Result Number */}
                {centerResultNumber !== null && (
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
                    <div
                      className="grid h-16 w-16 sm:h-18 sm:w-18 xl:h-22 xl:w-22 place-items-center rounded-full border-[3px] border-amber-200/90 shadow-[0_14px_30px_rgba(0,0,0,0.55)]"
                      style={{
                        background:
                          "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.32), rgba(255,230,150,0.18) 55%, rgba(0,0,0,0.45) 100%), linear-gradient(145deg, rgba(255,255,255,0.15), rgba(0,0,0,0.65))",
                        boxShadow:
                          "inset 0 0 20px rgba(0,0,0,0.4), 0 12px 28px rgba(0,0,0,0.65)",
                      }}
                    >
                      <span className="text-3xl sm:text-4xl xl:text-5xl font-black text-yellow-200 drop-shadow-[0_8px_14px_rgba(0,0,0,0.8)]">
                        {centerResultNumber}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Multi-Tiered Golden Pedestal Under Wheel */}
              <div className="relative -mt-5 sm:-mt-6 xl:-mt-8 flex flex-col items-center w-full z-10 pointer-events-none shrink-0">
                <div
                  className="h-4 sm:h-5 xl:h-6 w-[68%] rounded-full border-t border-amber-200/80 shadow-[0_4px_14px_rgba(0,0,0,0.6)]"
                  style={{
                    background:
                      "linear-gradient(180deg, #fef08a 0%, #d97706 50%, #78350f 100%)",
                  }}
                />
                <div
                  className="-mt-1.5 sm:-mt-2 h-5 sm:h-6 xl:h-7 w-[82%] rounded-full border-t border-amber-300/60 shadow-[0_10px_24px_rgba(0,0,0,0.8)]"
                  style={{
                    background:
                      "linear-gradient(180deg, #b45309 0%, #78350f 50%, #451a03 100%)",
                  }}
                />
                <div className="-mt-2 h-5 w-[90%] rounded-full bg-purple-600/30 blur-lg" />
              </div>
            </div>

            {/* TIMER (Directly below the wheel for all screens) */}
            <div className="w-full shrink-0">
              <div className="rounded-2xl border border-[#462373] bg-[#16082B] p-2.5 xl:p-3 shadow-md flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-400 shadow-md">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                      <path d="M6 2v6h.01L6 8.01 10 12l-4 4 .01.01H6V22h12v-5.99h-.01L18 16l-4-4 4-3.99-.01-.01H18V2H6zm10 14.5V20H8v-3.5l4-4 4 4zM12 11.5L8 7.5V4h8v3.5l-4 4z" />
                    </svg>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] xl:text-[11px] font-bold uppercase tracking-wider text-purple-200/70 leading-none">
                      TIME LEFT
                    </span>
                    <span className="text-[9px] font-bold tracking-widest text-purple-200/60 uppercase leading-none mt-0.5">
                      SECONDS
                    </span>
                  </div>
                </div>
                <div className="text-5xl sm:text-6xl xl:text-7xl font-black text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.6)]">
                  {countdownLabel}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* STATUS MESSAGE IF ANY */}
        {status && (
          <div className="mt-1 text-center text-xs font-bold text-amber-300 drop-shadow-md shrink-0">
            {status}
          </div>
        )}
      </div>

      {/* TOASTS */}
      {resultToast && (
        <div className="fixed bottom-24 left-1/2 z-[90] w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 sm:bottom-20">
          <div className="rounded-full border border-emerald-400/60 bg-black/90 px-5 py-3 text-center text-sm font-bold text-emerald-300 shadow-lg shadow-emerald-500/30 backdrop-blur-md">
            {resultToast}
          </div>
        </div>
      )}
      {betToast && (
        <div className="fixed bottom-8 left-1/2 z-[90] w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 sm:bottom-6">
          <div className="rounded-full border border-amber-400/60 bg-black/90 px-5 py-3 text-center text-sm font-bold text-amber-300 shadow-lg shadow-amber-500/30 backdrop-blur-md">
            {betToast}
          </div>
        </div>
      )}
    </div>
  );
}

