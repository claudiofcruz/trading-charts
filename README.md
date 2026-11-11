# Trading Charts

Gráficos Semanal + Diário lado a lado, estilo TradingView.

![Trading Charts](TradingCharts.jpeg)

- Candles verde/vermelho, volume colorido
- Bollinger Bands (20, 2), EMA 8 (verde), 21 (amarelo), 50 (azul), 200 (vermelho)
- Painéis inferiores: RSI 14, MACD (12, 26, 9), Squeeze Momentum (LazyBear)
- Dados: Yahoo Finance (yfinance) - mercado americano. Ex.: `AAPL`, `SPY`, `QQQ`, `NVDA`, `^GSPC`.

- Setas ▲/▼ de cruzamento do MACD no painel do MACD e no gráfico de preço
- Watchlist lateral com preço, variação do dia e sinais
- Scanner: sinais na última barra (Diário/Semanal) — MACD ▲/▼ e Squeeze liberado ▲/▼
- Auto-atualização (1/5/15 min), apenas com o mercado americano aberto (9:30–16:15 ET, seg–sex)
- Alertas 🔔: notificação do navegador + aviso na página quando surge sinal novo no scanner
  (com auto-atualização desligada, o scanner roda a cada 5 min durante o pregão)
- Desenhos por ticker: linha de tendência (2 cliques), raio (tendência estendida 30 barras à frente), linha horizontal (vale p/ semanal e diário),
  anotação de texto. Desfazer / Limpar. Esc cancela.
- Watchlist e desenhos ficam salvos em `data/` (no Docker, montado como volume)

## Rodar com Docker
    docker compose up -d --build
Abra http://localhost:8000

## Rodar sem Docker
    ./run_local.sh

## Squeeze Momentum
Histograma: verde-claro/verde-escuro (momentum positivo subindo/caindo), vermelho/vinho (negativo).
Pontos na linha zero: branco = squeeze ligado (compressão), cinza = squeeze liberado, azul = sem squeeze.
