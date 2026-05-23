import { useEffect, useState } from 'react';
import { Upload, X } from 'lucide-react';
import type { RefImage } from '../../types/generation';
import { prepareImageFile } from '../../lib/image/compress';
import { formatBytes } from '../../lib/image/format';
import { randomId } from '../../lib/random/id';
import { Button } from '../ui/Button';

const MAX_REFS = 6;

export function ReferenceUploader({ images, onChange }: { images: RefImage[]; onChange: (images: RefImage[]) => void }) {
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!warning) return undefined;
    const timer = window.setTimeout(() => setWarning(null), 2500);
    return () => window.clearTimeout(timer);
  }, [warning]);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = Math.max(0, MAX_REFS - images.length);
    if (remaining === 0) {
      setWarning(`最多 ${MAX_REFS} 张参考图, 请先删除部分图`);
      return;
    }
    const limited = Array.from(files).slice(0, remaining);
    const dropped = files.length - limited.length;
    if (dropped > 0) setWarning(`已达上限, 仅保留前 ${limited.length} 张, 跳过 ${dropped} 张`);
    const next = [...images];
    for (const file of limited) {
      try {
        const prepared = await prepareImageFile(file);
        next.push({ id: randomId('ref'), ...prepared });
      } catch (error) {
        setWarning(error instanceof Error ? error.message : '参考图处理失败');
      }
    }
    onChange(next);
  }

  const atLimit = images.length >= MAX_REFS;
  return (
    <section className="upload-panel">
      <label className="dropzone" aria-disabled={atLimit}>
        <Upload size={22} />
        <strong>{atLimit ? `已达上限 ${MAX_REFS} 张` : '添加参考图'}</strong>
        <span>{atLimit ? '删除已有参考图后可继续添加' : `自动压缩, 当前 ${images.length}/${MAX_REFS}`}</span>
        <input type="file" accept="image/*" multiple disabled={atLimit} onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ''; }} />
      </label>
      {warning && <p className="error-text" role="status" aria-live="polite">{warning}</p>}
      {images.length > 0 && (
        <div className="thumb-grid">
          {images.map((image) => (
            <article key={image.id} className="thumb-card">
              <img src={image.dataUrl} alt={image.name} />
              <div><strong>{image.name}</strong><span>{formatBytes(image.size)}</span></div>
              <Button variant="ghost" onClick={() => onChange(images.filter((item) => item.id !== image.id))}><X size={14} /></Button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
