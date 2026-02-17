const { refreshGoogleToken } = require('./google/google');
const { refreshTikTokToken } = require('./tiktok/tiktok');

/**
 * Checks if token needs refresh and refreshes it if necessary.
 * Updates the database with the new token and expiry.
 * 
 * @param {Object} instanceData - The user_automation record
 * @param {Object} supabase - Supabase client instance
 * @returns {Promise<Object>} - Object containing { accessToken, refreshToken, refreshed: boolean }
 */
async function refreshTokenIfNeeded(instanceData, supabase) {
    const {
        id,
        provider,
        access_token,
        refresh_token,
        token_expiry
    } = instanceData;

    // 1. Check if token is expired
    // Default to expired if no expiry date set, to force refresh (safer)
    // But if no expiry and no refresh token, we can't do anything
    if (!refresh_token) {
        return {
            accessToken: access_token,
            refreshToken: refresh_token,
            refreshed: false
        };
    }

    const expiryDate = token_expiry ? new Date(token_expiry) : new Date(0);
    const now = new Date();
    // Refresh if expired or expiring in the next 5 minutes
    const needsRefresh = expiryDate.getTime() - now.getTime() < 5 * 60 * 1000;

    if (!needsRefresh) {
        return {
            accessToken: access_token,
            refreshToken: refresh_token,
            refreshed: false
        };
    }

    // 2. Identify provider and refresh
    const providerName = (provider || '').toLowerCase();
    let refreshResult = null;

    console.log(`[TokenRefresh] Token expired for automation ${id} (provider: ${providerName}), refreshing...`);

    try {
        if (providerName.includes('google')) {
            refreshResult = await refreshGoogleToken(instanceData);
        } else if (providerName.includes('tiktok')) {
            refreshResult = await refreshTikTokToken(instanceData);
        } else {
            // Unknown provider, skip refresh
            console.warn(`[TokenRefresh] Unknown provider '${providerName}', skipping refresh`);
            return {
                accessToken: access_token,
                refreshToken: refresh_token,
                refreshed: false
            };
        }
    } catch (error) {
        console.error(`[TokenRefresh] Refresh failed for ${providerName}:`, error.message);
        throw error; // Propagate error so execution can be stopped/logged properly
    }

    // 3. Update database
    // Calculate new expiry
    // Google/TikTok usually return 'expires_in' in seconds
    const expiresInSeconds = refreshResult.expires_in || 3600;
    const newExpiry = new Date(now.getTime() + expiresInSeconds * 1000);

    const updates = {
        access_token: refreshResult.access_token,
        token_expiry: newExpiry.toISOString(),
        updated_at: new Date().toISOString()
    };

    // Only update refresh token if a new one was returned
    if (refreshResult.refresh_token) {
        updates.refresh_token = refreshResult.refresh_token;
    }

    const { error } = await supabase
        .from('user_automations')
        .update(updates)
        .eq('id', id);

    if (error) {
        console.error(`[TokenRefresh] Failed to update tokens in DB for ${id}:`, error.message);
        // We still return the new tokens so the current execution can proceed
    } else {
        console.log(`[TokenRefresh] Database updated with new token (expires: ${newExpiry.toISOString()})`);
    }

    return {
        accessToken: refreshResult.access_token,
        refreshToken: refreshResult.refresh_token || refresh_token,
        refreshed: true
    };
}

module.exports = { refreshTokenIfNeeded };
