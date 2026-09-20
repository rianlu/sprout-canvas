export const MIN_SERIES_COUNT: number;
export const MAX_SERIES_COUNT: number;
export const MAX_SERIES_BRIEF_LENGTH: number;
export const MAX_SCENE_PROMPT_LENGTH: number;
export function buildSeriesSplitPrompt(count: number): string;
export function parseSeriesPlan(text: string, count: number): Array<{ title: string; prompt: string }>;
export function scenePrompt(input: { brief: string; prompt: string; index: number; count: number; referenceCount?: number; hasContinuityReference?: boolean }): string;
