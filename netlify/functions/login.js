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

    const scope = [
        'streaming',
        'user-read-email',
        'user-read-private',
        'user-read-playback-state',
        'user-modify-playback-state'
    ].join(' ');

    const params = querystring.stringify({
        response_type: 'code',
        client_id: clientId,
        scope,
        redirect_uri: redirectUri
        // demo 版先不做 state 驗證，有需要再加
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
