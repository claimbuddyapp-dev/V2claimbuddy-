# ClaimBuddy

Deployment-ready Node.js + Express expense claim app with:

- WhatsApp claim intake via Twilio webhook
- Receipt parsing with optional Anthropic Vision/PDF support
- Admin dashboard served from `public/index.html`
- Employee and claim APIs
- Excel and PDF claim exports
- PostgreSQL support through `DATABASE_URL`, with lowdb fallback for local use

## Local setup

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`.

## Environment variables

Required for WhatsApp production use:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
```

Optional:

```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
DATABASE_URL=postgresql://user:password@host:5432/dbname
PORT=3000
NODE_ENV=production
```

## Railway deployment

1. Push this folder to GitHub.
2. Create a new Railway project from the GitHub repo.
3. Add a PostgreSQL service, then set `DATABASE_URL` on the web service.
4. Add Twilio and Anthropic environment variables.
5. Deploy. Railway uses `railway.toml` and runs `node server.js`.

## Twilio webhook

Set your Twilio WhatsApp webhook URL to:

```text
https://YOUR-APP-DOMAIN/webhook/whatsapp
```

Method: `POST`.

## Health check

```text
/health
```

## Useful API endpoints

- `GET /api/employees`
- `POST /api/employees`
- `GET /api/claims`
- `PATCH /api/claims/:id`
- `GET /api/analytics`
- `GET /api/export`
- `GET /api/export/pdf/:empId`
