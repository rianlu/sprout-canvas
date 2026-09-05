import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Images, Trash2, X } from 'lucide-react';
import type { ResultRecord } from '../../types/generation';
import { buildDownloadName } from '../../lib/image/filename';
import { imageFileExtension } from '../../lib/image/format';
import { useFocusTrap } from '../../hooks/useFocusTrap';

function hasValidTimestamp(timestamp: number) {
  return Number.isFinite(timestamp) && timestamp > 0;
}

function formatTime(timestamp: number) {
  if (!hasValidTimestamp(timestamp)) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function dateGroupLabel(timestamp: number) {
  if (!hasValidTimestamp(timestamp)) return '更早';
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date();
  weekAgo.setDate(today.getDate() - 7);
  const sameDate = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  if (sameDate(date, today)) return '今日';
  if (sameDate(date, yesterday)) return '昨日';
  if (date >= weekAgo) return '近 7 天';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function groupRecordsByDate(records: ResultRecord[]) {
  const groups: Array<{ label: string; records: ResultRecord[] }> = [];
  for (const record of records) {
    const label = dateGroupLabel(record.createdAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.records.push(record);
    else groups.push({ label, records: [record] });
  }
  // 归并「近 7 天」跨组
  return groups.reduce<Array<{ label: string; records: ResultRecord[] }>>((acc, group) => {
    const last = acc[acc.length - 1];
    if (last?.label === group.label) last.records.push(...group.records);
    else acc.push(group);
    return acc;
  }, []);
}

function modeLabel(mode: ResultRecord['mode']) {
  if (mode === 'reference') return '参考生成';
  if (mode === 'edit') return '局部编辑';
  return '文生图';
}

function downloadRecord(record: ResultRecord) {
  const anchor = document.createElement('a');
  anchor.href = record.dataUrl;
  anchor.download = buildDownloadName(record.prompt, record.createdAt, imageFileExtension(record.dataUrl, record.outputFormat));
  anchor.click();
}

interface GalleryGridProps {
  records: ResultRecord[];
  onClear: () => void;
  onDelete: (id: string) => void;
}

export function GalleryGrid({ records, onClear, onDelete }: GalleryGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const activeIndex = useMemo(() => records.findIndex((record) => record.id === activeId), [activeId, records]);
  const activeRecord = activeIndex >= 0 ? records[activeIndex] : null;
  const groupedRecords = useMemo(() => groupRecordsByDate(records), [records]);
  const viewerRef = useFocusTrap<HTMLDivElement>(Boolean(activeRecord));
  const move = useCallback((direction: -1 | 1) => {
    if (records.length === 0) return;
    const baseIndex = activeIndex >= 0 ? activeIndex : 0;
    const nextIndex = (baseIndex + direction + records.length) % records.length;
    setActiveId(records[nextIndex].id);
  }, [activeIndex, records]);

  const clearDialogRef = useFocusTrap<HTMLDivElement>(confirmClear);

  useEffect(() => {
    if (!confirmClear) return undefined;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setConfirmClear(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmClear]);

  useEffect(() => {
    if (!activeRecord) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setActiveId(null);
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeRecord, move, records]);

  return (
    <div className="page-stack">
      <header className="page-head">
        <div className="page-head-copy">
          <h1>展馆</h1>
          <p>本地保存的作品 · {records.length} 张 · 不上传云端</p>
        </div>
        <button type="button" className="btn btn-danger" disabled={records.length === 0} onClick={() => setConfirmClear(true)}>
          <Trash2 size={14} aria-hidden="true" />清空全部
        </button>
      </header>

      {records.length === 0 ? (
        <div className="empty-state" style={{ minHeight: 320 }}>
          <Images className="empty-icon" size={28} aria-hidden="true" />
          <strong>展馆还没有作品</strong>
          <span>生成的图片会自动保存在这里 (仅此浏览器)</span>
        </div>
      ) : (
        <div>
          {groupedRecords.map((group) => (
            <section className="gallery-day-group" key={group.label} aria-label={group.label}>
              <div className="gallery-day-heading">
                <h2>{group.label}</h2>
                <span className="chip">{group.records.length} 张</span>
              </div>
              <div className="gallery-stream-grid">
                {group.records.map((record) => (
                  <article className="gallery-card" key={record.id}>
                    <button type="button" className="gallery-card-figure" onClick={() => setActiveId(record.id)} aria-label={`查看 ${record.prompt || '作品'}`}>
                      <img src={record.dataUrl} alt={record.prompt || '生成图片'} loading="lazy" />
                    </button>
                    <div className="gallery-card-body">
                      <p className="prompt-line" title={record.prompt || '无提示词'}>{record.prompt || '无提示词'}</p>
                      <div className="meta-row">
                        <span className="chip">{formatTime(record.createdAt)}</span>
                        <span className="chip">{modeLabel(record.mode)}</span>
                        {record.kind === 'series' && <span className="chip chip-accent">系列</span>}
                      </div>
                      <div className="card-actions">
                        <button type="button" className="link-btn" onClick={() => downloadRecord(record)}><Download size={13} aria-hidden="true" />下载</button>
                        <button type="button" className="link-btn danger" onClick={() => onDelete(record.id)}><Trash2 size={13} aria-hidden="true" />删除</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {activeRecord && (
        <div className="gallery-viewer-overlay" role="dialog" aria-modal="true" aria-label="图片预览">
          <button type="button" className="backdrop" onClick={() => setActiveId(null)} aria-label="关闭预览" />
          <div ref={viewerRef} className="gallery-viewer-panel">
            <button type="button" className="viewer-close" onClick={() => setActiveId(null)} aria-label="关闭"><X size={18} /></button>
            {records.length > 1 && <button type="button" className="viewer-nav prev" onClick={() => move(-1)} aria-label="上一张"><ChevronLeft size={22} /></button>}
            <div className="gallery-viewer-media">
              <img src={activeRecord.dataUrl} alt={activeRecord.prompt || '生成图片'} />
            </div>
            {records.length > 1 && <button type="button" className="viewer-nav next" onClick={() => move(1)} aria-label="下一张"><ChevronRight size={22} /></button>}
            <div className="gallery-viewer-meta">
              <p className="meta-prompt">{activeRecord.prompt || '无提示词'}</p>
              <div className="meta-chips">
                <span className="chip">{activeIndex + 1} / {records.length}</span>
                <span className="chip">{modeLabel(activeRecord.mode)}</span>
                {activeRecord.kind === 'series' && <span className="chip chip-accent">系列</span>}
              </div>
              <div className="viewer-actions">
                <button type="button" className="btn" onClick={() => downloadRecord(activeRecord)}><Download size={14} aria-hidden="true" />下载</button>
                <button type="button" className="btn btn-danger" onClick={() => { onDelete(activeRecord.id); setActiveId(null); }}><Trash2 size={14} aria-hidden="true" />删除</button>
              </div>
              <span className="viewer-hint">ESC 关闭 · ← → 切换</span>
            </div>
          </div>
        </div>
      )}

      {confirmClear && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="确认清空展馆">
          <button type="button" className="backdrop" onClick={() => setConfirmClear(false)} aria-label="取消" />
          <div ref={clearDialogRef} className="modal-panel">
            <div className="modal-head">
              <h2>清空展馆</h2>
              <button type="button" className="icon-btn" onClick={() => setConfirmClear(false)} aria-label="关闭"><X size={16} /></button>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 'var(--fs-body-sm)' }}>
              将删除全部 {records.length} 张作品, 仅影响本浏览器, 此操作无法撤销.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setConfirmClear(false)}>取消</button>
              <button type="button" className="btn btn-danger" onClick={() => { onClear(); setConfirmClear(false); }}>确认清空</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
