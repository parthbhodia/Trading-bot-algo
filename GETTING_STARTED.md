# Getting Started - Stock Analysis Platform v2

## Prerequisites

- Node.js 18+
- Python 3.9+
- Supabase account

## Setup Instructions

### 1. Backend Setup

```bash
cd backend
python -m venv venv
# On Windows
venv\Scripts\activate
# On Mac/Linux
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
# Edit .env with your Supabase credentials

python -m app.main
```

Backend will run on: http://localhost:8000

### 2. Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env
# Edit .env with your API and Supabase credentials

npm run dev
```

Frontend will run on: http://localhost:4321

### 3. Environment Variables

#### Backend (.env)
```
SUPABASE_URL=your_supabase_url_here
SUPABASE_KEY=your_supabase_key_here
ENVIRONMENT=development
```

#### Frontend (.env)
```
VITE_API_BASE_URL=http://localhost:8000
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/portfolio` - Get portfolio data
- `POST /api/market-data` - Get market data for symbols
- `GET /api/vix-data` - Get VIX data for market analysis
- `GET /api/performance/{symbol}` - Get performance data for symbol

## Features

- ✅ Dark futuristic theme with glassmorphism
- ✅ Real-time portfolio tracking
- ✅ Market data integration
- ✅ VIX and market regime analysis
- ✅ Performance metrics
- ✅ Responsive design
- ✅ shadcn/ui components
- ✅ FastAPI backend
- ✅ Supabase integration

## Development

### Frontend Technologies
- Astro + React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide React

### Backend Technologies
- FastAPI
- Python
- yfinance
- Pandas
- Supabase

## Design System

- **Background**: Deep black (bg-zinc-950)
- **Accents**: Green neon effects
- **Theme**: Glassmorphism with backdrop blur
- **Font**: Inter throughout
- **Components**: shadcn/ui with custom styling

## Project Structure

```
stock-analysis-platform-v2/
├── frontend/          # Astro + React frontend
│   ├── src/
│   │   ├── components/ # React components
│   │   ├── layouts/    # Astro layouts
│   │   ├── pages/      # Astro pages
│   │   ├── lib/        # Utilities
│   │   └── styles/     # Global styles
├── backend/           # FastAPI backend
│   └── app/
│       └── main.py    # Main application
├── shared/            # Shared types
└── README.md
```

## Next Steps

1. Set up Supabase database
2. Configure environment variables
3. Run development servers
4. Start building features!
