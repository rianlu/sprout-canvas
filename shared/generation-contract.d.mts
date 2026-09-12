import type { CreditQuote } from './credits-contract.mjs';
export interface GenerationReference { id: string; name: string; dataUrl: string; recordId?: string }
export interface GenerationRequest {
  prompt: string;
  size: string;
  quality: 'auto' | 'low' | 'medium' | 'high';
  outputFormat: 'png' | 'jpeg' | 'webp';
  background: 'auto' | 'opaque' | 'transparent';
  outputCompression: number;
  references: GenerationReference[];
  mask?: string;
}
export type SeriesTemplate = 'picture-book' | 'ecommerce' | 'video-board' | 'brand-ip';
export interface GenerationContext {
  kind: 'single' | 'series'; placeholderId: string; prompt: string; mode: 'text' | 'reference' | 'edit';
  seriesId?: string; masterPrompt?: string; sceneId?: string; sceneIndex?: number; version?: number;
  parentId?: string; template?: SeriesTemplate; styleId?: string; styleName?: string; tone?: string; batchId?: string;
}
export interface GenerationSubmission { requestId: string; request: GenerationRequest; clientContext: GenerationContext; providerId?: string; referenceJobId?: string; referenceImage?: GenerationReference; retryOf?: string; creditQuote?: CreditQuote }
export interface GenerationRecipe extends Omit<GenerationRequest, 'references' | 'mask'> {
  version: 1; model: string; providerId: string; providerName: string; generationMode: string;
  styleId: string; styleName: string; tone: string;
  references: Omit<GenerationReference, 'dataUrl'>[]; hasMask: boolean; referenceJobId?: string;
}
export const GENERATION_DEFAULTS: Readonly<Pick<GenerationRequest, 'size' | 'quality' | 'outputFormat' | 'background' | 'outputCompression'>>;
export const IMAGE_SIZES: readonly string[];
export const SERIES_TEMPLATES: readonly SeriesTemplate[];
export const MAX_PROMPT_LENGTH: number;
export const MAX_REFERENCE_BYTES: number;
export function validateGenerationSubmission(input: unknown): GenerationSubmission;
export function generationRecipe(input: GenerationSubmission, provider?: { imageModel?: string; id?: string; name?: string; generationMode?: string }): GenerationRecipe;
export function toImagesPayload(input: GenerationSubmission): Record<string, unknown>;
export function requestError(message: string, statusCode?: number): Error & { statusCode: number };
export function validateImageSize(size: string): string;
