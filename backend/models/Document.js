const DocumentSchema = new mongoose.Schema({
  _id: String, // Document ID (room ID)
  content: { type: String, default: '' },
  users: [{ socketId: String, username: String }],
}, { timestamps: true });
