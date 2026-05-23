import { Upload, X } from 'lucide-react';
import type { RefImage } from '../../types/generation';
import { prepareImageFile } from '../../lib/image/compress';
import { formatBytes } from '../../lib/image/format';
import { Button } from '../ui/Button';

export function ReferenceUploader({ images, onChange }: { images: RefImage[]; onChange: (images: RefImage[]) => void }) {
  async function addFiles(files: FileList | null) {
    if (!files) return;
    const next = [...images];
    for (const file of Array.from(files)) {
      const prepared = await prepareImageFile(file);
      next.push({ id: crypto.randomUUID(), ...prepared });
    }
    onChange(next);
  }

  return (
    <section className="upload-panel">
      <label className="dropzone">
        <Upload size={22} />
        <strong>添加参考图</strong>
        <span>自动压缩, 支持参考生成和局部编辑</span>
        <input type="file" accept="image/*" multiple onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ''; }} />
      </label>
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
