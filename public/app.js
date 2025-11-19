// ----------- 工具函式 -----------

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

// ----------- 解析 token & 清掉網址 -----------

const params = getQueryParams();
let accessToken = params.access_token || null;
let refreshToken = params.refresh_token || null;

if (accessToken || refreshToken) {
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
}

// ----------- DOM 元素 -----------

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

// flip clock 容器
const flipClockRoot = document.getElementById("flip-clock");

// ----------- 播放器狀態 -----------

let player = null;
let currentState = null;
let progressInterval = null;

let currentTheme = "auto";
let lastAccentColor = null;

// ----------- 顯示/隱藏畫面 -----------

function showLogin() {
    loginView.classList.remove("hidden");
    playerView.classList.add("hidden");
}

function showPlayer() {
    loginView.classList.add("hidden");
    playerView.classList.remove("hidden");
}

// ----------- 主題 / 皮膚 -----------

function setTheme(theme) {
    currentTheme = theme;
    document.body.classList.remove("theme-wood", "theme-silver", "theme-night");

    if (theme === "wood") {
        document.body.classList.add("theme-wood");
        document.documentElement.style.setProperty("--accent-color", "#e0c48c");
    } else if (theme === "silver") {
        document.body.classList.add("theme-silver");
        document.documentElement.style.setProperty("--accent-color", "#1db954");
    } else if (theme === "night") {
        document.body.classList.add("theme-night");
        document.documentElement.style.setProperty("--accent-color", "#6f8bff");
    } else {
        document.documentElement.style.setProperty(
            "--accent-color",
            lastAccentColor || "#1db954"
        );
    }
}

themeSelect?.addEventListener("change", (e) => {
    setTheme(e.target.value);
});

// 從專輯封面抓主色調（只在 auto 模式時生效）
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
        r = Math.round((r / count) * 1.15);
        g = Math.round((g / count) * 1.15);
        b = Math.round((b / count) * 1.15);
        r = Math.min(255, r);
        g = Math.min(255, g);
        b = Math.min(255, b);

        const color = `rgb(${r}, ${g}, ${b})`;
        lastAccentColor = color;

        if (currentTheme === "auto") {
            document.documentElement.style.setProperty("--accent-color", color);
        }
    } catch (err) {
        console.warn("Failed to extract accent color, fallback", err);
        if (currentTheme === "auto") {
            document.documentElement.style.setProperty("--accent-color", "#1db954");
        }
    }
}

// ----------- Spotify 控制 -----------

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

    fetchQueue();
}

function initPlayer() {
    showPlayer();

    player = new Spotify.Player({
        name: "Vinyl Web Player",
        getOAuthToken: (cb) => cb(accessToken),
        volume: 0.8,
    });

    player.addListener("ready", ({ device_id }) => {
        console.log("Ready with Device ID", device_id);
        transferPlayback(device_id);
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
    });

    player.connect();
}

// ----------- Queue & Volume -----------

async function fetchQueue() {
    if (!accessToken) return;
    try {
        const res = await fetch("https://api.spotify.com/v1/me/player/queue", {
            headers: {
                Authorization: "Bearer " + accessToken,
            },
        });
        if (!res.ok) throw new Error("Failed to fetch queue");
        const data = await res.json();
        renderQueue(data);
    } catch (err) {
        console.error("Error fetching queue", err);
    }
}

function renderQueue(queueData) {
    queueList.innerHTML = "";
    if (!queueData || !queueData.queue) return;

    const upcoming = queueData.queue.slice(0, 8);
    if (upcoming.length === 0) {
        const li = document.createElement("li");
        li.textContent = "沒有接下來的歌曲";
        queueList.appendChild(li);
        return;
    }

    upcoming.forEach((track) => {
        const li = document.createElement("li");

        const title = document.createElement("span");
        title.className = "queue-track";
        title.textContent = track.name;

        const artist = document.createElement("span");
        artist.className = "queue-artist";
        artist.textContent = track.artists.map((a) => a.name).join(", ");

        li.appendChild(title);
        li.appendChild(artist);
        queueList.appendChild(li);
    });
}

queueRefreshBtn?.addEventListener("click", () => fetchQueue());

playBtn.addEventListener("click", () => {
    if (!player) return;
    player.togglePlay();
});

prevBtn.addEventListener("click", () => {
    if (!player) return;
    player.previousTrack();
});

nextBtn.addEventListener("click", () => {
    if (!player) return;
    player.nextTrack();
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

// ----------- Spotify SDK Ready -----------

window.onSpotifyWebPlaybackSDKReady = () => {
    if (!accessToken) {
        showLogin();
        return;
    }
    initPlayer();
};

// 初次進入頁面，沒有 token 就先顯示登入畫面
if (!accessToken) {
    showLogin();
}

// ----------- Flip Clock（翻頁時鐘） -----------

function createFlipDigitElement(initial = "0") {
    const digit = document.createElement("div");
    digit.className = "flip-digit";

    const top = document.createElement("div");
    top.className = "flip-top";
    top.textContent = initial;

    const bottom = document.createElement("div");
    bottom.className = "flip-bottom";
    bottom.textContent = initial;

    digit.appendChild(top);
    digit.appendChild(bottom);

    return digit;
}

function initFlipClock() {
    if (!flipClockRoot) return;

    flipClockRoot.classList.add("flip-clock");

    const structure = ["h1", "h2", "colon", "m1", "m2"];
    const digitMap = {};

    structure.forEach((slot) => {
        if (slot === "colon") {
            const colonEl = document.createElement("div");
            colonEl.className = "flip-colon";
            colonEl.textContent = ":";
            flipClockRoot.appendChild(colonEl);
            return;
        }
        const digitEl = createFlipDigitElement("0");
        flipClockRoot.appendChild(digitEl);
        digitMap[slot] = digitEl;
    });

    function updateClock() {
        const now = new Date();
        const h = now.getHours().toString().padStart(2, "0");
        const m = now.getMinutes().toString().padStart(2, "0");

        const values = {
            h1: h[0],
            h2: h[1],
            m1: m[0],
            m2: m[1],
        };

        Object.entries(values).forEach(([key, newVal]) => {
            const digitEl = digitMap[key];
            if (!digitEl) return;

            const top = digitEl.querySelector(".flip-top");
            const bottom = digitEl.querySelector(".flip-bottom");

            if (top.textContent === newVal) return;

            bottom.textContent = newVal;
            digitEl.classList.add("flip-anim");

            setTimeout(() => {
                top.textContent = newVal;
                digitEl.classList.remove("flip-anim");
            }, 300);
        });
    }

    updateClock();
    setInterval(updateClock, 1000);
}

initFlipClock();

// ----------- PWA Service Worker -----------

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/sw.js")
            .catch((err) => console.error("SW registration failed", err));
    });
}
