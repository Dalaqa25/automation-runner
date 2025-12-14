# Cold Email Workflow - Setup Guide

## ✅ Status: Ready to Run

Your automation runner now supports **all node types** required for the "Zero-Cost Cold Email Machine" workflow.

## New Executors Added

1. **manualTrigger** - Manual workflow execution
2. **scheduleTrigger** - Scheduled workflow execution (hourly, daily, etc.)
3. **splitInBatches** - Loop through items in batches for pagination
4. **wait** - Pause execution to avoid rate limits
5. **limit** - Limit number of items processed
6. **emailSend** - Send emails via SMTP (nodemailer)

## Workflow Overview

This workflow:
1. **Scrapes 200 LinkedIn profiles** from Google Custom Search (2 searches × 100 results)
2. **Extracts emails** from each profile using RapidAPI
3. **Sends cold emails** to each extracted email
4. **Updates Google Sheets** with results

## Required Configuration

### 1. Environment Variables (.env)

```env
# SMTP for sending emails
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Google OAuth for Sheets
GOOGLE_ACCESS_TOKEN=your-google-access-token
```

### 2. Workflow API Keys (Need to Replace in JSON)

The workflow has hardcoded API keys that need to be replaced:

- **Google Custom Search API Key**: `AIzaSyAYa0UJ1ZxVEQDH2dVMaLWjQtg6IrPu_EY`
- **Google Custom Search CX**: `706f087` (and another one marked as `[CX NUMBER]`)
- **RapidAPI Key**: `dsddd` (for email scraper)

### 3. Google Sheets Setup

The workflow uses this Google Sheet:
- **Sheet ID**: `1RN7JW0aGmAoJ3PI9AukbtAMUIV08nyKk93ti0J72s9g`
- **Sheet Name**: "Sheet1"

You'll need to:
1. Create your own Google Sheet
2. Update the `documentId` in the workflow JSON
3. Ensure your Google OAuth token has access to it

## How to Run

### Option 1: Manual Execution (Test)

```bash
POST http://localhost:3001/execute
Content-Type: application/json

{
  "workflow": <paste workflow JSON here>,
  "initialData": {},
  "tokens": {
    "googleAccessToken": "your-google-token"
  }
}
```

### Option 2: Store & Execute via Workflow Service

```bash
# Store workflow in database
POST http://localhost:3001/api/workflows/cold-email-machine/execute
Content-Type: application/json

{
  "parameters": {},
  "tokens": {
    "googleAccessToken": "your-google-token"
  }
}
```

### Option 3: Queue for Async Execution

```bash
POST http://localhost:3001/queue
Content-Type: application/json

{
  "workflow": <paste workflow JSON here>,
  "initialData": {},
  "tokens": {
    "googleAccessToken": "your-google-token"
  }
}
```

## Workflow Execution Flow

```
Manual/Schedule Trigger
    ↓
Generate Page Numbers (1, 11, 21, ..., 91)
    ↓
Split into Batches (10 items per batch)
    ↓
    ├─→ Search 1: "solar companies toronto"
    │       ↓
    │   Wait 1 second
    │       ↓
    │   Loop back for next batch
    │
    └─→ Search 2: "solar companies Vancouver"
            ↓
        Wait 1 second
            ↓
        Loop back for next batch
    ↓
Merge Results (200 profiles)
    ↓
Filter & Deduplicate
    ↓
Write to Google Sheets
    ↓
Read from Google Sheets (limit 15)
    ↓
Extract Emails (RapidAPI)
    ↓
Send Cold Emails
    ↓
Update Google Sheets with Status
```

## Important Notes

### Rate Limiting
- The workflow uses **Wait** nodes (1 second) between API calls
- Google Custom Search API has quotas (100 queries/day free tier)
- RapidAPI email scraper has its own limits

### Batch Processing
- **splitInBatches** processes 10 items at a time
- This prevents overwhelming APIs and allows for better error handling

### Email Sending
- Uses SMTP (Gmail, Outlook, etc.)
- For Gmail, you need an "App Password" (not your regular password)
- The workflow limits to 15 emails per run (via **Limit** node)

### Scheduled Execution
- The workflow has a **Schedule Trigger** set to run hourly
- To enable scheduling, you'll need to set up a cron job or use the queue system

## Testing Without Sending Emails

To test the workflow without actually sending emails:

1. Comment out or remove the email send node
2. Or set `SMTP_USER` and `SMTP_PASSWORD` to empty (will fail gracefully)
3. The workflow will still scrape profiles and write to Google Sheets

## Next Steps

1. ✅ All executors installed
2. ⏳ Set up environment variables
3. ⏳ Replace hardcoded API keys in workflow JSON
4. ⏳ Create/configure Google Sheet
5. ⏳ Test with manual trigger
6. ⏳ Set up scheduled execution (optional)

## Troubleshooting

### "Google access token not provided"
- Set `GOOGLE_ACCESS_TOKEN` in .env
- Or pass it in the `tokens` object when calling the API

### "SMTP credentials not provided"
- Set `SMTP_USER` and `SMTP_PASSWORD` in .env
- For Gmail, use an App Password, not your regular password

### "Invalid API key" (Google Search)
- Replace the hardcoded API key in the workflow JSON
- Get a free API key from Google Cloud Console

### Workflow hangs or times out
- Check the Wait nodes (they pause execution)
- Check batch sizes (too large = long execution time)
- Monitor Redis queue if using async execution
