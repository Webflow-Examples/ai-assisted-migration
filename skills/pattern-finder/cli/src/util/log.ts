/**
 * Minimal structured logger. Prefers stderr for status, stdout for data.
 */

const enabled = process.env.AI_MIGRATE_QUIET !== "1";

export function info(msg: string, ctx?: Record<string, unknown>): void {
  if (!enabled) return;
  const tail = ctx ? "  " + JSON.stringify(ctx) : "";
  process.stderr.write(`[info]  ${msg}${tail}\n`);
}

export function warn(msg: string, ctx?: Record<string, unknown>): void {
  const tail = ctx ? "  " + JSON.stringify(ctx) : "";
  process.stderr.write(`[warn]  ${msg}${tail}\n`);
}

export function err(msg: string, ctx?: Record<string, unknown>): void {
  const tail = ctx ? "  " + JSON.stringify(ctx) : "";
  process.stderr.write(`[error] ${msg}${tail}\n`);
}

export function step(phase: string, msg: string): void {
  if (!enabled) return;
  process.stderr.write(`\n=== ${phase} === ${msg}\n`);
}

export function progress(current: number, total: number, label: string): void {
  if (!enabled) return;
  const pct = total === 0 ? 0 : Math.round((current / total) * 100);
  process.stderr.write(`\r[${current}/${total}] ${pct}%  ${label.slice(0, 60).padEnd(60)}`);
  if (current === total) process.stderr.write("\n");
}
