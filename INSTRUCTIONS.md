# Stock Analysis Platform v2 - Complete Setup Instructions

## 🚨 IMPORTANT - Read This First!

This project has been through extensive development and debugging. **DO NOT** skip any steps in this guide. We faced multiple critical issues that you need to be aware of.

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Prerequisites](#prerequisites)
3. [Installation Steps](#installation-steps)
4. [Critical Issues We Faced](#critical-issues-we-faced)
5. [API Configuration](#api-configuration)
6. [Running the Application](#running-the-application)
7. [Troubleshooting](#troubleshooting)
8. [Known Limitations](#known-limitations)

---

## 🎯 Project Overview

A modern stock analysis platform with:
- **Real-time stock prices** via Finnhub API
- **VIX volatility analysis** via Yahoo Finance (with CORS proxies)
- **Historical performance charts** 
- **Portfolio tracking** with real P&L calculations
- **WebSocket integration** for live updates
- **Dark futuristic UI** with glassmorphism effects

---

## 📦 Prerequisites

### Required Software
- **Node.js 18+** - Frontend development
- **Python 3.9+** - Backend development
- **Git** - Version control

### Required Accounts
- **Finnhub API Key** - Free tier available
- **Supabase Account** - Free tier available (optional for full features)

---

## 🔧 Installation Steps

### 1. Clone the Repository
```bash
git clone <repository-url>
cd stock-analysis-platform-v2
```

### 2. Frontend Setup
```bash
cd frontend
npm install
```

### 3. Backend Setup
```bash
cd backend
pip install -r requirements.txt
```

### 4. Environment Configuration

#### Frontend (.env)
```bash
# Finnhub API (REQUIRED - get free key from https://finnhub.io/)
VITE_FINNHUB_API_KEY=your_finnhub_api_key_here

# Alpha Vantage (optional)
VITE_ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key

# Supabase (optional)
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

#### Backend (.env)
```bash
# Finnhub API (same as frontend)
FINNHUB_API_KEY=your_finnhub_api_key_here

# Alpha Vantage
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

---

## 🚨 Critical Issues We Faced

### 1. API Rate Limiting & CORS Issues
**Problem**: Finnhub free tier has limitations, Yahoo Finance blocked by CORS

**Solution Implemented**:
- Rate limiting (10 calls/second max)
- Multiple CORS proxies for Yahoo Finance
- Smart fallback from Finnhub to Yahoo Finance

### 2. WebSocket Connection Failures
**Problem**: WebSocket 400 errors, connection failures

**Solution Implemented**:
- Graceful error handling
- Rate-limited reconnection attempts
- Fallback to static prices when WebSocket fails

### 3. Environment Variable Access
**Problem**: Astro server mode affected `import.meta.env` access

**Solution Implemented**:
- Multiple fallback methods for API key access
- Browser-compatible environment variable handling

### 4. Data Integrity
**Problem**: Risk of fake/simulated financial data

**Solution Implemented**:
- **NO FAKE DATA** - Only real API data or clear error messages
- Proper error handling for subscription-required features
- Null safety for undefined financial values

---

## 🔑 API Configuration

### Finnhub API Setup (REQUIRED)
1. Go to [Finnhub.io](https://finnhub.io/)
2. Sign up for free account
3. Get API key from dashboard
4. Add to both frontend and backend `.env` files

### What Works with Free Finnhub:
- ✅ Real-time stock prices (QQQ, AAPL, MSFT, etc.)
- ✅ WebSocket connections (limited)
- ❌ VIX data (requires paid subscription)
- ❌ Historical candle data (requires paid subscription)

### Yahoo Finance Setup (Automatic)
- Uses CORS proxies to bypass browser restrictions
- Provides VIX and historical data for free
- Multiple proxy fallbacks for reliability

---

## 🚀 Running the Application

### Start Backend (Port 8001)
```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

### Start Frontend (Port 4322)
```bash
cd frontend
npm run dev
```

### Access the Application
- **Frontend**: http://localhost:4322
- **Backend API**: http://localhost:8001
- **API Docs**: http://localhost:8001/docs

---

## 🔧 Troubleshooting

### Common Issues and Solutions

#### "No Finnhub API key configured"
**Solution**: 
1. Check `.env` files in both frontend and backend
2. Ensure `VITE_FINNHUB_API_KEY` is set
3. Restart both servers

#### "VIX data requires paid subscription"
**Expected**: This is normal with free Finnhub
**Solution**: System falls back to Yahoo Finance automatically

#### "WebSocket connection failed"
**Expected**: Happens due to network restrictions
**Solution**: App shows static prices with clear error messages

#### "CORS policy blocked" (Yahoo Finance)
**Solution**: Multiple CORS proxies try automatically
- If all fail, VIX/historical charts show error messages
- Real-time prices still work via Finnhub

#### "Hydration failed" errors
**Solution**: Fixed with proper null safety in utility functions
- Check `utils.ts` for safe formatting functions

---

## ⚠️ Known Limitations

### Free API Limitations
- **Finnhub**: 60 calls/minute, no VIX/historical data
- **Yahoo Finance**: Requires CORS proxies, may be unreliable
- **WebSocket**: May fail due to network restrictions

### Features That Work
- ✅ Real-time stock prices (Finnhub)
- ✅ Portfolio calculations
- ✅ Error handling and user feedback
- ✅ Rate limiting and connection management

### Features That May Fail
- ❌ VIX charts (if CORS proxies fail)
- ❌ Historical performance charts (if CORS proxies fail)
- ❌ WebSocket real-time updates (network dependent)

---

## 🎯 Expected User Experience

### Working Scenario
```
🟊 Dashboard: Shows real stock prices from Finnhub
📊 VIX Chart: Shows volatility data via Yahoo Finance
📈 Performance Chart: Shows historical data via Yahoo Finance
🔌 Real-time Updates: WebSocket when available, static when not
```

### Error Scenario
```
🟡 VIX Chart: "VIX data requires paid subscription" → Falls back to Yahoo Finance
🔌 WebSocket: "WebSocket unavailable" → Shows static prices
📊 Historical: "CORS policy blocked" → Tries multiple proxies
```

---

## 🛠️ Development Notes

### Key Files to Understand
- `frontend/src/services/marketData.js` - API integration with fallbacks
- `frontend/src/services/websocketService.js` - WebSocket with rate limiting
- `frontend/src/lib/utils.ts` - Safe formatting functions
- `backend/app/main.py` - FastAPI endpoints

### Architecture Decisions
- **No fake data**: Real API data or clear errors only
- **Graceful degradation**: Platform works even when some features fail
- **Rate limiting**: Prevents API abuse and connection storms
- **Multiple data sources**: Finnhub + Yahoo Finance for completeness

---

## 🚀 Future Improvements

### Paid API Upgrades
- **Finnhub Premium**: Unlocks VIX and historical data
- **Alternative APIs**: Alpha Vantage, Polygon.io
- **Backend Proxy**: Self-hosted CORS proxy for Yahoo Finance

### Enhanced Features
- **Database persistence**: Store portfolio data
- **User authentication**: Multi-user support
- **Advanced charts**: More technical indicators
- **Trading strategies**: Backtesting integration

---

## 📞 Support

### If You Face Issues:
1. **Check console logs** - Detailed error messages provided
2. **Verify API keys** - Ensure Finnhub key is valid
3. **Check network** - Some features require internet access
4. **Review this guide** - Most issues documented here

### Debug Mode
- Frontend: Browser console shows detailed API call logs
- Backend: Terminal shows FastAPI request logs
- Both: Rate limiting and error handling messages

---

## 🎉 Success Criteria

You'll know it's working when:
- ✅ Dashboard loads with real stock prices
- ✅ VIX chart shows volatility data (via Yahoo Finance)
- ✅ Performance charts show historical data
- ✅ Error messages are clear and helpful
- ✅ No fake or simulated data anywhere

**Remember**: This platform prioritizes data integrity over fake functionality. If something doesn't work, it will show a clear error message rather than fake data.
