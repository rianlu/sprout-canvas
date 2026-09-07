import type { HTMLAttributes } from 'react';
import { StitchIcon } from './StitchIcon';

interface IconProps extends HTMLAttributes<HTMLSpanElement> {
  size?: number;
}
export type StitchIconComponent = (props: IconProps) => React.JSX.Element;
const icon = (name: string): StitchIconComponent =>
  function Icon(props) {
    return <StitchIcon name={name} {...props} />;
  };

export const Brush = icon('brush');
export const CircleCheck = icon('check_circle');
export const Download = icon('download');
export const Eraser = icon('delete_sweep');
export const Layers = icon('layers');
export const Leaf = icon('spa');
export const Lightbulb = icon('edit_note');
export const Maximize2 = icon('fullscreen');
export const Plus = icon('add');
export const RefreshCw = icon('refresh');
export const Scissors = icon('content_cut');
export const Sparkles = icon('auto_awesome');
export const Undo2 = icon('undo');
export const Wand2 = icon('magic_button');
export const X = icon('close');
export const BookOpenText = icon('menu_book');
export const Minus = icon('remove');
export const Trash2 = icon('delete');
export const ZoomIn = icon('zoom_in');
export const Copy = icon('content_copy');
export const Palette = icon('palette');
export const Search = icon('search');
export const ChevronLeft = icon('chevron_left');
export const ChevronRight = icon('chevron_right');
export const Images = icon('photo_library');
export const CircleUserRound = icon('person');
export const LoaderCircle = icon('progress_activity');
export const CircleAlert = icon('error');
export const Info = icon('info');
export const RotateCcw = icon('undo');
export const Grid2X2 = icon('grid_view');
