import mongoose from "mongoose";

const adminActionSchema = new mongoose.Schema(
  {
    actorUserId: { type: String },
    type: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

adminActionSchema.index({ createdAt: -1 });

export default mongoose.model("AdminAction", adminActionSchema);
