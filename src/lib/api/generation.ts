import { MAX_REFERENCE_BYTES, type GenerationRequest } from '../../../shared/generation-contract.mjs';
import type { GenerationConfig, ImageSizeTier, RefImage } from '../../types/generation';
import { prepareImageDataUrl } from '../image/compress';
import { dataUrlToBlob } from '../image/data-url';

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

export function sizePreset(size: string): Pick<GenerationConfig, 'aspectRatio' | 'sizeTier'> {
  for (const sizeTier of ['1K', '2K', '4K'] as const) {
    for (const [aspectRatio, preset] of Object.entries(SIZE_BY_TIER_AND_RATIO[sizeTier])) {
      if (preset.size === size) return { aspectRatio: aspectRatio as GenerationConfig['aspectRatio'], sizeTier };
    }
  }
  const dimensions = /^(\d+)x(\d+)$/.exec(size);
  if (dimensions) {
    const width = Number(dimensions[1]), height = Number(dimensions[2]);
    const ratio = Object.keys(SIZE_BY_TIER_AND_RATIO['1K']).find((value) => {
      const [w, h] = value.split(':').map(Number);
      return h > 0 && Math.abs(width / height - w / h) < 0.02;
    });
    return { aspectRatio: (ratio || 'auto') as GenerationConfig['aspectRatio'], sizeTier: Math.max(width, height) > 2560 ? '4K' : Math.max(width, height) > 1600 ? '2K' : '1K' };
  }
  return { aspectRatio: 'auto', sizeTier: '1K' };
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

export async function buildGenerationPayload(config: GenerationConfig, maskFactory?: (imageDataUrl: string) => Promise<string>): Promise<GenerationRequest> {
  const preparedRefs = await Promise.all(config.refImages.map(async (ref: RefImage) => {
    if (config.mode === 'edit') {
      const blob = dataUrlToBlob(ref.dataUrl);
      if (blob.size > MAX_REFERENCE_BYTES) throw new Error('局部重绘原图超过 12 MiB, 请先在本地缩小文件后重新上传');
      return { ...ref, size: blob.size };
    }
    return { ...ref, ...(await prepareImageDataUrl(ref.name, ref.dataUrl, ref.size)) };
  }));
  const request: GenerationRequest = {
    prompt: config.prompt,
    size: config.requestSize,
    quality: config.quality,
    background: config.background,
    outputFormat: config.outputFormat === 'auto' ? 'png' : config.outputFormat,
    outputCompression: config.outputCompression,
    references: preparedRefs.map((ref) => ({ id: ref.id, name: ref.name, dataUrl: ref.dataUrl, ...(ref.recordId ? { recordId: ref.recordId } : {}) })),
  };
  if (maskFactory && preparedRefs.length) request.mask = await maskFactory(preparedRefs[0].dataUrl);
  return request;
}
