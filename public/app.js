// ================= 共用工具 =================

function getQueryParams() {
    const params = {};
    const queryString = window.location.search.substring(1);
    if (!queryString) return params;
    const pairs = queryString.split("&").filter(Boolean);
    for (const pair of pairs) {
        const [key, value] = pair.split("=");
        params[decodeURIComponent(key)] = decodeURIComponent(value || "");
    }
    return params;
}

function msToTime(ms) {
    if (!ms && ms !== 0) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// ================= Token 解析 =================

const params = getQueryParams();
let accessToken = params.access_token || null;
let refreshToken = params.refresh_token || null;

// 乾淨網址（拿掉 ?access_token=...）
if (accessToken || refreshToken) {
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
}

// ================= DOM 取得 =================

const loginView = document.getElementById("login-view");
const playerView = document.getElementById("player-view");

const albumImage = document.getElementById("album-image");
const trackNameEl = document.getElementById("track-name");
const artistNameEl = document.getElementById("artist-name");
const currentTimeEl = document.getElementById("current-time");
const durationEl = document.getElementById("duration");
const progressBar = document.getElementById("progress-bar");

const playBtn = document.getElementById("play-btn");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");

const turntable = document.querySelector(".turntable");
const themeSelect = document.getElementById("theme-select");

const queueList = document.getElementById("queue-list");
const queueRefreshBtn = document.getElementById("queue-refresh-btn");
const volumeBar = document.getElementById("volume-bar");

// 簡易時鐘
const simpleClock = document.getElementById("simple-clock");

// ================= 狀態變數 =================

let player = null;
let currentState = null;
let progressInterval = null;

let currentTheme = "auto";
let lastAccentColor = null;

// ================= View 切換 =================

function showLogin() {
    loginView.classList.remove("hidden");
    playerView.classList.add("hidden");
}

function showPlayer() {
    loginView.classList.add("hidden");
    playerView.classList.remove("hidden");
}

// ================= 主題 / 皮膚 =================

function setTheme(theme) {
    currentTheme = theme;
    document.body.classList.remove(
        "theme-wood",
        "theme-silver",
        "theme-night",
        "theme-auto"
    );

    if (theme === "wood") {
        document.body.classList.add("theme-wood");
        document.documentElement.style.setProperty("--accent-color", "#e0c48c");
        document.documentElement.style.setProperty("--theme-color", "#c2954b");
    } else if (theme === "silver") {
        document.body.classList.add("theme-silver");
        document.documentElement.style.setProperty("--accent-color", "#1db954");
        document.documentElement.style.setProperty("--theme-color", "#6f7c8a");
    } else if (theme === "night") {
        document.body.classList.add("theme-night");
        document.documentElement.style.setProperty("--accent-color", "#6f8bff");
        document.documentElement.style.setProperty("--theme-color", "#4b5cff");
    } else {
        // auto：跟專輯顏色
        document.body.classList.add("theme-auto");
        document.documentElement.style.setProperty(
            "--accent-color",
            lastAccentColor || "#1db954"
        );
        document.documentElement.style.setProperty(
            "--theme-color",
            lastAccentColor || "#1db954"
        );
    }
}

themeSelect?.addEventListener("change", (e) => {
    setTheme(e.target.value);
});

// 從專輯封面抓主色調（平均色）
function applyAccentFromImage(img) {
    try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const size = 24;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        let r = 0,
            g = 0,
            b = 0,
            count = 0;
        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
        }
        r = Math.round((r / count) * 1.1);
        g = Math.round((g / count) * 1.1);
        b = Math.round((b / count) * 1.1);
        r = Math.min(255, r);
        g = Math.min(255, g);
        b = Math.min(255, b);

        const color = `rgb(${r}, ${g}, ${b})`;
        lastAccentColor = color;

        if (currentTheme === "auto") {
            document.documentElement.style.setProperty("--accent-color", color);
            document.documentElement.style.setProperty("--theme-color", color);
        }
    } catch (err) {
        console.warn("Failed to extract accent color, fallback", err);
        if (currentTheme === "auto") {
            document.documentElement.style.setProperty("--accent-color", "#1db954");
            document.documentElement.style.setProperty("--theme-color", "#1db954");
        }
    }
}

// ================= Spotify 控制 =================

