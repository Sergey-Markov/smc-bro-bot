import type ccxt from "ccxt";

export type BacktestStrategy =
  | "smc"
  | "swing"
  | "range"
  | "breakout"
  | "pullback"
  | "divergence";

export interface BacktestTrade {
  direction: "long" | "short";
  entryIndex: number;
  exitIndex: number;
  rMultiple: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnlR: number;
  longTrades: number;
  shortTrades: number;
}

function createEmptyResult(): BacktestResult {
  return {
    trades: [],
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    pnlR: 0,
    longTrades: 0,
    shortTrades: 0,
  };
}

function finalizeResult(trades: BacktestTrade[]): BacktestResult {
  if (!trades.length) {
    return createEmptyResult();
  }

  let wins = 0;
  let losses = 0;
  let pnlR = 0;
  let longTrades = 0;
  let shortTrades = 0;

  for (const trade of trades) {
    pnlR += trade.rMultiple;

    if (trade.rMultiple > 0) {
      wins += 1;
    } else if (trade.rMultiple < 0) {
      losses += 1;
    }

    if (trade.direction === "long") {
      longTrades += 1;
    } else {
      shortTrades += 1;
    }
  }

  const totalTrades = trades.length;
  const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;

  return {
    trades,
    totalTrades,
    wins,
    losses,
    winRate,
    pnlR,
    longTrades,
    shortTrades,
  };
}

function runBreakoutStrategy(candles: ccxt.OHLCV[]): BacktestResult {
  const trades: BacktestTrade[] = [];

  if (candles.length < 50) {
    return createEmptyResult();
  }

  const breakoutLookback = 20;
  const maxHoldBars = 5;

  for (let i = breakoutLookback; i < candles.length - 1; i += 1) {
    const windowStart = i - breakoutLookback;
    const recentSlice = candles.slice(windowStart, i);

    let recentHigh = Number.NEGATIVE_INFINITY;
    let recentLow = Number.POSITIVE_INFINITY;
    let volumeSum = 0;

    for (const [, , high, low, , volume] of recentSlice) {
      const highNumber = Number(high);
      const lowNumber = Number(low);
      const volumeNumber = Number(volume);

      if (highNumber > recentHigh) {
        recentHigh = highNumber;
      }

      if (lowNumber < recentLow) {
        recentLow = lowNumber;
      }

      volumeSum += volumeNumber;
    }

    const [, , , , close, volume] = candles[i];
    const closeNumber = Number(close);
    const volumeNumber = Number(volume);

    if (
      !Number.isFinite(recentHigh) ||
      !Number.isFinite(recentLow) ||
      !Number.isFinite(closeNumber) ||
      !Number.isFinite(volumeNumber)
    ) {
      continue;
    }

    const avgVolume = volumeSum / recentSlice.length;
    const isVolumeSpike = volumeNumber > avgVolume * 1.5;
    const breakoutThreshold = 0.0025;
    const isBreakout =
      closeNumber > recentHigh * (1 + breakoutThreshold) && isVolumeSpike;

    if (!isBreakout) {
      continue;
    }

    const entryIndex = i;
    const riskPerUnit = closeNumber - recentLow;

    if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) {
      continue;
    }

    const rTarget = 2;
    const targetPrice = closeNumber + rTarget * riskPerUnit;
    const stopPrice = recentLow;

    let exitIndex = i + 1;
    let exitPrice = Number(candles[exitIndex][4]);

    for (
      let j = i + 1;
      j < candles.length && j <= i + maxHoldBars;
      j += 1
    ) {
      const [, , high, low, closeNext] = candles[j];
      const highNumber = Number(high);
      const lowNumber = Number(low);
      const closeNextNumber = Number(closeNext);

      if (
        highNumber >= targetPrice ||
        closeNextNumber >= targetPrice
      ) {
        exitIndex = j;
        exitPrice = targetPrice;
        break;
      }

      if (lowNumber <= stopPrice || closeNextNumber <= stopPrice) {
        exitIndex = j;
        exitPrice = stopPrice;
        break;
      }

      exitIndex = j;
      exitPrice = closeNextNumber;
    }

    const rMultiple = (exitPrice - closeNumber) / riskPerUnit;

    trades.push({
      direction: "long",
      entryIndex,
      exitIndex,
      rMultiple,
    });
  }

  return finalizeResult(trades);
}

function runRangeStrategy(candles: ccxt.OHLCV[]): BacktestResult {
  const trades: BacktestTrade[] = [];

  if (candles.length < 60) {
    return createEmptyResult();
  }

  const rangeLookback = 30;

  for (let i = rangeLookback; i < candles.length - 1; i += 1) {
    const windowStart = i - rangeLookback;
    const recentSlice = candles.slice(windowStart, i);

    let rangeHigh = Number.NEGATIVE_INFINITY;
    let rangeLow = Number.POSITIVE_INFINITY;

    for (const [, , high, low] of recentSlice) {
      const highNumber = Number(high);
      const lowNumber = Number(low);

      if (highNumber > rangeHigh) {
        rangeHigh = highNumber;
      }

      if (lowNumber < rangeLow) {
        rangeLow = lowNumber;
      }
    }

    const [, , , , close] = candles[i];
    const closeNumber = Number(close);

    if (
      !Number.isFinite(rangeHigh) ||
      !Number.isFinite(rangeLow) ||
      !Number.isFinite(closeNumber)
    ) {
      continue;
    }

    const rangeHeight = rangeHigh - rangeLow;

    if (rangeHeight <= 0) {
      continue;
    }

    const upperZone = rangeHigh - rangeHeight * 0.2;
    const lowerZone = rangeLow + rangeHeight * 0.2;

    if (closeNumber >= upperZone) {
      const entryIndex = i;
      const stopPrice = rangeHigh * 1.001;
      const midPrice = rangeLow + rangeHeight * 0.5;
      const riskPerUnit = stopPrice - closeNumber;

      if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) {
        continue;
      }

      const exitPrice = midPrice;
      const exitIndex = i + 1;
      const rMultiple = (closeNumber - exitPrice) / riskPerUnit;

      trades.push({
        direction: "short",
        entryIndex,
        exitIndex,
        rMultiple,
      });
    } else if (closeNumber <= lowerZone) {
      const entryIndex = i;
      const stopPrice = rangeLow * 0.999;
      const midPrice = rangeLow + rangeHeight * 0.5;
      const riskPerUnit = closeNumber - stopPrice;

      if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) {
        continue;
      }

      const exitPrice = midPrice;
      const exitIndex = i + 1;
      const rMultiple = (exitPrice - closeNumber) / riskPerUnit;

      trades.push({
        direction: "long",
        entryIndex,
        exitIndex,
        rMultiple,
      });
    }
  }

  return finalizeResult(trades);
}

export function runBacktest(
  candles: ccxt.OHLCV[],
  strategy: BacktestStrategy,
): BacktestResult {
  if (!candles.length) {
    return createEmptyResult();
  }

  switch (strategy) {
    case "breakout":
      return runBreakoutStrategy(candles);
    case "range":
      return runRangeStrategy(candles);
    case "smc":
    case "swing":
    case "pullback":
    case "divergence":
    default:
      return runBreakoutStrategy(candles);
  }
}

