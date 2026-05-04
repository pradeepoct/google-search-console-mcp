# Google Cloud setup — Service Account for GSC

This is the trickiest step of the install. ~5 minutes. You only do it once.

## 1. Create (or pick) a Google Cloud project

1. Go to https://console.cloud.google.com
2. Top bar → project dropdown → **New Project**
3. Name it `gsc-mcp-connector` (or anything). Region: leave default. → **Create**
4. Make sure the new project is selected in the top bar.

## 2. Enable the Search Console API

1. Left menu → **APIs & Services** → **Library**
2. Search `Search Console API`
3. Click the result → **Enable**

(Optional but recommended) Also enable `Google Search Console API` if it appears as a separate result. Same project.

## 3. Create the Service Account

1. Left menu → **IAM & Admin** → **Service Accounts**
2. **+ Create service account**
   - **Name** : `gsc-mcp` (the email will be derived from this)
   - **Description** : `Read-only access to Search Console for the MCP connector`
   - → **Create and continue**
3. **Grant access** : skip (no project-level roles needed). → **Continue** → **Done**

## 4. Generate the JSON key

1. In the Service Accounts list, click the service account you just created
2. Tab **Keys** → **Add key** → **Create new key**
3. Select **JSON** → **Create**
4. A `.json` file is downloaded. **Treat it like a password.** Anyone with this file can read your GSC.

## 5. Copy the email

In the Service Account details, copy the value of **Email** (looks like `gsc-mcp@gsc-mcp-connector-12345.iam.gserviceaccount.com`). You will paste it into Search Console next.

## 6. Add the Service Account as a Search Console user

For each property you want the connector to access:

1. Open https://search.google.com/search-console
2. Pick the property
3. Left menu → **Settings** → **Users and permissions**
4. **Add user** → paste the Service Account email → **Permission: Restricted** is enough → **Add**

## 7. Format the JSON for the Worker secret

The Cloudflare secret command takes the JSON as a single line. Two ways:

**Option A — terminal copy:**
```bash
# macOS / Linux
cat /path/to/key.json | tr -d '\n' | pbcopy   # macOS
cat /path/to/key.json | tr -d '\n' | xclip    # Linux
```

**Option B — manual:** open the JSON in any editor, replace newlines with `\n` inside the `private_key` field, ensure the whole thing is on one line.

Then:
```bash
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
# paste the one-line JSON when prompted
```

Or via the Cloudflare dashboard (recommended for non-CLI users):
- Workers & Pages → `gsc-mcp-connector` → Settings → Variables and Secrets
- **Add** → name `GOOGLE_SERVICE_ACCOUNT_JSON` → type **Secret** → paste the full JSON (multi-line is fine in the dashboard) → Save.

## Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `Search Console API has not been enabled` | API not enabled in this project | Step 2 |
| `User does not have sufficient permission` | SA email not added to property | Step 6 |
| `Invalid JWT signature` | `private_key` newlines lost during paste | Re-paste from the original JSON or use the dashboard |
| Empty `siteEntry` array on `list_sites` | SA email not added to ANY property yet | Step 6 |
