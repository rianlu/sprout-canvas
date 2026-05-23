export type GenerationMode = 'images' | 'responses';

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
}
