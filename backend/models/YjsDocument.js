// models/YjsDocument.js
const mongoose = require("mongoose");

const yjsDocumentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    // Store the Y.js document state as binary data
    state: {
      type: Buffer,
      required: true,
    },
    // Store the last updated timestamp for syncing
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Create index for faster queries
// yjsDocumentSchema.index({ name: 1 });

module.exports = mongoose.model("YjsDocument", yjsDocumentSchema);