import "dotenv/config";
import { Bot, Context, session, SessionFlavor } from "grammy";
import {
  conversations,
  createConversation,
  Conversation,
  ConversationFlavor,
} from "@grammyjs/conversations";
import { prisma } from "./prisma";
import {
  Alert,
  AlertDirection,
  Mode,
  Strategy,
  Trade,
  TradeDirection,
  User,
} from "@prisma/client";
import ccxt from "ccxt";
import cron from "node-cron";
import { ATR, MACD, RSI } from "technicalindicators";

const { TELEGRAM_TOKEN, GROK_API_KEY } = process.env;

if (!TELEGRAM_TOKEN) {
  throw new Error("TELEGRAM_TOKEN is not set in environment variables");
}

// GROK_API_KEY is loaded via dotenv for future AI features.
// It is not used in this boilerplate yet, but is available via process.env.GROK_API_KEY.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const grokApiKey = GROK_API_KEY;

type BotMode = "polite" | "aggressive" | "uncensored";

type BotStrategy =
  | "smc"
  | "swing"
  | "range"
  | "breakout"
  | "pullback"
  | "divergence";

interface SessionData {
  // extend later as needed
}

type MyContext = Context & SessionFlavor<SessionData> & ConversationFlavor;
type MyConversation = Conversation<MyContext>;

const bot = new Bot<MyContext>(TELEGRAM_TOKEN);

const binance = new ccxt.binance({
  enableRateLimit: true,
});

bot.use(
  session({
    initial: (): SessionData => ({}),
  }),
);

bot.use(conversations());

async function getOrCreateUser(ctx: MyContext) {
  const from = ctx.from;

  if (!from) {
    throw new Error("No from field on context");
  }

  const telegramId = from.id.toString();

  const user = await prisma.user.upsert({
    where: { telegramId },
    update: {},
    create: {
      telegramId,
      mode: Mode.polite,
      preferredStrategy: Strategy.smc,
    },
  });

  return user;
}

async function setModeConversation(
  conversation: MyConversation,
  ctx: MyContext,
) {
  const user = await getOrCreateUser(ctx);

  await ctx.reply(
    "Оберіть режим:\n- polite\n- aggressive\n- uncensored\n\nВведіть один з варіантів текстом.",
  );

  const { message } = await conversation.wait();
  const text = message?.text?.trim().toLowerCase() as BotMode | undefined;

  if (!text || !["polite", "aggressive", "uncensored"].includes(text)) {
    await ctx.reply("Некоректний режим. Спробуйте ще раз командою /setmode.");
    return;
  }

  const modeMap: Record<BotMode, Mode> = {
    polite: Mode.polite,
    aggressive: Mode.aggressive,
    uncensored: Mode.uncensored,
  };

  await prisma.user.update({
    where: { id: user.id },
    data: { mode: modeMap[text] },
  });

  await ctx.reply(`Режим оновлено на: ${text}`);
}

async function setDepositConversation(
  conversation: MyConversation,
  ctx: MyContext,
) {
  const user = await getOrCreateUser(ctx);

  await ctx.reply("Введіть ваш депозит (число, наприклад 1000.5):");

  const { message } = await conversation.wait();
  const text = message?.text?.trim();

  if (!text) {
    await ctx.reply("Не вдалося зчитати число. Спробуйте ще раз командою /setdeposit.");
    return;
  }

  const value = Number(text.replace(",", "."));

  if (!Number.isFinite(value) || value < 0) {
    await ctx.reply("Депозит має бути невід'ємним числом. Спробуйте ще раз /setdeposit.");
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { deposit: value.toString() },
  });

  await ctx.reply(`Депозит оновлено: ${value}`);
}

