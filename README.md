# Stock Analysis Platform v2

A modern, dark-themed stock analysis platform built with React, FastAPI, and Supabase.

## Tech Stack

- **Frontend**: Astro + React + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: FastAPI + Python + Supabase
- **Database**: Supabase (PostgreSQL)
- **Styling**: Dark mode, futuristic, glassmorphism design
- **Font**: Inter throughout

## Features

- Real-time portfolio tracking
- Market data analysis
- VIX and market regime analysis
- Portfolio performance metrics
- Position management
- Trading signals
- 10-year asset performance analysis

## Design System

- **Background**: Deep black (bg-zinc-950)
- **Accents**: Neon and green colors
- **Theme**: Glassmorphism effects
- **Typography**: Inter font family

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.9+
- Supabase account

### Installation

1. Clone the repository
2. Install frontend dependencies
3. Install backend dependencies
4. Set up environment variables
5. Start development servers

## Project Structure

```
stock-analysis-platform-v2/
├── frontend/          # Astro + React frontend
├── backend/           # FastAPI backend
├── shared/            # Shared types and utilities
└── README.md
```

## Deployment

| Layer | Platform | URL |
|-------|----------|-----|
| Backend | Railway | `https://trading-bot-algo.up.railway.app` |
| Frontend | GitHub Pages | `https://parthbhodia.github.io/Trading-bot-algo/` |
| Database | Supabase | Managed PostgreSQL |

## Development

- Frontend: `npm run dev` (port 4321)
- Backend: `uvicorn app.main:app --reload` (port 8000)
