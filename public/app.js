// 解析 URL Query string
function getQueryParams() {
    const params = {};
    const queryString = window.location.search.substring(1);
    const pairs = queryString.split('&').filter(Boolean);
    for (const pair of pairs) {
        const [key, value] = pair.split('=');
        params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
    return params;
}

function msToTime(ms) {
    if (!ms && ms !== 0) return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const params = getQueryParams();
let accessToken = params.access_token || null;
let refreshToken = params.refresh_token || null;

// 清掉網址上的 token，避免每次 reload 再跑一次 callback
if (accessToken || refreshToken) {
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
}

const loginView = document.getElementById('login-view');
const playerView = document.getElementById('player-view');
const albumImage = document.getElementById('album-image');
const trackNameEl = document.getElementById('track-name');
const artistNameEl = document.getElementById('artist-name');
const currentTimeEl = document.getElementById('current-time');
const durationEl = document.getElementById('duration');
const progressBar = document.getElementById('progress-bar');
const playBtn = document.getElementById('play-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const turntable = document.querySelector('.turntable');
const themeSelect = document.getElementById('theme-select');
const queueList = document.getElementById('queue-list');
const queueRefreshBtn = document.getElementById('queue-refresh-btn');
const volumeBar = document.getElementById('volume-bar');

let player = null;
let currentState = null;
let progressInterval = null;
let currentTheme = 'auto';

function showLogin() {
    loginView.classList.remove('hidden');
    playerView.classList.add('hidden');
}

function showPlayer() {
    loginView.classList.add('hidden');
    playerView.classList.remove('hidden');
}

/* ---------- THEME & ACCENT COLOR ---------- */

function setTheme(theme) {
    currentTheme = theme;
    document.body.classList.remove('theme-wood', 'theme-silver', 'theme-night');
    if (theme === 'wood') {
        document.body.classList.add('theme-wood');
        document.documentElement.style.setProperty('--accent-color', '#e0c48c');
    } else if (theme === 'silver') {
        document.body.classList.add('theme-silver');
        document.documentElement.style.setProperty('--accent-color', '#1db954');
    } else if (theme === 'night') {
        document.body.classList.add('theme-night');
        document.documentElement.style.setProperty('--accent-color', '#6f8bff');
    } else {
        // auto：讓專輯封面決定
        document.documentElement.style.setProperty('--accent-color', '#1db954');
    }
}

themeSelect?.addEventListener('change', (e) => {
    setTheme(e.target.value);
});

/**
 * 從專輯封面抓主色調，設定為 accent color
 */
function applyAccentFromImage(img) {
    if (currentTheme !== 'auto') return;
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const size = 32;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        const color = `rgb(${r}, ${g}, ${b})`;
        document.documentElement.style.setProperty('--accent-color', color);
    } catch (err) {
        console.warn('Failed to extract accent color', err);
    }
}

/* ---------- SPOTIFY PLAYER ---------- */

async function transferPlayback(deviceId) {
    if (!accessToken) return;
    try {
        await fetch('https://api.spotify.com/v1/me/player', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + accessToken
            },
            body: JSON.stringify({
                device_ids: [deviceId],
                play: false
            })
        });
    } catch (err) {
        console.error('Error transferring playback', err);
    }
}

function updateUIFromState(state) {
    const track = state.track_window.current_track;
    if (!track) return;

    trackNameEl.textContent = track.name;
    artistNameEl.textContent = track.artists.map((a) => a.name).join(', ');

    const image = track.album.images[0];
    if (image) {
        albumImage.crossOrigin = 'anonymous';
        albumImage.onload = () => applyAccentFromImage(albumImage);
        albumImage.src = image.url;
    }

    const position = state.position;
    const duration = state.duration;
    currentTimeEl.textContent = msToTime(position);
    durationEl.textContent = msToTime(duration);

    const progressPercent = duration ? Math.floor((position / duration) * 100) : 0;
    progressBar.value = progressPercent;

    if (state.paused) {
        turntable.classList.remove('playing');
    } else {
        turntable.classList.add('playing');
    }

    // 清除舊的 interval
    if (progressInterval) clearInterval(progressInterval);

    // 播放中就每秒更新一次時間條（前端自己模擬）
    if (!state.paused) {
        progressInterval = setInterval(() => {
            if (!currentState) return;
            const { position, duration, paused } = currentState;
            if (paused) return;

            const newPos = position + 1000;
            if (newPos > duration) return;
            currentState.position = newPos;

            currentTimeEl.textContent = msToTime(newPos);
            const newPercent = duration ? Math.floor((newPos / duration) * 100) : 0;
            progressBar.value = newPercent;
        }, 1000);
    }

    // 順便更新 queue
    fetchQueue();
}