async function setStrategyConversation(
  conversation: MyConversation,
  ctx: MyContext,
) {
  const user = await getOrCreateUser(ctx);
  await ctx.reply(
    "Оберіть базову стратегію:\n- smc\n- swing\n- range\n- breakout\n- pullback\n- divergence\n\nВведіть один з варіантів текстом.",
  );

  const { message } = await conversation.wait();
  const text = message?.text?.trim().toLowerCase() as BotStrategy | undefined;

  const allowed: BotStrategy[] = [
    "smc",
    "swing",
    "range",
    "breakout",
    "pullback",
    "divergence",
  ];

  if (!text || !allowed.includes(text)) {
    await ctx.reply("Некоректна стратегія. Спробуйте ще раз командою /setstrategy.");
    return;
  }

  const strategyMap: Record<BotStrategy, Strategy> = {
    smc: Strategy.smc,
    swing: Strategy.swing,
    range: Strategy.range,
    breakout: Strategy.breakout,
    pullback: Strategy.pullback,
    divergence: Strategy.divergence,
  };

  await prisma.user.update({
    where: { id: user.id },
    data: { preferredStrategy: strategyMap[text] },
  });

  await ctx.reply(`Стратегія оновлена на: ${text}`);
}

async function addTradeConversation(
  conversation: MyConversation,
  ctx: MyContext,
) {
  const user = await getOrCreateUser(ctx);

  const numericOrNull = (raw: string) => {
    const normalized = raw.replace(",", ".").trim();
    if (!normalized) {
      return null;
    }

    const value = Number(normalized);

    if (!Number.isFinite(value)) {
      return Number.NaN;
    }

    return value;
  };

  const askText = async (prompt: string) => {
    await ctx.reply(prompt);
    const { message } = await conversation.wait();
    const text = message?.text?.trim();

    if (!text) {
      await ctx.reply("Не бачу текст. Скасовано /add, спробуй ще раз.");
      throw new Error("NO_TEXT");
    }

    return text;
  };

  if (!user.deposit || Number(user.deposit) <= 0) {
    await ctx.reply(
      "Спочатку задай депозит командою /setdeposit, щоб рахувати ризик.",
    );
    return;
  }

  try {
    const dateRaw = await askText(
      "Введіть дату угоди у форматі YYYY-MM-DD або 'today':",
    );
    let tradeDate: Date;

    if (dateRaw.toLowerCase() === "today") {
      tradeDate = new Date();
    } else {
      const parsedDate = new Date(dateRaw);

      if (Number.isNaN(parsedDate.getTime())) {
        await ctx.reply(
          "Некоректна дата. Скасовано /add, спробуй ще раз з правильною датою.",
        );
        return;
      }

      tradeDate = parsedDate;
    }

    const timeRaw = await askText(
      "Введіть час угоди (HH:MM, 24-годинний формат, наприклад 13:45):",
    );
    const timeMatch = timeRaw.match(/^(\d{1,2}):(\d{2})$/);

    if (!timeMatch) {
      await ctx.reply(
        "Некоректний час. Скасовано /add, спробуй ще раз з правильним часом.",
      );
      return;
    }

    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);

    if (
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      await ctx.reply(
        "Некоректний час. Скасовано /add, спробуй ще раз з правильним часом.",
      );
      return;
    }

    const tradeDateTime = new Date(tradeDate);
    tradeDateTime.setHours(hours, minutes, 0, 0);

    const symbolRaw = await askText(
      "Введіть символ угоди (наприклад BTCUSDT):",
    );
    const symbol = symbolRaw.toUpperCase();

    const directionRaw = (
      await askText("Введіть напрямок угоди (long/short):")
    ).toLowerCase();

    if (directionRaw !== "long" && directionRaw !== "short") {
      await ctx.reply(
        "Напрямок має бути long або short. Скасовано /add, спробуй ще раз.",
      );
      return;
    }

    type TradeDirectionInput = "long" | "short";
    const direction = directionRaw as TradeDirectionInput;

    const entry1Raw = await askText(
      "Введіть ціну входу entry1 (обов'язково, число):",
    );
    const entry1 = numericOrNull(entry1Raw);

    if (!Number.isFinite(entry1) || (entry1 ?? 0) <= 0) {
      await ctx.reply(
        "entry1 має бути додатним числом. Скасовано /add, спробуй ще раз.",
      );
      return;
    }

    const entry2Raw = await askText(
      "Введіть entry2 (додатково) або '-' якщо немає:",
    );
    const entry3Raw = await askText(
      "Введіть entry3 (додатково) або '-' якщо немає:",
    );

    const toOptionalNumber = (value: string) => {
      if (value.trim() === "-") {
        return null;
      }

      const parsed = numericOrNull(value);

      if (parsed === null || Number.isNaN(parsed)) {
        return Number.NaN;
      }

      return parsed;
    };

    const entry2 = toOptionalNumber(entry2Raw);
    const entry3 = toOptionalNumber(entry3Raw);

    if (Number.isNaN(entry2) || Number.isNaN(entry3)) {
      await ctx.reply(
        "entry2/entry3 мають бути числами або '-'. Скасовано /add, спробуй ще раз.",
      );
      return;
    }

    const entries: number[] = [
      entry1 as number,
      ...(entry2 != null ? [entry2] : []),
      ...(entry3 != null ? [entry3] : []),
    ];

    const tp1Raw = await askText(
      "Введіть TP1 (обов'язково, число):",
    );
    const tp1 = numericOrNull(tp1Raw);

    if (!Number.isFinite(tp1)) {
      await ctx.reply(
        "TP1 має бути числом. Скасовано /add, спробуй ще раз.",
      );
      return;
    }

    const tp2Raw = await askText(
      "Введіть TP2 (додатково) або '-' якщо немає:",
    );
    const tp3Raw = await askText(
      "Введіть TP3 (додатково) або '-' якщо немає:",
    );

    const tp2 = toOptionalNumber(tp2Raw);
    const tp3 = toOptionalNumber(tp3Raw);

    if (Number.isNaN(tp2) || Number.isNaN(tp3)) {
      await ctx.reply(
        "TP2/TP3 мають бути числами або '-'. Скасовано /add, спробуй ще раз.",
      );
      return;
    }

    const tps: number[] = [
      tp1 as number,
      ...(tp2 != null ? [tp2] : []),
      ...(tp3 != null ? [tp3] : []),
    ];

    const slBeRaw = await askText(
      "Введіть рівень SL/BE (stop-loss / break-even, число):",
    );
    const slBe = numericOrNull(slBeRaw);

    if (!Number.isFinite(slBe)) {
      await ctx.reply(
        "SL/BE має бути числом. Скасовано /add, спробуй ще раз.",
      );
      return;
    }

    const sizeRaw = await askText(
      "Введіть розмір позиції в USDT (size, додатне число):",
    );
    const sizeParsed = numericOrNull(sizeRaw);

    if (!Number.isFinite(sizeParsed) || (sizeParsed ?? 0) <= 0) {
      await ctx.reply(
        "Size має бути додатним числом. Скасовано /add, спробуй ще раз.",
      );
      return;
    }

    let size = sizeParsed as number;
    const deposit = Number(user.deposit);
    const baseEntry = entry1 as number;
    const slValue = slBe as number;

    if (!Number.isFinite(deposit) || deposit <= 0) {
      await ctx.reply(
        "Депозит у БД некоректний. Онови депозит через /setdeposit і спробуй ще раз.",
      );
      return;
    }

    const priceDiff = Math.abs(baseEntry - slValue);

    if (!Number.isFinite(priceDiff) || priceDiff <= 0) {
      await ctx.reply(
        "SL має відрізнятися від entry1. Скасовано /add, спробуй ще раз.",
      );
      return;
    }

    let riskPercent =
      (priceDiff / baseEntry) * (size / deposit) * 100;

    if (!Number.isFinite(riskPercent) || riskPercent <= 0) {
      await ctx.reply(
        "Не вдалося порахувати ризик. Перевір вхідні дані.",
      );
      return;
    }

    if (riskPercent > 1) {
      const sizeForOnePercent =
        ((deposit * 0.01 * baseEntry) / priceDiff);

      await ctx.reply(
        [
          `Ризик на угоду зараз ≈ ${riskPercent.toFixed(2)}%.`,
          "Це більше за 1%.",
          `Рекомендований розмір позиції для 1% ризику: ${sizeForOnePercent.toFixed(2)} USDT.`,
          "",
          "Введи:",
          "- 'yes' щоб залишити поточний size;",
          "- 'adj' щоб використати рекомендований розмір;",
          "- будь-що інше — щоб скасувати /add.",
        ].join("\n"),
      );

      const confirmRaw = (
        await askText("Твоє рішення (yes/adj/скасувати):")
      ).toLowerCase();

      if (confirmRaw === "adj") {
        size = sizeForOnePercent;
      } else if (confirmRaw === "yes") {
        // leave size as is
      } else {
        await ctx.reply("Ок, угоду не збережено.");
        return;
      }

      riskPercent =
        (priceDiff / baseEntry) * (size / deposit) * 100;
    }

    const allowedStrategies: BotStrategy[] = [
      "smc",
      "swing",
      "range",
      "breakout",
      "pullback",
      "divergence",
    ];

    const strategyRaw = (
      await askText(
        [
          "Введіть стратегію для цієї угоди:",
          "- smc / swing / range / breakout / pullback / divergence",
          `або '-' щоб використати базову: ${user.preferredStrategy}.`,
        ].join("\n"),
      )
    )
      .trim()
      .toLowerCase();

    let tradeStrategy: BotStrategy;

    if (strategyRaw === "-") {
      tradeStrategy = user.preferredStrategy as BotStrategy;
    } else if (allowedStrategies.includes(strategyRaw as BotStrategy)) {
      tradeStrategy = strategyRaw as BotStrategy;
    } else {
      await ctx.reply(
        "Некоректна стратегія. Скасовано /add, спробуй ще раз.",
      );
      return;
    }

    if (tradeStrategy === "smc") {
      await ctx.reply("Нагадування: перевір CHOCH/BOS перед входом у SMC сетап.");
    }

    await prisma.trade.create({
      data: {
        userId: user.id,
        symbol,
        direction,
        entries,
        tps,
        slBe: slValue.toString(),
        size: size.toString(),
        riskPercent,
        validated: false,
        strategy: tradeStrategy,
        createdAt: tradeDateTime,
      },
    });

    await ctx.reply(
      [
        "Угоду збережено.",
        `Символ: ${symbol}`,
        `Напрямок: ${direction}`,
        `Entry1: ${baseEntry}`,
        `SL: ${slValue}`,
        `Size: ${size.toFixed(2)} USDT`,
        `Ризик: ${riskPercent.toFixed(2)}%`,
        `Стратегія: ${tradeStrategy}`,
      ].join("\n"),
    );
  } catch (error) {
    // errors already повідомлені користувачу в більшості кейсів
    return;
  }
}

