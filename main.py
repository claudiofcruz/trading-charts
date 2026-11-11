"""Backend: baixa cotações (Yahoo Finance) e calcula os indicadores."""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Trading Charts")

# período de histórico baixado por intervalo (precisa de folga p/ a EMA 200)
PERIODS = {"1d": "5y", "1wk": "15y"}

_cache: dict[tuple[str, str], tuple[float, list]] = {}
CACHE_TTL = 60  # segundos


def normalize_ticker(ticker: str) -> str:
    return ticker.strip().upper()


# ---------------------------------------------------------------- indicadores
def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = gain / loss.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.where(loss != 0, 100.0).where(gain.notna())


def linreg(s: pd.Series, n: int) -> pd.Series:
    """Equivalente ao linreg(src, n, 0) do Pine Script."""
    x = np.arange(n, dtype=float)
    xm = x.mean()
    denom = ((x - xm) ** 2).sum()

    def f(y: np.ndarray) -> float:
        slope = ((x - xm) * (y - y.mean())).sum() / denom
        return y.mean() + slope * (n - 1 - xm)

    return s.rolling(n).apply(f, raw=True)


def squeeze_momentum(df: pd.DataFrame, length=20, mult=2.0, kc_length=20, kc_mult=1.5):
    """Squeeze Momentum Indicator (LazyBear) - mesma lógica do script do TradingView.

    Obs.: o script original usa multKC (1.5) também no desvio das Bollinger
    do squeeze; reproduzimos isso para bater com o TradingView.
    """
    c, h, l = df["Close"], df["High"], df["Low"]

    basis = c.rolling(length).mean()
    dev = kc_mult * c.rolling(length).std(ddof=0)
    upper_bb, lower_bb = basis + dev, basis - dev

    ma = c.rolling(kc_length).mean()
    prev_c = c.shift()
    tr = pd.concat([h - l, (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
    rng = tr.rolling(kc_length).mean()
    upper_kc, lower_kc = ma + rng * kc_mult, ma - rng * kc_mult

    sqz_on = (lower_bb > lower_kc) & (upper_bb < upper_kc)
    sqz_off = (lower_bb < lower_kc) & (upper_bb > upper_kc)

    hh = h.rolling(kc_length).max()
    ll = l.rolling(kc_length).min()
    val = linreg(c - ((hh + ll) / 2 + c.rolling(kc_length).mean()) / 2, kc_length)

    state = np.where(sqz_on, "on", np.where(sqz_off, "off", "none"))
    state = pd.Series(state, index=df.index).where(basis.notna() & rng.notna())
    return val, state


def build(df: pd.DataFrame) -> pd.DataFrame:
    c = df["Close"]
    out = pd.DataFrame(index=df.index)
    out["open"], out["high"], out["low"], out["close"] = df["Open"], df["High"], df["Low"], c
    out["volume"] = df["Volume"]

    for n in (8, 21, 50, 200):
        out[f"ema{n}"] = ema(c, n)

    mid = c.rolling(20).mean()
    sd = c.rolling(20).std(ddof=0)
    out["bb_mid"], out["bb_upper"], out["bb_lower"] = mid, mid + 2 * sd, mid - 2 * sd

    out["rsi"] = rsi(c, 14)

    macd = ema(c, 12) - ema(c, 26)
    signal = ema(macd, 9)
    out["macd"], out["macd_signal"], out["macd_hist"] = macd, signal, macd - signal

    out["sqz"], out["sqz_state"] = squeeze_momentum(df)
    return out


# --------------------------------------------------------------- dados/cache
def get_bars(symbol: str, interval: str) -> list[dict]:
    key = (symbol, interval)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]

    try:
        df = yf.Ticker(symbol).history(period=PERIODS[interval], interval=interval, auto_adjust=False)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Erro ao baixar dados: {e}")

    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    if df.empty:
        raise HTTPException(404, f"Nenhum dado encontrado para {symbol}")

    data = build(df)
    data.index = [d.strftime("%Y-%m-%d") for d in data.index]
    data = data[~data.index.duplicated(keep="last")]
    data = data.astype(object).where(data.notna(), None)

    bars = [{"time": t, **row} for t, row in zip(data.index, data.to_dict("records"))]
    _cache[key] = (time.time(), bars)
    return bars


def last_bar_signals(bars: list[dict]) -> list[str]:
    """Sinais ocorridos na última barra (hoje no diário / esta semana no semanal)."""
    if len(bars) < 2:
        return []
    p, b = bars[-2], bars[-1]
    out = []
    if None not in (p["macd"], p["macd_signal"], b["macd"], b["macd_signal"]):
        pd_, d = p["macd"] - p["macd_signal"], b["macd"] - b["macd_signal"]
        if pd_ <= 0 < d:
            out.append("macd_up")
        elif pd_ >= 0 > d:
            out.append("macd_down")
    if p["sqz_state"] == "on" and b["sqz_state"] != "on" and b["sqz"] is not None:
        out.append("sqz_fired_up" if b["sqz"] > 0 else "sqz_fired_down")
    return out


# ---------------------------------------------------------------------- API
@app.get("/api/chart")
def chart(ticker: str = Query(..., min_length=1), interval: str = Query("1d")):
    if interval not in PERIODS:
        raise HTTPException(400, "interval deve ser 1d ou 1wk")
    symbol = normalize_ticker(ticker)
    return {"ticker": symbol, "interval": interval, "bars": get_bars(symbol, interval)}


@app.get("/api/scan")
def scan(tickers: str = Query(..., min_length=1)):
    """Cotação + sinais (diário e semanal) para cada ticker da watchlist."""
    symbols = list(dict.fromkeys(normalize_ticker(t) for t in tickers.split(",") if t.strip()))

    def one(sym: str) -> dict:
        try:
            d = get_bars(sym, "1d")
            w = get_bars(sym, "1wk")
        except HTTPException as e:
            return {"ticker": sym, "error": e.detail}
        last, prev = d[-1], d[-2] if len(d) > 1 else d[-1]
        return {
            "ticker": sym,
            "price": last["close"],
            "change": last["close"] - prev["close"],
            "change_pct": (last["close"] / prev["close"] - 1) * 100,
            "date": last["time"],
            "weekly_date": w[-1]["time"],
            "daily": last_bar_signals(d),
            "weekly": last_bar_signals(w),
        }

    with ThreadPoolExecutor(max_workers=8) as ex:
        return list(ex.map(one, symbols))


# ------------------------------------------------- persistência (data/*.json)
DATA_DIR = Path(os.environ.get("DATA_DIR", "data"))
DATA_DIR.mkdir(exist_ok=True)
WATCHLIST_FILE = DATA_DIR / "watchlist.json"
DRAWINGS_FILE = DATA_DIR / "drawings.json"
DEFAULT_WATCHLIST = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN"]


def _read(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path: Path, value) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, indent=1))
    tmp.replace(path)


def sort_tickers(tickers: list[str]) -> list[str]:
    """Ordem alfabética, ignorando o prefixo ^ de índices (^XSP fica junto do X)."""
    return sorted(tickers, key=lambda t: (t.lstrip("^"), t))


@app.get("/api/watchlist")
def get_watchlist():
    return sort_tickers(_read(WATCHLIST_FILE, DEFAULT_WATCHLIST))


@app.put("/api/watchlist")
def put_watchlist(tickers: list[str] = Body(...)):
    clean = sort_tickers(list(dict.fromkeys(normalize_ticker(t) for t in tickers if t.strip())))
    _write(WATCHLIST_FILE, clean)
    return clean


@app.get("/api/drawings/{ticker}")
def get_drawings(ticker: str):
    return _read(DRAWINGS_FILE, {}).get(normalize_ticker(ticker), [])


@app.put("/api/drawings/{ticker}")
def put_drawings(ticker: str, drawings: list[dict] = Body(...)):
    all_ = _read(DRAWINGS_FILE, {})
    all_[normalize_ticker(ticker)] = drawings
    _write(DRAWINGS_FILE, all_)
    return drawings


app.mount("/", StaticFiles(directory="static", html=True), name="static")
