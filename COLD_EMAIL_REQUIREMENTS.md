# Cold Email Automation - Required Tokens & Credentials

## Overview

To run the "Zero-Cost Cold Email Machine" workflow, you need **4 types of credentials**:

## 1. Google OAuth Token (Required)

**Used for:** Google Sheets (reading/writing lead data)

**What you need:**
- Google OAuth2 access token
- Scopes: `https://www.googleapis.com/auth/spreadsheets`

**How to get it:**
1. User connects their Google account in your app
2. Store the access token in `user_integrations` table
3. Pass it to automation runner as `googleAccessToken`

**Environment variable:**
```env
GOOGLE_ACCESS_TOKEN=your-google-oauth-token
```

**Or pass via API:**
```javascript
{
  "tokens": {
    "googleAccessToken": "ya29.a0AfB_..."
  }
}
```

## 2. Google Custom Search API Key (Required)

**Used for:** Searching for LinkedIn profiles on Google

**What you need:**
- Google Custom Search API Key
- Custom Search Engine ID (CX)

**Current values in workflow (need to be replaced):**
```javascript
// Search 1
API Key: AIzaSyAYa0UJ1ZxVEQDH2dVMaLWjQtg6IrPu_EY
CX: 706f087

// Search 2
API Key: AIzaSyAYa0UJ1ZxVEQDH2dVMaLWjQtg  // Incomplete!
CX: [CX NUMBER]  // Placeholder!
```

**How to get it:**
1. Go to https://console.cloud.google.com/
2. Enable "Custom Search API"
3. Create API key
4. Go to https://programmablesearchengine.google.com/
5. Create a Custom Search Engine
6. Get the CX (Search Engine ID)

**Store in automation:**
```javascript
{
  "developer_keys": {
    "GOOGLE_SEARCH_API_KEY": "AIzaSy...",
    "GOOGLE_SEARCH_CX": "your-cx-id"
  }
}
```

**Note:** Free tier = 100 searches/day

## 3. RapidAPI Key (Required)

**Used for:** Extracting emails from websites

**What you need:**
- RapidAPI account
- Subscription to "Email Scraper" API

**Current value in workflow (need to be replaced):**
```javascript
x-rapidapi-key: "dsddd"  // Invalid placeholder
```

**How to get it:**
1. Go to https://rapidapi.com/
2. Sign up for account
3. Subscribe to "Email Scraper" API
4. Copy your API key

**Store in automation:**
```javascript
{
  "developer_keys": {
    "RAPIDAPI_KEY": "your-rapidapi-key"
  }
}
```

## 4. Email Sending (Gmail API - No Password!)

**Used for:** Sending cold emails

**GOOD NEWS:** You already have what you need! The automation runner uses **Gmail API with OAuth** (no email/password needed!)

**How it works:**
- Uses the **same Google OAuth token** you already have for Sheets
- No SMTP credentials needed!
- No email/password to manage!
- No extra packages needed!

**What you need:**
- ✅ Google OAuth token (you already have this!)
- ✅ Gmail API enabled in Google Cloud Console

**Setup (2 minutes):**
1. Go to https://console.cloud.google.com/
2. Go to "APIs & Services" → "Library"
3. Search for "Gmail API"
4. Click "Enable"
5. Done! ✅

**That's it!** The automation runner will automatically use Gmail API.

**Note:** Gmail free tier = 500 emails/day per user

## Complete Setup Checklist

### Step 1: Environment Variables (.env)

```env
# SMTP for sending emails
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-gmail-app-password

# Optional: Google OAuth (if not passed via API)
GOOGLE_ACCESS_TOKEN=ya29.a0AfB_...
```

### Step 2: Database (developer_keys)

