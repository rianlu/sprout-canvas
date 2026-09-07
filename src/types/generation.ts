import type { GenerationMode } from './provider';
import type { GenerationRecipe, SeriesTemplate } from '../../shared/generation-contract.mjs';
export type { GenerationRecipe, SeriesTemplate } from '../../shared/generation-contract.mjs';

export type StudioMode = 'text' | 'reference' | 'edit';
export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' | '21:9' | 'auto';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high';
export type ImageSizeTier = '1K' | '2K' | '4K';
export type ImageOutputFormat = 'auto' | 'png' | 'jpeg' | 'webp';

export interface RefImage {
  id: string;
  name: string;
  dataUrl: string;
  size: number;
  recordId?: string;
}

export interface GenerationConfig {
  mode: StudioMode;
  generationMode: GenerationMode;
  imageModel: string;
  prompt: string;
  imageCount: number;
  aspectRatio: AspectRatio;
  sizeTier: ImageSizeTier;
  requestSize: string;
  sizeHint: string;
  quality: ImageQuality;
  background: 'auto' | 'transparent' | 'opaque';
  outputFormat: ImageOutputFormat;
  outputCompression: number;
  refImages: RefImage[];
}

export type ResultKind = 'single' | 'series';

export interface ResultRecord {
  id: string;
  prompt: string;
  dataUrl: string;
  providerId: string;
  providerName: string;
  mode: StudioMode;
  kind: ResultKind;
  outputFormat?: ImageOutputFormat;
  createdAt: number;
  jobId?: string;
  requestId?: string;
  width?: number;
  height?: number;
  bytes?: number;
  previewOnly?: boolean;
  recipe?: GenerationRecipe;
  revisedPrompt?: string;
  sceneId?: string;
  sceneIndex?: number;
  version?: number;
  parentId?: string;
  template?: SeriesTemplate;
  /** 系列聚合 (v3.5): 同一 seriesId 的记录在展馆归为一张叠层卡 */
  seriesId?: string;
  /** 系列主提示词 (世界观) */
  masterPrompt?: string;
}
