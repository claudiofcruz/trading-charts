# Trading Charts

Gráficos Semanal + Diário lado a lado, estilo TradingView, para o mercado americano.

![Trading Charts](TradingCharts.jpeg)

## Funcionalidades

- Gráfico **Semanal** e **Diário** lado a lado, com zoom, rolagem e crosshair sincronizados entre os painéis
- Dados do Yahoo Finance (yfinance). Ex.: `AAPL`, `SPY`, `QQQ`, `NVDA`, `^GSPC`
- **Watchlist** lateral (ordem alfabética) com preço, variação do dia e sinais
- **Scanner**: sinais ocorridos na última barra (Diário/Semanal) dos tickers da watchlist
- **Alertas 🔔**: notificação do navegador + aviso na página quando surge um sinal novo no scanner
  (com auto-atualização desligada, o scanner roda a cada 5 min durante o pregão)
- **Auto-atualização** (1/5/15 min), apenas com o mercado aberto (seg–sex, 9:30–16:15 de Nova York)
- **Desenhos** por ticker: linha de tendência, raio (tendência estendida 30 barras à frente),
  linha horizontal (aparece no semanal e no diário) e anotação de texto. Desfazer / Limpar; Esc cancela
- Watchlist e desenhos ficam salvos em `data/` (no Docker, montado como volume)

## Indicadores

### Gráfico de preço

| Indicador | Parâmetros | Cor | O que mostra |
|---|---|---|---|
| **Candles** | — | verde / vermelho | Abertura, máxima, mínima e fechamento de cada período. Verde = fechou acima da abertura; vermelho = fechou abaixo. |
| **Volume** | — | verde / vermelho | Quantidade negociada no período, na parte de baixo do gráfico, com a mesma cor do candle. Volume alto confirma a força de um movimento. |
| **EMA 8** | 8 períodos | 🟢 verde | Média móvel exponencial curta: tendência de curtíssimo prazo, reage rápido ao preço. |
| **EMA 21** | 21 períodos | 🟡 amarelo | Tendência de curto prazo. Cruzamentos da EMA 8 com a 21 costumam indicar mudança de ritmo. |
| **EMA 50** | 50 períodos | 🔵 azul | Tendência de médio prazo; funciona muitas vezes como suporte/resistência. |
| **EMA 200** | 200 períodos | 🔴 vermelho | Tendência de longo prazo. Preço acima = viés de alta; abaixo = viés de baixa. |
| **Bollinger Bands** | 20 períodos, 2 desvios | lilás (média tracejada) | Média de 20 períodos com bandas a 2 desvios-padrão. Bandas estreitas = baixa volatilidade (possível explosão de movimento); preço tocando as bandas = extremos relativos. |
| **Setas MACD** | — | ▲ verde / ▼ vermelho | Os mesmos sinais de cruzamento do MACD (abaixo), repetidos sobre os candles. |

> EMA = *Exponential Moving Average*: dá mais peso aos preços recentes do que a média simples.

### RSI 14 — Índice de Força Relativa

Linha roxa de 0 a 100 que mede a força dos ganhos versus as perdas nos últimos 14 períodos (método de Wilder).

- **Acima de 70**: sobrecomprado — o ativo subiu muito e rápido
- **Abaixo de 30**: sobrevendido — caiu muito e rápido
- **Linha de 50**: divisória entre momentum comprador e vendedor

### MACD (12, 26, 9)

Mede a diferença entre duas médias exponenciais para identificar tendência e momentum.

- **Linha MACD** (azul): EMA 12 − EMA 26
- **Linha de sinal** (laranja): EMA 9 da linha MACD
- **Histograma**: MACD − sinal
  - verde forte = positivo e crescendo · verde claro = positivo e perdendo força
  - vermelho forte = negativo e caindo · rosa claro = negativo e perdendo força
- **▲ Up** (verde): MACD cruza a linha de sinal **para cima** — momentum de alta
- **▼ Down** (vermelho): MACD cruza a linha de sinal **para baixo** — momentum de baixa

### Squeeze Momentum (LazyBear)

Identifica períodos de **compressão de volatilidade** (o preço "acumula energia") e a direção provável quando ela é liberada.

O *squeeze* acontece quando as Bollinger Bands (20) ficam **dentro** do Canal de Keltner (20, 1,5 × ATR).

**Pontos na linha zero:**
- ⚪ **branco** = squeeze ligado — volatilidade comprimida, movimento forte pode estar próximo
- ⚫ **cinza** = squeeze liberado — a compressão terminou (o "disparo")
- 🔵 **azul** = sem squeeze

**Histograma (momentum)** — regressão linear do preço em relação ao meio do range dos últimos 20 períodos:
- verde claro = momentum positivo aumentando · verde escuro = positivo diminuindo
- vermelho = momentum negativo aumentando · vinho = negativo diminuindo

O cálculo segue o script original do LazyBear no TradingView (inclusive o uso de 1,5 desvio nas Bollinger internas do squeeze), para os valores baterem com os de lá.

### Sinais do Scanner

O scanner verifica apenas a **última barra** (hoje no diário, esta semana no semanal). Na watchlist o prefixo indica o tempo gráfico: **D** = Diário, **S** = Semanal.

| Sinal | Significado |
|---|---|
| **MACD ▲** | MACD cruzou a linha de sinal para cima |
| **MACD ▼** | MACD cruzou a linha de sinal para baixo |
| **Squeeze ▲** | Squeeze liberado com momentum positivo (rompimento provável para cima) |
| **Squeeze ▼** | Squeeze liberado com momentum negativo (rompimento provável para baixo) |

> Durante o pregão a última barra ainda está em formação, então um sinal pode aparecer e desaparecer até o fechamento.

## Rodar com Docker

    docker compose up -d --build

Abra http://localhost:8000

## Rodar sem Docker

    ./run_local.sh

---

*Ferramenta de estudo/análise. Não é recomendação de investimento. Os dados do Yahoo Finance podem ter atraso de ~15 minutos.*
