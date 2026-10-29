import { MAX_REFERENCE_IMAGES } from '../../../shared/generation-contract.mjs';
import type { ImageCapabilities, ImageFormat, ServerConfig } from '../../types/provider';

/** Distinct models in channel order; the selector only appears when there is more than one. */
export function imageModels(config?: ServerConfig | null): string[] {
  return [...new Set((config?.providers || []).map((provider) => provider.modelName || provider.imageModel).filter((name): name is string => Boolean(name)))];
}

/**
 * Capabilities of the channels serving `modelName` (all channels when empty). Falls back to the
 * server summary for responses that predate per-channel capabilities.
 */
export function modelCapabilities(config?: ServerConfig | null, modelName = ''): ImageCapabilities | undefined {
  const summary = config?.imageCapabilities;
  if (!summary) return undefined;
  const providers = (config.providers || []).filter((provider) => provider.capabilities && (!modelName || (provider.modelName || provider.imageModel) === modelName));
  if (!providers.length) return modelName ? undefined : summary;
  const channels = providers.map((provider) => ({
    customSizes: provider.capabilities!.customSizes === true,
    transparent: provider.capabilities!.transparent,
    formats: provider.capabilities!.outputFormats.filter((format): format is ImageFormat => ['png', 'jpeg', 'webp'].includes(format)),
  }));
  return {
    customSizes: channels.some((channel) => channel.customSizes),
    formats: [...new Set(channels.flatMap((channel) => channel.formats))],
    exactSize: providers.every((provider) => provider.capabilities!.exactSize),
    maxReferences: summary.maxReferences ?? MAX_REFERENCE_IMAGES,
    channels,
  };
}
