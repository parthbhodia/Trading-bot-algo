const isProd = typeof window !== 'undefined' && !window.location.hostname.includes('localhost');
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (isProd ? 'https://trading-bot-algo.up.railway.app' : 'http://localhost:8001');
