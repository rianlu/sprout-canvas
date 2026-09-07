export type GenerationMode = 'images' | 'responses';
export interface ImageCapabilities { customSizes: boolean; formats: Array<'png' | 'jpeg' | 'webp'>; exactSize: boolean; maxReferences: number }

export interface ImageProvider {
  id: string;
  name: string;
  imageModel: string;
  generationMode: GenerationMode;
}

export interface ServerConfig {
  baseUrl: string;
  activeProvider: string;
  defaultProvider: string;
  defaultImageProvider: string;
  keyConfigured: boolean;
  textModel: string;
  textProviderName: string;
  textProviderCount: number;
  imageModel: string;
  generationMode: GenerationMode;
  providers: ImageProvider[];
  imageChannels?: ChannelHealth[];
  textChannels?: ChannelHealth[];
  imageCapabilities?: ImageCapabilities;
}

export interface ChannelHealth { id: string; name: string; model?: string; status: 'available' | 'untested' | 'degraded' | 'cooldown'; failures: number; openUntil: number; lastSuccessAt: number }
