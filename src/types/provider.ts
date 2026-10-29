export type GenerationMode = 'images' | 'responses';
export type ImageFormat = 'png' | 'jpeg' | 'webp';
/** What one channel accepts; a request must fit a single channel, never a mix of several. */
export interface ChannelCapabilities { customSizes: boolean; transparent: boolean; formats: ImageFormat[] }
export interface ImageCapabilities {
  customSizes: boolean;
  formats: ImageFormat[];
  exactSize: boolean;
  maxReferences: number;
  /** Channels in the current model scope; absent before the provider list is known. */
  channels?: ChannelCapabilities[];
}

export interface ImageProvider {
  id: string;
  /** Channel name and upstream model; absent for visitors, who only see `modelName`. */
  name?: string;
  imageModel?: string;
  /** Selector group; channels sharing it serve the same model. */
  modelName?: string;
  generationMode: GenerationMode;
  capabilities?: { outputFormats: ImageFormat[]; exactSize: boolean; transparent: boolean; customSizes?: boolean };
}

/** Signed-in sessions get every field; visitors get `baseUrl`, `providers` and `imageCapabilities` only. */
export interface ServerConfig {
  baseUrl: string;
  activeProvider?: string;
  defaultProvider?: string;
  defaultImageProvider?: string;
  keyConfigured?: boolean;
  textModel?: string;
  textProviderName?: string;
  textProviderCount?: number;
  imageModel?: string;
  generationMode?: GenerationMode;
  providers: ImageProvider[];
  imageChannels?: ChannelHealth[];
  textChannels?: ChannelHealth[];
  imageCapabilities?: ImageCapabilities;
}

export interface ChannelHealth { id: string; name: string; model?: string; status: 'available' | 'untested' | 'degraded' | 'cooldown'; failures: number; openUntil: number; lastSuccessAt: number }
