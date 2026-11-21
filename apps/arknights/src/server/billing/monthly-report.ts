import "@tanstack/react-start/server-only";
import { getDatabasePool } from "@riic/platform-server/db";

export class BillingMonthlyError extends Error {}

export type BillingMonth = {
  month: string;
  runs: number;
  points: string;
  paid_orders: number;
  paid_fen: string;
  known_cost_fen: string;
  unknown_cost_runs: number;
  unknown_cost_calls: number;
};

function validateRange(from: Date, to: Date) {
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || +from >= +to || +to - +from > 366 * 86400_000) {
    throw new BillingMonthlyError("日期范围应在一年以内。");
  }
}

/** Include the last twelve Beijing calendar months, ending at the exclusive cutoff. */
export function billingMonthlyRange(params: URLSearchParams, now = new Date()) {
  const to = params.has("to") ? new Date(params.get("to")!) : now;
  if (!Number.isFinite(+to)) throw new BillingMonthlyError("日期范围应在一年以内。");
  const lastMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" })
    .formatToParts(new Date(+to - 1));
  const year = Number(lastMonth.find(part => part.type === "year")!.value);
  const month = Number(lastMonth.find(part => part.type === "month")!.value);
  const from = params.has("from") ? new Date(params.get("from")!) : new Date(Date.UTC(year, month - 12, 1, -8));
  validateRange(from, to);
  return { from, to };
}

/**
 * Operations report, not a cash-profit statement. Payments use paid_at; settled
 * usage/points use usage.created_at; provider costs use each call's created_at.
 * Decimal sums stay in PostgreSQL numeric and leave the API as decimal strings.
 */
export async function billingMonthly(from: Date, to: Date) {
  validateRange(from, to);
  const { rows } = await getDatabasePool().query<BillingMonth>(`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', $1::timestamptz AT TIME ZONE 'Asia/Shanghai'),
        date_trunc('month', ($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'Asia/Shanghai'),
        interval '1 month'
      ) AS month
    ), usage AS (
      SELECT date_trunc('month', created_at AT TIME ZONE 'Asia/Shanghai') AS month,
        count(*)::int AS runs, sum(points) AS points
      FROM app.agent_usage WHERE created_at >= $1 AND created_at < $2 GROUP BY 1
    ), orders AS (
      SELECT date_trunc('month', paid_at AT TIME ZONE 'Asia/Shanghai') AS month,
        count(*)::int AS paid_orders, sum(amount_fen) AS paid_fen
      FROM app.billing_order WHERE status='paid' AND paid_at >= $1 AND paid_at < $2 GROUP BY 1
    ), cost_sources AS (
      -- Versions 4/5 summarize model_call costs again in agent_usage. Never sum
      -- both. The linkage check also covers later versions that retain this shape.
      SELECT date_trunc('month', u.created_at AT TIME ZONE 'Asia/Shanghai') AS month,
        'usage:' || u.id AS run_key, u.upstream_cost_rmb_fen AS cost_fen,
        u.upstream_cost_rmb_fen IS NULL AS unknown_cost, false AS is_call
      FROM app.agent_usage u
      WHERE u.created_at >= $1 AND u.created_at < $2
        AND coalesce(u.metadata->>'billingVersion','') NOT IN ('4','5')
        AND NOT EXISTS (SELECT 1 FROM app.agent_model_call c WHERE c.run_id=u.id OR c.run_id=u.run_id)
      UNION ALL
      SELECT date_trunc('month', c.created_at AT TIME ZONE 'Asia/Shanghai'),
        'run:' || c.run_id, c.upstream_rmb * 100,
        c.upstream_rmb IS NULL AND c.status <> 'waived', true
      FROM app.agent_model_call c WHERE c.created_at >= $1 AND c.created_at < $2
    ), costs AS (
      SELECT month, sum(cost_fen) AS known_cost_fen,
        count(DISTINCT run_key) FILTER (WHERE unknown_cost)::int AS unknown_cost_runs,
        count(*) FILTER (WHERE unknown_cost AND is_call)::int AS unknown_cost_calls
      FROM cost_sources GROUP BY 1
    )
    SELECT to_char(m.month,'YYYY-MM') AS month, coalesce(u.runs,0)::int AS runs,
      coalesce(u.points,0)::text AS points, coalesce(o.paid_orders,0)::int AS paid_orders,
      coalesce(o.paid_fen,0)::text AS paid_fen, coalesce(c.known_cost_fen,0)::text AS known_cost_fen,
      coalesce(c.unknown_cost_runs,0)::int AS unknown_cost_runs,
      coalesce(c.unknown_cost_calls,0)::int AS unknown_cost_calls
    FROM months m LEFT JOIN usage u USING (month) LEFT JOIN orders o USING (month) LEFT JOIN costs c USING (month)
    ORDER BY m.month`, [from, to]);
  return { timezone: "Asia/Shanghai" as const, from: from.toISOString(), to: to.toISOString(), months: rows };
}
