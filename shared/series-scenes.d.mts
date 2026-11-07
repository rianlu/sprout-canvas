export type SeriesScene = 'general' | 'ecommerce-main' | 'ecommerce-detail' | 'character';
export interface ScenePreset { label: string; count: number; aspects: string[]; hint: string; placeholder: string; sampleLabel: string; sample: string }
export interface SceneTask { title: string; prompt: string; note?: string }
export interface SceneIssue { index: number; reason: string }
export interface ChatMessage { role: 'system' | 'user'; content: string }
export interface PlanningInput { scene?: string; count: number; content: string; referenceCount?: number }
export const SERIES_SCENES: readonly SeriesScene[];
export const SCENE_PRESETS: Readonly<Record<SeriesScene, ScenePreset>>;
export function normalizeScene(scene: unknown): SeriesScene;
export function mentionsReference(content: string): boolean;
export function referenceInstruction(referenceCount: number | undefined, content?: string): string;
export function planningMessages(input: PlanningInput): ChatMessage[];
export function parseScene(scene: string | undefined, text: string, count: number): { raw: unknown; tasks: SceneTask[] };
export function composeShot(scene: SeriesScene, raw: unknown, shot: unknown): string;
export function reviewScene(scene: string | undefined, raw: unknown, referenceCount?: number): SceneIssue[];
export function rewriteMessages(input: PlanningInput, raw: unknown, issues: SceneIssue[]): ChatMessage[];
