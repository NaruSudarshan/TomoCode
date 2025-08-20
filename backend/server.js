// server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const WebSocket = require('ws');
const jwt = require("jsonwebtoken");
const Y = require('yjs');

require("dotenv").config();

// Import models
const Document = require("./models/Document");
const Session = require("./models/Session");
const User = require("./models/User");
const YjsDocument = require("./models/YjsDocument");

// Import middleware
const auth = require("./middleware/auth");
const errorHandler = require("./middleware/errorHandler");
const { apiLimiter, authLimiter } = require("./middleware/rateLimiter");

// Import routes
const authRoutes = require("./routes/auth");

const app = express();
const server = http.createServer(app);

// CORS middleware
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true
}));

// Body parser middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Rate limiting
app.use("/api/", apiLimiter);
app.use("/api/auth/", authLimiter);

// Routes
app.use("/api/auth", authRoutes);

// Socket.io setup
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/collab-editor", {
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// WebSocket server setup for Y.js - using noServer to handle upgrades manually
const wss = new WebSocket.Server({ noServer: true });
const docs = new Map(); // In-memory store for Y.js documents

wss.on('connection', (ws, req) => {
  // Extract token from query string for authentication
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const docName = url.pathname.split('/').pop() || 'default';
  
  console.log(`WebSocket connection attempt for document: ${docName}`);
  
  if (token) {
    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      ws.userId = decoded.userId;
      ws.docName = docName;
      
      console.log(`Authenticated WebSocket connection for user: ${ws.userId}, document: ${docName}`);
      
      // Initialize or get Y.js document
      if (!docs.has(docName)) {
        docs.set(docName, new Y.Doc());
        console.log(`Created new Y.js document: ${docName}`);
        
        // Try to load from database
        YjsDocument.findOne({ name: docName })
          .then(storedDoc => {
            if (storedDoc) {
              console.log(`Loading existing document from database: ${docName}`);
              Y.applyUpdate(docs.get(docName), storedDoc.state);
            }
          })
          .catch(err => console.error('Error loading document from DB:', err));
      }
      
      const ydoc = docs.get(docName);
      
      // Send current state to client
      const state = Y.encodeStateAsUpdate(ydoc);
      if (state.length > 0) {
        ws.send(state);
        console.log(`Sent initial state to client for document: ${docName}`);
      }
      
      // Handle incoming updates
      ws.on('message', async (message) => {
        try {
          // Apply update to Y.js document
          Y.applyUpdate(ydoc, message);
          console.log(`Applied update to document: ${docName}`);
          
          // Broadcast to other clients in the same document
          wss.clients.forEach((client) => {
            if (client !== ws && 
                client.readyState === WebSocket.OPEN && 
                client.docName === docName) {
              client.send(message);
              console.log(`Broadcasted update to other client for document: ${docName}`);
            }
          });
          
          // Store update in database
          try {
            await YjsDocument.findOneAndUpdate(
              { name: docName },
              { 
                $set: { 
                  state: message, 
                  lastUpdated: new Date() 
                } 
              },
              { upsert: true, new: true }
            );
            console.log(`Saved update to database for document: ${docName}`);
          } catch (dbError) {
            console.error('Error storing update in database:', dbError);
          }
        } catch (error) {
          console.error('Error handling message:', error);
        }
      });
      
      // Handle client disconnection
      ws.on('close', () => {
        console.log(`Client disconnected from document: ${docName}`);
      });
      
    } catch (error) {
      console.error('Authentication failed:', error);
      ws.close(1008, 'Authentication failed');
      return;
    }
  } else {
    console.error('No token provided for WebSocket connection');
    ws.close(1008, 'Authentication token required');
    return;
  }
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Handle HTTP server upgrades manually
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  
  console.log(`Upgrade request for path: ${pathname}`);
  
  // Handle Y.js WebSocket connections
  if (pathname.startsWith('/yjs')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } 
  // Let Socket.IO handle its own connections
  else if (pathname.startsWith('/socket.io')) {
    // Do nothing - Socket.IO will handle this
  } 
  // Reject other WebSocket connections
  else {
    console.log(`Rejecting WebSocket connection to: ${pathname}`);
    socket.destroy();
  }
});

// Socket.io authentication middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error('Authentication error'));
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return next(new Error('Authentication error'));
    }
    
    socket.userId = user._id;
    next();
  } catch (error) {
    next(new Error('Authentication error'));
  }
});

