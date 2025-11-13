// public/script.js

const socket = io();
let roomId = null;
let userId = null;
let songList = [];
let currentIndex = 0;
let isPlaying = false;

// DOM Elements
const audio = document.getElementById("audio");
const currentSongName = document.getElementById("currentSongName");
const songListElem = document.getElementById("songList");
const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");
const authSection = document.getElementById("authSection");
const logoutBtn = document.getElementById("logoutBtn");
const userNameDisplay = document.getElementById("userNameDisplay");
const fileInput = document.getElementById("fileInput");
const fileNameSpan = document.getElementById("fileName");

// --- Utility Functions ---

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

fileInput.addEventListener("change", () => {
  fileNameSpan.textContent = fileInput.files[0]
    ? fileInput.files[0].name
    : "No file selected";
});

function adjustVolume(val) {
  audio.volume = val;
}

// --- Authentication & Initialization ---

function checkLoginStatus() {
  fetch("/user")
    .then((res) => {
      if (res.status === 401) throw new Error("Unauthorized");
      return res.json();
    })
    .then((data) => {
      userId = data.user.id; // Google ID
      userNameDisplay.textContent = `Hello, ${data.user.name}!`;
      authSection.style.display = "none";
      logoutBtn.style.display = "block";
      joinBtn.disabled = false;
      showToast(`Welcome, ${data.user.name}!`);
    })
    .catch(() => {
      userId = null;
      userNameDisplay.textContent =
        "Please sign in with Google to use the player.";
      authSection.style.display = "block";
      logoutBtn.style.display = "none";
      joinBtn.disabled = true;
    });
}

// Check status on load and check hash for post-login redirect
checkLoginStatus();

function joinRoom() {
  roomId = roomInput.value.trim();
  if (!roomId || !userId)
    return showToast("Please enter a Room ID and sign in.");

  socket.emit("join-room", roomId, userId);
  document.getElementById("player").style.display = "block";
  fetchSongs();
  showToast(`Joined room: ${roomId}`);
}

// --- Player Functions ---

function uploadSong() {
  const file = fileInput.files[0];
  if (!file) return showToast("Select a song to upload");
  if (!userId) return showToast("Please sign in to upload songs");

  const formData = new FormData();
  formData.append("song", file);

  fetch("/upload", {
    method: "POST",
    body: formData,
  })
    .then((res) => res.json())
    .then((data) => {
      showToast("✅ Song uploaded");
      fileInput.value = "";
      fileNameSpan.textContent = "No file selected";
      fetchSongs();
    })
    .catch(() => showToast("⚠️ Upload failed (Requires Login)"));
}

function fetchSongs() {
  fetch("/songs")
    .then((res) => res.json())
    .then((data) => {
      songList = data;
      renderSongList();
      if (songList.length > 0 && audio.src === "") {
        loadSong(0);
      }
    });
}

function renderSongList() {
  songListElem.innerHTML = "";
  songList.forEach((song, index) => {
    const li = document.createElement("li");
    if (index === currentIndex) li.classList.add("playing");

    const songName = document.createElement("span");
    songName.textContent = song;
    songName.style.flex = "1";
    songName.style.cursor = "pointer";
    songName.onclick = () => {
      loadSong(index);
      syncControl("change-song", 0, index);
    };

    const delBtn = document.createElement("span");
    delBtn.innerHTML = "🗑️";
    delBtn.style.cursor = "pointer";
    delBtn.style.marginLeft = "10px";
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteSong(song);
    };

    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.appendChild(songName);
    li.appendChild(delBtn);
    songListElem.appendChild(li);
  });
}

function deleteSong(song) {
  if (!userId) return showToast("Please sign in to delete songs.");
  if (!confirm(`Are you sure you want to delete "${song}"?`)) return;

  fetch(`/delete?song=${encodeURIComponent(song)}`, { method: "DELETE" })
    .then((res) => {
      if (res.status === 401) throw new Error("Unauthorized");
      return res.json();
    })
    .then((data) => {
      showToast("🗑️ Song deleted");
      fetchSongs();
    })
    .catch(() => showToast("⚠️ Failed to delete song (Login required)"));
}

function loadSong(index) {
  currentIndex = index;
  const filename = songList[index];
  audio.src = `/uploads/${filename}`;
  currentSongName.textContent = filename;

  // Update active highlight
  document
    .querySelectorAll("#songList li")
    .forEach((li) => li.classList.remove("playing"));
  if (songListElem.children[index]) {
    songListElem.children[index].classList.add("playing");
  }
}

// --- Sync Control Logic ---

function togglePlayPause() {
  if (!roomId || songList.length === 0)
    return showToast("Join a room with uploaded songs first.");
  if (audio.paused) {
    syncControl("play", audio.currentTime);
  } else {
    syncControl("pause", audio.currentTime);
  }
}

function nextSong() {
  if (!roomId || songList.length === 0) return;
  currentIndex = (currentIndex + 1) % songList.length;
  // Client loads song and sends control to others
  loadSong(currentIndex);
  syncControl("next", 0, currentIndex);
}

function prevSong() {
  if (!roomId || songList.length === 0) return;
  currentIndex = (currentIndex - 1 + songList.length) % songList.length;
  // Client loads song and sends control to others
  loadSong(currentIndex);
  syncControl("prev", 0, currentIndex);
}

function syncControl(
  action,
  currentTime = audio.currentTime,
  index = currentIndex
) {
  if (!roomId || songList.length === 0) return;
  socket.emit("control", { roomId, action, index, currentTime });
}

// Event to re-sync if a user manually seeks (drags the slider)
audio.addEventListener("seeked", () => {
  // Only send seek command if we are playing or recently played
  if (!audio.paused || audio.currentTime > 0) {
    syncControl("seek", audio.currentTime);
  }
});

// Auto-play next song on end
audio.addEventListener("ended", () => {
  // Check if the current song is the last in the list, if so, stop/loop
  // For this example, we just go to the next song
  nextSong();
});

// --- CORE SYNCHRONIZATION HANDLER ---

const SEEK_THRESHOLD = 0.75; // Max drift allowed (0.75 seconds)

socket.on("sync-state", (state) => {
  const {
    currentSongIndex,
    isPlaying: remoteIsPlaying,
    currentTime: remoteCurrentTime,
    lastUpdateTime,
  } = state;

  // 1. Song Change Check
  if (currentSongIndex !== currentIndex) {
    loadSong(currentSongIndex);
  }

  // 2. Time Correction (Precise Sync Logic)
  let expectedTime = remoteCurrentTime;
  if (remoteIsPlaying) {
    // Calculate drift: add the time elapsed since the server sent the update
    const timeSinceUpdate = (Date.now() - lastUpdateTime) / 1000;
    expectedTime = remoteCurrentTime + timeSinceUpdate;
  }

  const drift = Math.abs(audio.currentTime - expectedTime);

  // Only attempt seek if the player has enough data to play smoothly
  if (drift > SEEK_THRESHOLD && audio.readyState >= 3) {
    audio.currentTime = expectedTime;
    console.log(
      `⏱️ Corrected time: ${expectedTime.toFixed(2)}s (Drift: ${drift.toFixed(
        2
      )}s)`
    );
  }

  // 3. Play/Pause State
  isPlaying = remoteIsPlaying;
  if (remoteIsPlaying && audio.paused) {
    // Attempt to play, catching the error if browser blocks auto-play
    audio
      .play()
      .catch((e) =>
        console.log("Auto-play blocked, please interact with the player.")
      );
  } else if (!remoteIsPlaying && !audio.paused) {
    audio.pause();
  }
});
