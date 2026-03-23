import React, { useEffect, useRef } from 'react';

// ─────────────────────────────────────────────
// Indicator Math (runs on both server + client — pure JS)
// ─────────────────────────────────────────────

function wma(values, period) {
  const result = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let num = 0, den = 0;
    for (let j = 0; j < period; j++) {
      const w = period - j;
      num += (values[i - j] ?? 0) * w;
      den += w;
    }
    result[i] = den ? num / den : null;
  }
  return result;
}

function hma(values, period) {
  const half = Math.round(period / 2);
  const sqrtp = Math.round(Math.sqrt(period));
  const wmaHalf = wma(values, half);
  const wmaFull = wma(values, period);
  const raw = values.map((_, i) =>
    wmaHalf[i] != null && wmaFull[i] != null ? 2 * wmaHalf[i] - wmaFull[i] : null
  );
  const firstValid = raw.findIndex(v => v != null);
  if (firstValid === -1) return values.map(() => null);
  const wmaResult = wma(raw.slice(firstValid), sqrtp);
  return [...new Array(firstValid).fill(null), ...wmaResult];
}

function kahlman(values, gain) {
  const result = [];
  let kf = null, vel = 0;
  for (const v of values) {
    if (v == null) { result.push(null); continue; }
    if (kf == null) { kf = v; result.push(v); continue; }
    const dist = v - kf;
    const err = dist * Math.sqrt(gain * 2);
    vel = vel + gain * dist;
    kf = kf + err + vel;
    result.push(kf);
  }
  return result;
}

function hmaKahlman(values, period, gain) {
  return kahlman(hma(values, period), gain);
}

