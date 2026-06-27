/**
 * cronExpressionParser.ts — v84.0.0 "Workflow & Task Automation"
 * Parses cron expressions and computes next execution times.
 */
export interface CronExpression {
  raw: string;
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
  description: string;
}

export interface NextRunResult {
  expression: string;
  nextRunAt: number;
  nextRunISO: string;
  runsPerDay: number;
}

function parseCronField(field: string, min: number, max: number): number[] {
  if (field === "*") return Array.from({ length: max - min + 1 }, (_, i) => i + min);
  const result: number[] = [];
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, step] = part.split("/");
      const stepNum = parseInt(step);
      const start = range === "*" ? min : parseInt(range.split("-")[0]);
      const end = range === "*" ? max : (range.includes("-") ? parseInt(range.split("-")[1]) : max);
      for (let i = start; i <= end; i += stepNum) result.push(i);
    } else if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      for (let i = start; i <= end; i++) result.push(i);
    } else {
      result.push(parseInt(part));
    }
  }
  return [...new Set(result)].sort((a, b) => a - b);
}

function describeCron(minute: string, hour: string, dom: string, month: string, dow: string): string {
  if (minute === "*" && hour === "*") return "Every minute";
  if (minute !== "*" && hour === "*") return `At minute ${minute} of every hour`;
  if (minute === "0" && hour !== "*") return `At ${hour}:00`;
  if (dom === "*" && dow === "*") return `At ${hour}:${minute.padStart(2, "0")} every day`;
  return `At ${hour}:${minute.padStart(2, "0")} on specific days`;
}

export function parseCron(expression: string): CronExpression | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return { raw: expression, minute, hour, dayOfMonth, month, dayOfWeek, description: describeCron(minute, hour, dayOfMonth, month, dayOfWeek) };
}

export function getNextRun(expression: string, fromDate = new Date()): NextRunResult | null {
  const parsed = parseCron(expression);
  if (!parsed) return null;

  const minutes = parseCronField(parsed.minute, 0, 59);
  const hours = parseCronField(parsed.hour, 0, 23);

  // Simple approximation: find next minute/hour combination
  const now = new Date(fromDate);
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() + 1);

  for (let i = 0; i < 1440; i++) {
    if (hours.includes(now.getHours()) && minutes.includes(now.getMinutes())) {
      const runsPerDay = hours.length * minutes.length;
      return { expression, nextRunAt: now.getTime(), nextRunISO: now.toISOString(), runsPerDay };
    }
    now.setMinutes(now.getMinutes() + 1);
  }

  return null;
}

export function isValidCron(expression: string): boolean { return parseCron(expression) !== null; }
