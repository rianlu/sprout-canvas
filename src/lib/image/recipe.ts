import type { GenerationConfig, RefImage, ResultRecord } from '../../types/generation';
import { GENERATION_DEFAULTS } from '../../../shared/generation-contract.mjs';
import type { BrushMaskData } from '../editor/brush-mask';
import { blobDataUrl, getArtifact, getRecordDataUrl } from '../storage/gallery-db';
import { resolveSize, sizePreset } from '../api/generation';
import { imageFileExtension } from './format';
import type { PromptHistory } from '../prompt-history';

export interface StudioDraft {
  config?: Partial<GenerationConfig>;
  styleId?: string;
  styleName?: string;
  refImage?: RefImage | null;
  sourceRecord?: ResultRecord | null;
  mask?: BrushMaskData | null;
  maskDataUrl?: string;
  tone?: 'soft' | 'vivid' | 'none';
  promptHistory?: PromptHistory | null;
}

/** Edit the selected output, retaining its recipe without reusing earlier references or masks. */
export function imageEditConfig(source?: ResultRecord | null): Partial<GenerationConfig> {
  const recipe = source?.recipe;
  const size = recipe?.size || 'auto';
  const preset = sizePreset(size);
  return {
    mode: 'edit', prompt: '', imageCount: 1, refImages: [],
    ...preset, requestSize: size, sizeHint: resolveSize(preset.aspectRatio, preset.sizeTier).hint,
    quality: recipe?.quality || GENERATION_DEFAULTS.quality,
    outputFormat: recipe?.outputFormat || GENERATION_DEFAULTS.outputFormat,
    background: recipe?.background || GENERATION_DEFAULTS.background,
    outputCompression: recipe?.outputCompression ?? GENERATION_DEFAULTS.outputCompression,
    imageModel: recipe?.model || '', generationMode: recipe?.generationMode === 'responses' ? 'responses' : 'images',
  };
}

export async function sourceImageDraft(record: ResultRecord, edit = false): Promise<StudioDraft> {
  const dataUrl = await getRecordDataUrl(record);
  return {
    styleId: 'default', styleName: '',
    refImage: { id: record.id, recordId: record.id, name: `作品-${record.id.slice(-4)}.${imageFileExtension(dataUrl)}`, dataUrl, size: record.bytes || 0 },
    sourceRecord: { ...record, dataUrl: '' },
    config: edit ? imageEditConfig(record) : { mode: 'reference', prompt: '', refImages: [], imageCount: 1 },
    mask: null, maskDataUrl: '', tone: 'none',
  };
}

export async function recipeDraft(record: ResultRecord) {
  const recipe = record.recipe;
  if (!recipe) throw new Error('这张历史作品未保存完整配方');
  const refImages: RefImage[] = [];
  for (const ref of recipe.references) {
    const blob = await getArtifact(`ref-${ref.id}`) || (ref.recordId ? await getArtifact(ref.recordId) : undefined);
    if (!blob) throw new Error(`参考图 ${ref.name} 已不存在, 无法完整复用此配方`);
    refImages.push({ ...ref, dataUrl: await blobDataUrl(blob), size: blob.size });
  }
  let maskDataUrl = '';
  if (recipe.hasMask && record.requestId) {
    const blob = await getArtifact(`mask-${record.requestId}`);
    if (!blob) throw new Error('原始蒙版已不存在, 无法完整复用此配方');
    maskDataUrl = await blobDataUrl(blob);
  }
  const { aspectRatio, sizeTier } = sizePreset(recipe.size);
  const config: Partial<GenerationConfig> = { prompt: record.mode === 'edit' ? record.prompt : recipe.prompt, quality: recipe.quality, outputFormat: recipe.outputFormat, background: recipe.background, outputCompression: recipe.outputCompression, requestSize: recipe.size, aspectRatio, sizeTier, sizeHint: resolveSize(aspectRatio, sizeTier).hint, refImages, imageCount: 1, mode: record.mode };
  return { config, styleId: 'default', styleName: '', refImage: refImages[0] || null, sourceRecord: null, mask: null, maskDataUrl, tone: 'none' as const };
}
