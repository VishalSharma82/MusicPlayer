const socket = io();
let roomId = null;

let songList = [];
let currentIndex = 0;
let isPlaying = false;

const audio = document.getElementById("audio");
const currentSongName = document.getElementById("currentSongName");
const songListElem = document.getElementById("songList");

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function joinRoom() {
  roomId = document.getElementById("roomInput").value.trim();
  if (!roomId) return showToast("Please enter a Room ID");

  socket.emit("join-room", roomId);
  document.getElementById("player").style.display = "block";
  fetchSongs();
}

function uploadSong() {
  const file = document.getElementById("fileInput").files[0];
  if (!file) return showToast("Select a song to upload");

  const formData = new FormData();
  formData.append("song", file);

  fetch("/upload", {
    method: "POST",
    body: formData
  })
    .then(res => res.json())
    .then(data => {
      showToast("✅ Song uploaded");
      fetchSongs();
    })
    .catch(() => showToast("⚠️ Upload failed"));
}

function fetchSongs() {
  fetch("/songs")
    .then(res => res.json())
    .then(data => {
      songList = data;
      renderSongList();
      if (songList.length > 0) loadSong(0);
    });
}

function renderSongList() {
  songListElem.innerHTML = "";
  songList.forEach((song, index) => {
    const li = document.createElement("li");

    const songName = document.createElement("span");
    songName.textContent = song;
    songName.style.flex = "1";
    songName.style.cursor = "pointer";
    songName.onclick = () => {
      loadSong(index);
      syncControl("play");
    };

    const delBtn = document.createElement("span");
    delBtn.innerHTML = "🗑️";
    delBtn.style.cursor = "pointer";
    delBtn.style.marginLeft = "10px";
    delBtn.onclick = () => deleteSong(song);

    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.appendChild(songName);
    li.appendChild(delBtn);
    songListElem.appendChild(li);
  });
}

function deleteSong(song) {
  if (!confirm(`Are you sure you want to delete "${song}"?`)) return;

  fetch(`/delete?song=${encodeURIComponent(song)}`, { method: "DELETE" })
    .then(res => res.json())
    .then(data => {
      showToast("🗑️ Song deleted");
      fetchSongs(); // Refresh list
    })
    .catch(() => showToast("⚠️ Failed to delete song"));
}


function loadSong(index) {
  currentIndex = index;
  const filename = songList[index];
  audio.src = `/uploads/${filename}`;
  currentSongName.textContent = filename;
}

function togglePlayPause() {
  if (!roomId || songList.length === 0) return;
  if (audio.paused) {
    syncControl("play");
  } else {
    syncControl("pause");
  }
}

function syncControl(action) {
  socket.emit("control", { roomId, action, index: currentIndex });
  applyControl(action);
}

function applyControl(action) {
  if (action === "play") {
    audio.play();
    isPlaying = true;
  } else if (action === "pause") {
    audio.pause();
    isPlaying = false;
  } else if (action === "next") {
    nextSong(true);
  } else if (action === "prev") {
    prevSong(true);
  }
}

function nextSong(triggeredBySocket = false) {
  if (songList.length === 0) return;
  currentIndex = (currentIndex + 1) % songList.length;
  loadSong(currentIndex);
  if (!triggeredBySocket) syncControl("next");
  if (isPlaying) audio.play();
}

function prevSong(triggeredBySocket = false) {
  if (songList.length === 0) return;
  currentIndex = (currentIndex - 1 + songList.length) % songList.length;
  loadSong(currentIndex);
  if (!triggeredBySocket) syncControl("prev");
  if (isPlaying) audio.play();
}

function adjustVolume(val) {
  audio.volume = val;
}

socket.on("control", (data) => {
  if (data.index !== undefined) loadSong(data.index);
  applyControl(data.action);
});
