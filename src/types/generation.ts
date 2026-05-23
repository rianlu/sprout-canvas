import type { GenerationMode } from './provider';

export type StudioMode = 'text' | 'reference' | 'edit';
export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | 'auto';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high';

export interface RefImage {
  id: string;
  name: string;
  dataUrl: string;
  size: number;
}

export interface RectSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GenerationConfig {
  mode: StudioMode;
  generationMode: GenerationMode;
  imageModel: string;
  prompt: string;
  imageCount: number;
  aspectRatio: AspectRatio;
  requestSize: string;
  sizeHint: string;
  quality: ImageQuality;
  background: 'auto' | 'transparent' | 'opaque';
  outputFormat: 'auto' | 'png' | 'jpeg' | 'webp';
  outputCompression: number;
  refImages: RefImage[];
  editSelection?: RectSelection | null;
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
  createdAt: number;
}
