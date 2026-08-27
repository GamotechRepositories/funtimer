import mongoose from "mongoose";

const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const roundResultRuleSchema = new mongoose.Schema(
  {
    ruleType: {
      type: String,
      enum: ["fixed_result", "blocked_numbers"],
      required: true,
      index: true,
    },
    scope: {
      type: String,
      enum: ["daily_time", "round_once"],
      required: true,
      index: true,
    },
    timeKey: {
      type: String,
      validate: {
        validator(value) {
          if (this.scope !== "daily_time") return true;
          return HHMM_REGEX.test(String(value || ""));
        },
        message: "timeKey must be HH:mm for daily_time scope",
      },
    },
    roundId: {
      type: String,
      validate: {
        validator(value) {
          if (this.scope !== "round_once") return true;
          return Boolean(value);
        },
        message: "roundId is required for round_once scope",
      },
    },
    fixedNumber: {
      type: Number,
      min: 0,
      max: 9,
      validate: {
        validator(value) {
          if (this.ruleType !== "fixed_result") return true;
          return Number.isInteger(value);
        },
        message: "fixedNumber is required for fixed_result rule type",
      },
    },
    blockedNumbers: {
      type: [Number],
      default: [],
      validate: {
        validator(value) {
          if (this.ruleType !== "blocked_numbers") return true;
          return (
            Array.isArray(value) &&
            value.length > 0 &&
            value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 9)
          );
        },
        message:
          "blockedNumbers must contain one or more integers between 0 and 9 for blocked_numbers rule type",
      },
    },
    enabled: { type: Boolean, default: true, index: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

roundResultRuleSchema.index({ ruleType: 1, scope: 1, timeKey: 1, enabled: 1 });
roundResultRuleSchema.index({ scope: 1, roundId: 1, enabled: 1 });
roundResultRuleSchema.index(
  { ruleType: 1, scope: 1, timeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: "daily_time" },
  }
);
roundResultRuleSchema.index(
  { ruleType: 1, scope: 1, roundId: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: "round_once" },
  }
);

export default mongoose.model("RoundResultRule", roundResultRuleSchema);
