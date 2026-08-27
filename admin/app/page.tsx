/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SimplePeer from "simple-peer";
import io, { Socket } from "socket.io-client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
const SOCKET_URL = API_BASE.replace(/\/api$/, "");
const DIGITS = Array.from({ length: 10 }, (_, i) => i);

type SyncMessage = { event: string; payload: any; ts?: number };

const neonCard =
  "rounded-xl border border-white/10 bg-white/5 backdrop-blur-lg shadow-lg shadow-pink-500/20";
const REPORTS_PAGE_SIZE = 25;

const formatClock = (input: string | number | Date) =>
  new Date(input).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
const formatRoundTime = (payload: any) => {
  if (payload && typeof payload === "object") {
    const timeSource = payload.startTime || payload.endTime || payload.lockTime;
    const parsed = timeSource ? new Date(timeSource) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) {
      return formatClock(parsed);
    }
  }
  return formatClock(Date.now());
};

export default function AdminApp() {
  const [token, setToken] = useState("");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [status, setStatus] = useState("");
  const [successToast, setSuccessToast] = useState("");
  const [view, setView] = useState<
    "dashboard" | "users" | "reports" | "rounds" | "account" | "control"
  >("dashboard");
  const [dashboard, setDashboard] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [reportSummary, setReportSummary] = useState<any>(null);
  const [rounds, setRounds] = useState<any[]>([]);
  const [selectedRound, setSelectedRound] = useState<{
    id: string;
    time: string;
    resultNumber?: number | null;
  } | null>(null);
  const [selectedUser, setSelectedUser] = useState("");
  const [passwordUpdate, setPasswordUpdate] = useState("");
  const [passwordModalUser, setPasswordModalUser] = useState<string | null>(
    null
  );
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [roundBets, setRoundBets] = useState<any[]>([]);
  const [walletHistory, setWalletHistory] = useState<any[]>([]);
  const [rtpConfig, setRtpConfig] = useState<any>(null);
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("all");
  const [reportPagination, setReportPagination] = useState({
    page: 1,
    limit: REPORTS_PAGE_SIZE,
    totalItems: 0,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false,
  });
  const [historyFilter, setHistoryFilter] = useState<"all" | "bets" | "admin">(
    "all"
  );
  const [newUser, setNewUser] = useState({
    userId: "",
    name: "",
    phone: "",
    district: "",
    state: "",
    email: "",
    password: "",
    initialBalance: 0,
  });
  const [creditForm, setCreditForm] = useState({ amount: 0, reason: "" });
  const [debitForm, setDebitForm] = useState({ amount: 0, reason: "" });
  const [socketConnected, setSocketConnected] = useState(false);
  const [activeRoundId, setActiveRoundId] = useState<string | null>(null);
  const [activeRoundRemainingMs, setActiveRoundRemainingMs] = useState(0);
  const [activeRoundPhase, setActiveRoundPhase] = useState<
    "betting" | "spinning" | "settling" | null
  >(null);
  const [resultRules, setResultRules] = useState<{
    dailyFixedRules: any[];
    dailyBlockedRules: any[];
    activeRound: any | null;
    currentRoundOneOffBlocks: any[];
    currentRoundOneOffFixed: any | null;
  }>({
    dailyFixedRules: [],
    dailyBlockedRules: [],
    activeRound: null,
    currentRoundOneOffBlocks: [],
    currentRoundOneOffFixed: null,
  });
  const [fixedRuleForm, setFixedRuleForm] = useState({
    timeKey: "",
    fixedNumber: 0,
    enabled: true,
    notes: "",
  });
  const [blockedDailyForm, setBlockedDailyForm] = useState<{
    timeKey: string;
    blockedNumbers: number[];
    enabled: boolean;
    notes: string;
  }>({
    timeKey: "",
    blockedNumbers: [],
    enabled: true,
    notes: "",
  });
  const [currentRoundFixedNumber, setCurrentRoundFixedNumber] = useState<
    number | null
  >(null);
  const [currentRoundExcludedNumber, setCurrentRoundExcludedNumber] = useState<
    number | null
  >(null);
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, any>>(new Map());

  const syncRoundTimerFromPayload = (payload: any) => {
    if (!payload || typeof payload !== "object") return;
    if (typeof payload.roundId === "string" && payload.roundId) {
      setActiveRoundId(payload.roundId);
    }
    if (typeof payload.phase === "string") {
      setActiveRoundPhase(payload.phase as "betting" | "spinning" | "settling");
    }

    const settlementRemainingMs = Number(payload.settlementRemainingMs);
    if (Number.isFinite(settlementRemainingMs)) {
      setActiveRoundRemainingMs(Math.max(0, Math.round(settlementRemainingMs)));
      return;
    }

    const remainingFromPayload = Number(payload.remainingMs);
    if (Number.isFinite(remainingFromPayload)) {
      setActiveRoundRemainingMs(Math.max(0, Math.round(remainingFromPayload)));
      return;
    }

    const settleMs = payload.settleAt ? new Date(payload.settleAt).getTime() : NaN;
    if (Number.isFinite(settleMs)) {
      setActiveRoundRemainingMs(Math.max(0, settleMs - Date.now()));
      return;
    }

    const endMs = payload.endTime ? new Date(payload.endTime).getTime() : NaN;
    if (Number.isFinite(endMs)) {
      setActiveRoundRemainingMs(Math.max(0, endMs - Date.now()));
      return;
    }

    const durationMs = Number(payload.durationMs);
    if (Number.isFinite(durationMs)) {
      setActiveRoundRemainingMs(Math.max(0, Math.round(durationMs)));
    }
  };

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
          const message = await res.json().catch(() => ({}));
          throw new Error(message.message || "Request failed");
        }
        return res.json();
      },
    [token]
  );
  const visibleReportPages = useMemo(() => {
    if (reportPagination.totalItems === 0) return [];
    const maxVisiblePages = 5;
    const start = Math.max(1, reportPagination.page - 2);
    const end = Math.min(
      reportPagination.totalPages,
      start + maxVisiblePages - 1
    );
    const adjustedStart = Math.max(1, end - maxVisiblePages + 1);
    return Array.from(
      { length: end - adjustedStart + 1 },
      (_, index) => adjustedStart + index
    );
  }, [
    reportPagination.page,
    reportPagination.totalItems,
    reportPagination.totalPages,
  ]);

  const handleSyncEvent = (msg: SyncMessage) => {
    if (msg.event === "round-result") {
      setActiveRoundRemainingMs(0);
      setActiveRoundPhase("settling");
      loadDashboard();
      loadReports();
      loadRounds();
    }
    if (msg.event === "round-start") {
      setStatus(`New round started at ${formatRoundTime(msg.payload)}`);
      syncRoundTimerFromPayload(msg.payload);
      loadResultRules();
    }
    if (msg.event === "round-countdown") {
      syncRoundTimerFromPayload(msg.payload);
    }
    if (msg.event === "round-spin-start") {
      syncRoundTimerFromPayload(msg.payload);
    }
  };

  const broadcastToPeers = (msg: SyncMessage) => {
    peersRef.current.forEach((peer) => {
      if (peer.connected) {
        peer.send(JSON.stringify(msg));
      }
    });
  };

  const logout = () => {
    localStorage.removeItem("admin-token");
    localStorage.removeItem("admin-email");
    setToken("");
    setDashboard(null);
    setUsers([]);
    setReports([]);
    setReportSummary(null);
    setReportPagination({
      page: 1,
      limit: REPORTS_PAGE_SIZE,
      totalItems: 0,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    });
    setRounds([]);
    setSelectedRound(null);
    setRoundBets([]);
    setWalletHistory([]);
    setSelectedUser("");
    setActiveRoundId(null);
    setActiveRoundRemainingMs(0);
    setActiveRoundPhase(null);
    setStatus("Logged out");
  };

  const setupWebRTC = (socket: Socket) => {
    const createPeer = (peerId: string, initiator: boolean) => {
      if (peersRef.current.has(peerId)) return;
      const peer = new SimplePeer({ initiator, trickle: true });
      peer.on("signal", (data: any) => {
        const payload =
          data.type === "offer"
            ? { offer: data }
            : data.type === "answer"
              ? { answer: data }
            : { candidate: data };
        if ("offer" in payload) {
          socket.emit("webrtc-offer", { target: peerId, offer: payload.offer });
        } else if ("answer" in payload) {
          socket.emit("webrtc-answer", {
            target: peerId,
            answer: payload.answer,
          });
        } else {
          socket.emit("webrtc-ice-candidate", {
            target: peerId,
            candidate: payload.candidate,
          });
        }
      });
      peer.on("data", (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          handleSyncEvent(msg);
        } catch (err) {
          console.error("Invalid RTC message", err);
        }
      });
      peer.on("error", () => {
        peersRef.current.delete(peerId);
      });
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
      if (targetPeer) {
        targetPeer.signal(offer);
      }
    });
    socket.on("webrtc-answer", ({ from, answer }) => {
      const peer = peersRef.current.get(from);
      if (peer) peer.signal(answer);
    });
    socket.on("webrtc-ice-candidate", ({ from, candidate }) => {
      const peer = peersRef.current.get(from);
      if (peer) peer.signal(candidate);
    });
  };

  useEffect(() => {
    const saved = localStorage.getItem("admin-token");
    const savedEmail = localStorage.getItem("admin-email");
    if (saved) {
      setToken(saved);
      setLoginForm((f) => ({ ...f, email: savedEmail || f.email }));
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    loadDashboard();
    loadUsers();
    loadReports();
    loadRounds();
    loadRtp();
    loadResultRules();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const socket = io(SOCKET_URL, { transports: ["websocket"] });
    socketRef.current = socket;
    socket.on("connect", () => {
      setSocketConnected(true);
      socket.emit("authenticate", token);
      socket.emit("join-rtc");
    });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("round-result", (payload) => {
      const msg = { event: "round-result", payload, ts: Date.now() };
      handleSyncEvent(msg);
      broadcastToPeers(msg);
    });
    socket.on("round-start", (payload) => {
      const msg = { event: "round-start", payload, ts: Date.now() };
      handleSyncEvent(msg);
      broadcastToPeers(msg);
    });
    socket.on("round-countdown", (payload) => {
      const msg = { event: "round-countdown", payload, ts: Date.now() };
      handleSyncEvent(msg);
    });
    socket.on("round-spin-start", (payload) => {
      const msg = { event: "round-spin-start", payload, ts: Date.now() };
      handleSyncEvent(msg);
      broadcastToPeers(msg);
    });
    socket.on("rtc-relay", (msg: SyncMessage) => {
      handleSyncEvent(msg);
      broadcastToPeers(msg);
    });

    setupWebRTC(socket);

    return () => {
      socket.disconnect();
      peersRef.current.forEach((peer) => peer.destroy());
      peersRef.current.clear();
    };
  }, [token]);

  useEffect(() => {
    if (!successToast) return;
    const timer = setTimeout(() => setSuccessToast(""), 2500);
    return () => clearTimeout(timer);
  }, [successToast]);

  const login = async () => {
    setStatus("");
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      if (!res.ok) {
        throw new Error("Invalid credentials");
      }
      const data = await res.json();
      setToken(data.token);
      localStorage.setItem("admin-token", data.token);
      localStorage.setItem("admin-email", loginForm.email);
      setStatus("Logged in");
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const loadDashboard = async () => {
    try {
      const data = await apiFetch("/admin/dashboard");
      setDashboard(data);
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await apiFetch("/admin/users");
      setUsers(data);
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const loadReports = async (filters?: {
    startDate?: string;
    endDate?: string;
    timeSlot?: string;
    page?: number;
  }) => {
    try {
      const startDateValue = filters?.startDate ?? reportStartDate;
      const endDateValue = filters?.endDate ?? reportEndDate;
      const timeSlotValue = filters?.timeSlot ?? timeSlot;
      const pageValue = Math.max(1, filters?.page ?? reportPagination.page);
      const params = new URLSearchParams();
      if (startDateValue) params.append("startDate", startDateValue);
      if (endDateValue) params.append("endDate", endDateValue);
      if (timeSlotValue && timeSlotValue !== "all") {
        params.append("timeSlot", timeSlotValue);
      }
      params.append("page", String(pageValue));
      params.append("limit", String(REPORTS_PAGE_SIZE));
      const qs = params.toString();
      const data = await apiFetch(`/admin/reports${qs ? `?${qs}` : ""}`);
      setReports(data.bets);
      setReportSummary(data.summary);
      setReportPagination(
        data.pagination || {
          page: pageValue,
          limit: REPORTS_PAGE_SIZE,
          totalItems: data.bets?.length || 0,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        }
      );
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const applyReportFilters = () => {
    loadReports({
      startDate: reportStartDate,
      endDate: reportEndDate,
      timeSlot,
      page: 1,
    });
  };

  const clearReportFilters = () => {
    const clearedStartDate = "";
    const clearedEndDate = "";
    const clearedSlot = "all";
    setReportStartDate(clearedStartDate);
    setReportEndDate(clearedEndDate);
    setTimeSlot(clearedSlot);
    loadReports({
      startDate: clearedStartDate,
      endDate: clearedEndDate,
      timeSlot: clearedSlot,
      page: 1,
    });
  };

  const changeReportPage = (page: number) => {
    if (page === reportPagination.page) return;
    loadReports({ page });
  };

  const loadRounds = async () => {
    try {
      const data = await apiFetch("/admin/rounds");
      setRounds(data);
      if (selectedRound) {
        const found = data.find((r: any) => r.roundId === selectedRound.id);
        if (found) {
          setSelectedRound({
            id: found.roundId,
            time: formatClock(found.endTime),
            resultNumber: found.resultNumber ?? null,
          });
          loadRoundBets(found);
        }
      }
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const loadRoundBets = async (round: {
    roundId: string;
    endTime?: string;
    resultNumber?: number | null;
  }) => {
    setSelectedRound({
      id: round.roundId,
      time: formatClock(round.endTime || Date.now()),
      resultNumber: round.resultNumber ?? null,
    });
    try {
      const data = await apiFetch(`/admin/rounds/${round.roundId}`);
      setRoundBets(data.bets);
      setSelectedRound({
        id: round.roundId,
        time: formatClock(round.endTime || Date.now()),
        resultNumber: data.resultNumber ?? round.resultNumber ?? null,
      });
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const loadWalletHistory = async (userId: string) => {
    try {
      const data = await apiFetch(`/admin/wallet/history/${userId}`);
      setWalletHistory(data);
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const loadRtp = async () => {
    try {
      const data = await apiFetch("/admin/rtp");
      setRtpConfig({
        ...data,
        roundDurationSeconds: data?.roundDurationSeconds ?? 90,
      });
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const loadResultRules = async () => {
    try {
      const data = await apiFetch("/admin/result-rules");
      const activeRound = data?.activeRound || null;
      setResultRules({
        dailyFixedRules: data?.dailyFixedRules || [],
        dailyBlockedRules: data?.dailyBlockedRules || [],
        activeRound,
        currentRoundOneOffBlocks: data?.currentRoundOneOffBlocks || [],
        currentRoundOneOffFixed: data?.currentRoundOneOffFixed || null,
      });
      if (activeRound?.roundId) {
        setActiveRoundId(activeRound.roundId);
        setActiveRoundPhase(activeRound.phase || "betting");
        const remainingMs = Number(activeRound.settlementRemainingMs);
        const settleMs = activeRound.settleAt
          ? new Date(activeRound.settleAt).getTime()
          : NaN;
        setActiveRoundRemainingMs(
          Number.isFinite(remainingMs)
            ? Math.max(0, Math.round(remainingMs))
            : Number.isFinite(settleMs)
              ? Math.max(0, settleMs - Date.now())
              : 0
        );
      } else {
        setActiveRoundId(null);
        setActiveRoundRemainingMs(0);
        setActiveRoundPhase(null);
      }
      const oneOffBlocked = data?.currentRoundOneOffBlocks?.[0]?.blockedNumbers || [];
      const oneOffExcluded = oneOffBlocked.find(
        (entry: any) => Number.isInteger(entry) && entry >= 0 && entry <= 9
      );
      const oneOffFixed = data?.currentRoundOneOffFixed?.fixedNumber;
      setCurrentRoundExcludedNumber(
        Number.isInteger(oneOffExcluded) ? oneOffExcluded : null
      );
      setCurrentRoundFixedNumber(
        Number.isInteger(oneOffFixed) && oneOffFixed >= 0 && oneOffFixed <= 9
          ? oneOffFixed
          : null
      );
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const toggleDigit = (
    list: number[],
    digit: number,
    setter: (next: number[]) => void
  ) => {
    if (list.includes(digit)) {
      setter(list.filter((n) => n !== digit));
      return;
    }
    setter([...list, digit].sort((a, b) => a - b));
  };
  const toggleSingleDigit = (
    current: number | null,
    digit: number,
    setter: (next: number | null) => void
  ) => {
    setter(current === digit ? null : digit);
  };

  const saveFixedRule = async () => {
    setStatus("");
    try {
      await apiFetch("/admin/result-rules/fixed", {
        method: "POST",
        body: JSON.stringify({
          timeKey: fixedRuleForm.timeKey,
          fixedNumber: Number(fixedRuleForm.fixedNumber),
          enabled: fixedRuleForm.enabled,
          notes: fixedRuleForm.notes,
        }),
      });
      setStatus("Fixed result rule saved");
      loadResultRules();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const deleteFixedRule = async (timeKey: string) => {
    setStatus("");
    try {
      await apiFetch(`/admin/result-rules/fixed/${encodeURIComponent(timeKey)}`, {
        method: "DELETE",
      });
      setStatus(`Deleted fixed rule for ${timeKey}`);
      loadResultRules();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const toggleFixedRuleEnabled = async (rule: any) => {
    setStatus("");
    try {
      await apiFetch("/admin/result-rules/fixed", {
        method: "POST",
        body: JSON.stringify({
          timeKey: rule.timeKey,
          fixedNumber: Number(rule.fixedNumber),
          enabled: !rule.enabled,
          notes: rule.notes || "",
        }),
      });
      setStatus(`Fixed rule ${rule.timeKey} updated`);
      loadResultRules();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const saveDailyBlockedRule = async () => {
    setStatus("");
    try {
      await apiFetch("/admin/result-rules/blocked/daily", {
        method: "POST",
        body: JSON.stringify(blockedDailyForm),
      });
      setStatus("Daily blocked-numbers rule saved");
      loadResultRules();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const deleteDailyBlockedRule = async (timeKey: string) => {
    setStatus("");
    try {
      await apiFetch(
        `/admin/result-rules/blocked/daily/${encodeURIComponent(timeKey)}`,
        { method: "DELETE" }
      );
      setStatus(`Deleted blocked rule for ${timeKey}`);
      loadResultRules();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const toggleDailyBlockedRuleEnabled = async (rule: any) => {
    setStatus("");
    try {
      await apiFetch("/admin/result-rules/blocked/daily", {
        method: "POST",
        body: JSON.stringify({
          timeKey: rule.timeKey,
          blockedNumbers: rule.blockedNumbers || [],
          enabled: !rule.enabled,
          notes: rule.notes || "",
        }),
      });
      setStatus(`Blocked rule ${rule.timeKey} updated`);
      loadResultRules();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const applyCurrentRoundFixed = async () => {
    setStatus("");
    if (currentRoundFixedNumber === null) {
      setStatus("Select a result number first");
      return;
    }
    try {
      await apiFetch("/admin/result-rules/fixed/current-round", {
        method: "POST",
        body: JSON.stringify({
          fixedNumber: currentRoundFixedNumber,
          notes: "Configured from admin control panel",
        }),
      });
      setStatus("Current round fixed result applied");
      setSuccessToast("Fixed result applied successfully");
      loadResultRules();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const clearCurrentRoundFixed = async () => {
    setStatus("");
    try {
      await apiFetch("/admin/result-rules/fixed/current-round", {
        method: "DELETE",
      });
      setStatus("Current round fixed result cleared");
      setCurrentRoundFixedNumber(null);
      loadResultRules();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const applyCurrentRoundExclude = async () => {
    setStatus("");
    if (currentRoundExcludedNumber === null) {
      setStatus("Select a number to exclude first");
      return;
    }
    try {
      await apiFetch("/admin/result-rules/blocked/current-round", {
        method: "POST",
        body: JSON.stringify({
          excludedNumber: currentRoundExcludedNumber,
          notes: "Configured from admin control panel",
        }),
      });
      setStatus("Current round exclusion applied");
      loadResultRules();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const clearCurrentRoundExclude = async () => {
    setStatus("");
    try {
      await apiFetch("/admin/result-rules/blocked/current-round", {
        method: "DELETE",
      });
      setStatus("Current round exclusion cleared");
      setCurrentRoundExcludedNumber(null);
      loadResultRules();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const activeRoundExcludedNumbers =
    resultRules.currentRoundOneOffBlocks?.[0]?.blockedNumbers || [];
  const activeRoundExcludedNumber = activeRoundExcludedNumbers.find(
    (entry: any) => Number.isInteger(entry) && entry >= 0 && entry <= 9
  );
  const hasCurrentRoundFixedActive =
    Number.isInteger(resultRules.currentRoundOneOffFixed?.fixedNumber) &&
    resultRules.currentRoundOneOffFixed.fixedNumber >= 0 &&
    resultRules.currentRoundOneOffFixed.fixedNumber <= 9;
  const hasCurrentRoundExcludeActive = Number.isInteger(activeRoundExcludedNumber);
  const hasLegacyCurrentRoundConflict =
    hasCurrentRoundFixedActive && hasCurrentRoundExcludeActive;
  const hasActiveRound = Boolean(resultRules.activeRound);
  const disableFixedControl =
    !hasActiveRound ||
    hasLegacyCurrentRoundConflict ||
    (hasCurrentRoundExcludeActive && !hasCurrentRoundFixedActive);
  const disableExcludeControl =
    !hasActiveRound ||
    hasLegacyCurrentRoundConflict ||
    (hasCurrentRoundFixedActive && !hasCurrentRoundExcludeActive);
  const activeRoundSecondsLeft = Math.max(0, Math.ceil(activeRoundRemainingMs / 1000));
  const activeRoundTimerLabel = activeRoundId ? `${activeRoundSecondsLeft}s` : "--";
  const activeRoundPhaseLabel =
    activeRoundPhase === "spinning"
      ? "Post-close spin"
      : activeRoundPhase === "settling"
        ? "Settling"
        : activeRoundPhase === "betting"
          ? "Betting open"
          : "No active round";

  const createUser = async () => {
    try {
      await apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify(newUser),
      });
      setStatus("User created");
      setNewUser({
        userId: "",
        name: "",
        phone: "",
        district: "",
        state: "",
        email: "",
        password: "",
        initialBalance: 0,
      });
      setShowAddUserModal(false);
      loadUsers();
      loadDashboard();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const submitWalletChange = async (type: "credit" | "debit") => {
    if (!selectedUser) return;
    try {
      const form = type === "credit" ? creditForm : debitForm;
      await apiFetch(`/admin/wallet/${selectedUser}/${type}`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      setStatus(`Wallet ${type} applied`);
      loadWalletHistory(selectedUser);
      loadUsers();
      loadDashboard();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const updateRtp = async () => {
    try {
      const roundDurationSeconds = Number(rtpConfig.roundDurationSeconds);
      if (!Number.isFinite(roundDurationSeconds)) {
        throw new Error("Enter a valid round timer (seconds)");
      }
      if (roundDurationSeconds < 10 || roundDurationSeconds > 600) {
        throw new Error("Round timer must be between 10 and 600 seconds");
      }
      const payload = {
        targetRtpPercent: rtpConfig.targetRtpPercent,
        roundDurationSeconds,
      };
      const updated = await apiFetch("/admin/rtp", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setStatus("RTP updated");
      setRtpConfig({
        ...updated,
        roundDurationSeconds:
          updated?.roundDurationSeconds ?? payload.roundDurationSeconds ?? 90,
      });
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const updatePassword = async (userId: string | null) => {
    if (!userId) return;
    if (!passwordUpdate) {
      setStatus("Enter a new password");
      return;
    }
    try {
      await apiFetch(`/admin/users/${userId}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password: passwordUpdate }),
      });
      setStatus("Password updated");
      setPasswordUpdate("");
      setPasswordModalUser(null);
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  const deleteUser = async (userId: string) => {
    if (!userId) return;
    const confirmDelete = window.confirm(
      `Delete user ${userId}? This cannot be undone.`
    );
    if (!confirmDelete) return;
    try {
      await apiFetch(`/admin/users/${userId}`, { method: "DELETE" });
      setStatus("User deleted");
      setSelectedUser("");
      loadUsers();
      loadDashboard();
    } catch (err: any) {
      setStatus(err.message);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-purple-950 to-black flex items-center justify-center text-white">
        <div className={`${neonCard} p-8 w-full max-w-lg`}>
          <h1 className="text-3xl font-semibold mb-6 text-center">
            Admin Panel Login
          </h1>
          <div className="space-y-4">
            <input
              className="w-full rounded-lg bg-black/40 px-4 py-3 border border-pink-500/40 focus:border-pink-400 outline-none"
              placeholder="Email"
              value={loginForm.email}
              onChange={(e) =>
                setLoginForm({ ...loginForm, email: e.target.value })
              }
            />
            <input
              className="w-full rounded-lg bg-black/40 px-4 py-3 border border-pink-500/40 focus:border-pink-400 outline-none"
              type="password"
              placeholder="Password"
              value={loginForm.password}
              onChange={(e) =>
                setLoginForm({ ...loginForm, password: e.target.value })
              }
            />
            <button
              className="w-full rounded-lg bg-gradient-to-r from-pink-500 via-red-500 to-amber-400 py-3 font-semibold shadow-lg shadow-pink-500/40"
              onClick={login}
            >
              Login
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,0,128,0.35),_transparent_35%),radial-gradient(circle_at_bottom,_rgba(255,170,0,0.2),_transparent_30%),#05060a] text-white">
      {successToast && (
        <div className="fixed right-6 top-6 z-[70] rounded-lg border border-emerald-300/40 bg-emerald-500/20 px-4 py-3 text-sm font-medium text-emerald-100 shadow-lg shadow-emerald-900/30 backdrop-blur">
          {successToast}
        </div>
      )}
      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Fun Timer Admin
            </h1>
            <p className="mt-1 text-xs text-pink-200/80">
              {activeRoundPhaseLabel}: {activeRoundTimerLabel}
            </p>
          </div>
          <div className="flex gap-2">
            {["dashboard", "users", "reports", "rounds", "account", "control"].map(
              (tab) => (
                <button
                  key={tab}
                  className={`px-4 py-2 rounded-lg text-sm capitalize border border-white/10 ${
                    view === tab
                      ? "bg-pink-600/80 shadow-lg shadow-pink-500/40"
                      : "bg-white/5 hover:bg-white/10"
                  }`}
                  onClick={() => setView(tab as any)}
                >
                  {tab}
                </button>
              )
            )}
            <button
              className="px-4 py-2 rounded-lg text-sm capitalize border border-red-500/50 bg-red-600/70 hover:bg-red-600"
              onClick={logout}
            >
              Logout
            </button>
          </div>
        </header>

        {status && (
          <div className={`${neonCard} px-4 py-3 text-sm text-amber-100`}>
            {status}
          </div>
        )}

        {view === "dashboard" && dashboard && (
          <section className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className={`${neonCard} p-4`}>
              <p className="text-xs uppercase text-pink-200/80">Total Users</p>
              <p className="text-3xl font-bold">
                {dashboard.totals.totalUsers}
              </p>
            </div>
            <div className={`${neonCard} p-4`}>
              <p className="text-xs uppercase text-pink-200/80">
                Bet Volume Accepted
              </p>
              <p className="text-3xl font-bold">
                ₹{dashboard.totals.totalBetAmount.toLocaleString()}
              </p>
            </div>
            <div className={`${neonCard} p-4`}>
              <p className="text-xs uppercase text-pink-200/80">Total Bets</p>
              <p className="text-3xl font-bold">
                {dashboard.totals.totalBets.toLocaleString()}
              </p>
            </div>
            <div className={`${neonCard} p-4`}>
              <p className="text-xs uppercase text-pink-200/80">
                Winnings Paid
              </p>
              <p className="text-3xl font-bold text-amber-200">
                ₹{dashboard.totals.totalWinnings.toLocaleString()}
              </p>
            </div>
            <div className={`${neonCard} p-4`}>
              <p className="text-xs uppercase text-pink-200/80">Net Profit</p>
              <p className="text-3xl font-bold text-emerald-300">
                ₹{dashboard.totals.netProfit.toLocaleString()}
              </p>
            </div>
            <div className={`${neonCard} p-4 col-span-full`}>
              <h3 className="text-lg font-semibold mb-2">User Statistics</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-pink-200/80">
                    <tr>
                      <th className="py-2">User ID</th>
                      <th>Total Bets</th>
                      <th>Bet Amount</th>
                      <th>Wins</th>
                      <th>Winning Amount</th>
                      <th>Wallet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.userStats.map((u: any) => (
                      <tr key={u.userId} className="border-t border-white/5">
                        <td className="py-2">{u.userId}</td>
                        <td>{u.totalBets}</td>
                        <td>₹{u.totalBetAmount.toLocaleString()}</td>
                        <td>{u.totalWins}</td>
                        <td>₹{u.totalWinningAmount.toLocaleString()}</td>
                        <td className="text-emerald-300">
                          ₹{u.walletBalance.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {view === "users" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Users</h3>
              <div className="flex items-center gap-3">
                <button
                  className="text-sm text-pink-200 underline"
                  onClick={loadUsers}
                >
                  Refresh
                </button>
                <button
                  className="rounded-lg bg-gradient-to-r from-pink-500 to-amber-400 px-4 py-2 text-sm font-semibold shadow-lg shadow-pink-500/30"
                  onClick={() => setShowAddUserModal(true)}
                >
                  Add User
                </button>
              </div>
            </div>
            <div className={`${neonCard} p-4`}>
              <div className="overflow-x-auto custom-scroll">
                <table className="w-full text-sm min-w-[1150px]">
                  <thead className="text-left text-pink-200/80">
                    <tr>
                      <th className="py-2 px-3 whitespace-nowrap">User ID</th>
                      <th className="py-2 px-3 whitespace-nowrap">Name</th>
                      <th className="py-2 px-3 whitespace-nowrap">Phone</th>
                      <th className="py-2 px-3 whitespace-nowrap">District</th>
                      <th className="py-2 px-3 whitespace-nowrap">State</th>
                      <th className="py-2 px-3 whitespace-nowrap">Email</th>
                      <th className="py-2 px-3 whitespace-nowrap">Wallet</th>
                      <th className="py-2 px-3 whitespace-nowrap text-center">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr
                        key={u.userId}
                        className="border-t border-white/5 hover:bg-white/5"
                        onClick={() => {
                          setSelectedUser(u.userId);
                          loadWalletHistory(u.userId);
                        }}
                      >
                        <td className="py-2 px-3 whitespace-nowrap">
                          {u.userId}
                        </td>
                        <td className="px-3 whitespace-nowrap">{u.name}</td>
                        <td className="px-3 whitespace-nowrap">{u.phone}</td>
                        <td className="px-3 whitespace-nowrap">{u.district}</td>
                        <td className="px-3 whitespace-nowrap">{u.state}</td>
                        <td className="px-3 whitespace-nowrap">{u.email}</td>
                        <td className="px-3 text-emerald-300 whitespace-nowrap">
                          ₹{u.walletBalance?.toLocaleString() ?? 0}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <button
                              className="rounded-md bg-white/10 px-3 py-1 text-xs hover:bg-white/15"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPasswordModalUser(u.userId);
                                setPasswordUpdate("");
                              }}
                            >
                              Change Password
                            </button>
                            <button
                              className="rounded-md bg-red-600/80 px-3 py-1 text-xs font-semibold hover:bg-red-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteUser(u.userId);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {view === "reports" && (
          <section className={`${neonCard} p-4`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Reports</h3>
              <div className="flex items-center gap-2">
                <button
                  className="text-sm text-pink-200 underline"
                  onClick={() => loadReports()}
                >
                  Refresh
                </button>
              </div>
            </div>
            <div className="grid md:grid-cols-4 gap-3 mb-4 text-sm">
              <div className="space-y-1">
                <p className="text-xs text-pink-200/80">From date</p>
                <input
                  type="date"
                  className="date-input-white-icon w-full rounded-lg bg-black/40 px-3 py-2 border border-white/10 focus:border-pink-400 outline-none"
                  value={reportStartDate}
                  onChange={(e) => setReportStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-pink-200/80">To date</p>
                <input
                  type="date"
                  className="date-input-white-icon w-full rounded-lg bg-black/40 px-3 py-2 border border-white/10 focus:border-pink-400 outline-none"
                  value={reportEndDate}
                  min={reportStartDate || undefined}
                  onChange={(e) => setReportEndDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-pink-200/80">Time of day</p>
                <select
                  className="w-full rounded-lg bg-black/40 px-3 py-2 border border-white/10 focus:border-pink-400 outline-none"
                  value={timeSlot}
                  onChange={(e) => setTimeSlot(e.target.value)}
                >
                  <option value="all">All Day</option>
                  <option value="morning">Morning (6 AM - 12 PM)</option>
                  <option value="afternoon">Afternoon (12 PM - 6 PM)</option>
                  <option value="evening">Evening (6 PM - 12 AM)</option>
                  <option value="night">Night (12 AM - 6 AM)</option>
                </select>
              </div>
              <div className="flex items-end gap-2">
                <button
                  className="flex-1 rounded-lg bg-gradient-to-r from-pink-500 to-amber-400 px-4 py-2 font-semibold"
                  onClick={applyReportFilters}
                >
                  Apply Filters
                </button>
                <button
                  className="rounded-lg bg-white/10 px-4 py-2 text-sm"
                  onClick={clearReportFilters}
                >
                  Clear
                </button>
              </div>
            </div>
            {reportSummary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className={`${neonCard} p-3`}>
                  <p className="text-xs uppercase text-pink-200/80">
                    Total Bets
                  </p>
                  <p className="text-2xl font-semibold">
                    {reportSummary.totalBets.toLocaleString()}
                  </p>
                </div>
                <div className={`${neonCard} p-3`}>
                  <p className="text-xs uppercase text-pink-200/80">Wins</p>
                  <p className="text-2xl font-semibold">
                    {reportSummary.totalWins.toLocaleString()}
                  </p>
                </div>
                <div className={`${neonCard} p-3`}>
                  <p className="text-xs uppercase text-pink-200/80">Volume</p>
                  <p className="text-2xl font-semibold">
                    ₹{reportSummary.totalBetAmount.toLocaleString()}
                  </p>
                </div>
                <div className={`${neonCard} p-3`}>
                  <p className="text-xs uppercase text-pink-200/80">Profit</p>
                  <p className="text-2xl font-semibold text-emerald-300">
                    ₹{reportSummary.netProfit.toLocaleString()}
                  </p>
                </div>
              </div>
            )}
            <div className="mb-3 flex flex-col gap-2 text-sm text-pink-100/80 md:flex-row md:items-center md:justify-between">
              <p>
                {reportPagination.totalItems > 0
                  ? `Showing ${(reportPagination.page - 1) * reportPagination.limit + 1}-${Math.min(
                      reportPagination.page * reportPagination.limit,
                      reportPagination.totalItems
                    )} of ${reportPagination.totalItems} bets`
                  : "No bets found for the selected filters"}
              </p>
              {reportPagination.totalItems > 0 && (
                <p>
                  Page {reportPagination.page} of {reportPagination.totalPages}
                </p>
              )}
            </div>
            <div className="overflow-x-auto custom-scroll">
              <table className="w-full text-sm">
                <thead className="text-left text-pink-200/80">
                  <tr>
                    <th className="py-2">Time</th>
                    <th>User</th>
                    <th>Result</th>
                    <th>Winning No.</th>
                    <th>Bet</th>
                    <th>Win</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.length > 0 ? (
                    reports.map((b) => (
                      <tr key={b._id} className="border-t border-white/5">
                        <td className="py-2">{formatClock(b.createdAt)}</td>
                        <td>{b.userId}</td>
                        <td>{b.status === "PENDING" ? "-" : b.status}</td>
                        <td className="text-center">{b.resultNumber ?? "—"}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {b.bets.map((entry: any) => (
                              <span
                                key={`${entry.number}-${entry.amount}-${b._id}`}
                                className="rounded-full bg-white/10 px-2 py-1 text-xs"
                              >
                                <span className="font-semibold text-pink-200">
                                  {entry.number}
                                </span>
                                <span className="mx-1 text-pink-200/60">·</span>
                                ₹{entry.amount}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="text-emerald-300">
                          ₹{b.winAmount?.toLocaleString() ?? 0}
                        </td>
                        <td
                          className={
                            b.status === "WIN"
                              ? "text-emerald-300"
                              : "text-pink-200"
                          }
                        >
                          {b.status}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-t border-white/5">
                      <td
                        colSpan={7}
                        className="py-6 text-center text-pink-200/70"
                      >
                        No report records available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {reportPagination.totalItems > 0 && (
              <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg bg-white/10 px-3 py-2 text-sm disabled:opacity-40"
                    disabled={!reportPagination.hasPreviousPage}
                    onClick={() => changeReportPage(reportPagination.page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="rounded-lg bg-white/10 px-3 py-2 text-sm disabled:opacity-40"
                    disabled={!reportPagination.hasNextPage}
                    onClick={() => changeReportPage(reportPagination.page + 1)}
                  >
                    Next
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {visibleReportPages.map((pageNumber) => (
                    <button
                      key={pageNumber}
                      className={`min-w-10 rounded-lg px-3 py-2 text-sm ${
                        pageNumber === reportPagination.page
                          ? "bg-gradient-to-r from-pink-500 to-amber-400 font-semibold text-black"
                          : "bg-white/10"
                      }`}
                      onClick={() => changeReportPage(pageNumber)}
                    >
                      {pageNumber}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {view === "rounds" && (
          <section className="grid md:grid-cols-3 gap-4">
            <div className={`${neonCard} p-4`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold">Wheel Rounds</h3>
                <button
                  className="text-sm text-pink-200 underline"
                  onClick={loadRounds}
                >
                  Refresh
                </button>
              </div>
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {rounds.map((r) => (
                  <button
                    key={r.roundId}
                    className={`w-full text-left px-3 py-2 rounded-lg border border-white/10 ${
                      selectedRound?.id === r.roundId
                        ? "bg-pink-600/60"
                        : "bg-white/5"
                    }`}
                    onClick={() => loadRoundBets(r)}
                  >
                    <div className="flex justify-between text-sm">
                      <span>{formatClock(r.endTime)}</span>
                      <span className="text-pink-200/80">
                        {r.resultNumber ?? "pending"}
                      </span>
                    </div>
                    <p className="text-xs text-amber-100">
                      {new Date(r.endTime).toLocaleDateString()}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            <div className={`${neonCard} p-4 md:col-span-2`}>
              <h3 className="text-lg font-semibold mb-3">
                Bets for {selectedRound ? selectedRound.time : "select a round"}
              </h3>
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto custom-scroll">
                <table className="w-full text-sm min-w-[800px]">
                  <thead className="text-left text-pink-200/80">
                    <tr>
                      <th className="py-2">User</th>
                      <th className="py-2 text-center">Winning No.</th>
                      <th>Bets</th>
                      <th>Amount</th>
                      <th>Win</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roundBets.map((b) => (
                      <tr key={b._id} className="border-t border-white/5">
                        <td className="py-2">{b.userId}</td>
                        <td className="text-center">
                          {selectedRound?.resultNumber ?? "—"}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {b.bets.map((entry: any) => (
                              <span
                                key={`${entry.number}-${entry.amount}-${b._id}`}
                                className="rounded-full bg-white/10 px-2 py-1 text-xs"
                              >
                                <span className="font-semibold text-pink-200">
                                  {entry.number}
                                </span>
                                <span className="mx-1 text-pink-200/60">·</span>
                                ₹{entry.amount}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>₹{b.totalBet}</td>
                        <td className="text-emerald-300">
                          ₹{b.winAmount?.toLocaleString() ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {view === "account" && (
          <section className="grid md:grid-cols-3 gap-4">
            <div className={`${neonCard} p-4`}>
              <h3 className="text-lg font-semibold mb-3">Select User</h3>
              <select
                className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30"
                value={selectedUser}
                onChange={(e) => {
                  setSelectedUser(e.target.value);
                  loadWalletHistory(e.target.value);
                }}
              >
                <option value="">Choose user</option>
                {users.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {u.userId} - {u.name}
                  </option>
                ))}
              </select>
              <div className="mt-4 space-y-2">
                <input
                  className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30"
                  type="number"
                  placeholder="Credit amount"
                  value={creditForm.amount}
                  onChange={(e) =>
                    setCreditForm({
                      ...creditForm,
                      amount: Number(e.target.value),
                    })
                  }
                />
                <input
                  className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30"
                  placeholder="Reason"
                  value={creditForm.reason}
                  onChange={(e) =>
                    setCreditForm({ ...creditForm, reason: e.target.value })
                  }
                />
                <button
                  className="w-full rounded-lg bg-gradient-to-r from-emerald-500 to-teal-400 py-2 text-sm font-semibold"
                  onClick={() => submitWalletChange("credit")}
                >
                  Credit Wallet
                </button>
              </div>
              <div className="mt-4 space-y-2">
                <input
                  className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30"
                  type="number"
                  placeholder="Debit amount"
                  value={debitForm.amount}
                  onChange={(e) =>
                    setDebitForm({
                      ...debitForm,
                      amount: Number(e.target.value),
                    })
                  }
                />
                <input
                  className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30"
                  placeholder="Reason"
                  value={debitForm.reason}
                  onChange={(e) =>
                    setDebitForm({ ...debitForm, reason: e.target.value })
                  }
                />
                <button
                  className="w-full rounded-lg bg-gradient-to-r from-red-500 to-pink-500 py-2 text-sm font-semibold"
                  onClick={() => submitWalletChange("debit")}
                >
                  Debit Wallet
                </button>
              </div>
            </div>
            <div className={`${neonCard} p-4 md:col-span-2`}>
              <h3 className="text-lg font-semibold mb-3">Account History</h3>
              <div className="flex items-center gap-2 mb-3">
                <label className="text-xs text-pink-200/80">Filter:</label>
                <div className="flex gap-2">
                  {[
                    { value: "all", label: "All" },
                    { value: "bets", label: "Bets" },
                    { value: "admin", label: "Admin" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      className={`px-3 py-1 rounded-lg text-xs border border-white/10 ${
                        historyFilter === opt.value
                          ? "bg-pink-600/70"
                          : "bg-white/5 hover:bg-white/10"
                      }`}
                      onClick={() => setHistoryFilter(opt.value as any)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-h-[460px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-pink-200/80">
                    <tr>
                      <th className="py-2">Time</th>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Reason / Bet Time</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {walletHistory
                      .filter((tx) => {
                        if (historyFilter === "all") return true;
                        const reason = (tx.reason || "").toLowerCase();
                        const isAdmin = reason.includes("admin");
                        return historyFilter === "admin" ? isAdmin : !isAdmin;
                      })
                      .map((tx) => (
                      <tr key={tx._id} className="border-t border-white/5">
                        <td className="py-2">
                          {new Date(tx.createdAt).toLocaleString()}
                        </td>
                        <td
                          className={
                            tx.type === "credit"
                              ? "text-emerald-300"
                              : "text-red-300"
                          }
                        >
                          {tx.type}
                        </td>
                        <td>₹{tx.amount}</td>
                        <td>
                          {(() => {
                            const reason = tx.reason || "";
                            const lower = reason.toLowerCase();
                            const looksLikeBetId = /^[a-f0-9]{24}$/.test(
                              reason
                            );
                            const showTime =
                              lower.includes("round") ||
                              lower.includes("bet") ||
                              looksLikeBetId;
                            return showTime
                              ? new Date(tx.createdAt).toLocaleString()
                              : reason || "-";
                          })()}
                        </td>
                        <td>₹{tx.balanceAfter}</td>
                      </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {view === "control" && (
          <section className={`${neonCard} p-4`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Control Panel</h3>
              <div className="flex items-center gap-3">
                <button
                  className="text-sm text-pink-200 underline"
                  onClick={loadRtp}
                >
                  Refresh RTP
                </button>
                <button
                  className="text-sm text-pink-200 underline"
                  onClick={loadResultRules}
                >
                  Refresh Rules
                </button>
              </div>
            </div>
            {rtpConfig && (
              <div className="space-y-6">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-pink-200/80 mb-1">RTP %</p>
                    <input
                      className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30"
                      type="number"
                      value={rtpConfig.targetRtpPercent}
                      onChange={(e) =>
                        setRtpConfig({
                          ...rtpConfig,
                          targetRtpPercent: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <p className="text-xs text-pink-200/80 mb-1">Multiplier</p>
                    <div className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30 text-pink-100">
                      9x (fixed)
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-pink-200/80 mb-1">
                      Round Timer (seconds)
                    </p>
                    <div className="flex flex-wrap gap-3 items-center">
                      <input
                        className="w-40 rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30"
                        type="number"
                        min={10}
                        max={600}
                        value={rtpConfig.roundDurationSeconds ?? 90}
                        onChange={(e) =>
                          setRtpConfig({
                            ...rtpConfig,
                            roundDurationSeconds: Number(e.target.value),
                          })
                        }
                      />
                      <span className="text-xs text-pink-200/70">
                        Applies to the current round and the next rounds.
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  className="rounded-lg bg-gradient-to-r from-pink-500 to-amber-400 px-4 py-2 font-semibold"
                  onClick={updateRtp}
                >
                  Save RTP Settings
                </button>

                <div className="border-t border-white/10 pt-4 space-y-5">
                  <h4 className="text-base font-semibold">Round Result Rules</h4>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-pink-100">
                        Fixed Result By Time
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30"
                          placeholder="HH:mm"
                          value={fixedRuleForm.timeKey}
                          onChange={(e) =>
                            setFixedRuleForm({
                              ...fixedRuleForm,
                              timeKey: e.target.value,
                            })
                          }
                        />
                        <input
                          className="rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30"
                          type="number"
                          min={0}
                          max={9}
                          value={fixedRuleForm.fixedNumber}
                          onChange={(e) =>
                            setFixedRuleForm({
                              ...fixedRuleForm,
                              fixedNumber: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <input
                        className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30"
                        placeholder="Notes (optional)"
                        value={fixedRuleForm.notes}
                        onChange={(e) =>
                          setFixedRuleForm({
                            ...fixedRuleForm,
                            notes: e.target.value,
                          })
                        }
                      />
                      <label className="flex items-center gap-2 text-xs text-pink-100">
                        <input
                          type="checkbox"
                          checked={fixedRuleForm.enabled}
                          onChange={(e) =>
                            setFixedRuleForm({
                              ...fixedRuleForm,
                              enabled: e.target.checked,
                            })
                          }
                        />
                        Enabled
                      </label>
                      <button
                        className="rounded-lg bg-gradient-to-r from-pink-500 to-amber-400 px-3 py-2 text-sm font-semibold"
                        onClick={saveFixedRule}
                      >
                        Save Fixed Rule
                      </button>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-pink-100">
                        Existing Fixed Rules
                      </p>
                      <div className="max-h-[220px] overflow-y-auto space-y-2 pr-1">
                        {resultRules.dailyFixedRules.map((rule) => (
                          <div
                            key={rule._id}
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
                          >
                            <div className="flex items-center justify-between">
                              <span>
                                {rule.timeKey} → <strong>{rule.fixedNumber}</strong>
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  className="text-xs text-pink-200 underline"
                                  onClick={() => toggleFixedRuleEnabled(rule)}
                                >
                                  {rule.enabled ? "Disable" : "Enable"}
                                </button>
                                <button
                                  className="text-xs text-red-200 underline"
                                  onClick={() => deleteFixedRule(rule.timeKey)}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-pink-200/70">
                              {rule.enabled ? "Enabled" : "Disabled"}
                            </p>
                          </div>
                        ))}
                        {!resultRules.dailyFixedRules.length && (
                          <p className="text-xs text-pink-200/70">No fixed rules</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-pink-100">
                        Blocked Numbers By Time
                      </p>
                      <input
                        className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30"
                        placeholder="HH:mm"
                        value={blockedDailyForm.timeKey}
                        onChange={(e) =>
                          setBlockedDailyForm({
                            ...blockedDailyForm,
                            timeKey: e.target.value,
                          })
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        {DIGITS.map((digit) => (
                          <button
                            key={`daily-block-${digit}`}
                            className={`h-8 w-8 rounded-full text-xs border ${
                              blockedDailyForm.blockedNumbers.includes(digit)
                                ? "bg-red-600/80 border-red-400"
                                : "bg-white/5 border-white/20"
                            }`}
                            onClick={() =>
                              toggleDigit(
                                blockedDailyForm.blockedNumbers,
                                digit,
                                (next) =>
                                  setBlockedDailyForm({
                                    ...blockedDailyForm,
                                    blockedNumbers: next,
                                  })
                              )
                            }
                          >
                            {digit}
                          </button>
                        ))}
                      </div>
                      <input
                        className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30"
                        placeholder="Notes (optional)"
                        value={blockedDailyForm.notes}
                        onChange={(e) =>
                          setBlockedDailyForm({
                            ...blockedDailyForm,
                            notes: e.target.value,
                          })
                        }
                      />
                      <label className="flex items-center gap-2 text-xs text-pink-100">
                        <input
                          type="checkbox"
                          checked={blockedDailyForm.enabled}
                          onChange={(e) =>
                            setBlockedDailyForm({
                              ...blockedDailyForm,
                              enabled: e.target.checked,
                            })
                          }
                        />
                        Enabled
                      </label>
                      <button
                        className="rounded-lg bg-gradient-to-r from-red-500 to-pink-500 px-3 py-2 text-sm font-semibold"
                        onClick={saveDailyBlockedRule}
                      >
                        Save Blocked Rule
                      </button>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-pink-100">
                        Existing Blocked-Time Rules
                      </p>
                      <div className="max-h-[220px] overflow-y-auto space-y-2 pr-1">
                        {resultRules.dailyBlockedRules.map((rule) => (
                          <div
                            key={rule._id}
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
                          >
                            <div className="flex items-center justify-between">
                              <span>{rule.timeKey}</span>
                              <div className="flex items-center gap-2">
                                <button
                                  className="text-xs text-pink-200 underline"
                                  onClick={() => toggleDailyBlockedRuleEnabled(rule)}
                                >
                                  {rule.enabled ? "Disable" : "Enable"}
                                </button>
                                <button
                                  className="text-xs text-red-200 underline"
                                  onClick={() => deleteDailyBlockedRule(rule.timeKey)}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-pink-200/70">
                              Blocked: {(rule.blockedNumbers || []).join(", ")}
                            </p>
                          </div>
                        ))}
                        {!resultRules.dailyBlockedRules.length && (
                          <p className="text-xs text-pink-200/70">
                            No blocked-time rules
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
                    <p className="text-sm font-semibold text-pink-100">
                      Current Round Result Controls (One Time)
                    </p>
                    <p className="text-xs text-pink-200/80">
                      Active round:{" "}
                      {resultRules.activeRound
                        ? `${resultRules.activeRound.roundId} (${resultRules.activeRound.timeKey})`
                        : "No active round"}
                    </p>
                    <p className="text-xs text-pink-200/80">
                      {activeRoundPhaseLabel}: {activeRoundTimerLabel}
                    </p>
                    <p className="text-xs text-pink-200/65">
                      Bets close at 0s. During the post-close spin window, these controls still apply to the same round.
                    </p>
                    {hasLegacyCurrentRoundConflict && (
                      <p className="rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-100">
                        Legacy conflict: fixed and excluded controls are both active.
                        Clear one control first. Apply actions are disabled.
                      </p>
                    )}
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
                        <p className="text-sm font-semibold text-pink-100">
                          Lock Current Round Result
                        </p>
                        <p className="text-xs text-pink-200/70">
                          Active lock:{" "}
                          {hasCurrentRoundFixedActive
                            ? resultRules.currentRoundOneOffFixed.fixedNumber
                            : "Not set"}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {DIGITS.map((digit) => (
                            <button
                              key={`current-fixed-${digit}`}
                              disabled={disableFixedControl}
                              className={`h-8 w-8 rounded-full text-xs border ${
                                currentRoundFixedNumber === digit
                                  ? "bg-emerald-600/80 border-emerald-400"
                                  : "bg-white/5 border-white/20"
                              } ${disableFixedControl ? "opacity-50 cursor-not-allowed" : ""}`}
                              onClick={() =>
                                toggleSingleDigit(
                                  currentRoundFixedNumber,
                                  digit,
                                  setCurrentRoundFixedNumber
                                )
                              }
                            >
                              {digit}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={disableFixedControl || currentRoundFixedNumber === null}
                            className={`rounded-lg bg-gradient-to-r from-emerald-500 to-teal-400 px-3 py-2 text-sm font-semibold ${
                              disableFixedControl || currentRoundFixedNumber === null
                                ? "opacity-50 cursor-not-allowed"
                                : ""
                            }`}
                            onClick={applyCurrentRoundFixed}
                          >
                            Apply Fixed Result
                          </button>
                          <button
                            disabled={!hasActiveRound}
                            className={`rounded-lg bg-white/10 px-3 py-2 text-sm ${
                              !hasActiveRound ? "opacity-50 cursor-not-allowed" : ""
                            }`}
                            onClick={clearCurrentRoundFixed}
                          >
                            Clear Fixed Result
                          </button>
                        </div>
                      </div>

                      <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
                        <p className="text-sm font-semibold text-pink-100">
                          Exclude One Number
                        </p>
                        <p className="text-xs text-pink-200/70">
                          Active exclusion:{" "}
                          {hasCurrentRoundExcludeActive ? activeRoundExcludedNumber : "Not set"}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {DIGITS.map((digit) => (
                            <button
                              key={`current-exclude-${digit}`}
                              disabled={disableExcludeControl}
                              className={`h-8 w-8 rounded-full text-xs border ${
                                currentRoundExcludedNumber === digit
                                  ? "bg-red-600/80 border-red-400"
                                  : "bg-white/5 border-white/20"
                              } ${
                                disableExcludeControl
                                  ? "opacity-50 cursor-not-allowed"
                                  : ""
                              }`}
                              onClick={() =>
                                toggleSingleDigit(
                                  currentRoundExcludedNumber,
                                  digit,
                                  setCurrentRoundExcludedNumber
                                )
                              }
                            >
                              {digit}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={
                              disableExcludeControl || currentRoundExcludedNumber === null
                            }
                            className={`rounded-lg bg-gradient-to-r from-red-500 to-pink-500 px-3 py-2 text-sm font-semibold ${
                              disableExcludeControl || currentRoundExcludedNumber === null
                                ? "opacity-50 cursor-not-allowed"
                                : ""
                            }`}
                            onClick={applyCurrentRoundExclude}
                          >
                            Apply Exclusion
                          </button>
                          <button
                            disabled={!hasActiveRound}
                            className={`rounded-lg bg-white/10 px-3 py-2 text-sm ${
                              !hasActiveRound ? "opacity-50 cursor-not-allowed" : ""
                            }`}
                            onClick={clearCurrentRoundExclude}
                          >
                            Clear Exclusion
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {showAddUserModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={() => setShowAddUserModal(false)}
        >
          <div
            className={`${neonCard} w-full max-w-lg p-6`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add User</h3>
              <button
                className="rounded-full bg-white/10 px-3 py-1 text-sm hover:bg-white/20"
                onClick={() => setShowAddUserModal(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3">
              {Object.entries(newUser).map(([key, value]) => (
                <input
                  key={key}
                  className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30 focus:border-pink-400 outline-none"
                  placeholder={key}
                  type={
                    key === "password"
                      ? "password"
                      : key === "initialBalance"
                      ? "number"
                      : "text"
                  }
                  value={value as any}
                  onChange={(e) =>
                    setNewUser({ ...newUser, [key]: e.target.value })
                  }
                />
              ))}
              <button
                className="w-full rounded-lg bg-gradient-to-r from-pink-500 to-amber-400 py-2 text-sm font-semibold"
                onClick={createUser}
              >
                Create User
              </button>
            </div>
          </div>
        </div>
      )}

      {passwordModalUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={() => {
            setPasswordModalUser(null);
            setPasswordUpdate("");
          }}
        >
          <div
            className={`${neonCard} w-full max-w-md p-6`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Change Password</h3>
              <button
                className="rounded-full bg-white/10 px-3 py-1 text-sm hover:bg-white/20"
                onClick={() => {
                  setPasswordModalUser(null);
                  setPasswordUpdate("");
                }}
              >
                Close
              </button>
            </div>
            <p className="text-sm text-pink-200/80 mb-2">
              User ID: {passwordModalUser}
            </p>
            <div className="space-y-3">
              <input
                className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm border border-pink-500/30 focus:border-pink-400 outline-none"
                placeholder="New password"
                type="password"
                value={passwordUpdate}
                onChange={(e) => setPasswordUpdate(e.target.value)}
              />
              <button
                className="w-full rounded-lg bg-gradient-to-r from-emerald-500 to-teal-400 py-2 text-sm font-semibold"
                onClick={() => updatePassword(passwordModalUser)}
              >
                Update Password
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .custom-scroll::-webkit-scrollbar {
          height: 10px;
          width: 10px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 9999px;
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(90deg, #ec4899, #f97316);
          border-radius: 9999px;
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(90deg, #f472b6, #fb923c);
        }
      `}</style>
    </div>
  );
}