type AlertWithUser = Alert & { user: User };

type TradeWithUser = Trade & { user: User };

function buildStrategyTip(strategy: string): string {
  switch (strategy) {
    case "pullback":
      return "Подивись на EMA20 — класичний pullback може вже відпрацьовувати.";
    case "smc":
      return "Перевір sweep і BOS/CHOCH перед будь-яким перезаходом.";
    case "swing":
      return "Тримай фокус на старшому таймфреймі та ключових свінгах.";
    case "range":
      return "Фіксуй частину в межах ренджу, не ганяйся за кожним пробоєм.";
    case "breakout":
      return "Дочекайся ретесту рівня, не стрибай за свічкою без підтвердження.";
    case "divergence":
      return "Перевір, чи дивергенція ще актуальна, не перезаходь всліпу.";
    default:
      return "Тримайся свого плану по цій стратегії та не роздувай ризик.";
  }
}

function buildModeAwareTp1Message(args: {
  mode: Mode;
  symbol: string;
  strategy: string;
  pnl: number;
}): string {
  const baseLine = `TP1 взято по ${args.symbol}.`;
  const pnlLine = `Умовний профіт за TP1 ≈ +${args.pnl.toFixed(2)} USDT.`;
  const tip = buildStrategyTip(args.strategy);

  if (args.mode === Mode.polite) {
    return [
      baseLine,
      pnlLine,
      "",
      `Рекомендація: перенесіть SL у BE згідно зі стратегією ${args.strategy}.`,
      tip,
    ].join("\n");
  }

  if (args.mode === Mode.aggressive) {
    return [
      baseLine,
      pnlLine,
      "",
      `Перекоти SL в BE і захисти профіт по ${args.strategy}.`,
      tip,
    ].join("\n");
  }

  return [
    `${baseLine} Fuck yeah, TP1 hit!`,
    pnlLine,
    "",
    `Перекинь SL в BE по ${args.strategy} і не дай ринку відкусити профіт.`,
    tip,
  ].join("\n");
}

