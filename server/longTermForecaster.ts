/**
 * longTermForecaster.ts — v59.0.0 "The Prediction Engine"
 * Long-range forecasting using linear regression with seasonality decomposition.
 */

export interface LongTermForecast { forecastId: string; seriesId: string; forecastValues: number[]; horizon: number; trendSlope: number; seasonalAmplitude: number; rSquared: number; }
const forecasts: LongTermForecast[] = [];
let fCounter = 0;

export function forecastLongTerm(seriesId: string, history: number[], horizon: number, seasonalPeriod = 12): LongTermForecast {
  if (history.length < 2) throw new Error("[LongTermForecaster] Need at least 2 data points");
  const n = history.length;
  const xMean = (n - 1) / 2;
  const yMean = history.reduce((s, v) => s + v, 0) / n;
  const slope = history.reduce((s, v, i) => s + (i - xMean) * (v - yMean), 0) /
    history.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
  const intercept = yMean - slope * xMean;
  const seasonal = history.map((v, i) => v - (intercept + slope * i));
  const amplitude = Math.max(...seasonal) - Math.min(...seasonal);
  const predicted = history.map((_, i) => intercept + slope * i);
  const ssTot = history.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = history.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  const forecastValues = Array.from({ length: horizon }, (_, i) => {
    const trend = intercept + slope * (n + i);
    const seasonalAdj = amplitude * Math.sin((2 * Math.PI * (n + i)) / seasonalPeriod) * 0.1;
    return trend + seasonalAdj;
  });
  const forecast: LongTermForecast = { forecastId: `ltf-${++fCounter}`, seriesId, forecastValues, horizon, trendSlope: slope, seasonalAmplitude: amplitude, rSquared };
  forecasts.push(forecast);
  return forecast;
}

export function getForecasts(): LongTermForecast[] { return [...forecasts]; }
export function _resetLongTermForecasterForTest(): void { forecasts.length = 0; fCounter = 0; }
