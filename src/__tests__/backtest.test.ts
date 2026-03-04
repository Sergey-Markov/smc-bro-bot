import type ccxt from "ccxt";
import { runBacktest } from "../backtest";

function makeCandle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): ccxt.OHLCV {
  return [time, open, high, low, close, volume];
}

describe("runBacktest", () => {
  it("returns empty result for too few candles", () => {
    const candles: ccxt.OHLCV[] = [];

    for (let i = 0; i < 10; i += 1) {
      candles.push(makeCandle(Date.now() + i * 60000, 100, 101, 99, 100, 1000));
    }

    const result = runBacktest(candles, "breakout");

    expect(result.totalTrades).toBe(0);
    expect(result.trades).toHaveLength(0);
  });

  it("produces a stable result shape for breakout on synthetic data", () => {
    const candles: ccxt.OHLCV[] = [];
    let price = 100;

    for (let i = 0; i < 200; i += 1) {
      const open = price;
      const high = open + 1;
      const low = open - 1;
      const close = open + Math.sin(i / 10) * 0.5;
      const volume = 1000 + (i % 20) * 10;

      candles.push(
        makeCandle(Date.now() + i * 60000, open, high, low, close, volume),
      );

      price = close;
    }

    const result = runBacktest(candles, "breakout");

    expect(result.totalTrades).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.trades)).toBe(true);
  });
});