// 把播放裝置切到這個網頁（不主動刷新 queue，保持 snapshot）
async function transferPlayback(deviceId) {
    if (!accessToken) return;
    try {
        await fetch("https://api.spotify.com/v1/me/player", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + accessToken,
            },
            body: JSON.stringify({
                device_ids: [deviceId],
                play: false,
            }),
        });
    } catch (err) {
        console.error("Error transferring playback", err);
    }
}

// 播放指定 track（點 queue item 用；不重抓 queue，保持第一次的列表）
async function playTrack(uri) {
    if (!accessToken || !uri) return;
    try {
        const res = await fetch("https://api.spotify.com/v1/me/player/play", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + accessToken,
            },
            body: JSON.stringify({
                uris: [uri],
            }),
        });

        if (!res.ok) {
            console.error("Error playing track", await res.text().catch(() => ""));
        }

        // 不呼叫 fetchQueue()，避免 queue 被 Spotify 新算出來的內容洗掉
    } catch (err) {
        console.error("Error playing track", err);
    }
}

// 更新 UI（不再在這裡重抓 queue）
function updateUIFromState(state) {
    const track = state.track_window.current_track;
    if (!track) return;

    trackNameEl.textContent = track.name;
    artistNameEl.textContent = track.artists.map((a) => a.name).join(", ");

    const image = track.album.images[0];
    if (image) {
        albumImage.crossOrigin = "anonymous";
        albumImage.onload = () => applyAccentFromImage(albumImage);
        const url =
            image.url + (image.url.includes("?") ? "&" : "?") + "t=" + Date.now();
        albumImage.src = url;
    }

    const position = state.position;
    const duration = state.duration;

    currentTimeEl.textContent = msToTime(position);
    durationEl.textContent = msToTime(duration);

    const progressPercent = duration
        ? Math.floor((position / duration) * 100)
        : 0;
    progressBar.value = progressPercent;

    if (state.paused) {
        turntable.classList.remove("playing");
    } else {
        turntable.classList.add("playing");
    }

    if (progressInterval) clearInterval(progressInterval);
    if (!state.paused) {
        progressInterval = setInterval(() => {
            if (!currentState) return;
            const { duration, paused } = currentState;
            if (paused) return;

            const newPos = currentState.position + 1000;
            if (newPos > duration) return;
            currentState.position = newPos;

            currentTimeEl.textContent = msToTime(newPos);
            const newPercent = duration
                ? Math.floor((newPos / duration) * 100)
                : 0;
            progressBar.value = newPercent;
        }, 1000);
    }

    // 這裡不再 fetchQueue()，避免每次 state 變化就換 queue
}

// 初始化播放 SDK
function initPlayer() {
    showPlayer();

    player = new Spotify.Player({
        name: "Vinyl Web Player",
        getOAuthToken: (cb) => cb(accessToken),
        volume: 0.8,
    });

    player.addListener("ready", ({ device_id }) => {
        console.log("Ready with Device ID", device_id);
        // 登入後自動切到這個網頁
        transferPlayback(device_id);
        // 只在第一次 ready 時抓一次 queue，當作 snapshot
        fetchQueue();
    });

    player.addListener("not_ready", ({ device_id }) => {
        console.log("Device ID has gone offline", device_id);
    });

    player.addListener("initialization_error", ({ message }) => {
        console.error("init error", message);
    });

    player.addListener("authentication_error", ({ message }) => {
        console.error("auth error", message);
        alert("Spotify 認證失敗，請重新登入。");
        showLogin();
    });

    player.addListener("account_error", ({ message }) => {
        console.error("account error", message);
        alert("需要 Spotify Premium 帳號才能播放。");
    });

    player.addListener("player_state_changed", (state) => {
        if (!state) return;
        currentState = state;
        updateUIFromState(state);
        // 不在這裡 fetchQueue()
    });

    player.connect();
}

// ================= Queue（播放列表） =================

async function fetchQueue() {
    if (!accessToken || !queueList) return;
    try {
        const res = await fetch("https://api.spotify.com/v1/me/player/queue", {
            headers: {
                Authorization: "Bearer " + accessToken,
            },
        });

        if (res.status === 204) {
            renderQueue([]);
            return;
        }

        if (!res.ok) {
            console.error("Failed to fetch queue", await res.text().catch(() => ""));
            renderQueue([]);
            return;
        }

        const data = await res.json();
        renderQueue(data.queue || []);
    } catch (err) {
        console.error("Error fetching queue", err);
        renderQueue([]);
    }
}

