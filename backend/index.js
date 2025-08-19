// index.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// Import Document model
const Document = require('./models/Document');

// Setup Express + HTTP + Socket.IO
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

//MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true 
})
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

//Basic Route
app.get('/', (req, res) => {
  res.send('Collaborative Editor Backend');
});

//Debounce Utility
const debounce = (func, delay) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), delay);
  };
};

const saveDocument = debounce(async (documentId, content) => {
  await Document.findByIdAndUpdate(documentId, { content }).exec();
}, 1000); // Save after 1 second of inactivity

// Socket.IO Events
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  // Join a document room
  socket.on('join-document', async (documentId, username) => {
    socket.join(documentId);

    let doc = await Document.findById(documentId);
    if (!doc) {
      doc = new Document({ _id: documentId, users: [] });
      await doc.save();
    }

    // Add user to doc
    doc.users.push({ socketId: socket.id, username });
    await doc.save();

    // Send current content to the new user
    socket.emit('load-document', doc.content);

    // Notify others
    socket.to(documentId).emit('user-joined', username);
    console.log(`👤 ${username} joined document ${documentId}`);
  });

  // Handle code changes with debounced save
  socket.on('code-change', (documentId, newCode) => {
    socket.to(documentId).emit('code-change', newCode);
    saveDocument(documentId, newCode); // <- debounced DB save
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log('❌ User disconnected:', socket.id);

    // Remove user from all documents
    await Document.updateMany(
      { 'users.socketId': socket.id },
      { $pull: { users: { socketId: socket.id } } }
    );
  });
});

//Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
