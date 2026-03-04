import ccxt from "ccxt";

export const binance = new ccxt.binance({
  enableRateLimit: true,
});

