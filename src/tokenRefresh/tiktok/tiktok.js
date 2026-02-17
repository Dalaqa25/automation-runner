/**
 * Refreshes TikTok OAuth2 token
 * @param {Object} instanceData - The automation instance data including refresh_token
 * @returns {Promise<Object>} - The new token data { access_token, expires_in, refresh_token }
 */
async function refreshTikTokToken(instanceData) {
    console.log(`[TokenRefresh][tiktok] Refreshing token for instance ${instanceData.id}`);

    if (!instanceData.refresh_token) {
        throw new Error('No refresh token available for TikTok provider');
    }

    // Ensure TikTok credentials are set
    if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
        throw new Error('TikTok client credentials (TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET) are missing from environment variables');
    }

    const params = new URLSearchParams();
    params.append('client_key', process.env.TIKTOK_CLIENT_KEY);
    params.append('client_secret', process.env.TIKTOK_CLIENT_SECRET);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', instanceData.refresh_token);

    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cache-Control': 'no-cache'
        },
        body: params
    });

    const data = await response.json();

    if (!response.ok || data.error) {
        throw new Error(`TikTok token refresh failed: ${data.error_description || data.error || data.message || 'Unknown error'}`);
    }

    // Validate response structure
    if (!data.access_token) {
        throw new Error('TikTok token refresh succeeded but no access_token returned');
    }

    return {
        access_token: data.access_token,
        expires_in: data.expires_in,
        // TikTok returns a new refresh token that is valid for 365 days
        // Always use the latest one
        refresh_token: data.refresh_token || instanceData.refresh_token
    };
}

module.exports = { refreshTikTokToken };
