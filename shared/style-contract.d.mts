export interface StyleInput {
  name?: string;
  prompt: string;
  author?: string;
  category?: string;
  sourceUrl?: string;
  published?: boolean;
  sortOrder?: number;
  imageDataUrl?: string;
  version?: number;
}
export interface StyleRecord {
  id: string;
  name: string;
  prompt: string;
  author: string;
  category: string;
  sourceUrl: string;
  published: boolean;
  sortOrder: number;
  image: string;
  imageBytes: number;
  imageWidth: number;
  imageHeight: number;
  license: string;
  licenseUrl: string;
  collectionUrl: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}
export interface StyleCatalog { styles: StyleRecord[]; categories: string[]; revision: number }
export interface StyleImportPreview { added: number; updated: number; unchanged: number; total: number; revision: number }
export const STYLE_LIMITS: Readonly<{ prompt: number; imageBytes: number; archiveBytes: number; entries: number }>;
export const STYLE_ARCHIVE_FORMAT: 'sprout-canvas-styles';
export const STYLE_ID: RegExp;
export const STYLE_IMAGE_FILE: RegExp;
export function validateStyleInput(input: unknown): Required<Pick<StyleInput, 'name' | 'prompt' | 'author' | 'category' | 'sourceUrl' | 'published' | 'sortOrder'>>;
