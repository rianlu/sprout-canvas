import type { GenerationConfig, RefImage } from '../../types/generation';
import { prepareImageDataUrl } from '../image/compress';

const SIZE_BY_RATIO: Record<string, { size: string; hint: string }> = {
  '1:1': { size: '1024x1024', hint: '画面比例 1:1.' },
  '16:9': { size: '1536x1024', hint: '画面比例 16:9.' },
  '9:16': { size: '1024x1536', hint: '画面比例 9:16.' },
  '4:3': { size: '1536x1024', hint: '画面比例 4:3.' },
  '3:4': { size: '1024x1536', hint: '画面比例 3:4.' },
  auto: { size: 'auto', hint: '' },
};

export function resolveSize(aspectRatio: string) {
  return SIZE_BY_RATIO[aspectRatio] || SIZE_BY_RATIO['1:1'];
}

export async function buildGenerationPayload(config: GenerationConfig, maskFactory?: (imageDataUrl: string) => Promise<string>) {
  const suffix = config.sizeHint ? `\n${config.sizeHint}` : '';
  const payload: Record<string, unknown> = {
    model: config.imageModel,
    prompt: `${config.prompt}${suffix}`,
    n: 1,
  };
  if (config.requestSize !== 'auto') payload.size = config.requestSize;
  if (config.quality !== 'auto') payload.quality = config.quality;
  if (config.background !== 'auto') payload.background = config.background;
  if (config.outputFormat !== 'auto') payload.output_format = config.outputFormat;
  if (config.outputFormat === 'jpeg' || config.outputFormat === 'webp') payload.output_compression = config.outputCompression;
  const preparedRefs = config.refImages.length
    ? await Promise.all(config.refImages.map(async (ref: RefImage) => ({ ...ref, ...(await prepareImageDataUrl(ref.name, ref.dataUrl, ref.size)) })))
    : [];
  if (preparedRefs.length) {
    payload.ref_images = preparedRefs.map((ref: RefImage) => ({ name: ref.name, image_url: ref.dataUrl }));
  }
  if (config.mode === 'edit' && config.editSelection) {
    payload.edit_selection = config.editSelection;
    if (maskFactory && preparedRefs[0]) {
      const refs = payload.ref_images as Array<{ name: string; image_url: string; mask_url?: string }>;
      refs[0].mask_url = await maskFactory(preparedRefs[0].dataUrl);
    }
  }
  return payload;
}
