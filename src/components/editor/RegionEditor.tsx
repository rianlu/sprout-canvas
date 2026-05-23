import type { MouseEvent } from 'react';
import type { RectSelection, RefImage } from '../../types/generation';
import { Button } from '../ui/Button';

interface RegionEditorProps {
  image: RefImage | null;
  selection: RectSelection | null;
  onSelectionChange: (selection: RectSelection | null) => void;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function RegionEditor({ image, selection, onSelectionChange }: RegionEditorProps) {
  function createSelection(event: MouseEvent<HTMLDivElement>) {
    if (!image) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const startX = clamp((event.clientX - bounds.left) / bounds.width);
    const startY = clamp((event.clientY - bounds.top) / bounds.height);
    const move = (moveEvent: globalThis.MouseEvent) => {
      const currentX = clamp((moveEvent.clientX - bounds.left) / bounds.width);
      const currentY = clamp((moveEvent.clientY - bounds.top) / bounds.height);
      onSelectionChange({
        x: Math.min(startX, currentX),
        y: Math.min(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  if (!image) return <div className="editor-empty">局部编辑需要先上传一张原图.</div>;
  return (
    <section className="region-editor">
      <div className="editor-toolbar"><span>拖拽框选要修改的区域</span><Button variant="ghost" onClick={() => onSelectionChange(null)}>清除选区</Button></div>
      <div className="editor-stage" onMouseDown={createSelection}>
        <img src={image.dataUrl} alt={image.name} draggable={false} />
        {selection && selection.width > 0 && selection.height > 0 && (
          <div className="selection-box" style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%` }} />
        )}
      </div>
    </section>
  );
}
