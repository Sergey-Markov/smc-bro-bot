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

bot.use(createConversation(setModeConversation, "setModeConversation"));
bot.use(createConversation(setDepositConversation, "setDepositConversation"));
bot.use(createConversation(setStrategyConversation, "setStrategyConversation"));

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

bot.catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Bot error:", err.error);
});

bot.start();

