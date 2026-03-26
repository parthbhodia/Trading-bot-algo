# Stock Analysis Platform v2 — Claude Context

## Project Overview
A full-stack algorithmic trading dashboard with real-time signals, email alerts, and portfolio tracking.

## Tech Stack
- **Frontend**: Astro 4 + React 18 + Tailwind CSS + shadcn/ui
- **Backend**: FastAPI (Python) + Uvicorn
- **Database**: Supabase (PostgreSQL)
- **Data**: yfinance, Alpha Vantage, Finnhub, NewsAPI
- **AI**: xAI (Grok), Groq
- **Email**: Gmail SMTP (App Password)

## Deployment
| Layer | Platform | URL |
|-------|----------|-----|
| Backend | Railway (`celebrated-creativity` project → `Trading-bot-algo` service) | `https://trading-bot-algo.up.railway.app` |
| Frontend | GitHub Pages | `https://parthbhodia.github.io/Trading-bot-algo/` |
| Database | Supabase | `https://wnpibdxagcdcwyrcimfu.supabase.co` |

## Repository
- GitHub: `https://github.com/parthbhodia/Trading-bot-algo`
- Branch: `master`

## Local Development
```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev   # http://localhost:4321
```

## Environment Variables
### Backend (Railway)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `EMAIL_ADDRESS`, `EMAIL_PASSWORD`, `ALERT_EMAIL`
- `EMAIL_ALERTS_ENABLED`, `PLTR_ALERT_ENABLED`
- `ALERT_TIMEZONE` (America/New_York)
- `XAI_API_KEY`, `GROQ_API_KEY`
- `NEWS_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `FINNHUB_API_KEY`
- `SEC_USER_AGENT`
- `ENVIRONMENT=production`

### Frontend (GitHub Actions Secrets)
- `VITE_API_BASE_URL` → Railway backend URL
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Key Files
- `backend/app/main.py` — FastAPI app entry point (all routes + strategies)
- `backend/railway.toml` — Railway deploy config
- `backend/Procfile` — Uvicorn start command
- `frontend/astro.config.mjs` — Astro config (static output for GitHub Pages)
- `frontend/src/services/marketData.js` — API calls to backend
- `frontend/src/services/websocketService.js` — WebSocket client
- `.github/workflows/deploy-frontend.yml` — GitHub Pages auto-deploy

## Trading Strategies
- **HMA-Kahlman Triple Confirm** — Primary signal system
- **Dual Momentum** — Scheduled momentum signals
- **TQQQ Terminal Strategy** — Leveraged ETF signals
- **Email Deduplication** — 4-hour window to prevent spam

## Scheduled Tasks
- 9:00 AM ET — Pre-market check
- 9:34 AM ET — Market open signal scan