function toChartDate(dateStr) {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

const FAST_PERIOD = 14;
const SLOW_PERIOD = 22;
const GAIN = 0.7;
const BG = '#0d0d0d';

const HMAKahlmanChart = ({ data = [], symbol = '' }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !data.length) return;

    let chart = null;
    let cleanup = null;

    // Dynamic import keeps lightweight-charts out of SSR entirely
    import('lightweight-charts').then(({ createChart, CrosshairMode, LineStyle, PriceScaleMode, CandlestickSeries, LineSeries, AreaSeries, createSeriesMarkers }) => {
      if (!containerRef.current) return;

      // ── Build unique sorted rows ─────────────────────────────────
      const seen = new Set();
      const rows = data
        .map(d => {
          const time = toChartDate(d.date);
          if (!time) return null;
          const c = d.close ?? d.ticker_price ?? 0;
          const o = d.open ?? c;
          const h = d.high ?? c;
          const l = d.low ?? c;
          return { time, open: o, high: h, low: l, close: c, signal: d.signal };
        })
        .filter(Boolean)
        .sort((a, b) => a.time.localeCompare(b.time))
        .filter(d => { if (seen.has(d.time)) return false; seen.add(d.time); return true; });

      if (!rows.length) return;

      const hasOHLC = rows.some(r => r.high !== r.low);

      // ── Create chart ──────────────────────────────────────────────
      chart = createChart(containerRef.current, {
        layout: {
          background: { color: BG },
          textColor: '#9ca3af',
          fontSize: 11,
          fontFamily: "'Inter', 'DM Sans', sans-serif",
        },
        grid: {
          vertLines: { color: 'rgba(55,65,81,0.4)' },
          horzLines: { color: 'rgba(55,65,81,0.4)' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: '#6b7280', labelBackgroundColor: '#1f2937' },
          horzLine: { color: '#6b7280', labelBackgroundColor: '#1f2937' },
        },
        rightPriceScale: {
          borderColor: 'rgba(55,65,81,0.6)',
          scaleMargins: { top: 0.12, bottom: 0.12 },
          mode: PriceScaleMode.Logarithmic,  // log scale so $7 and $160 are both readable
        },
        timeScale: {
          borderColor: 'rgba(55,65,81,0.6)',
          timeVisible: true,
          secondsVisible: false,
        },
        width: containerRef.current.clientWidth,
        height: 440,
      });

      // ── Price series (v5 API: chart.addSeries(Type, opts)) ────────
      let priceSeries;
      if (hasOHLC) {
        priceSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#10b981',
          downColor: '#ef4444',
          borderUpColor: '#10b981',
          borderDownColor: '#ef4444',
          wickUpColor: '#6ee7b7',
          wickDownColor: '#fca5a5',
        });
        priceSeries.setData(rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      } else {
        priceSeries = chart.addSeries(LineSeries, {
          color: '#60a5fa',
          lineWidth: 2,
          lastValueVisible: true,
          priceLineVisible: true,
          priceLineColor: '#60a5fa',
          priceLineStyle: LineStyle.Dashed,
        });
        priceSeries.setData(rows.map(r => ({ time: r.time, value: r.close })));
      }

      // ── HMA-Kahlman calculations ──────────────────────────────────
      const closes = rows.map(r => r.close);
      const hmaFastArr = hmaKahlman(closes, FAST_PERIOD, GAIN);
      const hmaSlowArr = hmaKahlman(closes, SLOW_PERIOD, GAIN);

      const fastLineData = rows
        .map((r, i) => hmaFastArr[i] != null ? { time: r.time, value: hmaFastArr[i] } : null)
        .filter(Boolean);
      const slowLineData = rows
        .map((r, i) => hmaSlowArr[i] != null ? { time: r.time, value: hmaSlowArr[i] } : null)
        .filter(Boolean);

      // ── Cloud: fast area (green fill downward) ────────────────────
      const fastArea = chart.addSeries(AreaSeries, {
        lineColor: '#10b981',
        topColor: 'rgba(16,185,129,0.18)',
        bottomColor: 'rgba(16,185,129,0)',
        lineWidth: 2.5,
        lastValueVisible: true,
        priceLineVisible: false,
        title: `HMA-K(${FAST_PERIOD})`,
      });
      fastArea.setData(fastLineData);

      // ── Cloud: slow area (BG-erase below slow line) ───────────────
      // Drawn on top of fast area — its opaque-BG fill "paints over"
      // the green below the slow line, leaving only the band visible.
      const slowArea = chart.addSeries(AreaSeries, {
        lineColor: '#f472b6',
        lineStyle: LineStyle.Dashed,
        topColor: BG,        // opaque chart BG → erases fast-area fill below slow
        bottomColor: BG,
        lineWidth: 2.5,
        lastValueVisible: true,
        priceLineVisible: false,
        title: `HMA-K(${SLOW_PERIOD})`,
      });
      slowArea.setData(slowLineData);

      // ── BUY / SELL markers (all signals, deduplicated) ───────────
      // BUY = amber/gold (contrasts against green HMA area fill)
      // SELL = red
      const markers = [];
      let lastSig = null;
      rows.forEach(r => {
        if (!r.signal || r.signal === 'HOLD' || r.signal === lastSig) return;
        const isBuy = r.signal === 'BUY';
        markers.push({
          time: r.time,
          position: isBuy ? 'belowBar' : 'aboveBar',
          color: isBuy ? '#f59e0b' : '#ef4444',   // amber for BUY, red for SELL
          shape: isBuy ? 'arrowUp' : 'arrowDown',
          text: `${r.signal} $${r.close.toFixed(2)}`,
          size: 2,
        });
        lastSig = r.signal;
      });
      if (markers.length > 0) {
        createSeriesMarkers(priceSeries, markers);
      }

      // Default view: last ~1 year of data (252 daily bars).
      // User can scroll left to see older signals. fitContent as fallback.
      if (rows.length > 252) {
        const fromDate = rows[rows.length - 252].time;
        const toDate   = rows[rows.length - 1].time;
        chart.timeScale().setVisibleRange({ from: fromDate, to: toDate });
      } else {
        chart.timeScale().fitContent();
      }

      // ── Responsive resize ─────────────────────────────────────────
      const ro = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect?.width;
        if (w && chart) chart.resize(w, 440);
      });
      ro.observe(containerRef.current);

      cleanup = () => { ro.disconnect(); chart.remove(); chart = null; };
    }).catch(err => {
      console.error('Failed to load chart library:', err);
    });

    return () => { if (cleanup) cleanup(); };
  }, [data, symbol]);

  return (
    <div className="space-y-2">
      {/* Indicator legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-400 px-1">
        <span className="font-medium text-zinc-300">{symbol} · Price Action</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-7 h-0.5 bg-green-400 rounded"></span>
          HMA-Kahlman ({FAST_PERIOD}, {GAIN})
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="28" height="3" viewBox="0 0 28 3" style={{display:'inline-block'}}>
            <line x1="0" y1="1.5" x2="28" y2="1.5" stroke="#f472b6" strokeWidth="2" strokeDasharray="5,3"/>
          </svg>
          HMA-Kahlman ({SLOW_PERIOD}, {GAIN})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-amber-400 font-bold">▲</span> BUY
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-red-400 font-bold">▼</span> SELL
        </span>
      </div>

      {/* Chart canvas */}
      <div
        ref={containerRef}
        className="w-full rounded-lg overflow-hidden"
        style={{ minHeight: 440, background: BG }}
      />
    </div>
  );
};

export default HMAKahlmanChart;
