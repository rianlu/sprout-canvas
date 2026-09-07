import { STITCH_STYLES, type StitchStyle } from './stitch-styles';

export function findImageStyle(id: string): StitchStyle | undefined { return STITCH_STYLES.find((style) => style.id === id); }
export function applyAnyImageStyleToPrompt(prompt: string, style?: StitchStyle | null): string {
  return style ? `${prompt.trim()}\n\n画风指导: ${style.prompt}\n以本次画面内容为主体, 保持上述材质, 光影与构图语言.` : prompt.trim();
}
