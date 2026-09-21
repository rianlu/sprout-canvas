import type { GenerationConfig } from '../../types/generation';

/**
 * 当前默认网关会忽略 quality、output_format、background。
 * 改为 false 后，单图页恢复这三项选择；服务端仍按请求原样转发，不必改后端。
 */
export const LOCK_UNSUPPORTED_IMAGE_OPTIONS = true;

export const LOCKED_IMAGE_DEFAULTS: Pick<GenerationConfig, 'quality' | 'outputFormat' | 'background'> = {
  quality: 'auto',
  outputFormat: 'png',
  background: 'auto',
};
