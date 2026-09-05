import type { GenerationConfig, ImageSizeTier, RefImage } from '../../types/generation';
import { prepareImageDataUrl } from '../image/compress';

const SIZE_BY_TIER_AND_RATIO: Record<ImageSizeTier, Record<string, { size: string; hint: string }>> = {
  '1K': {
    '1:1': { size: '1024x1024', hint: '画面比例 1:1.' },
    '16:9': { size: '1280x720', hint: '画面比例 16:9.' },
    '9:16': { size: '720x1280', hint: '画面比例 9:16.' },
    '4:3': { size: '1024x768', hint: '画面比例 4:3.' },
    '3:4': { size: '768x1024', hint: '画面比例 3:4.' },
    '3:2': { size: '1536x1024', hint: '画面比例 3:2.' },
    '2:3': { size: '1024x1536', hint: '画面比例 2:3.' },
    '21:9': { size: '1280x544', hint: '画面比例 21:9.' },
    auto: { size: 'auto', hint: '' },
  },
  '2K': {
    '1:1': { size: '2048x2048', hint: '画面比例 1:1.' },
    '16:9': { size: '2560x1440', hint: '画面比例 16:9.' },
    '9:16': { size: '1440x2560', hint: '画面比例 9:16.' },
    '4:3': { size: '2048x1536', hint: '画面比例 4:3.' },
    '3:4': { size: '1536x2048', hint: '画面比例 3:4.' },
    '3:2': { size: '2160x1440', hint: '画面比例 3:2.' },
    '2:3': { size: '1440x2160', hint: '画面比例 2:3.' },
    '21:9': { size: '2560x1088', hint: '画面比例 21:9.' },
    auto: { size: 'auto', hint: '' },
  },
  '4K': {
    '1:1': { size: '2880x2880', hint: '画面比例 1:1.' },
    '16:9': { size: '3840x2160', hint: '画面比例 16:9.' },
    '9:16': { size: '2160x3840', hint: '画面比例 9:16.' },
    '4:3': { size: '3200x2400', hint: '画面比例 4:3.' },
    '3:4': { size: '2400x3200', hint: '画面比例 3:4.' },
    '3:2': { size: '3456x2304', hint: '画面比例 3:2.' },
    '2:3': { size: '2304x3456', hint: '画面比例 2:3.' },
    '21:9': { size: '3840x1600', hint: '画面比例 21:9.' },
    auto: { size: 'auto', hint: '' },
  },
};

export function resolveSize(aspectRatio: string, sizeTier: ImageSizeTier = '1K') {
  const tierMap = SIZE_BY_TIER_AND_RATIO[sizeTier] || SIZE_BY_TIER_AND_RATIO['1K'];
  return tierMap[aspectRatio] || tierMap['1:1'];
}

export function formatRequestSize(size: string) {
  return size === 'auto' ? '自动尺寸' : size.replace('x', '×');
}

export function sizeTierLabel(sizeTier: ImageSizeTier) {
  if (sizeTier === '2K') return '高清 2K';
  if (sizeTier === '4K') return '超清 4K';
  return '标准 1K';
}

export function qualityLabel(quality: GenerationConfig['quality']) {
  if (quality === 'low') return '快速';
  if (quality === 'medium') return '标准';
  if (quality === 'high') return '精细';
  return '自动';
}

export async function buildGenerationPayload(config: GenerationConfig, maskFactory?: (imageDataUrl: string) => Promise<string>) {
  const suffix = config.sizeHint ? `\n${config.sizeHint}` : '';
  const payload: Record<string, unknown> = {
    model: config.imageModel,
    prompt: `${config.prompt}${suffix}`,
    n: 1,
    moderation: 'low',
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
    if (maskFactory) {
      const refs = payload.ref_images as Array<{ name: string; image_url: string; mask_url?: string }>;
      refs[0].mask_url = await maskFactory(preparedRefs[0].dataUrl);
    }
  }
  return payload;
}