```javascript
// When creating the automation
await supabase.from('automations').insert({
  name: 'Cold Email Machine',
  workflow: coldEmailWorkflowJson,
  developer_keys: {
    GOOGLE_SEARCH_API_KEY: 'AIzaSy...',
    GOOGLE_SEARCH_CX: 'your-cx-id',
    RAPIDAPI_KEY: 'your-rapidapi-key'
  },
  default_schedule: '0 * * * *'
});
```

### Step 3: User OAuth Tokens

```javascript
// Store in user_integrations table
{
  user_id: 'uuid',
  provider: 'google',
  access_token: 'ya29.a0AfB_...',
  refresh_token: '...',
  expires_at: '...'
}
```

### Step 4: Update Workflow JSON

Replace hardcoded values in the workflow:

```javascript
// Find and replace in workflow JSON
{
  "url": "https://www.googleapis.com/customsearch/v1?key={{GOOGLE_SEARCH_API_KEY}}&cx={{GOOGLE_SEARCH_CX}}&q=[QUERY]"
}

// And
{
  "headerParameters": {
    "parameters": [
      {
        "name": "x-rapidapi-key",
        "value": "{{RAPIDAPI_KEY}}"
      }
    ]
  }
}
```

## API Call Example

```javascript
POST http://localhost:3001/api/automations/run
{
  "automation_id": "cold-email-uuid",
  "user_id": "user-uuid",
  "config": {},
  "schedule": true
}

// The automation runner will:
// 1. Get developer_keys from automations table (Google Search API, RapidAPI)
// 2. Get googleAccessToken from user_integrations table
// 3. Get SMTP credentials from environment variables
// 4. Execute workflow with all credentials
```

## Cost Breakdown

### Free Tier Limits

1. **Google Custom Search API**
   - Free: 100 searches/day
   - Paid: $5 per 1,000 searches

2. **RapidAPI Email Scraper**
   - Free: 50 requests/month
   - Basic: $10/month for 1,000 requests

3. **Gmail SMTP**
   - Free: 500 emails/day
   - Google Workspace: 2,000 emails/day

4. **Google Sheets API**
   - Free: Unlimited (with rate limits)

### Workflow Usage

**Per run (200 leads):**
- Google Search: 20 API calls (2 searches × 10 pages each)
- Email Scraper: 15 API calls (limited to 15 by workflow)
- Emails Sent: 15 emails per hour
- Google Sheets: 3 API calls (write, read, update)

**Daily (if running every hour):**
- Emails: 360 per day (15 × 24 hours)
- Within Gmail free tier (500/day) ✅

## Troubleshooting

### "Google access token not provided"
- Set `GOOGLE_ACCESS_TOKEN` in .env
- Or ensure user has connected Google account

### "Invalid API key" (Google Search)
- Replace hardcoded API key in workflow JSON
- Or store in `developer_keys`

### "SMTP credentials not provided"
- Set `SMTP_USER` and `SMTP_PASSWORD` in .env

### "RapidAPI error"
- Replace hardcoded "dsddd" with real API key
- Check RapidAPI subscription is active

## Security Best Practices

1. **Never commit credentials to Git**
   - Use `.env` file (already in `.gitignore`)
   - Store API keys in database `developer_keys`

2. **Use environment variables for SMTP**
   - Don't store in database
   - Keep in `.env` file

3. **Rotate tokens regularly**
   - Refresh Google OAuth tokens
   - Regenerate API keys periodically

4. **Limit API key permissions**
   - Google API: Only enable Custom Search API
   - Use separate API keys per automation

## Summary

**Required Tokens:**
1. ✅ Google OAuth Token (from user)
2. ✅ Google Custom Search API Key (developer)
3. ✅ RapidAPI Key (developer)
4. ✅ SMTP Credentials (developer)

**Where to store:**
- User tokens → `user_integrations` table
- Developer keys → `automations.developer_keys` column
- SMTP credentials → `.env` file

**Next steps:**
1. Add `.env` file with SMTP credentials
2. Get Google Custom Search API key
3. Get RapidAPI key
4. Update workflow JSON with credential placeholders
5. Test with one lead first!
