import type { RefImage } from '../../types/generation';
import { ImagePreviewDialog } from './ImagePreviewDialog';

interface Props {
  references: RefImage[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function ReferenceImagePreview({ references, selectedId, onSelect, onClose }: Props) {
  const index = references.findIndex((reference) => reference.id === selectedId);
  const reference = references[index];
  if (!reference) return null;
  const select = (delta: number) => {
    const next = references[index + delta];
    return next ? () => onSelect(next.id) : undefined;
  };
  return <ImagePreviewDialog
    label="参考图预览"
    title={`参考图 ${index + 1}`}
    subtitle={reference.name}
    imageKey={reference.id}
    src={reference.dataUrl}
    alt={`参考图 ${index + 1} 原图`}
    position={{ index, count: references.length }}
    onPrevious={select(-1)}
    onNext={select(1)}
    previousLabel="上一张参考图"
    nextLabel="下一张参考图"
    closeLabel="关闭参考图预览"
    onClose={onClose}
  />;
}
