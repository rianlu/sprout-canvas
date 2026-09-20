import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ResultRecord } from '../../types/generation';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useImageMetadata } from '../../hooks/useImageMetadata';
import {
  cardRecords,
  cardTimestamp,
  cardTitle,
  copyRecordImage,
  downloadRecord,
  downloadRecords,
  supportsFileSharing,
  shareRecords,
  type GalleryCard,
  type SeriesCard,
} from '../../lib/image/gallery';
import { imageFileExtension } from '../../lib/image/format';
import { useOriginalImage } from '../../hooks/useOriginalImage';
import { StitchIcon } from '../ui/StitchIcon';
import { RecordImage } from './RecordImage';
import { ImageViewport } from './ImageViewport';

interface ViewerProps {
  cards: GalleryCard[];
  initialIndex: number;
  initialSceneIndex?: number;
  onClose: () => void;
  onUseAsRef: (record: ResultRecord) => void;
  onEditRecord?: (record: ResultRecord) => void;
  onUseRecipe?: (record: ResultRecord) => void;
  onUseSeries?: (card: SeriesCard) => void;
  onSplit?: (record: ResultRecord) => void;
  onNotify: (type: 'info' | 'success' | 'error', message: string) => void;
}

export function StitchGalleryViewer({ cards, initialIndex, initialSceneIndex = 0, onClose, onUseAsRef, onEditRecord, onUseSeries, onUseRecipe, onSplit, onNotify }: ViewerProps) {
  const [cardIndex, setCardIndex] = useState(initialIndex);
  const [sceneIndex, setSceneIndex] = useState(initialSceneIndex);
  const [versionId, setVersionId] = useState('');
  const [previewMode, setPreviewMode] = useState<'series' | 'single'>(
    cards[initialIndex]?.kind === 'series' ? 'series' : 'single',
  );
  const [layout, setLayout] = useState<'carousel' | 'waterfall'>('carousel');
  const [detailsOpen, setDetailsOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches);

  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const stripRef = useRef<HTMLDivElement>(null);
  const card = cards[cardIndex] ?? cards[0];
  const records = useMemo(() => (card ? cardRecords(card) : []), [card]);
  const metadata = useImageMetadata(card?.kind === 'series' ? card.versions || records : records);
  const latestRecord = records[sceneIndex] ?? records[0];
  const versions = card?.kind === 'series' && latestRecord?.sceneId ? (card.versions || records).filter((item) => item.sceneId === latestRecord.sceneId).sort((a, b) => (b.version || 1) - (a.version || 1)) : [];
  const record = versions.find((item) => item.id === versionId) || latestRecord;
  const original = useOriginalImage(record);
  const series = card?.kind === 'series';
  const showSeries = series && previewMode === 'series';
  const title = card ? cardTitle(card) : '';
  const imageInfo = record ? metadata[record.id] : undefined;
  const format = record ? imageFileExtension(record.dataUrl, record.outputFormat).toUpperCase() : '';

  const changeCard = useCallback(
    (delta: number) => {
      const next = (cardIndex + delta + cards.length) % cards.length;
      setCardIndex(next);
      setSceneIndex(0);
      setVersionId('');
      setPreviewMode(cards[next]?.kind === 'series' ? 'series' : 'single');
      setLayout('carousel');
    },
    [cardIndex, cards],
  );

  const changeScene = useCallback(
    (delta: number) => {
      setVersionId('');
      setSceneIndex((current) => (current + delta + records.length) % records.length);
      setLayout('carousel');
    },
    [records.length],
  );

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const changed = () => setDetailsOpen(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        if (showSeries) changeScene(delta);
        else changeCard(delta);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changeCard, changeScene, onClose, showSeries]);

  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sceneIndex]);

  if (!card || !record) return null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify('success', '提示词已复制');
    } catch {
      onNotify('error', '复制失败, 请检查浏览器剪贴板权限');
    }
  };
  const downloadAll = async () => {
    try {
      if (series) {
        await downloadRecords(records, `sprout-series-${card.seriesId}`);
        onNotify('success', `已打包 ${records.length} 幕分镜`);
      } else await downloadRecord(record);
    } catch {
      onNotify('error', '下载失败, 请重试');
    }
  };

  return (
    <div
      className="stitch-viewer fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-inverse-surface/50 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="作品检视"
        className="stitch-viewer-dialog relative flex h-[min(92dvh,calc(100dvh-1.5rem))] w-[min(100%,calc(100vw-1.5rem))] max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface shadow-[0_20px_60px_rgba(40,48,36,0.20)] sm:h-[min(88dvh,56rem)] sm:w-[min(80vw,64rem)]"
      >
        <div className="h-16 px-3 md:px-space-lg bg-surface-container-lowest border-b border-outline-variant/30 flex items-center justify-between gap-2 md:gap-space-md shrink-0">
          <div className="flex items-center gap-space-md min-w-0 flex-1">
            <div className="hidden sm:flex w-10 h-10 rounded-xl bg-primary/10 text-primary items-center justify-center shrink-0">
              <StitchIcon name={series ? 'dynamic_feed' : 'brush'} size={24} />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-space-xs min-w-0">
                <h2 className="font-headline-sm text-headline-sm text-on-surface truncate" title={title}>
                  {title}
                </h2>
                <span className="hidden xl:inline px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-meta-sm text-meta-sm font-medium shrink-0">
                  {series ? `共 ${records.length} 幕分镜` : '单图创作'}
                </span>
              </div>
              <div className="text-on-surface-variant font-meta-sm text-meta-sm mt-0.5 truncate">
                {new Date(cardTimestamp(card)).toLocaleString('zh-CN', { hour12: false })} 生成
                <span className="px-2">·</span>
                <span>{record.providerName || '未提供'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-space-xs shrink-0">
            <div className="flex items-center bg-surface-container rounded-lg p-0.5">
              <button
                type="button"
                className="p-1.5 rounded hover:bg-surface-container-high"
                title={series ? '上一套' : '上一张'}
                aria-label={series ? '上一套' : '上一张'}
                onClick={() => changeCard(-1)}
                disabled={cards.length < 2}
              >
                <StitchIcon name="arrow_back" size={18} />
              </button>
              <span className="font-meta-sm text-meta-sm text-on-surface-variant px-1.5">
                {cardIndex + 1} / {cards.length}
              </span>
              <button
                type="button"
                className="p-1.5 rounded hover:bg-surface-container-high"
                title={series ? '下一套' : '下一张'}
                aria-label={series ? '下一套' : '下一张'}
                onClick={() => changeCard(1)}
                disabled={cards.length < 2}
              >
                <StitchIcon name="arrow_forward" size={18} />
              </button>
            </div>
            <button
              type="button"
              className="flex items-center gap-1 px-2 sm:px-space-md py-1.5 rounded-lg bg-primary text-on-primary hover:bg-primary-container shadow-sm"
              title={series ? '打包下载全套 ZIP' : '下载原图'}
              onClick={() => void downloadAll()}
            >
              <StitchIcon name={series ? 'folder_zip' : 'download'} size={18} />
              <span className="hidden xl:inline font-body-sm text-body-sm font-medium">
                {series ? '下载全系列 ZIP' : '下载原图'}
              </span>
            </button>
            <button
              type="button"
              className="viewer-tool-button px-2 gap-1 font-body-sm text-body-sm"
              aria-label={detailsOpen ? '收起详情' : '查看详情'}
              aria-expanded={detailsOpen}
              aria-controls="viewer-details"
              onClick={() => setDetailsOpen((current) => !current)}
            >
              <StitchIcon name="tune" size={20} />
              <span className="hidden sm:inline">{detailsOpen ? '收起详情' : '查看详情'}</span>
            </button>
            <button
              type="button"
              className="w-9 h-9 rounded-lg bg-surface-container hover:bg-error-container hover:text-on-error-container text-on-surface-variant flex items-center justify-center"
              onClick={onClose}
              title="关闭 (Esc)"
              aria-label="关闭查看器"
            >
              <StitchIcon name="close" size={20} />
            </button>
          </div>
        </div>
        <div className="stitch-viewer-content flex-1 flex min-h-0 items-stretch relative overflow-hidden">
          <div className={`stitch-viewer-stage flex-1 flex-col min-w-0 min-h-0 ${detailsOpen ? 'hidden lg:flex' : 'flex'}`}>
            {series && (
              <div className="flex items-center flex-wrap gap-2 px-3 py-2 bg-surface-container-lowest border-b border-outline-variant/30 shrink-0">
                <div className="flex items-center bg-surface-container-low p-0.5 rounded-lg" aria-label="检视模式">
                  {([['series', 'view_carousel', '系列预览'], ['single', 'image', '当前图片']] as const).map(([mode, icon, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={previewMode === mode}
                      className={`flex items-center gap-1 px-2 py-1.5 rounded-lg font-body-sm text-body-sm ${previewMode === mode ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}
                      onClick={() => { setPreviewMode(mode); setLayout('carousel'); }}
                    ><StitchIcon name={icon} size={16} />{label}</button>
                  ))}
                </div>
                {showSeries && <div className="flex items-center gap-1 ml-auto" aria-label="分镜布局">
                  {([['carousel', 'image', '逐镜'], ['waterfall', 'view_stream', '拼版']] as const).map(([mode, icon, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={layout === mode}
                      className={`flex items-center gap-1 px-2 py-1.5 rounded-lg font-body-sm text-body-sm ${layout === mode ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:bg-surface-container'}`}
                      onClick={() => setLayout(mode)}
                    ><StitchIcon name={icon} size={16} />{label}</button>
                  ))}
                </div>}

              </div>
            )}
            {layout === 'carousel' ? (
              <ImageViewport
                key={`${record.id}-${previewMode}`}
                src={original.url || record.dataUrl || undefined}
                alt={record.prompt || '生成的画作'}
                error={original.error}
                onCopy={() => void copyRecordImage(record).then(() => onNotify('success', '已复制原图')).catch((error) => onNotify('error', error instanceof Error ? error.message : '复制失败, 请改用下载'))}
              />
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto bg-surface-container-low p-4 md:p-space-lg" aria-label="连贯拼版">
                <div className="max-w-5xl mx-auto space-y-space-lg">
                  {records.map((scene, index) => (
                    <article key={scene.id} className="p-space-md bg-surface-container-lowest rounded-xl">
                      <h3 className="font-headline-sm text-headline-sm mb-2">第 {index + 1} 幕</h3>
                      <button
                        className="block w-full"
                        type="button"
                        title={`检视第 ${index + 1} 幕`}
                        onClick={() => { setSceneIndex(index); setVersionId(''); setLayout('carousel'); }}
                      ><RecordImage record={scene} alt={scene.prompt} className="w-full h-auto rounded-lg mb-2" /></button>
                      <p className="font-body-sm text-body-sm text-on-surface-variant">{scene.prompt}</p>
                    </article>
                  ))}
                </div>
              </div>
            )}
            {layout === 'carousel' && (
              <div className="flex items-center justify-between gap-3 px-3 py-2 bg-surface-container-lowest border-t border-outline-variant/30 font-meta-sm text-meta-sm text-on-surface-variant shrink-0">
                <span className="truncate">{imageInfo ? `${imageInfo.size} · ${imageInfo.ratio}` : '读取画幅中'} · {format} 原图{series ? ` · 第 ${sceneIndex + 1} / ${records.length} 幕` : ''}</span>
                <span className="hidden sm:inline shrink-0">滚轮查看细节 · Ctrl 滚轮缩放</span>
              </div>
            )}
            {showSeries && (
              <div className="h-20 px-3 py-2 bg-surface-container-lowest border-t border-outline-variant/30 flex items-center justify-between gap-2 shrink-0">
                <div className="hidden xl:flex items-center gap-space-xs text-on-surface-variant font-meta-sm text-meta-sm shrink-0">
                  <StitchIcon name="view_carousel" size={18} className="text-primary" />
                  <span>故事分镜轨道</span>
                </div>
                <div
                  ref={stripRef}
                  className="flex-1 flex items-center [justify-content:safe_center] gap-space-xs overflow-x-auto py-1 min-w-0"
                  aria-label="故事分镜轨道"
                >
                  {records.map((scene, index) => (
                    <button
                      key={scene.id}
                      type="button"
                      aria-current={index === sceneIndex}
                      aria-label={`查看第 ${index + 1} 幕`}
                      className={`flex items-center gap-2 p-1.5 rounded-xl transition-all shrink-0 ${index === sceneIndex ? 'bg-surface-bright shadow-sm border-2 border-primary' : 'bg-surface-container-high/60 hover:bg-surface-bright opacity-80 hover:opacity-100'}`}
                      onClick={() => {
                        setSceneIndex(index);
                        setVersionId('');
                        setLayout('carousel');
                      }}
                    >
                      <div className="w-16 h-11 rounded-lg overflow-hidden bg-surface-container relative">
                        <RecordImage record={scene} alt="" className="w-full h-full object-cover" />
                        <span
                          className={`absolute bottom-0.5 right-0.5 px-1 rounded font-meta-sm text-[9px] leading-tight ${index === sceneIndex ? 'bg-primary text-on-primary' : 'bg-inverse-surface/80 text-inverse-on-surface'}`}
                        >
                          {String(index + 1).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="hidden sm:flex flex-col text-left pr-2 max-w-24">
                        <span
                          className={`font-body-sm text-body-sm font-medium leading-tight ${index === sceneIndex ? 'text-primary' : 'text-on-surface'}`}
                        >
                          第 {index + 1} 幕
                        </span>
                        <span className="font-meta-sm text-meta-sm text-on-surface-variant truncate">
                          {scene.prompt || '未命名分镜'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    className="w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center"
                    onClick={() => changeScene(-1)}
                    title="上一幕"
                  >
                    <StitchIcon name="chevron_left" size={16} />
                  </button>
                  <button
                    type="button"
                    className="w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center"
                    onClick={() => changeScene(1)}
                    title="下一幕"
                  >
                    <StitchIcon name="chevron_right" size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
          {detailsOpen && <aside id="viewer-details" aria-label="作品详情" className="stitch-viewer-inspector flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-container-lowest lg:w-80 lg:flex-none lg:border-l border-outline-variant/30">
            <div className="min-h-0 flex-1 space-y-space-md overflow-y-auto p-space-lg">
              <div className="flex items-center gap-space-xs text-primary">
                <StitchIcon name="tune" size={20} />
                <h3 className="font-headline-sm text-headline-sm">参数与创作配方</h3>
              </div>
              {showSeries && (
                <div className="p-space-sm rounded-xl bg-surface-container-low space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-on-surface-variant">
                    <span className="font-meta-sm text-meta-sm uppercase tracking-wider flex items-center gap-1">
                      <StitchIcon name="public" size={14} />
                      系列故事梗概
                    </span>
                    <button
                      type="button"
                      className="hover:text-primary"
                      title="复制全局提示词"
                      onClick={() => void copy(card.masterPrompt)}
                    >
                      <StitchIcon name="content_copy" size={15} />
                    </button>
                  </div>
                  <p className="max-h-40 overflow-y-auto font-body-sm text-body-sm text-on-surface leading-relaxed whitespace-pre-wrap break-words">
                    {card.masterPrompt || '未提供'}
                  </p>
                </div>
              )}
              <div className="p-space-sm rounded-xl bg-surface-container-low space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-on-surface-variant">
                  <span className="font-meta-sm text-meta-sm uppercase tracking-wider flex items-center gap-1 text-primary">
                    <StitchIcon name={showSeries ? 'videocam' : 'psychology'} size={14} />
                    {showSeries ? '当前分镜提示词' : '完整生成提示词'}
                  </span>
                  <button
                    type="button"
                    className="hover:text-primary"
                    title="复制当前提示词"
                    onClick={() => void copy(record.recipe?.prompt || record.prompt)}
                  >
                    <StitchIcon name="content_copy" size={15} />
                  </button>
                </div>
                <p className="max-h-40 overflow-y-auto font-body-sm text-body-sm text-on-surface font-medium leading-relaxed whitespace-pre-wrap break-words">
                  {record.recipe?.prompt || record.prompt || '未提供'}
                </p>
              </div>
              {versions.length > 1 && <label className="block text-body-sm">本镜版本<select aria-label="本镜版本" value={record.id} onChange={(event) => setVersionId(event.target.value)} className="w-full mt-1 p-2 rounded-lg bg-surface-container">{versions.map((item) => <option key={item.id} value={item.id}>版本 {item.version || 1} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>}
              {record.recipe && (
                <div className="space-y-1.5">
                  <span className="font-meta-sm text-meta-sm text-on-surface-variant">参考素材</span>
                  <p className="p-2 rounded-lg bg-surface-container font-body-sm text-body-sm">
                    {record.recipe.references.length || record.recipe.referenceImage ? [...record.recipe.references.map((ref) => ref.name), ...(record.recipe.referenceImage ? ['分镜衔接参考'] : [])].join(', ') : '文字创作'}
                    {record.recipe.hasMask ? ' · 局部编辑蒙版' : ''}
                  </p>
                </div>
              )}
              {original.error && <p role="alert" className="text-error text-body-sm">{original.error}</p>}
              <div className="grid grid-cols-2 gap-space-xs pt-1">
                {[
                  ['画面画幅比例', imageInfo ? `${imageInfo.ratio} (${imageInfo.size})` : '读取中'],
                  ['画风', record.recipe?.styleName || (record.recipe ? '自定义' : '历史作品未记录')],
                  ['生成质量', ({ high: '精细', medium: '标准', low: '快速', auto: '自动' } as Record<string, string>)[record.recipe?.quality || ''] || '历史作品未记录'],
                  ['输出格式', format],
                ].map(([label, value]) => (
                  <div key={label} className="p-2 rounded-lg bg-surface-container-low">
                    <span className="font-meta-sm text-meta-sm text-on-surface-variant block">{label}</span>
                    <span className="font-body-sm text-body-sm text-on-surface font-medium break-words">{value}</span>
                  </div>
                ))}
                <div className="col-span-2 p-2 rounded-lg bg-surface-container-low flex items-center justify-between">
                  <span className="font-meta-sm text-meta-sm text-on-surface-variant">画布背景透光</span>
                  <span className="font-body-sm text-body-sm">{record.recipe?.background === 'transparent' ? '透明' : record.recipe ? '自然背景' : '历史作品未记录'}</span>
                </div>
              </div>
            </div>
            <div className="shrink-0 space-y-space-xs border-t border-outline-variant/30 bg-surface-container-lowest px-space-lg py-space-md">
              {record.recipe && onUseRecipe && (
                <button type="button" className="w-full py-2 rounded-xl bg-surface-container text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high" onClick={() => { onUseRecipe(record); onClose(); }}>复用完整配方</button>
              )}
              {onEditRecord && (
                <button type="button" className="w-full py-2 rounded-xl bg-secondary-container text-on-secondary-container font-body-sm text-body-sm hover:bg-secondary-fixed flex items-center justify-center gap-2" onClick={() => { onEditRecord(record); onClose(); }}><StitchIcon name="brush" size={18} />{showSeries ? '局部重绘当前分镜' : '局部重绘此图'}</button>
              )}
              {onSplit && (
                <button type="button" className="w-full py-2 rounded-xl bg-surface-container text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high flex items-center justify-center gap-2" onClick={() => onSplit(record)}><StitchIcon name="content_cut" size={18} />切图拆分</button>
              )}
              <button
                type="button"
                className="w-full py-2.5 px-space-md rounded-xl bg-primary text-on-primary hover:bg-primary-container font-body-sm text-body-sm font-medium flex items-center justify-center gap-2 shadow-sm"
                onClick={() => {
                  if (showSeries && onUseSeries) onUseSeries(card);
                  else onUseAsRef(record);
                  onClose();
                }}
              >
                <StitchIcon name="brush" size={18} />
                <span>{showSeries && onUseSeries ? '基于此系列继续衍生分镜' : '用作参考图再创作'}</span>
              </button>
              {showSeries && (
                <button
                  type="button"
                  className="w-full py-2 px-space-sm rounded-xl bg-surface-container hover:bg-surface-container-high font-body-sm text-body-sm flex items-center justify-center gap-1.5"
                  onClick={() => void downloadRecord(record).catch(() => onNotify('error', '下载失败, 请检查本地原图'))}
                >
                  <StitchIcon name="file_download" size={16} />
                  下载当前分镜
                </button>
              )}
              {supportsFileSharing() && <button
                type="button"
                className="w-full py-2 px-space-sm rounded-xl bg-surface-container hover:bg-surface-container-high font-body-sm text-body-sm flex items-center justify-center gap-1.5"
                onClick={() => void shareRecords(showSeries ? records : [record]).catch((error) => { if (error?.name !== 'AbortError') onNotify('error', error instanceof Error ? error.message : '分享失败'); })}
              >
                <StitchIcon name="share" size={16} />
                分享文件
              </button>}
            </div>
          </aside>}
        </div>
      </div>
    </div>
  );
}