function calculateTp1Pnl(trade: Trade): number | null {
  const entries = (trade.entries as unknown as number[]) || [];
  const tps = (trade.tps as unknown as number[]) || [];

  if (!entries.length || !tps.length) {
    return null;
  }

  const entry = Number(entries[0]);
  const tp1 = Number(tps[0]);
  const size = Number(trade.size);

  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(tp1) ||
    !Number.isFinite(size) ||
    entry <= 0
  ) {
    return null;
  }

  const isLong = trade.direction === TradeDirection.long;
  const priceDiff = isLong ? tp1 - entry : entry - tp1;

  return (priceDiff / entry) * size;
}

type TradeWithUser = Trade & { user: User };

async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const ticker = await binance.fetchTicker(symbol);
    const candidate = (ticker.last ?? ticker.close) as number | undefined;

    if (!candidate || !Number.isFinite(candidate)) {
      return null;
    }

    return candidate;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to fetch ticker for", symbol, error);
    return null;
  }
}

async function handleOpenTrade(trade: TradeWithUser): Promise<void> {
  const entries = (trade.entries as unknown as number[]) || [];
  const tps = (trade.tps as unknown as number[]) || [];

  if (!entries.length || !tps.length) {
    return;
  }

  const entry = Number(entries[0]);
  const tp1 = Number(tps[0]);

  if (!Number.isFinite(entry) || !Number.isFinite(tp1) || entry <= 0) {
    return;
  }

  const currentPrice = await fetchCurrentPrice(trade.symbol);

  if (!currentPrice) {
    return;
  }

  const isLong = trade.direction === TradeDirection.long;
  const tp1Hit = isLong ? currentPrice >= tp1 : currentPrice <= tp1;

  if (!tp1Hit) {
    return;
  }

  const pnl = calculateTp1Pnl(trade);

  if (pnl == null) {
    return;
  }

  const chatId = Number.isFinite(Number(trade.user.telegramId))
    ? Number(trade.user.telegramId)
    : trade.user.telegramId;

  const message = buildModeAwareTp1Message({
    mode: trade.user.mode,
    symbol: trade.symbol,
    strategy: trade.strategy,
    pnl,
  });

  try {
    await bot.api.sendMessage(chatId, message);
  } finally {
    await prisma.trade.update({
      where: { id: trade.id },
      data: { profitLoss: pnl.toString() },
    });
  }
}

