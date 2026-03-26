import { API_BASE_URL } from "../config.js";
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Newspaper, TrendingUp, TrendingDown, Minus,
         AlertTriangle, Zap, Globe, Flame, Cpu, BarChart2 } from 'lucide-react';

// ── Category config ────────────────────────────────────────────────────────
const CATEGORIES = [
  {
    id:      'market',
    label:   'Market Overview',
    symbols: ['SPY'],
    icon:    <BarChart2 className="w-4 h-4" />,
    color:   'blue',
    accent:  'text-blue-400',
    border:  'border-blue-500/40',
    bg:      'bg-blue-500/10',
    desc:    'S&P 500 & broad market news',
  },
  {
    id:      'oil',
    label:   'Oil & Energy',
    symbols: ['XOM'],
    icon:    <Flame className="w-4 h-4" />,
    color:   'amber',
    accent:  'text-amber-400',
    border:  'border-amber-500/40',
    bg:      'bg-amber-500/10',
    desc:    'Oil markets, energy sector',
  },
  {
    id:      'geopolitics',
    label:   'Geopolitics & War',
    symbols: ['GLD'],
    icon:    <Globe className="w-4 h-4" />,
    color:   'yellow',
    accent:  'text-yellow-400',
    border:  'border-yellow-500/40',
    bg:      'bg-yellow-500/10',
    desc:    'Gold, safe-havens, global risk events',
  },
  {
    id:      'defense',
    label:   'Defense',
    symbols: ['LMT'],
    icon:    <AlertTriangle className="w-4 h-4" />,
    color:   'red',
    accent:  'text-red-400',
    border:  'border-red-500/40',
    bg:      'bg-red-500/10',
    desc:    'Defense industry, military spending',
  },
  {
    id:      'tech',
    label:   'Tech & AI',
    symbols: ['NVDA'],
    icon:    <Cpu className="w-4 h-4" />,
    color:   'purple',
    accent:  'text-purple-400',
    border:  'border-purple-500/40',
    bg:      'bg-purple-500/10',
    desc:    'AI, semiconductors, tech',
  },
  {
    id:      'pltr',
    label:   'Palantir',
    symbols: ['PLTR'],
    icon:    <Zap className="w-4 h-4" />,
    color:   'green',
    accent:  'text-green-400',
    border:  'border-green-500/40',
    bg:      'bg-green-500/10',
    desc:    'PLTR-specific coverage',
  },
];