function initPlayer() {
    showPlayer();

    player = new Spotify.Player({
        name: 'Vinyl Web Player',
        getOAuthToken: (cb) => {
            cb(accessToken);
        },
        volume: 0.8
    });

    player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        // 一登入就自動把播放切到這個網頁
        transferPlayback(device_id);
    });

    player.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID has gone offline', device_id);
    });

    player.addListener('initialization_error', ({ message }) => {
        console.error('init error', message);
    });

    player.addListener('authentication_error', ({ message }) => {
        console.error('auth error', message);
        alert('Spotify 認證失敗，請重新登入。');
        showLogin();
    });

    player.addListener('account_error', ({ message }) => {
        console.error('account error', message);
        alert('需要 Spotify Premium 帳號才能播放。');
    });

    player.addListener('player_state_changed', (state) => {
        if (!state) return;
        currentState = state;
        updateUIFromState(state);
    });

    player.connect();
}

/* ---------- QUEUE & VOLUME ---------- */

async function fetchQueue() {
    if (!accessToken) return;
    try {
        const res = await fetch('https://api.spotify.com/v1/me/player/queue', {
            headers: {
                Authorization: 'Bearer ' + accessToken
            }
        });
        if (!res.ok) {
            throw new Error('Failed to fetch queue');
        }
        const data = await res.json();
        renderQueue(data);
    } catch (err) {
        console.error('Error fetching queue', err);
    }
}

function renderQueue(queueData) {
    queueList.innerHTML = '';
    if (!queueData || !queueData.queue) return;
    const upcoming = queueData.queue.slice(0, 8);

    if (upcoming.length === 0) {
        const li = document.createElement('li');
        li.textContent = '沒有接下來的歌曲';
        queueList.appendChild(li);
        return;
    }

    upcoming.forEach((track) => {
        const li = document.createElement('li');
        const title = document.createElement('span');
        title.className = 'queue-track';
        title.textContent = track.name;

        const artist = document.createElement('span');
        artist.className = 'queue-artist';
        artist.textContent = track.artists.map((a) => a.name).join(', ');

        li.appendChild(title);
        li.appendChild(artist);
        queueList.appendChild(li);
    });
}

queueRefreshBtn?.addEventListener('click', () => {
    fetchQueue();
});

// 控制按鈕
playBtn.addEventListener('click', () => {
    if (!player) return;
    player.togglePlay();
});

prevBtn.addEventListener('click', () => {
    if (!player) return;
    player.previousTrack();
});

nextBtn.addEventListener('click', () => {
    if (!player) return;
    player.nextTrack();
});

// 音量
volumeBar.addEventListener('input', (e) => {
    const value = parseInt(e.target.value, 10) / 100;
    if (!player) return;
    player.setVolume(value);
});

// 拖動進度條
progressBar.addEventListener('input', async (e) => {
    if (!currentState || !accessToken) return;
    const percent = parseInt(e.target.value, 10);
    const duration = currentState.duration;
    const newPositionMs = Math.floor((percent / 100) * duration);

    try {
        await fetch(
            'https://api.spotify.com/v1/me/player/seek?position_ms=' + newPositionMs,
            {
                method: 'PUT',
                headers: {
                    Authorization: 'Bearer ' + accessToken
                }
            }
        );
    } catch (err) {
        console.error(err);
    }
});

// Spotify SDK 載完後會自動呼叫這個函式
window.onSpotifyWebPlaybackSDKReady = () => {
    if (!accessToken) {
        showLogin();
        return;
    }
    initPlayer();
};

// 一開始載入頁面時，如果還沒有 token，先顯示登入畫面
if (!accessToken) {
    showLogin();
}

// PWA Service Worker 註冊
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js')
            .catch((err) => console.error('SW registration failed', err));
    });
}
