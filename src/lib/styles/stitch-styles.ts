import catalog from './catalog.json';

export interface StitchStyle {
  id: string; name: string; englishName: string; description: string; group: string; prompt: string; template: string;
  image: string; tags: string[]; eyebrow: string; icon: string; needsReference: boolean;
  source: { id: number; author: string; authorUrl: string; url: string; imageUrl: string; license: string };
}
export const STITCH_STYLES: StitchStyle[] = catalog.styles;
export const STITCH_STYLE_GROUPS = [...new Set(STITCH_STYLES.map((style) => style.group))];
export const STYLE_ATTRIBUTION = { source: catalog.source, originalSource: catalog.originalSource, license: catalog.license, sourceCount: catalog.sourceCount };