function renderQueue(tracks) {
    if (!queueList) return;
    queueList.innerHTML = "";

    if (!tracks.length) {
        const empty = document.createElement("div");
        empty.textContent = "目前沒有接下來的歌曲";
        empty.style.opacity = "0.7";
        empty.style.fontSize = "0.85rem";
        queueList.appendChild(empty);
        return;
    }

    tracks.forEach((track) => {
        const item = document.createElement("div");
        item.className = "queue-item";

        const title = document.createElement("div");
        title.className = "queue-title";
        title.textContent = track.name;

        const artist = document.createElement("div");
        artist.className = "queue-artist";
        artist.textContent = (track.artists || [])
            .map((a) => a.name)
            .join(", ");

        item.appendChild(title);
        item.appendChild(artist);

        item.addEventListener("click", () => {
            if (track.uri) {
                // 點 queue 播歌，但不重抓 queue（維持 snapshot）
                playTrack(track.uri);
            }
        });

        queueList.appendChild(item);
    });
}

// 「刷新」按鈕：手動重抓 queue（這時才會看到 Spotify 真實最新 queue）
queueRefreshBtn?.addEventListener("click", () => fetchQueue());

// ================= 控制按鈕事件 =================

playBtn.addEventListener("click", () => {
    if (!player) return;
    player.togglePlay();
    // state 變化會由 player_state_changed 處理，不動 queue
});

prevBtn.addEventListener("click", () => {
    if (!player) return;
    player.previousTrack();
    // 不重抓 queue，維持 snapshot；想看最新就按「刷新」
});

nextBtn.addEventListener("click", () => {
    if (!player) return;
    player.nextTrack();
    // 一樣不重抓 queue
});

volumeBar.addEventListener("input", (e) => {
    const value = parseInt(e.target.value, 10) / 100;
    if (!player) return;
    player.setVolume(value);
});

progressBar.addEventListener("input", async (e) => {
    if (!currentState || !accessToken) return;
    const percent = parseInt(e.target.value, 10);
    const duration = currentState.duration;
    const newPositionMs = Math.floor((percent / 100) * duration);

    try {
        await fetch(
            "https://api.spotify.com/v1/me/player/seek?position_ms=" + newPositionMs,
            {
                method: "PUT",
                headers: {
                    Authorization: "Bearer " + accessToken,
                },
            }
        );
    } catch (err) {
        console.error("seek error", err);
    }
});

// ================= Spotify SDK Ready =================

window.onSpotifyWebPlaybackSDKReady = () => {
    if (!accessToken) {
        showLogin();
        return;
    }
    initPlayer();
};

// 初次進入頁面：沒有 token 就顯示登入
if (!accessToken) {
    showLogin();
}

// ================= 一般時鐘（非翻頁） =================

function startSimpleClock() {
    if (!simpleClock) return;

    const dateEl =
        simpleClock.querySelector(".clock-date") ||
        (() => {
            const span = document.createElement("span");
            span.className = "clock-date";
            simpleClock.appendChild(document.createElement("br"));
            simpleClock.appendChild(span);
            return span;
        })();

    function updateClock() {
        const now = new Date();
        const hh = now.getHours().toString().padStart(2, "0");
        const mm = now.getMinutes().toString().padStart(2, "0");

        if (!simpleClock.firstChild) {
            simpleClock.appendChild(document.createTextNode(`${hh}:${mm}`));
        } else {
            simpleClock.childNodes[0].nodeValue = `${hh}:${mm}`;
        }

        const weekday = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
        const mon = (now.getMonth() + 1).toString().padStart(2, "0");
        const dd = now.getDate().toString().padStart(2, "0");
        const w = weekday[now.getDay()];

        dateEl.textContent = `${mon}/${dd} ${w}`;
    }

    updateClock();
    setInterval(updateClock, 1000);
}

startSimpleClock();

// =================（可選）關掉 Service Worker =================
// 如果之後要做 PWA，再把下面打開即可
// if ("serviceWorker" in navigator) {
//   window.addEventListener("load", () => {
//     navigator.serviceWorker
//       .register("/sw.js")
//       .catch((err) => console.error("SW registration failed", err));
//   });
// }
