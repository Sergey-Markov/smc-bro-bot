# Intimy / SMC Bro Bot

Telegram-бот для свінг‑трейдингу на крипті, який поєднує трекінг угод, ризик‑менеджмент, алерти по стратегіях (SMC/ICT, Range, Breakout тощо), психологічні підказки та AI‑аналіз через GrokAI.

Цей файл — єдине місце для всієї документації по проєкту. Оновлюй його при додаванні нових фіч.

---

## Основна ідея

- **Розумний коуч‑бот**: не просто трекає угоди, а й перевіряє валідність сетапів за стратегіями (SMC, Range, Breakout, Pullback, Divergence).
- **Ризик < 1%**: бот допомагає не перетягувати ризик і нагадує про базові правила (ліквідність, BOS/CHOCH, ATR‑ренджі тощо).
- **Мульти‑режими комунікації**: ввічливий, агресивний, uncensored режим з різним тоном, але однаковою логікою.
- **AI‑фічі через GrokAI**: аналіз угод, бектестинг, сентимент по ринку з урахуванням обраних стратегій.

---

## Поточний стан (MVP)

Бекенд на **Node.js + TypeScript**, бот на **grammY** з **conversations**, БД через **Prisma + SQLite**.

### Реалізовано зараз

- **Базовий Telegram‑бот**
  - `/start` — вітання + показ поточного режиму та базової стратегії.
  - `/setmode` — зміна режиму відповіді (`polite`, `aggressive`, `uncensored`) через розмову.
  - `/setdeposit` — встановлення депозиту користувача (Decimal в БД).
  - `/setstrategy` — вибір базової стратегії (`smc`, `swing`, `range`, `breakout`, `pullback`, `divergence`).

- **База даних (Prisma + SQLite)**
  - `User`:
    - `telegramId`, `deposit`, `mode`, `preferredStrategy`.
    - Звʼязок з `Trade` і `Alert`.
  - `Trade`:
    - `symbol`, `direction (long/short)`, `entries` (JSON масив), `tps` (JSON масив), `slBe`, `size`, `riskPercent`, `validated`, `strategy` (string).
  - `Alert`:
    - `symbol`, `targetPrice`, `direction (above/below)`, `active`.

---

## Архітектура проєкту

- **Мова/рантайм**: Node.js + TypeScript.
- **Telegram‑бот**: `grammy` + `@grammyjs/conversations`.
- **ORM/БД**: Prisma + SQLite (локально), далі можна перевести на Postgres.
- **Env/конфіг**: `dotenv` (`.env`, `.env.example`).

### Структура папок

- `src/`
  - `bot.ts` — вхідна точка Telegram‑бота, реєстрація команд і conversations.
  - `prisma.ts` — ініціалізація Prisma‑клієнта (singleton).
- `prisma/`
  - `schema.prisma` — опис моделей БД.
- root:
  - `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, `README.md`.

---

## Моделі БД (коротко)

- **User**
  - `telegramId: string` — ідентифікатор користувача Telegram.
  - `deposit: Decimal` — розмір депозиту для розрахунку ризику.
  - `mode: Mode` — `polite | aggressive | uncensored`.
  - `preferredStrategy: Strategy` — базова стратегія (SMC, swing, range, breakout, pullback, divergence).
  - `trades: Trade[]` — повʼязані угоди.
  - `alerts: Alert[]` — повʼязані алерти.

- **Trade**
  - `symbol: string`
  - `direction: long | short`
  - `entries: Json` — масив цін входу.
  - `tps: Json` — масив тейків.
  - `slBe: Decimal` — стоп/BE.
  - `size: Decimal` — розмір позиції (USDT).
  - `riskPercent: number` — відсоток ризику від депозиту.
  - `validated: boolean` — чи пройшла угода валідацію стратегією.
  - `strategy: string` — назва/тег стратегії.

- **Alert**
  - `symbol: string`
  - `targetPrice: Decimal`
  - `direction: above | below`
  - `active: boolean`

---

## Запуск проєкту (локально)

1. **Встановити залежності**

   ```bash
   npm install
   ```

2. **Налаштувати `.env`**

   - Скопіювати:

     ```bash
     copy .env.example .env
     ```

   - Заповнити:
     - `TELEGRAM_TOKEN` — токен бота з BotFather.
     - `GROK_API_KEY` — ключ для GrokAI (поки не використовується, але потрібен далі).
     - `DATABASE_URL` — наприклад `file:./dev.db` (SQLite).

3. **Ініціалізувати Prisma/БД**

   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```

