import type { GenerationConfig } from '../../types/generation';

/**
 * 当前两个中转都忽略 quality 与 output_format (见 docs/REAL_API_VALIDATION.md); 透明背景按通道 capabilities 启用.
 * 改为 false 后, 单图恢复精度与格式选择, 系列与单镜恢复质量选择; 服务端仍按请求原样转发, 不必改后端.
 */
export const LOCK_UNSUPPORTED_IMAGE_OPTIONS = true;

export const LOCKED_IMAGE_DEFAULTS: Pick<GenerationConfig, 'quality' | 'outputFormat'> = {
  quality: 'auto',
  outputFormat: 'png',
};
