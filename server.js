const express = require("express");
const http = require("http");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.urlencoded({ extended: true }));

// Create uploads folder if it doesn't exist
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "_" + file.originalname;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// POST /upload => Upload new song
app.post("/upload", upload.single("song"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  res.json({ filename: req.file.filename });
});

// GET /songs => List all uploaded songs
app.get("/songs", (req, res) => {
  fs.readdir(path.join(__dirname, "uploads"), (err, files) => {
    if (err) {
      return res.status(500).json({ error: "Failed to list songs" });
    }
    const songs = files.filter(file => file.endsWith(".mp3"));
    res.json(songs);
  });
});

// Socket.IO logic
io.on("connection", (socket) => {
  console.log("✅ A user connected");

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`User joined room: ${roomId}`);
  });

  socket.on("control", (data) => {
    // Emit to others in the same room
    socket.to(data.roomId).emit("control", data);
  });

  socket.on("disconnect", () => {
    console.log("❌ A user disconnected");
  });
});

app.delete("/delete", (req, res) => {
  const song = req.query.song;
  if (!song) return res.status(400).json({ error: "Song not specified" });

  const filePath = path.join(__dirname, "./uploads", song);

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error("Delete Error:", err);
      return res.status(500).json({ error: "Failed to delete song" });
    }
    res.json({ success: true });
  });
});


// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

