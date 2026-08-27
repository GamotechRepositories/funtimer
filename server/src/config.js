import dotenv from "dotenv";

dotenv.config();

const numberFromEnv = (value, fallback) => {
  const parsed = parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const FIXED_WIN_MULTIPLIER = 9;

export const port = process.env.PORT;
export const mongoUri = process.env.MONGO_URI;
export const jwtSecret = process.env.JWT_SECRET || "super-secret-change-me";
export const roundDurationMs = numberFromEnv(process.env.ROUND_DURATION_MS, 90_000);
export const postCloseSpinMs = numberFromEnv(process.env.POST_CLOSE_SPIN_MS, 5_000);
export const defaultRtp = Number(process.env.DEFAULT_RTP_PERCENT || 90);
export const defaultMultiplier = FIXED_WIN_MULTIPLIER;
export const fixedWinMultiplier = FIXED_WIN_MULTIPLIER;
export const adminSeedEmail = process.env.ADMIN_EMAIL || "admin@casino.local";
export const adminSeedPassword = process.env.ADMIN_PASSWORD || "ChangeMe!123";
export const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
