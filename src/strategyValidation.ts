import { ATR, MACD, RSI } from "technicalindicators";

/** Local enums compatible with Prisma schema (avoids @prisma/client type resolution issues) */
export const AlertDirection = { above: "above", below: "below" } as const;
export type AlertDirection = (typeof AlertDirection)[keyof typeof AlertDirection];

export const Strategy = {
  smc: "smc",
  swing: "swing",
  range: "range",
  breakout: "breakout",
  pullback: "pullback",
  divergence: "divergence",
} as const;
export type Strategy = (typeof Strategy)[keyof typeof Strategy];

export interface OhlcvValidationInput {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
}

export interface ValidationResult {
  isValid: boolean;
  reason: string;
}

interface ZigZagPivot {
  index: number;
  price: number;
  type: "high" | "low";
}

function buildZigZagPivots(
  highs: number[],
  lows: number[],
  deviationPercent = 0.5,
): ZigZagPivot[] {
  const pivots: ZigZagPivot[] = [];

  if (highs.length < 3 || lows.length < 3) {
    return pivots;
  }

  let lastPivotIndex = 0;
  let lastPivotPrice = highs[0];
  let lastType: ZigZagPivot["type"] = "high";

  for (let i = 1; i < highs.length; i += 1) {
    const high = highs[i];
    const low = lows[i];
    const reference = lastPivotPrice;
    const upMovePercent = ((high - reference) / reference) * 100;
    const downMovePercent = ((reference - low) / reference) * 100;

    if (lastType === "high" && downMovePercent >= deviationPercent) {
      pivots.push({
        index: lastPivotIndex,
        price: lastPivotPrice,
        type: "high",
      });
      lastType = "low";
      lastPivotIndex = i;
      lastPivotPrice = low;
      continue;
    }

    if (lastType === "low" && upMovePercent >= deviationPercent) {
      pivots.push({
        index: lastPivotIndex,
        price: lastPivotPrice,
        type: "low",
      });
      lastType = "high";
      lastPivotIndex = i;
      lastPivotPrice = high;
      continue;
    }

    if (lastType === "high" && high > lastPivotPrice) {
      lastPivotPrice = high;
      lastPivotIndex = i;
    } else if (lastType === "low" && low < lastPivotPrice) {
      lastPivotPrice = low;
      lastPivotIndex = i;
    }
  }

  pivots.push({
    index: lastPivotIndex,
    price: lastPivotPrice,
    type: lastType,
  });

  const sliceSize = 10;

  return pivots.slice(-sliceSize);
}

function validateSmcStructure(
  closes: number[],
  highs: number[],
  lows: number[],
  direction: AlertDirection,
): ValidationResult {
  if (closes.length < 20 || highs.length < 20 || lows.length < 20) {
    return {
      isValid: false,
      reason: "Замало свічок для структури SMC.",
    };
  }

  const pivots = buildZigZagPivots(highs, lows, 0.5);

  if (pivots.length < 3) {
    return {
      isValid: false,
      reason: "Замало свінгів ZigZag для SMC-структури.",
    };
  }

  const last = pivots[pivots.length - 1];
  const previous = pivots[pivots.length - 2];

  if (direction === AlertDirection.above) {
    const hasBos =
      previous.type === "high" &&
      last.type === "high" &&
      last.price > previous.price;

    return hasBos
      ? {
          isValid: true,
          reason: "Є BOS вище попереднього свінг-хая за ZigZag (SMC).",
        }
      : {
          isValid: false,
          reason: "По ZigZag немає чіткого BOS вище попереднього хая.",
        };
  }

  const hasBos =
    previous.type === "low" &&
    last.type === "low" &&
    last.price < previous.price;

  return hasBos
    ? {
        isValid: true,
        reason: "Є BOS нижче попереднього свінг-лоу за ZigZag (SMC).",
      }
    : {
        isValid: false,
        reason: "По ZigZag немає чіткого BOS нижче попереднього лоу.",
      };
}

