import "dotenv/config";
import { Bot, Context, session, SessionFlavor } from "grammy";
import {
  conversations,
  createConversation,
  Conversation,
  ConversationFlavor,
} from "@grammyjs/conversations";
import { prisma } from "./prisma";
import { Mode, Strategy } from "@prisma/client";

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

