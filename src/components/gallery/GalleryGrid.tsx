import { ChevronLeft, ChevronRight, Download, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ResultRecord } from '../../types/generation';
import { buildDownloadName } from '../../lib/image/filename';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { Button } from '../ui/Button';

function hasValidTimestamp(timestamp: number) {
  return Number.isFinite(timestamp) && timestamp > 0;
}

function formatDateTime(timestamp: number) {
  if (!hasValidTimestamp(timestamp)) return '时间未记录';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function dateGroupLabel(timestamp: number) {
  if (!hasValidTimestamp(timestamp)) return '历史作品';
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDate = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  if (sameDate(date, today)) return '今天';
  if (sameDate(date, yesterday)) return '昨天';
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
  return groups;
}

function modeLabel(mode: ResultRecord['mode']) {
  if (mode === 'reference') return '参考生成';
  if (mode === 'edit') return '局部编辑';
  return '文生图';
}

export function GalleryGrid({ records, onClear, onDelete }: { records: ResultRecord[]; onClear: () => void; onDelete: (id: string) => void }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = useMemo(() => records.findIndex((record) => record.id === activeId), [activeId, records]);
  const activeRecord = activeIndex >= 0 ? records[activeIndex] : null;
  const groupedRecords = useMemo(() => groupRecordsByDate(records), [records]);
  const viewerRef = useFocusTrap<HTMLDivElement>(Boolean(activeRecord));

  function open(record: ResultRecord) {
    setActiveId(record.id);
  }

  function close() {
    setActiveId(null);
  }

  function move(direction: -1 | 1) {
    if (records.length === 0) return;
    const baseIndex = activeIndex >= 0 ? activeIndex : 0;
    const nextIndex = (baseIndex + direction + records.length) % records.length;
    setActiveId(records[nextIndex].id);
  }

  function download(record: ResultRecord) {
    const anchor = document.createElement('a');
    anchor.href = record.dataUrl;
    anchor.download = buildDownloadName(record.prompt, record.createdAt);
    anchor.click();
  }

  useEffect(() => {
    if (!activeRecord) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeRecord, activeIndex, records]);

  return (
    <div className="page-stack gallery-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">Gallery</span>
          <h1>展馆</h1>
        </div>
        <Button variant="ghost" onClick={onClear}>清空</Button>
      </div>

      {records.length === 0 ? (
        <div className="empty-state large">生成作品会收藏在这里.</div>
      ) : (
        <section className="gallery-stream" aria-label="生成作品记录流">
          {groupedRecords.map((group) => (
            <div className="gallery-day-group" key={group.label}>
              <div className="gallery-day-heading"><span>{group.label}</span><strong>{group.records.length} 张</strong></div>
              <div className="gallery-day-list">
                {group.records.map((record) => (
                  <article className="gallery-stream-card" key={record.id}>
                    <button className="stream-image-button" onClick={() => open(record)} aria-label="查看大图">
                      <img src={record.dataUrl} alt={record.prompt || '生成图片'} loading="lazy" />
                    </button>
                    <div className="stream-card-body">
                      <div className="stream-meta"><span>{formatDateTime(record.createdAt)}</span><span>{modeLabel(record.mode)}</span><span>{record.providerName || '自动调度'}</span></div>
                      <strong className="gallery-prompt" title={record.prompt || '无提示词'}>{record.prompt || '无提示词'}</strong>
                      <div className="gallery-actions">
                        <Button variant="ghost" onClick={() => open(record)}>查看大图</Button>
                        <Button variant="ghost" onClick={() => download(record)}><Download size={14} />下载</Button>
                        <Button variant="ghost" onClick={() => onDelete(record.id)}><Trash2 size={14} />删除</Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {activeRecord && (
        <div className="gallery-viewer" role="dialog" aria-modal="true" aria-label="图片预览">
          <button className="gallery-viewer-backdrop" onClick={close} aria-label="关闭预览" />
          <div ref={viewerRef} className="gallery-viewer-panel">
            <button className="viewer-close" onClick={close} aria-label="关闭"><X size={20} /></button>
            {records.length > 1 && <button className="viewer-nav prev" onClick={() => move(-1)} aria-label="上一张"><ChevronLeft size={24} /></button>}
            <img src={activeRecord.dataUrl} alt={activeRecord.prompt || '生成图片'} />
            {records.length > 1 && <button className="viewer-nav next" onClick={() => move(1)} aria-label="下一张"><ChevronRight size={24} /></button>}
            <div className="viewer-meta">
              <strong>{activeRecord.prompt || '无提示词'}</strong>
              <span>{activeIndex + 1} / {records.length} · {activeRecord.providerName || '自动调度'}</span>
              <div className="gallery-actions">
                <Button variant="secondary" onClick={() => download(activeRecord)}><Download size={14} />下载</Button>
                <Button variant="danger" onClick={() => { onDelete(activeRecord.id); close(); }}><Trash2 size={14} />删除</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