function validateRangeEnvironment(
  lastClose: number,
  lastAtr: number | undefined,
): ValidationResult {
  if (!lastAtr || !Number.isFinite(lastAtr) || !Number.isFinite(lastClose)) {
    return {
      isValid: false,
      reason: "ATR/ціна некоректні для оцінки ренджу.",
    };
  }

  const atrRatio = lastAtr / lastClose;
  const isRange = atrRatio < 0.01;

  return isRange
    ? {
        isValid: true,
        reason: "ATR низький — ринок більше схожий на рендж.",
      }
    : {
        isValid: false,
        reason: "ATR високий — зараз не класичний рендж.",
      };
}

function validateBreakoutEnvironment(
  closes: number[],
  volumes: number[],
  macdHistogram: number[],
): ValidationResult {
  if (
    closes.length < 5 ||
    volumes.length < 21 ||
    macdHistogram.length < 5
  ) {
    return {
      isValid: false,
      reason: "Мало даних для оцінки брейкауту (об'єм/MACD).",
    };
  }

  const lastVolume = volumes[volumes.length - 1];
  const window = Math.min(20, volumes.length - 1);
  const baseSlice = volumes.slice(-window - 1, -1);
  const baseVolumeAvg =
    baseSlice.reduce((acc, value) => acc + value, 0) / baseSlice.length;

  const isSpike = lastVolume > baseVolumeAvg * 1.5;
  const recentHistogram = macdHistogram.slice(-3);
  const histogramSupports = recentHistogram.every((value) => value > 0);

  if (isSpike && histogramSupports) {
    return {
      isValid: true,
      reason:
        "Є об'ємний спайк і позитивний MACD histogram — брейкаут виглядає здоровим.",
    };
  }

  if (!isSpike) {
    return {
      isValid: false,
      reason: "Об'єм слабкий — брейкаут може бути фейковим.",
    };
  }

  return {
    isValid: false,
    reason:
      "MACD histogram не підтверджує силу руху — брейкаут може бути втомленим.",
  };
}

function validateDivergenceEnvironment(
  closes: number[],
  rsiSeries: number[],
): ValidationResult {
  if (closes.length < 10 || rsiSeries.length < 10) {
    return {
      isValid: false,
      reason: "Замало даних для дивергенції.",
    };
  }

  const priceStart = closes[closes.length - 5];
  const priceEnd = closes[closes.length - 1];
  const rsiStart = rsiSeries[rsiSeries.length - 5];
  const rsiEnd = rsiSeries[rsiSeries.length - 1];

  const makingHigherHigh = priceEnd > priceStart;
  const makingLowerLow = priceEnd < priceStart;
  const momentumUp = rsiEnd > rsiStart;
  const momentumDown = rsiEnd < rsiStart;

  const bullishDivergence = makingLowerLow && momentumUp;
  const bearishDivergence = makingHigherHigh && momentumDown;
  const hasDivergence = bullishDivergence || bearishDivergence;

  return hasDivergence
    ? {
        isValid: true,
        reason: "Є базова RSI-дивергенція між ціною та моментумом.",
      }
    : {
        isValid: false,
        reason: "Чіткої дивергенції за RSI поки не видно.",
      };
}

export function validateAlertByStrategy(params: {
  ohlcv: OhlcvValidationInput;
  direction: AlertDirection;
  strategy: Strategy;
}): ValidationResult {
  const { closes, highs, lows, volumes } = params.ohlcv;

  if (!closes.length) {
    return {
      isValid: false,
      reason: "OHLCV порожній для цього символу.",
    };
  }

  const atrSeries = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
  });

  const lastAtr = atrSeries[atrSeries.length - 1];

  const rsiSeries = RSI.calculate({
    values: closes,
    period: 14,
  });

  const macdSeries = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const macdHistogram = macdSeries.map((item) => item.histogram ?? 0);
  const lastClose = closes[closes.length - 1];

  switch (params.strategy) {
    case Strategy.smc:
      return validateSmcStructure(closes, highs, lows, params.direction);

    case Strategy.range:
      return validateRangeEnvironment(lastClose, lastAtr);

    case Strategy.breakout:
      return validateBreakoutEnvironment(closes, volumes, macdHistogram);

    case Strategy.divergence:
      return validateDivergenceEnvironment(closes, rsiSeries);

    case Strategy.swing:
    case Strategy.pullback:
    default:
      return {
        isValid: true,
        reason:
          "Специфічного валідатора для цієї стратегії ще немає — тримаємо базову згоду.",
      };
  }
}

