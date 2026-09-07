import type { SeriesTemplate } from './generation-contract.mjs';
export const SERIES_PRESETS: Array<{ id: SeriesTemplate; label: string; tip: string; rule: string }>;
export function buildSeriesSplitPrompt(template: SeriesTemplate, count: number): string;
export function parseSeriesPlan(text: string, count: number): Array<{ title: string; prompt: string }>;
export function scenePrompt(input: { brief: string; prompt: string; index: number; count: number }): string;
