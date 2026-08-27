/* eslint-disable @next/next/no-img-element */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useEffect, useRef, useState } from "react";
import SimplePeer from "simple-peer";
import io, { Socket } from "socket.io-client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
const SOCKET_URL = API_BASE.replace(/\/api$/, "");
const DEFAULT_SPIN_MS = 5000;
const FINAL_SETTLE_FALLBACK_SPEED = 520;
const MIN_FINAL_SETTLE_MS = 850;
const FREE_SPIN_DEGREES_PER_SECOND = 540;
const NUMBER_RING_OFFSET = "clamp(58px, 14vw, 106px)";
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
  const [token] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("player-token") || "";
  });
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
  const spinLoopStateRef = useRef({
    lastTime: 0,
  });
  const activeSpinRoundIdRef = useRef<string | null>(null);
  const roundStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    return motion.from + (motion.to - motion.from) * Math.min(1, Math.max(0, progress));
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
      const nextRotation = rotationRef.current + angularVelocityRef.current * delta;

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

    const minDistanceForSmoothStop = (startVelocity * MIN_FINAL_SETTLE_MS) / 2;
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

      angularVelocityRef.current = Math.max(0, startVelocity + acceleration * clampedElapsed);
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
      const finalSettleMs = Math.round(startFinalSettleLoop(neededDelta));
      spinEndRef.current = Date.now() + finalSettleMs;

      if (resultTimerRef.current) {
        clearTimeout(resultTimerRef.current);
      }

      const revealResult = () => {
        if (spinRevealDoneRef.current) return;
        spinRevealDoneRef.current = true;
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

  const centerResultNumber =
    !isSpinning && highlightNumber !== null ? highlightNumber : null;
  const countdownLabel = String(Math.max(0, Math.floor(countdown)));
  const recentHistory = history.slice(-10).reverse();
  const historyCellClass = (n: number) =>
    NUMBER_TILE_CLASSES[n] || NUMBER_TILE_CLASSES[0];

  if (!token) {
    return (
      <div className="relative min-h-[100dvh] overflow-hidden text-white">
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
        <div className="flex min-h-[100dvh] items-center justify-center px-6">
          <div className="rounded-3xl border border-white/15 bg-black/35 px-6 py-5 text-center shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-md">
            <p className="text-sm font-semibold text-white/85">
              Login on the home page to sync this wheel view.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden text-white">
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

      <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-6">
        <div className="flex w-full max-w-[640px] flex-col items-center gap-8">
          <div className="relative">
          <div className="pointer-events-none absolute left-1/2 top-0 z-40 -translate-x-1/2 -translate-y-1/3">
            <div className="h-7 w-7 rotate-45 rounded-[10px] border border-white/30 bg-gradient-to-b from-sky-200 to-blue-600 shadow-[0_14px_24px_rgba(0,0,0,0.55)] sm:h-9 sm:w-9" />
          </div>

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
                        transform: `translate(-50%, -50%) rotate(${angleDeg}deg) translateY(calc(-50% - ${NUMBER_RING_OFFSET})) rotate(${-(angleDeg + spinRotation)}deg)`,
                      }}
                    >
                      <span
                        className={`block text-2xl font-black drop-shadow-[0_6px_12px_rgba(0,0,0,0.6)] transition-transform sm:text-3xl md:text-4xl ${
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
              className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 select-none object-contain drop-shadow-[0_26px_48px_rgba(0,0,0,0.6)] sm:h-[118%] sm:w-[118%] md:h-[116%] md:w-[116%]"
            />

            {centerResultNumber !== null && (
              <div className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2">
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

          <div className="pointer-events-none absolute inset-x-0 -bottom-3 flex justify-center">
            <div className="rounded-full border border-white/12 bg-black/30 px-4 py-1.5 text-sm font-black tracking-[0.24em] text-white/85 shadow-[0_12px_22px_rgba(0,0,0,0.35)] backdrop-blur-sm">
              {countdownLabel}
            </div>
          </div>
          </div>

          <div
            className="w-full max-w-[calc(100vw-2rem)] rounded-2xl border-2 border-amber-200/45 px-2.5 py-2 sm:px-3"
            style={{
              background:
                "linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0.55))",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.12), 0 14px 24px rgba(0,0,0,0.35)",
            }}
          >
            <div className="overflow-x-auto overflow-y-hidden [touch-action:pan-x]">
              <div className="flex min-w-full items-center justify-between gap-1.5">
                {recentHistory.map((h, idx) => (
                  <div
                    key={`${h.roundId}-${h.result}-${idx}`}
                    className={`flex h-8 min-w-8 flex-none items-center justify-center rounded-md border border-black/30 text-[1.65rem] font-black leading-[0.8] tracking-[-0.08em] shadow-[0_10px_14px_rgba(0,0,0,0.45)] sm:h-10 sm:min-w-10 sm:rounded-lg sm:text-[2.1rem] ${historyCellClass(
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
