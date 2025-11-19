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
let customQueue = []; // 自動 queue 用

let currentTheme = "auto";
let lastAccentColor = null;

let hasShownSpotify403 = false; // 403 提示只出現一次

// 方案 A：記錄目前播放的 context（playlist / album）
let currentContextUri = null;
let currentContextTracks = [];

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

// ================= 403 共用處理 =================

function handleSpotify403() {
    if (hasShownSpotify403) return;
    hasShownSpotify403 = true;
    console.warn("Spotify 403：可能不是 Premium 或尚未被加入測試者。");
    // 用播放列表區塊顯示提示文字
    if (queueList) {
        queueList.innerHTML = "";
        const msg = document.createElement("div");
        msg.textContent = "請聯絡開方者施捨你權限或付費解鎖";
        msg.style.color = "#ffeb3b";
        msg.style.fontSize = "0.9rem";
        msg.style.fontWeight = "600";
        msg.style.padding = "8px 4px";
        queueList.appendChild(msg);
    }
}

// ================= Spotify 控制 =================

// 把播放裝置切到這個網頁
async function transferPlayback(deviceId) {
    if (!accessToken) return;
    try {
        const res = await fetch("https://api.spotify.com/v1/me/player", {
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

        if (res.status === 403) {
            handleSpotify403();
            return;
        }

        if (!res.ok) {
            console.warn("transferPlayback 失敗", await res.text());
        }
    } catch (err) {
        console.error("Error transferring playback", err);
    }
}

// 播放指定 track（一般用途；queue 我們改用 context 播）
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

        if (res.status === 403) {
            handleSpotify403();
            return;
        }

        if (!res.ok) {
            console.warn("Error playing track", await res.text());
        }
    } catch (err) {
        console.error("Error playing track", err);
    }
}

// 方案 A：從 playlist / album context 播指定 index
async function playFromContext(contextUri, index) {
    if (!accessToken || !contextUri) return;
    try {
        const res = await fetch("https://api.spotify.com/v1/me/player/play", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + accessToken,
            },
            body: JSON.stringify({
                context_uri: contextUri,
                offset: { position: index },
            }),
        });

        if (res.status === 403) {
            handleSpotify403();
            return;
        }

        if (!res.ok) {
            console.warn("Error playFromContext", await res.text());
        }
    } catch (err) {
        console.error("Error playFromContext", err);
    }
}

// 更新 UI
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

        // 歌曲切換 / 播放狀態變化時，自動重建 queue
        buildQueueFromCurrent(true);
    });

    player.connect();
}

// ================= 自動 Queue（從播放清單/專輯產生） =================

