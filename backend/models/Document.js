// models/Document.js
const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      default: "Untitled Document",
    },
    language: {
      type: String,
      default: "javascript", // could be js, python, java, etc.
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    collaborators: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // For Y.js, we'll store the document name which will be used as the Y.js document identifier
    yjsDocumentName: {
      type: String,
      unique: true,
      required: true,
      default: function() {
        return `doc_${this._id}_${Date.now()}`;
      }
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Document", documentSchema);