async function processOpenTradesTick(): Promise<void> {
  const openTrades = await prisma.trade.findMany({
    where: { profitLoss: 0 },
    include: { user: true },
  });

  if (!openTrades.length) {
    return;
  }

  for (const trade of openTrades) {
    try {
      await handleOpenTrade(trade);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to handle open trade", trade.id, error);
    }
  }
}

async function fetchOhlcvForValidation(
  symbol: string,
): Promise<{
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
} | null> {
  try {
    const candles = await binance.fetchOHLCV(symbol, "4h", undefined, 100);

    if (!candles.length) {
      return null;
    }

    const closes: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];
    const volumes: number[] = [];

    for (const [, open, high, low, close, volume] of candles) {
      // open is ignored here, але можна додати пізніше
      closes.push(Number(close));
      highs.push(Number(high));
      lows.push(Number(low));
      volumes.push(Number(volume));
    }

    return { closes, highs, lows, volumes };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to fetch OHLCV for", symbol, error);
    return null;
  }
}

interface ValidationResult {
  isValid: boolean;
  reason: string;
}

function validateSmcStructure(
  closes: number[],
  highs: number[],
  lows: number[],
  direction: AlertDirection,
): ValidationResult {
  if (closes.length < 10 || highs.length < 10 || lows.length < 10) {
    return {
      isValid: false,
      reason: "Замало свічок для структури SMC.",
    };
  }

  const lookback = Math.min(50, highs.length);
  const recentHighs = highs.slice(-lookback);
  const recentLows = lows.slice(-lookback);
  const lastClose = closes[closes.length - 1];

  const swingHigh = Math.max(...recentHighs);
  const swingLow = Math.min(...recentLows);
  const breakoutThreshold = 0.001; // ~0.1% для BOS

  if (direction === AlertDirection.above) {
    const brokeHigh = lastClose > swingHigh * (1 + breakoutThreshold);

    return brokeHigh
      ? {
          isValid: true,
          reason: "Є BOS вище останнього свінг-хая (SMC).",
        }
      : {
          isValid: false,
          reason: "Немає чіткого BOS вище свінг-хая.",
        };
  }

  const brokeLow = lastClose < swingLow * (1 - breakoutThreshold);

  return brokeLow
    ? {
        isValid: true,
        reason: "Є BOS нижче останнього свінг-лоу (SMC).",
      }
    : {
        isValid: false,
        reason: "Немає чіткого BOS нижче свінг-лоу.",
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
  const isRange = atrRatio < 0.01; // <1% діапазон за 4h

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
): ValidationResult {
  if (closes.length < 5 || volumes.length < 21) {
    return {
      isValid: false,
      reason: "Мало даних для оцінки об'ємів на брейкаут.",
    };
  }

  const lastVolume = volumes[volumes.length - 1];
  const window = Math.min(20, volumes.length - 1);
  const baseSlice = volumes.slice(-window - 1, -1);
  const baseVolumeAvg =
    baseSlice.reduce((acc, v) => acc + v, 0) / baseSlice.length;

  const isSpike = lastVolume > baseVolumeAvg * 1.5;

  return isSpike
    ? {
        isValid: true,
        reason: "Є об'ємний спайк — брейкаут виглядає реальним.",
      }
    : {
        isValid: false,
        reason: "Об'єм слабкий — брейкаут може бути фейковим.",
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

async function validateAlertByStrategy(params: {
  symbol: string;
  direction: AlertDirection;
  strategy: Strategy;
}): Promise<ValidationResult> {
  const ohlcv = await fetchOhlcvForValidation(params.symbol);

  if (!ohlcv) {
    return {
      isValid: false,
      reason: "Не вдалося отримати OHLCV для валідації.",
    };
  }

  const { closes, highs, lows, volumes } = ohlcv;

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

  // поки що MACD лише для контексту, можна використати глибше пізніше
  if (!macdSeries.length) {
    // немає MACD, але це не критично, просто менше сигналів
  }

  const lastClose = closes[closes.length - 1];

  switch (params.strategy) {
    case Strategy.smc:
      return validateSmcStructure(closes, highs, lows, params.direction);

    case Strategy.range:
      return validateRangeEnvironment(lastClose, lastAtr);

    case Strategy.breakout:
      return validateBreakoutEnvironment(closes, volumes);

    case Strategy.divergence:
      return validateDivergenceEnvironment(closes, rsiSeries);

    case Strategy.swing:
    case Strategy.pullback:
    default:
      return {
        isValid: true,
        reason:
          "Спеціфічного валідатора для цієї стратегії ще немає — тримаємо базову згоду.",
      };
  }
}

function buildModeAwareAlertMessage(args: {
  mode: Mode;
  symbol: string;
  strategy: Strategy;
  targetPrice: number;
  currentPrice: number;
  valid: boolean;
  reason: string;
}): string {
  const strategyLabel = args.strategy;
  const header = [
    `Алерт по ${args.symbol} спрацював.`,
    `Ціна зараз ≈ ${args.currentPrice.toFixed(4)}, таргет був ${args.targetPrice}.`,
  ].join(" ");

  const validationHint = `Wait for validation per ${strategyLabel}, e.g., CHOCH needed.`;

  if (args.valid) {
    if (args.mode === Mode.polite) {
      return [
        header,
        "",
        `За стратегією ${strategyLabel} сетап виглядає валідно.`,
        args.reason,
      ].join("\n");
    }

    if (args.mode === Mode.aggressive) {
      return [
        header,
        "",
        `Сетап за ${strategyLabel} виглядає робочим — діюй по плану, але не забувай про ризик.`,
        args.reason,
      ].join("\n");
    }

    // uncensored
    return [
      header,
      "",
      `Виглядає жирний сетап по ${strategyLabel}. Не зноси депозит, бро.`,
      args.reason,
    ].join("\n");
  }

  if (args.mode === Mode.polite) {
    return [
      header,
      "",
      `За стратегією ${strategyLabel} сетап ще сирий.`,
      args.reason,
      validationHint,
    ].join("\n");
  }

  if (args.mode === Mode.aggressive) {
    return [
      header,
      "",
      `Почекай підтвердження за ${strategyLabel} перед входом.`,
      args.reason,
      validationHint,
    ].join("\n");
  }

  // uncensored
  return [
    header,
    "",
    "Не лети в ринок, бро. Сетап ще не валідний.",
    args.reason,
    validationHint,
  ].join("\n");
}

async function handleSingleAlert(alert: AlertWithUser): Promise<void> {
  const { symbol, targetPrice, direction, user } = alert;
  const target = Number(targetPrice);

  if (!Number.isFinite(target) || target <= 0) {
    await prisma.alert.update({
      where: { id: alert.id },
      data: { active: false },
    });
    return;
  }

  const currentPrice = await fetchCurrentPrice(symbol);

  if (!currentPrice) {
    return;
  }

  const triggered =
    direction === AlertDirection.above
      ? currentPrice >= target
      : currentPrice <= target;

  if (!triggered) {
    return;
  }

  const validation = await validateAlertByStrategy({
    symbol,
    direction,
    strategy: user.preferredStrategy,
  });

  const message = buildModeAwareAlertMessage({
    mode: user.mode,
    symbol,
    strategy: user.preferredStrategy,
    targetPrice: target,
    currentPrice,
    valid: validation.isValid,
    reason: validation.reason,
  });

  try {
    const chatId = Number.isFinite(Number(user.telegramId))
      ? Number(user.telegramId)
      : user.telegramId;

    await bot.api.sendMessage(chatId, message);
  } finally {
    await prisma.alert.update({
      where: { id: alert.id },
      data: { active: false },
    });
  }
}

async function processAlertsTick(): Promise<void> {
  const activeAlerts = await prisma.alert.findMany({
    where: { active: true },
    include: { user: true },
  });

  if (!activeAlerts.length) {
    return;
  }

  for (const alert of activeAlerts) {
    try {
      await handleSingleAlert(alert);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to handle alert", alert.id, error);
    }
  }
}

cron.schedule("*/5 * * * *", async () => {
  await processAlertsTick();
});

cron.schedule("*/15 * * * *", async () => {
  await processOpenTradesTick();
});

bot.use(createConversation(setModeConversation, "setModeConversation"));
bot.use(createConversation(setDepositConversation, "setDepositConversation"));
bot.use(createConversation(setStrategyConversation, "setStrategyConversation"));
bot.use(createConversation(addTradeConversation, "addTradeConversation"));

bot.command("start", async (ctx) => {
  const user = await getOrCreateUser(ctx);

  await ctx.reply(
    [
      "Йо, я SMC bro бот.",
      "",
      `Твій режим: ${user.mode}`,
      `Базова стратегія: ${user.preferredStrategy}`,
      "",
      "Команди:",
      "/setmode - змінити режим (polite/aggressive/uncensored)",
      "/setdeposit - оновити депозит",
      "/setstrategy - змінити базову стратегію",
    ].join("\n"),
  );
});

bot.command("setmode", async (ctx) => {
  await ctx.conversation.enter("setModeConversation");
});

bot.command("setdeposit", async (ctx) => {
  await ctx.conversation.enter("setDepositConversation");
});

bot.command("setstrategy", async (ctx) => {
  await ctx.conversation.enter("setStrategyConversation");
});

bot.command("add", async (ctx) => {
  await ctx.conversation.enter("addTradeConversation");
});

bot.command("alert", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  const text = ctx.message?.text ?? "";
  const parts = text.trim().split(/\s+/).slice(1);

  if (parts.length < 3) {
    await ctx.reply(
      [
        "Формат команди:",
        "/alert SYMBOL PRICE above|below",
        "Приклад: /alert BTCUSDT 65000 above",
      ].join("\n"),
    );
    return;
  }

  const [symbolRaw, priceRaw, directionRaw] = parts;
  const symbol = symbolRaw.toUpperCase();
  const normalizedPrice = priceRaw.replace(",", ".");
  const target = Number(normalizedPrice);

  if (!Number.isFinite(target) || target <= 0) {
    await ctx.reply("Ціна має бути додатнім числом.");
    return;
  }

  const directionText = directionRaw.toLowerCase();
  let direction: AlertDirection;

  if (directionText === "above") {
    direction = AlertDirection.above;
  } else if (directionText === "below") {
    direction = AlertDirection.below;
  } else {
    await ctx.reply("Напрямок має бути above або below.");
    return;
  }

  await prisma.alert.create({
    data: {
      userId: user.id,
      symbol,
      targetPrice: target.toString(),
      direction,
    },
  });

  await ctx.reply(
    [
      `Алерт для ${symbol} на ціну ${target} (${directionText}) збережено.`,
      "Буду чекати спрацювання раз на 5 хв з валідацією по стратегії.",
    ].join("\n"),
  );
});

bot.command("report", async (ctx) => {
  const user = await getOrCreateUser(ctx);

  const trades = await prisma.trade.findMany({
    where: { userId: user.id },
  });

  if (!trades.length) {
    await ctx.reply("Поки що немає жодної угоди для звіту.");
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
      // недостатньо даних для умовного P/L
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

  if (!totalTradesForStats) {
    await ctx.reply(
      "Є угоди, але замало даних, щоб порахувати умовний P/L.",
    );
    return;
  }

  const winRate = (wins / totalTradesForStats) * 100;

  const lines: string[] = [];

  lines.push("Звіт по угодах (умовний P/L на базі R:R TP1/SL):");
  lines.push(`Всього угод: ${totalTradesForStats}`);
  lines.push(`Тотальний P/L: ${totalPnl.toFixed(2)} USDT`);
  lines.push(`Win-rate: ${winRate.toFixed(2)}%`);
  lines.push("");
  lines.push("По стратегіях:");

  for (const [strategyKey, stats] of Object.entries(byStrategy)) {
    if (!stats.trades) {
      continue;
    }

    const localWinRate = (stats.wins / stats.trades) * 100;

    lines.push(
      `- ${strategyKey}: угод ${stats.trades}, P/L ${stats.pnl.toFixed(
        2,
      )} USDT, win-rate ${localWinRate.toFixed(2)}%`,
    );
  }

  await ctx.reply(lines.join("\n"));
});

bot.catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Bot error:", err.error);
});

bot.start();

