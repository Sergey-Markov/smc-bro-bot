import "dotenv/config";
import express from "express";
import cors from "cors";
import type { Request, Response } from "express";
import { prisma } from "./prisma";
import { runBacktest, BacktestStrategy } from "./backtest";
import { binance } from "./exchange";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/api/trades", async (req: Request, res: Response) => {
  try {
    const userIdRaw = req.query.userId as string | undefined;
    const telegramId = req.query.telegramId as string | undefined;

    let whereClause:
      | { userId: number }
      | { user: { telegramId: string } }
      | undefined;

    if (userIdRaw) {
      const userId = Number(userIdRaw);

      if (!Number.isFinite(userId)) {
        res.status(400).json({ error: "userId має бути числом." });
        return;
      }

      whereClause = { userId };
    } else if (telegramId) {
      whereClause = { user: { telegramId } };
    }

    if (!whereClause) {
      res.status(400).json({
        error: "Передай userId або telegramId у query-параметрах.",
      });
      return;
    }

    const trades = await prisma.trade.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    });

    res.json({ trades });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("GET /api/trades error", error);
    res.status(500).json({ error: "Не вдалося отримати угоди." });
  }
});

app.get("/api/reports", async (req: Request, res: Response) => {
  try {
    const userIdRaw = req.query.userId as string | undefined;

    if (!userIdRaw) {
      res.status(400).json({ error: "Потрібен userId у query-параметрах." });
      return;
    }

    const userId = Number(userIdRaw);

    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "userId має бути числом." });
      return;
    }

    const trades = await prisma.trade.findMany({
      where: { userId },
    });

    if (!trades.length) {
      res.json({
        summary: {
          totalTrades: 0,
          totalPnl: 0,
          winRate: 0,
          byStrategy: {},
        },
      });
      return;
    }

    let totalPnl = 0;
    let wins = 0;
    let losses = 0;
    let breakevens = 0;

    const byStrategy: Record<
      string,
      { trades: number; pnl: number; wins: number; losses: number }
    > = {};

    for (const trade of trades) {
      const entries = (trade.entries as unknown as number[]) || [];
      const tps = (trade.tps as unknown as number[]) || [];

      if (!entries.length || !tps.length) {
        continue;
      }

      const entry = Number(entries[0]);
      const tp1 = Number(tps[0]);
      const slBe = Number(trade.slBe);
      const size = Number(trade.size);

      if (
        !Number.isFinite(entry) ||
        !Number.isFinite(tp1) ||
        !Number.isFinite(slBe) ||
        !Number.isFinite(size) ||
        entry <= 0
      ) {
        continue;
      }

      const riskMoney = (Math.abs(entry - slBe) / entry) * size;
      const rewardMoney = (Math.abs(tp1 - entry) / entry) * size;
      const pnl = rewardMoney - riskMoney;

      totalPnl += pnl;

      if (pnl > 0) {
        wins += 1;
      } else if (pnl < 0) {
        losses += 1;
      } else {
        breakevens += 1;
      }

      const strategyKey = trade.strategy || "unknown";

      if (!byStrategy[strategyKey]) {
        byStrategy[strategyKey] = {
          trades: 0,
          pnl: 0,
          wins: 0,
          losses: 0,
        };
      }

      byStrategy[strategyKey].trades += 1;
      byStrategy[strategyKey].pnl += pnl;

      if (pnl > 0) {
        byStrategy[strategyKey].wins += 1;
      } else if (pnl < 0) {
        byStrategy[strategyKey].losses += 1;
      }
    }

    const totalTradesForStats = wins + losses + breakevens;
    const winRate = totalTradesForStats
      ? (wins / totalTradesForStats) * 100
      : 0;

    res.json({
      summary: {
        totalTrades: totalTradesForStats,
        totalPnl,
        winRate,
        byStrategy,
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("GET /api/reports error", error);
    res.status(500).json({ error: "Не вдалося сформувати звіт." });
  }
});

app.post("/api/backtest", async (req: Request, res: Response) => {
  try {
    const { symbol: rawSymbol, timeframe: rawTimeframe, strategy, candles } =
      req.body as {
        symbol?: string;
        timeframe?: string;
        strategy?: BacktestStrategy;
        candles?: number;
      };

    if (!rawSymbol || !rawTimeframe || !strategy) {
      res.status(400).json({
        error:
          "Потрібні поля symbol, timeframe (4h|1d) та strategy у тілі запиту.",
      });
      return;
    }

    const symbol = rawSymbol.toUpperCase();
    const timeframeText = rawTimeframe.toLowerCase();
    const timeframe =
      timeframeText === "1d" || timeframeText === "1day" ? "1d" : "4h";

    const allowedStrategies: BacktestStrategy[] = [
      "smc",
      "swing",
      "range",
      "breakout",
      "pullback",
      "divergence",
    ];

    if (!allowedStrategies.includes(strategy)) {
      res.status(400).json({
        error:
          "Стратегія має бути однією з: smc, swing, range, breakout, pullback, divergence.",
      });
      return;
    }

    const defaultLimit = 500;
    const limit = candles ?? defaultLimit;

    if (!Number.isFinite(limit) || limit <= 50) {
      res
        .status(400)
        .json({ error: "candles має бути числом > 50." });
      return;
    }

    const ohlcv = await binance.fetchOHLCV(
      symbol,
      timeframe,
      undefined,
      limit,
    );

    if (!ohlcv.length) {
      res
        .status(400)
        .json({ error: "Історія по цьому символу порожня." });
      return;
    }

    const result = runBacktest(ohlcv, strategy);

    res.json({
      symbol,
      timeframe,
      strategy,
      candles: ohlcv.length,
      result,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("POST /api/backtest error", error);
    res.status(500).json({ error: "Не вдалося виконати бек-тест." });
  }
});

const portRaw = process.env.PORT;
const port = Number(portRaw) || 3000;

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`HTTP API server listening on :${port}`);
});

