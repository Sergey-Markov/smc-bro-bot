## Intimy/SMC-bro Dashboard PWA (скелет)

Це скелетний опис PWA-дешборду, який має працювати поверх бекенду (`src/server.ts`).

- **Стек**: React + TypeScript + Vite (або Next.js, якщо захочеш SSR), Chart.js для графіків.
- **Основні сторінки**:
  - `Login` — Telegram Login Widget, отримання JWT від бекенду.
  - `Dashboard` — список угод користувача + графіки:
    - P&L у часі.
    - Win-rate по стратегіях.
    - Перекриття EMA/ZigZag/ATR/BOS поверх цінового графіка для вибраної угоди/стратегії.
  - `Settings` — зміна `deposit`, `mode`, `preferredStrategy`, статус `premium`.

### Орієнтовна структура фронтенд-проєкту

- `frontend/src/api/client.ts` — HTTP-клієнт з JWT (Authorization: Bearer).
- `frontend/src/api/trades.ts` — обгортки над:
  - `GET /api/trades?userId=...`
  - `GET /api/reports?userId=...`
  - `POST /api/backtest`
- `frontend/src/components/Charts/StrategyPerformanceChart.tsx` — Chart.js-графік win-rate/P&L по стратегіях.
- `frontend/src/components/Charts/PriceWithLevelsChart.tsx` — ціновий графік з лініями EMA, ZigZag-свінгів, ATR-реньджів, BOS.

Нижче — мінімальний приклад компонента з Chart.js для візуалізації P&L по стратегіях:

```tsx
import { Bar } from "react-chartjs-2";

interface StrategyStats {
  strategy: string;
  pnl: number;
}

interface Props {
  stats: StrategyStats[];
}

export function StrategyPnlChart({ stats }: Props) {
  const data = {
    labels: stats.map((item) => item.strategy),
    datasets: [
      {
        label: "P&L, USDT",
        data: stats.map((item) => item.pnl),
        backgroundColor: "rgba(75, 192, 192, 0.6)",
      },
    ],
  };

  return <Bar data={data} />;
}
```

Цей скелет дає достатню базу, щоб швидко розгорнути справжній PWA зі зручним дешбордом поверх поточного API.