// ── Sentiment badge ────────────────────────────────────────────────────────
const SentimentBadge = ({ sentiment }) => {
  if (!sentiment) return null;
  const cfg = {
    bullish: { cls: 'bg-green-500/20 text-green-400 border-green-500/30', icon: <TrendingUp  className="w-3 h-3" /> },
    bearish: { cls: 'bg-red-500/20   text-red-400   border-red-500/30',   icon: <TrendingDown className="w-3 h-3" /> },
    mixed:   { cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: <Minus className="w-3 h-3" /> },
  }[sentiment] || { cls: 'bg-zinc-700 text-zinc-400 border-zinc-600', icon: null };
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold border ${cfg.cls}`}>
      {cfg.icon}
      {sentiment.toUpperCase()}
    </span>
  );
};

// ── Single news card ──────────────────────────────────────────────────────
const NewsCard = ({ symbol, cat, data, loading, error, onRefresh }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-xl border bg-zinc-900/60 backdrop-blur p-5 ${cat.border} flex flex-col gap-3`}>
      {/* Card header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${cat.bg} ${cat.accent}`}>{cat.icon}</div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-sm">{symbol}</span>
              {data && <SentimentBadge sentiment={data.sentiment} />}
            </div>
            <p className="text-zinc-500 text-xs mt-0.5">{cat.desc}</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-zinc-600 hover:text-zinc-400 transition-colors disabled:opacity-40 shrink-0"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Body */}
      {loading && !data ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <div className={`w-5 h-5 border-2 rounded-full animate-spin`}
               style={{ borderColor: `${cat.accent.replace('text-', '')}33`, borderTopColor: 'currentColor' }}
          />
          <p className="text-zinc-500 text-xs">Generating AI summary…</p>
        </div>
      ) : error && !data ? (
        <div className="text-center py-4">
          <p className="text-zinc-500 text-xs mb-2">{error}</p>
          <button onClick={onRefresh} className={`text-xs ${cat.accent} hover:opacity-80`}>Retry</button>
        </div>
      ) : data ? (
        <>
          {/* AI bullets */}
          <div className="space-y-1.5">
            {data.bullets?.map((b, i) => (
              <div key={i} className="flex gap-2 items-start text-xs">
                <span className={`shrink-0 mt-0.5 ${b.type === 'bull' ? 'text-green-400' : 'text-red-400'}`}>
                  {b.type === 'bull' ? '🟢' : '🔴'}
                </span>
                <span className="text-zinc-300 leading-relaxed">{b.text}</span>
              </div>
            ))}
          </div>

          {/* Source articles (collapsible) */}
          {data.articles?.length > 0 && (
            <div>
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors"
              >
                {expanded ? '▲' : '▼'} {data.articles.length} source headlines
              </button>
              {expanded && (
                <div className="mt-2 space-y-2 pl-2 border-l border-zinc-800">
                  {data.articles.map((a, i) => (
                    <div key={i}>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-400 hover:text-blue-400 transition-colors text-xs leading-snug block"
                      >
                        {a.title}
                      </a>
                      <p className="text-zinc-600 text-xs">{a.publisher} · {a.date}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Timestamp */}
          {data.generated && (
            <p className="text-zinc-700 text-xs">
              Updated {new Date(data.generated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
};

// ── Main NewsPage component ────────────────────────────────────────────────
const NewsPage = () => {
  const [activeTab, setActiveTab]   = useState('all');
  const [newsCache, setNewsCache]   = useState({});  // { SYMBOL: data }
  const [loadingSet, setLoadingSet] = useState(new Set());
  const [errorMap, setErrorMap]     = useState({});

  const setLoading = (sym, val) =>
    setLoadingSet(prev => { const s = new Set(prev); val ? s.add(sym) : s.delete(sym); return s; });

  const fetchNews = useCallback(async (symbol, force = false) => {
    if (!force && newsCache[symbol]) return;
    setLoading(symbol, true);
    setErrorMap(prev => { const m = { ...prev }; delete m[symbol]; return m; });
    try {
      const res = await fetch(`${API_BASE_URL}/api/news/${symbol}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setNewsCache(prev => ({ ...prev, [symbol]: data }));
    } catch (e) {
      setErrorMap(prev => ({ ...prev, [symbol]: `Could not load news for ${symbol}` }));
    } finally {
      setLoading(symbol, false);
    }
  }, [newsCache]);

  // Fetch initial tab on mount + when tab changes
  useEffect(() => {
    if (activeTab === 'all') {
      // Load all categories lazily (only if not cached)
      CATEGORIES.forEach(cat => cat.symbols.forEach(sym => fetchNews(sym)));
    } else {
      const cat = CATEGORIES.find(c => c.id === activeTab);
      if (cat) cat.symbols.forEach(sym => fetchNews(sym));
    }
  }, [activeTab]);

  const handleRefresh = (symbol) => {
    setNewsCache(prev => { const n = { ...prev }; delete n[symbol]; return n; });
    fetchNews(symbol, true);
  };

  const handleRefreshAll = () => {
    setNewsCache({});
    CATEGORIES.forEach(cat => cat.symbols.forEach(sym => fetchNews(sym, true)));
  };

  const visibleCats = activeTab === 'all'
    ? CATEGORIES
    : CATEGORIES.filter(c => c.id === activeTab);

  const totalLoading = loadingSet.size;

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      {/* ── Page header ── */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              Market Intelligence
            </h1>
            <p className="text-zinc-400 mt-1 text-sm">
              AI-powered news analysis by Grok — oil, geopolitics, war, and events affecting markets
            </p>
          </div>
          <div className="flex items-center gap-3">
            {totalLoading > 0 && (
              <span className="text-zinc-500 text-xs animate-pulse">
                Generating {totalLoading} summaries…
              </span>
            )}
            <button
              onClick={handleRefreshAll}
              disabled={totalLoading > 0}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-4 h-4 ${totalLoading > 0 ? 'animate-spin' : ''}`} />
              Refresh All
            </button>
            <a
              href="/"
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm transition-colors"
            >
              ← Dashboard
            </a>
          </div>
        </div>

        {/* ── Category tabs ── */}
        <div className="flex gap-2 mt-6 flex-wrap">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'all'
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
            }`}
          >
            All
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveTab(cat.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === cat.id
                  ? `${cat.bg} ${cat.accent} ${cat.border} border`
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
              }`}
            >
              {cat.icon}
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── News grid ── */}
      <div className={`grid gap-6 ${
        activeTab === 'all'
          ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
          : 'grid-cols-1 md:grid-cols-2'
      }`}>
        {visibleCats.map(cat =>
          cat.symbols.map(sym => (
            <NewsCard
              key={sym}
              symbol={sym}
              cat={cat}
              data={newsCache[sym]}
              loading={loadingSet.has(sym)}
              error={errorMap[sym]}
              onRefresh={() => handleRefresh(sym)}
            />
          ))
        )}
      </div>

      {/* ── Disclaimer ── */}
      <p className="mt-10 text-center text-zinc-700 text-xs">
        AI summaries generated by Grok (xAI) from live yfinance headlines.
        Not financial advice. Always verify before trading.
      </p>
    </div>
  );
};

export default NewsPage;
