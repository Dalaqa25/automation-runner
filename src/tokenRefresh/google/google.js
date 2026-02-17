/**
 * Refreshes Google OAuth2 token
 * @param {Object} instanceData - The automation instance data including refresh_token
 * @returns {Promise<Object>} - The new token data { access_token, expires_in, refresh_token }
 */
async function refreshGoogleToken(instanceData) {
    console.log(`[TokenRefresh][google] Refreshing token for instance ${instanceData.id}`);

    if (!instanceData.refresh_token) {
        throw new Error('No refresh token available for Google provider');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: instanceData.refresh_token,
            grant_type: 'refresh_token'
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(`Google token refresh failed: ${data.error_description || data.error || 'Unknown error'}`);
    }

    return {
        access_token: data.access_token,
        expires_in: data.expires_in,
        // Google doesn't always return a new refresh token, use existing if not provided
        refresh_token: data.refresh_token || instanceData.refresh_token
    };
}

module.exports = { refreshGoogleToken };
