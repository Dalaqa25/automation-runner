# Invoice System Manager

Specialized node executors for automated invoice processing from Google Drive.

## How It Works

The invoice automation workflow is **triggered automatically** when a new PDF invoice is uploaded to a specific Google Drive folder.

### Workflow Steps:

1. **Google Drive Trigger** - Polls Google Drive folder every minute for new files
2. **Download Invoice** - Downloads the PDF file from Google Drive
3. **Extract Text** - Extracts text content from the PDF
4. **AI Data Extraction** - Uses Groq AI to extract structured invoice data
5. **Update Database** - Saves invoice data to Google Sheets
6. **Send Email** - Notifies billing team via Gmail

## Starting the Invoice Automation

### Option 1: Start Polling (Recommended for Triggers)

```bash
POST /api/automations/start-polling
```

**Request Body:**
```json
{
  "automation_id": "your-automation-uuid",
  "user_id": "your-user-uuid",
  "config": {
    "folder_id": "google-drive-folder-id",
    "spreadsheet_id": "google-sheets-id",
    "billing_email": "billing@company.com"
  }
}
```

This starts a background polling service that checks the Google Drive folder every minute for new invoices.

### Option 2: One-Time Execution

```bash
POST /api/automations/run
```

**Request Body:**
```json
{
  "automation_id": "your-automation-uuid",
  "user_id": "your-user-uuid",
  "config": {
    "folder_id": "google-drive-folder-id",
    "spreadsheet_id": "google-sheets-id",
    "billing_email": "billing@company.com"
  }
}
```

This runs the workflow once immediately (useful for testing).

## Stopping the Automation

```bash
POST /api/automations/stop-polling
```

**Request Body:**
```json
{
  "automation_id": "your-automation-uuid"
}
```

## Checking Active Automations

```bash
GET /api/automations/active-polls
```

Returns list of all workflows currently being polled.

## Required Configuration

The workflow needs these placeholders replaced:

- `{{folder_id}}` - Google Drive folder ID to watch
- `{{spreadsheet_id}}` - Google Sheets spreadsheet ID for invoice database
- `{{billing_email}}` - Email address to send notifications to

## Required Tokens

The automation needs these OAuth tokens (stored in `user_integrations` table):

- **Google Access Token** - For Google Drive and Gmail access
- **Google Refresh Token** - For token refresh
- **Groq API Key** - For AI-powered data extraction (from developer_keys)

## Node Executors

### googleDriveTrigger.js
- Polls Google Drive folder for new files
- Checks every minute (configurable)
- Returns list of new files since last check

### googleDrive.js
- Downloads files from Google Drive
- Returns file content as base64 binary data

### informationExtractor.js
- Uses Groq AI (llama-3.3-70b-versatile) to extract structured data
- Extracts invoice fields: number, date, client info, products, amounts, etc.

### gmailTool.js
- Sends email notifications via Gmail API
- Supports text and HTML emails

## Example Usage

1. Upload the automation-1.json workflow to your database
2. Configure Google OAuth for the user
3. Start polling:

```javascript
const response = await fetch('http://localhost:3001/api/automations/start-polling', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    automation_id: 'abc-123',
    user_id: 'user-456',
    config: {
      folder_id: '1a2b3c4d5e',
      spreadsheet_id: '6f7g8h9i0j',
      billing_email: 'billing@company.com'
    }
  })
});
```

4. Upload an invoice PDF to the Google Drive folder
5. The automation will automatically:
   - Detect the new file
   - Download and extract text
   - Extract invoice data using AI
   - Save to Google Sheets
   - Send email notification

## Troubleshooting

- **No files detected**: Check folder_id is correct and user has access
- **Download fails**: Verify Google OAuth token is valid
- **AI extraction fails**: Check GROQ_API_KEY is set in environment
- **Email fails**: Verify Gmail API is enabled and user has granted permissions