// Socket.io for real-time features (cursors, user presence, etc.)
io.on("connection", (socket) => {
  console.log("User connected:", socket.id, "User ID:", socket.userId);

  // Join a document room
  socket.on("join-document", async (data) => {
    const { documentId } = data;
    socket.join(documentId);

    try {
      // Check if user has access to document
      const document = await Document.findById(documentId);
      
      if (!document) {
        socket.emit("error", { message: "Document not found" });
        return;
      }
      
      if (!document.owner.equals(socket.userId) && 
          !document.collaborators.some(id => id.equals(socket.userId))) {
        socket.emit("error", { message: "Access denied" });
        return;
      }

      // Update session
      const session = new Session({
        document: documentId,
        user: socket.userId,
        socketId: socket.id,
      });
      await session.save();

      // Notify others in the room
      socket.to(documentId).emit("user-joined", {
        userId: socket.userId,
        socketId: socket.id,
      });
    } catch (error) {
      console.error("Error joining document:", error);
      socket.emit("error", { message: "Failed to join document" });
    }
  });

  // Handle cursor movements
  socket.on("cursor-move", (data) => {
    const { documentId, position } = data;
    socket.to(documentId).emit("cursor-move", {
      userId: socket.userId,
      position,
      socketId: socket.id,
    });
  });

  // Handle user leaving
  socket.on("leave-document", async (data) => {
    const { documentId } = data;
    socket.leave(documentId);

    try {
      // Update session
      await Session.findOneAndUpdate(
        { document: documentId, user: socket.userId, socketId: socket.id },
        { active: false }
      );

      // Notify others in the room
      socket.to(documentId).emit("user-left", {
        userId: socket.userId,
        socketId: socket.id,
      });
    } catch (error) {
      console.error("Error leaving document:", error);
    }
  });

  // Handle disconnection
  socket.on("disconnect", async () => {
    console.log("User disconnected:", socket.id);
    try {
      // Update session
      await Session.findOneAndUpdate(
        { socketId: socket.id },
        { active: false }
      );
    } catch (error) {
      console.error("Error handling disconnect:", error);
    }
  });
});

// REST API Routes with authentication
app.get("/api/documents", auth, async (req, res) => {
  try {
    const documents = await Document.find({
      $or: [
        { owner: req.user._id },
        { collaborators: req.user._id }
      ]
    }).populate("owner", "username").populate("collaborators", "username");
    
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id", auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id)
      .populate("owner", "username")
      .populate("collaborators", "username");
    
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }
    
    // Check if user has access
    if (!document.owner.equals(req.user._id) && 
        !document.collaborators.some(id => id.equals(req.user._id))) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/documents", auth, async (req, res) => {
  try {
    const { title, language } = req.body;
    const document = new Document({
      title,
      language,
      owner: req.user._id,
    });
    
    await document.save();
    await document.populate("owner", "username");
    
    res.status(201).json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/documents/:id", auth, async (req, res) => {
  try {
    const { title, language, collaborators } = req.body;
    
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }
    
    // Check if user is the owner
    if (!document.owner.equals(req.user._id)) {
      return res.status(403).json({ error: "Only the owner can update this document" });
    }
    
    const updatedDocument = await Document.findByIdAndUpdate(
      req.params.id,
      { title, language, collaborators },
      { new: true, runValidators: true }
    ).populate("owner", "username").populate("collaborators", "username");
    
    res.json(updatedDocument);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/documents/:id", auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }
    
    // Check if user is the owner
    if (!document.owner.equals(req.user._id)) {
      return res.status(403).json({ error: "Only the owner can delete this document" });
    }
    
    await Document.findByIdAndDelete(req.params.id);
    
    // Also delete associated Yjs document
    await YjsDocument.findOneAndDelete({ name: document.yjsDocumentName });
    
    res.json({ message: "Document deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add collaborator to document
app.post("/api/documents/:id/collaborators", auth, async (req, res) => {
  try {
    const { email } = req.body;
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }
    
    // Check if user is the owner
    if (!document.owner.equals(req.user._id)) {
      return res.status(403).json({ error: "Only the owner can add collaborators" });
    }
    
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    // Check if user is already a collaborator
    if (document.collaborators.includes(user._id)) {
      return res.status(400).json({ error: "User is already a collaborator" });
    }
    
    // Add collaborator
    document.collaborators.push(user._id);
    await document.save();
    
    await document.populate("owner", "username");
    await document.populate("collaborators", "username email");
    
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove collaborator from document
app.delete("/api/documents/:id/collaborators/:userId", auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }
    
    // Check if user is the owner
    if (!document.owner.equals(req.user._id)) {
      return res.status(403).json({ error: "Only the owner can remove collaborators" });
    }
    
    // Remove collaborator
    document.collaborators = document.collaborators.filter(
      collaboratorId => !collaboratorId.equals(req.params.userId)
    );
    
    await document.save();
    
    await document.populate("owner", "username");
    await document.populate("collaborators", "username email");
    
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Error handler middleware (should be last)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});