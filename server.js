// server.js

const express = require("express");
const http = require("http");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const session = require("express-session"); 
const passport = require("passport"); 
const GoogleStrategy = require("passport-google-oauth20").Strategy; 
require('dotenv').config(); // Environment variables load

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Configuration & Middleware ---

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Session setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'a_default_secret_for_dev', 
    resave: false,
    saveUninitialized: true
}));

app.use(passport.initialize());
app.use(passport.session());

// Passport Google Strategy (Authenticates with Google ID)
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: "https://musicplayer-07bb.onrender.com/auth/google/callback" 
},
function(accessToken, refreshToken, profile, done) {
    // In a real app, you would save this user to a database (e.g., MongoDB, PostgreSQL)
    const user = {
        id: profile.id, // The unique Google ID
        name: profile.displayName,
        email: profile.emails[0].value 
    };
    return done(null, user);
}));

passport.serializeUser((user, done) => { done(null, user); });
passport.deserializeUser((user, done) => { done(null, user); });

// Middleware for access control
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    // If unauthorized, send 401 response
    res.status(401).json({ error: "Unauthorized. Please sign in." }); 
}

// Global Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.urlencoded({ extended: true }));

// --- Google Auth Routes ---

app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        // Successful login, redirect to client-side detection route
        res.redirect('/#loggedIn'); 
    });

app.get('/logout', (req, res, next) => {
    req.logout((err) => { 
        if (err) { return next(err); }
        res.redirect('/');
    });
});

// Endpoint to check login status
app.get('/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ user: req.user });
    } else {
        res.status(401).json({ user: null });
    }
});


// --- File Handling Routes ---

// Create uploads folder if it doesn't exist
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Multer setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads"),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + "_" + file.originalname.replace(/\s/g, "_");
        cb(null, uniqueName);
    },
});
const upload = multer({ storage });

// POST /upload (Protected)
app.post("/upload", ensureAuthenticated, upload.single("song"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }
    res.json({ filename: req.file.filename });
});

// GET /songs
app.get("/songs", (req, res) => {
    fs.readdir(path.join(__dirname, "uploads"), (err, files) => {
        if (err) {
            return res.status(500).json({ error: "Failed to list songs" });
        }
        const songs = files.filter(file => file.endsWith(".mp3")); 
        res.json(songs);
    });
});

// DELETE /delete (Protected)
app.delete("/delete", ensureAuthenticated, (req, res) => {
    const song = req.query.song;
    if (!song) return res.status(400).json({ error: "Song not specified" });
    const filePath = path.join(__dirname, "./uploads", path.basename(song));

    fs.unlink(filePath, (err) => {
        if (err) {
            console.error("Delete Error:", err);
            return res.status(500).json({ error: "Failed to delete song" });
        }
        res.json({ success: true });
    });
});


// --- Socket.IO Sync Logic ---
const roomStates = {}; 

io.on("connection", (socket) => {
    console.log(`✅ User connected: ${socket.id}`);

    socket.on("join-room", (roomId, userId) => {
        socket.join(roomId);
        console.log(`User ${userId} joined room: ${roomId}`);

        socket.data.roomId = roomId;
        socket.data.userId = userId;

        if (!roomStates[roomId]) {
            roomStates[roomId] = {
                currentSongIndex: 0,
                isPlaying: false,
                currentTime: 0,
                lastUpdateTime: Date.now() 
            };
        }

        // Send the complete state to the new user for immediate sync
        socket.emit("sync-state", roomStates[roomId]);
    });

    socket.on("control", (data) => {
        const { roomId, action, index, currentTime } = data;

        if (roomStates[roomId]) {
            const state = roomStates[roomId];

            // Update state based on action
            if (action === "play") {
                state.isPlaying = true;
                state.currentTime = currentTime; 
            } else if (action === "pause") {
                state.isPlaying = false;
                state.currentTime = currentTime; 
            } else if (action === "change-song" || action === "next" || action === "prev") {
                state.currentSongIndex = index;
                state.currentTime = 0; 
                state.isPlaying = true;
            } else if (action === "seek" && currentTime !== undefined) {
                state.currentTime = currentTime;
            }
            
            // Critical: Update timestamp for drift correction on all clients
            state.lastUpdateTime = Date.now(); 

            // Broadcast the new authoritative state to all users in the room
            io.to(roomId).emit("sync-state", state); 
        }
    });

    socket.on("disconnect", () => {
        console.log(`❌ User disconnected: ${socket.id}`);
    });
});


// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        console.warn("⚠️ WARNING: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. Authentication will fail.");
    }
});