// auto = true 時代表是「歌曲切換時自動更新」，錯了也不要吵使用者
async function buildQueueFromCurrent(auto = false) {
    if (!accessToken || !queueList) return;

    try {
        // 1. 先問現在在播什麼，順便拿 context（播放清單/專輯）
        const playingRes = await fetch(
            "https://api.spotify.com/v1/me/player/currently-playing",
            {
                headers: {
                    Authorization: "Bearer " + accessToken,
                },
            }
        );

        if (playingRes.status === 403) {
            handleSpotify403();
            return;
        }

        // 204 = Spotify 說「現在沒有播放任何東西」
        if (playingRes.status === 204) {
            if (!auto) console.warn("目前沒有正在播放的內容 (204)");
            renderQueue([], auto ? "" : "目前沒有正在播放的內容");
            return;
        }

        if (!playingRes.ok) {
            if (!auto)
                console.warn(
                    "無法取得目前播放狀態",
                    await playingRes.text().catch(() => "")
                );
            renderQueue([], auto ? "" : "目前沒有正在播放的內容");
            return;
        }

        const raw = await playingRes.text();
        if (!raw) {
            renderQueue([], auto ? "" : "目前沒有正在播放的內容");
            return;
        }

        let playing;
        try {
            playing = JSON.parse(raw);
        } catch (e) {
            console.warn("目前播放 JSON 解析失敗", e);
            renderQueue([], auto ? "" : "目前沒有正在播放的內容");
            return;
        }

        const currentTrack = playing.item;
        const context = playing.context;

        if (!currentTrack || !context || !context.uri) {
            renderQueue(
                [],
                auto ? "" : "目前播放不是來自播放清單 / 專輯，無法自動產生 queue"
            );
            return;
        }

        const currentTrackId = currentTrack.id;

        // 2. 看 context 是 playlist 還是 album，只處理這兩種
        const uriParts = context.uri.split(":");
        const type = uriParts[1]; // 'playlist' or 'album'
        const id = uriParts[2];

        if (type !== "playlist" && type !== "album") {
            renderQueue(
                [],
                auto ? "" : "目前播放不是播放清單 / 專輯，無法自動產生 queue"
            );
            return;
        }

        // 3. 把整個播放清單/專輯抓下來（最多抓前 100 首就夠玩了）
        const endpoint =
            type === "playlist"
                ? `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`
                : `https://api.spotify.com/v1/albums/${id}/tracks?limit=50`;

        const listRes = await fetch(endpoint, {
            headers: {
                Authorization: "Bearer " + accessToken,
            },
        });

        if (listRes.status === 403) {
            handleSpotify403();
            return;
        }

        if (!listRes.ok) {
            if (!auto)
                console.warn(
                    "無法取得播放清單 / 專輯曲目",
                    await listRes.text().catch(() => "")
                );
            renderQueue([], auto ? "" : "無法取得播放清單 / 專輯曲目");
            return;
        }

        const listData = await listRes.json();

        // playlist 回傳 items[].track
        // album 回傳 items[]（本身就是 track）
        const items = (listData.items || []).map((item) =>
            item.track ? item.track : item
        );

        // 方案 A：記住整份 context，以後 queue 點歌照這個播放
        currentContextUri = context.uri;
        currentContextTracks = items;

        // 4. 找出目前這首在清單裡的位置
        const currentIndex = items.findIndex((t) => t && t.id === currentTrackId);

        if (currentIndex === -1) {
            renderQueue([], auto ? "" : "在清單中找不到目前這首歌");
            return;
        }

        // 5. 從目前位置後面開始，取出 20 首當成 queue
        const nextTracks = items.slice(currentIndex + 1, currentIndex + 1 + 20);

        customQueue = nextTracks;
        renderQueue(customQueue);
    } catch (err) {
        console.error("自動 queue 發生錯誤", err);
        if (!auto) {
            renderQueue([], "產生自動 queue 時發生錯誤");
        }
    }
}

function renderQueue(tracks, emptyMessage = "") {
    if (!queueList) return;
    queueList.innerHTML = "";

    if (!tracks || !tracks.length) {
        if (emptyMessage) {
            const empty = document.createElement("div");
            empty.textContent = emptyMessage;
            empty.style.opacity = "0.7";
            empty.style.fontSize = "0.85rem";
            queueList.appendChild(empty);
        }
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

        // 方案 A：用 context_uri + index 切歌，維持 queue 正確
        item.addEventListener("click", () => {
            if (!currentContextUri || !currentContextTracks.length || !track.id) {
                // 後備方案：退回用單首 URI 播
                if (track.uri) {
                    playTrack(track.uri);
                }
                return;
            }
            const idx = currentContextTracks.findIndex(
                (t) => t && t.id === track.id
            );
            if (idx === -1) {
                // 找不到就當單首播
                if (track.uri) playTrack(track.uri);
                return;
            }
            playFromContext(currentContextUri, idx);
        });

        queueList.appendChild(item);
    });
}

// 點「刷新」按鈕時手動重建 queue
queueRefreshBtn?.addEventListener("click", () =>
    buildQueueFromCurrent(false)
);

// ================= 播放控制與 Slider =================

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
        const res = await fetch(
            "https://api.spotify.com/v1/me/player/seek?position_ms=" + newPositionMs,
            {
                method: "PUT",
                headers: {
                    Authorization: "Bearer " + accessToken,
                },
            }
        );

        if (res.status === 403) {
            handleSpotify403();
            return;
        }

        if (!res.ok) {
            console.warn("seek error", await res.text().catch(() => ""));
        }
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

        // 第一行時間
        if (!simpleClock.firstChild) {
            simpleClock.appendChild(document.createTextNode(`${hh}:${mm}`));
        } else {
            simpleClock.firstChild.nodeValue = `${hh}:${mm}`;
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

// =================（可選）Service Worker =================
// 若之後要做 PWA 再打開
// if ("serviceWorker" in navigator) {
//   window.addEventListener("load", () => {
//     navigator.serviceWorker
//       .register("/sw.js")
//       .catch((err) => console.error("SW registration failed", err));
//   });
// }
