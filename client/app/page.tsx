/* eslint-disable react-hooks/exhaustive-deps */
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
      <div className="min-h-[100dvh] relative overflow-hidden bg-[radial-gradient(circle_at_20%_10%,rgba(255,200,80,0.2),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(255,80,80,0.25),transparent_40%),radial-gradient(circle_at_0%_100%,rgba(140,70,255,0.2),transparent_40%),#1c0529] flex items-center justify-center px-4 py-8 text-white">
        <div className="absolute -top-24 right-0 h-72 w-72 rounded-full bg-amber-400/20 blur-[120px]" />
        <div className="absolute bottom-0 left-0 h-72 w-72 rounded-full bg-fuchsia-500/20 blur-[130px]" />
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

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden text-white [touch-action:pan-y]">
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

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-3 py-3 pb-6 sm:px-4 sm:pb-24 lg:pb-3">
        {(() => {
          const hudPillStyle = {
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.16), rgba(0,0,0,0.18)), linear-gradient(180deg, rgba(120,50,180,0.55), rgba(40,10,65,0.92))",
            border: "1px solid rgba(255, 225, 140, 0.25)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -10px 18px rgba(0,0,0,0.35), 0 10px 22px rgba(0,0,0,0.35)",
          } as const;
          const closeStyle = {
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.22), rgba(0,0,0,0.16)), linear-gradient(180deg, rgba(255,200,70,0.95), rgba(210,120,20,0.92))",
            border: "1px solid rgba(60, 20, 10, 0.35)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 22px rgba(0,0,0,0.45)",
          } as const;
          const boardStyle = {
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.12)), radial-gradient(circle at 50% 0%, rgba(130,60,200,0.55), rgba(50,12,80,0.92) 60%, rgba(18,3,30,0.96) 100%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.12), 0 25px 60px rgba(0,0,0,0.55)",
          } as const;
          const cardStyle = {
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.1)), radial-gradient(circle at 50% 20%, rgba(140,70,220,0.55), rgba(45,10,70,0.92) 55%, rgba(20,2,35,0.96) 100%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -18px 24px rgba(0,0,0,0.22), 0 14px 24px rgba(0,0,0,0.45)",
          } as const;
          const slotStyle = {
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.12)), linear-gradient(180deg, rgba(95,30,140,0.78), rgba(30,5,52,0.92))",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -8px 16px rgba(0,0,0,0.35)",
          } as const;
          const actionButtonStyle = (variant: "gray" | "green") =>
            ({
              background:
                variant === "green"
                  ? "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(0,0,0,0.16)), linear-gradient(180deg, rgba(90,240,90,0.92), rgba(20,140,20,0.92))"
                  : "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(0,0,0,0.16)), linear-gradient(180deg, rgba(210,210,220,0.55), rgba(120,120,130,0.55))",
              border: "1px solid rgba(0,0,0,0.35)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -10px 16px rgba(0,0,0,0.22), 0 14px 24px rgba(0,0,0,0.35)",
            } as const);

          const historyCellClass = (n: number) =>
            NUMBER_TILE_CLASSES[n] || NUMBER_TILE_CLASSES[0];

          return (
            <>
              <header className="flex w-full min-w-0 flex-col gap-2 sm:gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div
                    className="max-w-full rounded-full px-3 py-1.5 text-xs font-bold tracking-wide sm:px-5 sm:py-2 sm:text-sm"
                    style={hudPillStyle}
                  >
                    <span className="opacity-90">BALANCE :</span>
                    <span className="ml-2 font-black">
                      ₹{wallet.toLocaleString()}
                    </span>
                  </div>
                  <div
                    className="max-w-full rounded-full px-3 py-1.5 text-xs font-bold tracking-wide sm:px-5 sm:py-2 sm:text-sm"
                    style={hudPillStyle}
                  >
                    <span className="opacity-90">GAME ID :</span>
                    <span className="ml-2 break-all font-black">{roundIdLabel}</span>
                  </div>
                </div>

                <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3 md:justify-end">
                  <div
                    className="max-w-full rounded-full px-3 py-1.5 text-xs font-bold tracking-wide sm:px-5 sm:py-2 sm:text-sm"
                    style={hudPillStyle}
                  >
                    <span className="opacity-90">DRAW TIME :</span>
                    <span className="ml-2 font-black">{drawTimeLabel}</span>
                  </div>
                  <button
                    className="grid h-9 w-9 place-items-center rounded-lg font-black text-slate-900 sm:h-10 sm:w-10"
                    style={closeStyle}
                    onClick={logout}
                    aria-label="Close"
                    title="Logout"
                  >
                    ×
                  </button>
                </div>
              </header>

              <div className="mt-4 grid min-w-0 items-start gap-4 xl:mt-6 xl:flex-1 xl:min-h-0 xl:items-stretch xl:grid-cols-[1fr_600px]">
                <section className="order-2 min-w-0 space-y-4 px-2 xl:order-1 xl:px-0">
                  <div className="grid md:grid-cols-[1fr_220px_130px] gap-4 items-start">
                    <div
                      className="mx-auto w-full max-w-[calc(100vw-2rem)] rounded-[20px] border-2 border-amber-200/55 p-2.5 sm:rounded-[26px] sm:border-[3px] sm:p-4 md:col-span-3 md:max-w-none"
                      style={boardStyle}
                    >
                      <div className="grid grid-cols-5 gap-1.5 sm:gap-3">
                        {bets.map((bet) => {
                          const chipImage =
                            CHIP_IMAGES[bet.lastChipIdx] || CHIP_IMAGES[0];
                          const tileClass =
                            NUMBER_TILE_CLASSES[bet.number] ||
                            NUMBER_TILE_CLASSES[0];
                          return (
                            <button
                              key={bet.number}
                              onClick={() => placeInstantBet(bet.number)}
                              disabled={isSpinning}
                              className={`relative h-[110px] overflow-hidden rounded-[16px] border-2 border-amber-200/65 p-1.5 transition disabled:cursor-not-allowed disabled:opacity-60 sm:h-[132px] sm:rounded-[22px] sm:border-[3px] sm:p-2 md:h-[148px] ${
                                bet.amount > 0
                                  ? "shadow-[0_0_0_2px_rgba(255,220,140,0.25),0_16px_30px_rgba(0,0,0,0.45)]"
                                  : "shadow-[0_14px_24px_rgba(0,0,0,0.4)] hover:brightness-110"
                              }`}
                              style={cardStyle}
                            >
                              <div
                                className={`flex h-8 items-center justify-center rounded-lg border-2 border-amber-200/70 text-[22px] font-black shadow-[0_8px_14px_rgba(0,0,0,0.5)] sm:h-10 sm:rounded-xl sm:text-[28px] ${tileClass}`}
                              >
                                {bet.number}
                              </div>
                              <div
                                className="relative mt-1.5 h-[58px] overflow-hidden rounded-xl border-2 border-black/40 sm:mt-2 sm:h-[72px] sm:rounded-2xl md:h-[80px]"
                                style={slotStyle}
                              >
                                <div className="absolute inset-[8px] rounded-lg border border-white/10 bg-black/20 shadow-[inset_0_0_18px_rgba(0,0,0,0.45)] sm:inset-[10px] sm:rounded-xl" />
                                {bet.amount > 0 && (
                                  <>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <div
                                        className="h-9 w-9 rounded-full border border-amber-200/70 shadow-[0_16px_22px_rgba(0,0,0,0.6)] sm:h-11 sm:w-11 md:h-12 md:w-12"
                                        style={{
                                          backgroundImage: `url(${chipImage})`,
                                          backgroundSize: "cover",
                                          backgroundPosition: "center",
                                        }}
                                      />
                                    </div>
                                    <div className="absolute bottom-1 left-1/2 max-w-[calc(100%-0.5rem)] -translate-x-1/2 rounded-full border border-amber-200/35 bg-black/65 px-1.5 py-0.5 text-center text-[9px] leading-none font-black text-amber-200 shadow-[0_12px_18px_rgba(0,0,0,0.55)] whitespace-nowrap sm:bottom-2 sm:max-w-[calc(100%-1rem)] sm:px-3 sm:py-1 sm:text-[11px]">
                                      ₹{bet.amount.toLocaleString()}
                                    </div>
                                  </>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mx-auto flex w-full max-w-[calc(100vw-2rem)] items-center justify-center px-1 md:col-span-2 md:max-w-none md:px-0">
                      <div className="w-full pr-1 sm:pr-0 md:pr-0">
                        <div className="grid w-full grid-cols-5 justify-items-center gap-2 sm:gap-3">
                          {CHIPS.map((chip, idx) => (
                            <button
                              key={chip}
                              className={`relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 text-center transition sm:h-14 sm:w-14 md:h-[76px] md:w-[76px] ${
                                selectedChip === chip
                                  ? "border-white shadow-[0_0_0_2px_rgba(255,220,140,0.35),0_0_24px_rgba(255,220,140,0.35)] scale-[1.03]"
                                  : "border-white/25 hover:border-white/60"
                              }`}
                              onClick={() => setSelectedChip(chip)}
                              style={{
                                backgroundImage: `url(${
                                  CHIP_IMAGES[idx] || CHIP_IMAGES[0]
                                })`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                                backgroundRepeat: "no-repeat",
                                boxShadow:
                                  "0 10px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.25)",
                              }}
                            >
                              <span className="relative text-[11px] font-black drop-shadow-[0_4px_6px_rgba(0,0,0,0.7)] sm:text-sm">
                                {chip.toLocaleString()}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mx-auto flex w-full max-w-[calc(100vw-2rem)] flex-wrap items-stretch gap-2 pt-0 md:col-start-3 md:row-span-3 md:row-start-2 md:max-w-none md:flex-col md:flex-nowrap md:gap-3 md:self-stretch md:justify-start md:pt-1">
                      <button
                        className="h-11 min-w-[31%] flex-1 rounded-full font-black tracking-wider text-slate-900 transition hover:brightness-110 active:brightness-105 disabled:cursor-not-allowed disabled:opacity-95 md:h-12 md:min-w-0 md:w-full md:flex-none"
                        style={{
                          background:
                            "linear-gradient(180deg, rgba(255,255,255,0.22), rgba(0,0,0,0.14)), linear-gradient(180deg, rgba(255,235,120,0.95), rgba(220,150,10,0.92))",
                          border: "1px solid rgba(0,0,0,0.35)",
                          boxShadow:
                            "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -10px 16px rgba(0,0,0,0.18), 0 14px 24px rgba(0,0,0,0.35)",
                        }}
                        onClick={doubleBets}
                        disabled={isSpinning || totalBet === 0}
                      >
                        DOUBLE
                      </button>
                      <button
                        className="h-11 min-w-[31%] flex-1 rounded-full font-black tracking-wider text-white transition hover:brightness-110 active:brightness-105 disabled:cursor-not-allowed disabled:opacity-95 md:h-12 md:min-w-0 md:w-full md:flex-none"
                        style={{
                          background:
                            "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(0,0,0,0.14)), linear-gradient(180deg, rgba(90,240,90,0.95), rgba(20,140,20,0.92))",
                          border: "1px solid rgba(0,0,0,0.35)",
                          boxShadow:
                            "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -10px 16px rgba(0,0,0,0.18), 0 14px 24px rgba(0,0,0,0.35)",
                        }}
                        onClick={undoBet}
                        disabled={isSpinning || lastPlacedBets.length === 0}
                        title="Undo last bet"
                      >
                        UNDO
                      </button>
                      <button
                        className="h-11 min-w-[31%] flex-1 rounded-full font-black tracking-wider text-white transition hover:brightness-110 active:brightness-105 disabled:cursor-not-allowed disabled:opacity-95 md:h-12 md:min-w-0 md:w-full md:flex-none"
                        style={{
                          background:
                            "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(0,0,0,0.14)), linear-gradient(180deg, rgba(255,120,120,0.95), rgba(170,15,25,0.92))",
                          border: "1px solid rgba(0,0,0,0.35)",
                          boxShadow:
                            "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -10px 16px rgba(0,0,0,0.18), 0 14px 24px rgba(0,0,0,0.35)",
                        }}
                        onClick={clearBets}
                        disabled={isSpinning || lastPlacedBets.length === 0}
                      >
                        CLEAR
                      </button>
                    </div>

                    <div
                      className="mx-auto w-full max-w-[calc(100vw-2rem)] rounded-2xl border-2 border-amber-200/45 px-2.5 py-2 sm:px-3 md:col-span-2 md:max-w-none"
                      style={{
                        background:
                          "linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0.55))",
                        boxShadow:
                          "inset 0 1px 0 rgba(255,255,255,0.12), 0 14px 24px rgba(0,0,0,0.35)",
                      }}
                    >
                      <div className="overflow-x-auto overflow-y-hidden [touch-action:pan-x]">
                        <div className="flex w-max items-center gap-1.5">
                        {recentHistory.map((h, idx) => (
                          <div
                            key={`${h.roundId}-${h.result}-${idx}`}
                            className={`flex h-8 w-8 items-center justify-center rounded-md border border-black/30 text-xl leading-none font-black shadow-[0_10px_14px_rgba(0,0,0,0.45)] sm:h-10 sm:w-10 sm:rounded-lg sm:text-2xl ${historyCellClass(
                              h.result
                            )}`}
                          >
                            {h.result}
                          </div>
                        ))}
                        </div>
                      </div>
                    </div>

                    <div className="mx-auto grid w-full max-w-[calc(100vw-2rem)] items-stretch gap-3 sm:grid-cols-[1fr_220px] sm:gap-4 md:col-span-2 md:max-w-none">
                      <div
                        className="rounded-2xl border-2 border-purple-200/15 px-3 py-2.5 shadow-[0_18px_40px_rgba(0,0,0,0.45)] sm:px-4 sm:py-3"
                        style={{
                          background:
                            "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.12)), linear-gradient(180deg, rgba(110,40,160,0.65), rgba(40,8,70,0.9))",
                        }}
                      >
                        <p className="text-[24px] font-black leading-[1.05] text-lime-300 drop-shadow-[0_6px_10px_rgba(0,0,0,0.55)] sm:text-[28px] md:text-[30px]">
                          Place your
                          <br />
                          chips
                        </p>
                      </div>
                      <div
                        className="rounded-2xl border-2 border-purple-200/15 px-4 py-3 text-center shadow-[0_18px_40px_rgba(0,0,0,0.45)] sm:px-5 sm:py-4"
                        style={{
                          background:
                            "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.12)), linear-gradient(180deg, rgba(90,20,140,0.65), rgba(25,3,45,0.92))",
                        }}
                      >
                        <p className="text-[10px] font-bold tracking-[0.3em] text-white/80 sm:text-[11px] sm:tracking-[0.35em]">
                          TIME LEFT
                        </p>
                        <p className="mt-1 text-[36px] font-black text-white drop-shadow-[0_10px_18px_rgba(0,0,0,0.55)] sm:mt-1.5 sm:text-[42px] md:text-[46px]">
                          {countdownLabel}
                        </p>
                      </div>
                    </div>

                    {status && (
                      <p className="text-center text-xs font-semibold text-amber-200 drop-shadow-[0_6px_10px_rgba(0,0,0,0.6)] sm:text-sm md:col-span-3">
                        {status}
                      </p>
                    )}
                  </div>
                </section>

                <section className="order-1 flex min-w-0 flex-col items-center gap-3 sm:gap-4 xl:order-2 xl:h-full xl:min-h-0">
                  <div className="z-20 w-full max-w-full xl:sticky xl:top-2">
                    <div className="w-full max-w-full rounded-2xl bg-black/15 px-2 py-2 backdrop-blur-[2px] xl:bg-transparent xl:px-0 xl:py-0 xl:backdrop-blur-0">
                      <div className="flex w-full justify-center">
                        <div className="relative">
                          <div className="absolute -left-4 -top-2 h-5 w-5 rotate-45 rounded-sm border-2 border-cyan-200/70 bg-cyan-300/10 shadow-[0_0_20px_rgba(90,240,255,0.35)] sm:-left-6 sm:h-6 sm:w-6" />
                          <div className="absolute -right-4 top-9 h-4 w-4 rotate-45 rounded-sm border-2 border-cyan-200/70 bg-cyan-300/10 shadow-[0_0_20px_rgba(90,240,255,0.35)] sm:-right-6 sm:top-10 sm:h-5 sm:w-5" />
                          <h2
                            className="text-center text-4xl font-black leading-[0.9] drop-shadow-[0_10px_18px_rgba(0,0,0,0.7)] sm:text-5xl"
                            style={{
                              backgroundImage:
                                "linear-gradient(180deg, #fff3b0 0%, #ffd24a 40%, #c88412 100%)",
                              WebkitBackgroundClip: "text",
                              backgroundClip: "text",
                              color: "transparent",
                            }}
                          >
                            FUN
                            <br />
                            TIMER
                          </h2>
                        </div>
                      </div>

                      <div className="relative mt-2 sm:mt-0">
                        <div className="pointer-events-none absolute left-1/2 -top-2 z-40 -translate-x-1/2">
                          <div className="h-7 w-7 rotate-45 rounded-[10px] border border-white/30 bg-gradient-to-b from-sky-200 to-blue-600 shadow-[0_14px_24px_rgba(0,0,0,0.55)] sm:h-9 sm:w-9" />
                        </div>

                        <div className="p-0">
                          <div className="relative mx-auto h-[min(88vw,420px)] w-[min(88vw,420px)] max-w-full overflow-visible md:h-[520px] md:w-[520px]">
                        <div
                          className="absolute inset-[12%] overflow-hidden rounded-full shadow-[0_26px_70px_rgba(0,0,0,0.55)] sm:inset-[11%] md:inset-[54px]"
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
                                  className="absolute left-1/2 top-1/2"
                                  style={{
                                    transform: `translate(-50%, -50%) rotate(${angleDeg}deg) translateY(calc(-50% - ${NUMBER_RING_OFFSET})) rotate(${-(
                                      angleDeg + spinRotation
                                    )}deg)`,
                                  }}
                                >
                                  <span
                                    className={`block text-2xl font-black drop-shadow-[0_6px_12px_rgba(0,0,0,0.6)] transition-transform sm:text-3xl md:text-4xl ${
                                      isHit
                                        ? "text-yellow-200 scale-110"
                                        : "text-white"
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
                          className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 select-none object-contain drop-shadow-[0_26px_48px_rgba(0,0,0,0.6)] sm:h-[118%] sm:w-[118%] md:h-[116%] md:w-[116%]"
                        />
                        {centerResultNumber !== null && (
                          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
                            <div
                              className="grid h-20 w-20 place-items-center rounded-full border-[3px] border-amber-200/70 shadow-[0_16px_34px_rgba(0,0,0,0.45)] sm:h-24 sm:w-24 md:h-28 md:w-28"
                              style={{
                                background:
                                  "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.32), rgba(255,230,150,0.18) 55%, rgba(0,0,0,0.35) 100%), linear-gradient(145deg, rgba(255,255,255,0.15), rgba(0,0,0,0.55))",
                                boxShadow:
                                  "inset 0 0 24px rgba(0,0,0,0.4), 0 14px 32px rgba(0,0,0,0.55)",
                              }}
                            >
                              <span className="text-4xl font-black text-yellow-100 drop-shadow-[0_8px_14px_rgba(0,0,0,0.7)] sm:text-5xl md:text-6xl">
                                {centerResultNumber}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex w-full justify-center xl:justify-start">
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
                          className={`h-9 w-9 rounded-full border flex items-center justify-center transition ${
                            soundOn
                              ? "border-emerald-300/60 text-emerald-200 bg-emerald-500/10"
                              : "border-white/20 text-pink-100/70 bg-white/5 hover:bg-white/10"
                          }`}
                          aria-label={
                            soundOn ? "Mute wheel sound" : "Unmute wheel sound"
                          }
                          title={soundOn ? "Sound on" : "Sound off"}
                        >
                          {soundOn ? (
                            <svg
                              viewBox="0 0 24 24"
                              className="h-4 w-4"
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
                              className="h-4 w-4"
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
                    </div>
                  </div>
                    </div>
                  </div>

                  <div className="mx-auto grid w-full max-w-[420px] grid-cols-2 gap-2 pb-1 xl:mt-auto">
                    <div
                      className="rounded-lg border border-white/10 px-3 py-2 shadow-[0_10px_18px_rgba(0,0,0,0.45)]"
                      style={{
                        background:
                          "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.12)), linear-gradient(180deg, rgba(20,40,70,0.95), rgba(5,10,20,0.95))",
                      }}
                    >
                      <p className="text-[11px] font-black tracking-wider text-white/80">
                        PLAY :{" "}
                        <span className="text-white">
                          ₹{totalBet.toLocaleString()}
                        </span>
                      </p>
                    </div>
                    <div
                      className="rounded-lg border border-white/10 px-3 py-2 shadow-[0_10px_18px_rgba(0,0,0,0.45)]"
                      style={{
                        background:
                          "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.12)), linear-gradient(180deg, rgba(20,40,70,0.95), rgba(5,10,20,0.95))",
                      }}
                    >
                      <p className="text-[11px] font-black tracking-wider text-white/80">
                        WIN :{" "}
                        <span className="text-white">
                          ₹{winAmount.toLocaleString()}
                        </span>
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </>
          );
        })()}
      </div>
      {resultToast && (
        <div className="fixed bottom-24 left-1/2 z-[90] w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 sm:bottom-20">
          <div className="rounded-full border border-emerald-300/50 bg-black/85 px-4 py-2.5 text-center text-sm text-emerald-200 shadow-lg shadow-emerald-400/30 backdrop-blur-md sm:px-6 sm:py-3">
            {resultToast}
          </div>
        </div>
      )}
      {betToast && (
        <div className="fixed bottom-8 left-1/2 z-[90] w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 sm:bottom-6">
          <div className="rounded-full border border-amber-300/50 bg-black/80 px-4 py-2.5 text-center text-sm text-amber-200 shadow-lg shadow-amber-400/30 backdrop-blur-md sm:px-6 sm:py-3">
            {betToast}
          </div>
        </div>
      )}
    </div>
  );
}
