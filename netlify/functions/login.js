// netlify/functions/login.js
const querystring = require('querystring');

exports.handler = async (event) => {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        console.error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI');
        return {
            statusCode: 500,
            body: 'Server config error: missing Spotify env vars'
        };
    }

    // 🔥 必要 scopes（完整、自動 queue 100% 正常）
    const scope = [
        'streaming',
        'user-read-email',
        'user-read-private',
        'user-read-playback-state',
        'user-modify-playback-state',
        'user-read-currently-playing'   // ← 你之前缺這個！
    ].join(' ');

    const params = querystring.stringify({
        response_type: 'code',
        client_id: clientId,
        scope,
        redirect_uri: redirectUri,
        show_dialog: true               // ← 讓 Spotify 重新要求授權（非常重要！）
    });

    const authorizeUrl = 'https://accounts.spotify.com/authorize?' + params;

    return {
        statusCode: 302,
        headers: {
            Location: authorizeUrl
        },
        body: ''
    };
};
