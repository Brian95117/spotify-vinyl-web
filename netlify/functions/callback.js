// netlify/functions/callback.js
const axios = require('axios');
const querystring = require('querystring');

exports.handler = async (event) => {
    const code = event.queryStringParameters.code;

    if (!code) {
        return {
            statusCode: 400,
            body: 'Missing authorization code'
        };
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
    const clientBaseUrl = process.env.CLIENT_BASE_URL || '/';

    if (!clientId || !clientSecret || !redirectUri) {
        console.error('Missing Spotify env vars');
        return {
            statusCode: 500,
            body: 'Server config error: missing Spotify env vars'
        };
    }

    try {
        const tokenRes = await axios.post(
            'https://accounts.spotify.com/api/token',
            querystring.stringify({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                client_id: clientId,
                client_secret: clientSecret
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const accessToken = tokenRes.data.access_token;
        const refreshToken = tokenRes.data.refresh_token || '';

        const redirectUrl =
            clientBaseUrl +
            `?access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(
                refreshToken
            )}`;

        return {
            statusCode: 302,
            headers: {
                Location: redirectUrl
            },
            body: ''
        };
    } catch (err) {
        console.error(err.response?.data || err.message);
        return {
            statusCode: 500,
            body: 'Error exchanging code for token with Spotify'
        };
    }
};
