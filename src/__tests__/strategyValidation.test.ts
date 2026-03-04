import { AlertDirection, Strategy } from "../strategyValidation";
import {
  validateAlertByStrategy,
  type OhlcvValidationInput,
} from "../strategyValidation";

function makeFlatOhlcv(length: number, price = 100): OhlcvValidationInput {
  const closes = Array.from({ length }, () => price);
  const highs = Array.from({ length }, () => price + 1);
  const lows = Array.from({ length }, () => price - 1);
  const volumes = Array.from({ length }, () => 1000);

  return { closes, highs, lows, volumes };
}

describe("validateAlertByStrategy", () => {
  it("returns invalid when OHLCV is empty", () => {
    const result = validateAlertByStrategy({
      ohlcv: {
        closes: [],
        highs: [],
        lows: [],
        volumes: [],
      },
      direction: AlertDirection.above,
      strategy: Strategy.smc,
    });

    expect(result.isValid).toBe(false);
  });

  it("returns invalid for range when ATR cannot be computed", () => {
    const ohlcv = makeFlatOhlcv(5, 100);

    const result = validateAlertByStrategy({
      ohlcv,
      direction: AlertDirection.above,
      strategy: Strategy.range,
    });

    expect(result.isValid).toBe(false);
  });

  it("handles breakout strategy without throwing on flat data", () => {
    const ohlcv = makeFlatOhlcv(60, 100);

    const result = validateAlertByStrategy({
      ohlcv,
      direction: AlertDirection.above,
      strategy: Strategy.breakout,
    });

    expect(typeof result.isValid).toBe("boolean");
    expect(typeof result.reason).toBe("string");
  });
});

