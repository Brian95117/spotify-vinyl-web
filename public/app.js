// public/app.js

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

let player = null;
let currentState = null;
let progressInterval = null;

function showLogin() {
    loginView.classList.remove('hidden');
    playerView.classList.add('hidden');
}

function showPlayer() {
    loginView.classList.add('hidden');
    playerView.classList.remove('hidden');
}

function updateUIFromState(state) {
    const track = state.track_window.current_track;
    if (!track) return;

    trackNameEl.textContent = track.name;
    artistNameEl.textContent = track.artists.map(a => a.name).join(', ');

    const image = track.album.images[0];
    if (image) {
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
}

// 初始化 Spotify Player
function initPlayer() {
    showPlayer();

    player = new Spotify.Player({
        name: 'Vinyl Web Player',
        getOAuthToken: cb => {
            cb(accessToken);
        },
        volume: 0.8
    });

    player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
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

    player.addListener('player_state_changed', state => {
        if (!state) return;
        currentState = state;
        updateUIFromState(state);
    });

    player.connect();
}

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

// 拖動進度條（用 Spotify Web API 修改播放位置）
progressBar.addEventListener('input', async (e) => {
    if (!currentState || !accessToken) return;
    const percent = parseInt(e.target.value, 10);
    const duration = currentState.duration;
    const newPositionMs = Math.floor((percent / 100) * duration);

    try {
        await fetch('https://api.spotify.com/v1/me/player/seek?position_ms=' + newPositionMs, {
            method: 'PUT',
            headers: {
                Authorization: 'Bearer ' + accessToken
            }
        });
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