4. **Запустити бота**

   - Dev:

     ```bash
     npm run dev
     ```

   - Prod:

     ```bash
     npm run build
     npm start
     ```

---

## Дорожня карта фіч (загальний план)

> Цей список синхронізується з правилами в `.cursor/rules/about-project.mdc`. Оновлюй обидва місця при зміні плану.

- **1. Трекінг угод з ризик‑контролем**
  - Команда `/add` як conversation.
  - Розрахунок `riskPercent` з урахуванням депозиту.
  - Попередження, якщо ризик > 1%, автопропозиція корегувати розмір позиції.
  - Спеціальні ремарки для SMC (ліквідність, BOS/CHOCH).

- **2. Алерти з валідацією стратегій**
  - `/alert` + cron (node‑cron) кожні 5 хв.
  - Дані з `ccxt.binance`.
  - TA через `technicalindicators`:
    - ZigZag для структур (CHOCH/BOS).
    - ATR для ренджів.
    - RSI/MACD для дивергенцій.
    - Volume spike для breakout.

- **3. Психологія / менторство**
  - Cron кожні 15 хв, моніторинг відкритих угод.
  - Повідомлення типу “TP1 taken — move SL to BE” з урахуванням стратегії й режиму (polite/aggressive/uncensored).

- **4. Інтеграція GrokAI**
  - `/analyze` для аналізу конкретної угоди (SMC, swing, range тощо).
  - `/sentiment` для контексту з новин/X.
  - Кешування через Redis (ioredis), щоб не палити ліміти.

- **5. Бектестинг стратегій**
  - `/backtest` з симуляцією угод по OHLCV з ccxt.
  - SMC: BOS/CHOCH + FVG + ліквідність.
  - Swing: pullback до EMA20/50.
  - Range, Breakout, Divergence тощо.

- **6. Режими спілкування**
  - Повна інтеграція `mode` в усі відповіді бота й промпти до GrokAI.

- **7. PWA‑дашборд (React + Expo/Next)**
  - Логін через Telegram.
  - Графіки P&L, оверлеї стратегій (EMA, ZigZag, ATR‑ренджі, BOS).
  - Налаштування юзера.

- **8. Монетизація**
  - Stripe, `/subscribe`, `User.premium`.
  - Ліміти для AI/бектестингу для free vs premium.

---

## Договореності по коду

- **TypeScript/Node**
  - Строгий TS (`strict: true`).
  - Мінімізувати `any`, краще окремі типи для режимів/стратегій.

- **Чистий код**
  - Ніяких magic numbers — виносимо в константи.
  - Маленькі функції з однією відповідальністю.
  - Повторювану логіку виносимо в хелпери.

- **Prisma**
  - Схему змінюємо через `schema.prisma` + `prisma migrate`.
  - Гроші/ціни — через `Decimal` або адекватну модель (не `float`).

- **Git**
  - Коміти тільки англійською, дрібні та сфокусовані.
  - Гілки з осмисленими назвами (`feature/add-alerts-smc`, `feat/grok-analyze`, тощо).

---

## TODO для оновлення README

При додаванні нових фіч / команд:

- Додати їх:
  - у секцію **"Реалізовано зараз"**,
  - у **"Дорожню карту"** (якщо це новий блок) або відмітити як готовий.
- Коротко описати зміни моделей БД, якщо вони є.

