import dotenv from "dotenv";

dotenv.config();

const numberFromEnv = (value, fallback) => {
  const parsed = parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const FIXED_WIN_MULTIPLIER = 9;

// Server
export const port = Number(process.env.PORT) || 4000;

// Database
export const mongoUri =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL;

// JWT
export const jwtSecret =
  process.env.JWT_SECRET || "super-secret-change-me";

// Game Config
export const roundDurationMs = numberFromEnv(
  process.env.ROUND_DURATION_MS,
  90000
);

export const postCloseSpinMs = numberFromEnv(
  process.env.POST_CLOSE_SPIN_MS,
  5000
);

export const defaultRtp = Number(
  process.env.DEFAULT_RTP_PERCENT || 90
);

export const defaultMultiplier = FIXED_WIN_MULTIPLIER;
export const fixedWinMultiplier = FIXED_WIN_MULTIPLIER;

// Admin
export const adminSeedEmail =
  process.env.ADMIN_EMAIL || "admin@casino.local";

export const adminSeedPassword =
  process.env.ADMIN_PASSWORD || "ChangeMe!123";

// CORS
export const allowedOrigins = (
  process.env.ALLOWED_ORIGINS || "*"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Debug (remove after deployment)
console.log("Mongo URI Loaded:", mongoUri ? "YES ✅" : "NO ❌");