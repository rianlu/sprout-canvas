import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Brush,
  CircleCheck,
  Copy,
  Download,
  Eraser,
  Layers,
  Leaf,
  Lightbulb,
  RefreshCw,
  Sparkles,
  Undo2,
  Wand2,
  X,
} from '../ui/icons';
import type { AspectRatio, GenerationConfig, RefImage, ResultRecord } from '../../types/generation';
import type { StudioStyleTemplate } from '../../lib/image/recipe';
import { StudioTemplateCard } from './StudioTemplateCard';
import { StitchIcon } from '../ui/StitchIcon';
import { useImageMetadata } from '../../hooks/useImageMetadata';
import { formatRequestSize, qualityLabel, resolveSize } from '../../lib/api/generation';
import { LOCK_UNSUPPORTED_IMAGE_OPTIONS } from '../../lib/image/channel-limits';
import { imageFileExtension } from '../../lib/image/format';
import { RecordImage } from '../gallery/RecordImage';
import type { ImageCapabilities } from '../../types/provider';
import { MAX_PROMPT_LENGTH } from '../../../shared/generation-contract.mjs';
import { CreditStatus } from '../ui/CreditStatus';
import { CreditCost } from '../ui/CreditCost';
import type { CreditCharge } from '../../../shared/credits-contract.mjs';
import type { PromptHistory } from '../../lib/prompt-history';
import { PromptActivityBorder } from '../ui/PromptActivityBorder';
import type { QueueDelivery } from '../../types/queue';
import { deliveryMessage, personalQueuePosition, type QueueTiming } from '../../lib/queue-presentation';
import { QueueElapsed } from '../queue/QueueElapsed';
import { ReferenceImageSlots } from '../image/ReferenceImageSlots';
import { ReferenceImagePreview } from '../image/ReferenceImagePreview';

/* ============ 单图创作 · 控制轨 (照搬 Stitch 单图稿 LEFT CONTROL PANEL, 类名原样) ============ */

export interface StitchStudioRailProps {
  onNewCreation: () => void;
  onOpenStyles: () => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  onPolish: () => void;
  polishing: boolean;
  promptHistory: PromptHistory | null;
  onTogglePolish: () => void;
  imageBusy: boolean;
  selectedTemplate: StudioStyleTemplate | null;
  onUnpinStyle: () => void;
  refImage: RefImage | null;
  referenceImages: RefImage[];
  maxReferences: number;
  onUploadRefs: (files: File[], replaceId?: string) => void;
  onOpenMaskEditor: () => void;
  onSwitchToEdit: () => void;
  onSwitchToReference: () => void;
  sourceRecord: ResultRecord | null;
  maskStrokes: number;
  config: GenerationConfig;
  onConfigChange: (patch: Partial<GenerationConfig>) => void;
  onSubmit: () => void;
  submitting: boolean;
  onRemoveRef: (referenceId?: string) => void;
  imageCapabilities?: ImageCapabilities;
}

/** 画幅比例选择格 (稿: grid-cols-3 六格) */
function AspectRatioGrid({ value, onChange, customSizes = true, sizeTier, requestSize }: { value: AspectRatio; onChange: (v: AspectRatio) => void; customSizes?: boolean; sizeTier: GenerationConfig['sizeTier']; requestSize: string }) {
  const ratios: { id: AspectRatio; name: string; box: string }[] = [
    { id: '1:1', name: '1:1 方图', box: 'w-4 h-4' },
    { id: '3:4', name: '3:4 竖图', box: 'w-3 h-4' },
    { id: '4:3', name: '4:3 横图', box: 'w-4 h-3' },
    { id: '9:16', name: '9:16 壁纸', box: 'w-2.5 h-4' },
    { id: '16:9', name: '16:9 宽屏', box: 'w-4 h-2.5' },
    { id: '21:9', name: '21:9 超宽', box: 'w-5 h-2' },
    { id: '3:2', name: '3:2 横图', box: 'w-4 h-3' },
    { id: '2:3', name: '2:3 竖图', box: 'w-3 h-4' },
    { id: 'auto', name: '自动画幅', box: 'w-4 h-4' },
  ];
  const visible = customSizes ? ratios.filter((r, index) => index < 6 || r.id === value) : ratios.filter((r) => ['1:1', '3:2', '2:3', 'auto'].includes(r.id));
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {visible.map((r) => {
        const active = value === r.id;
        return (
          <button
            key={r.id}
            type="button"
            aria-pressed={active}
            className={
              active
                ? 'flex flex-col items-start p-2 rounded-xl bg-surface-container-high shadow-[0_0_0_2px_#597445] text-on-surface transition-all text-left'
                : 'flex flex-col items-start p-2 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface-variant transition-all text-left'
            }
            onClick={() => onChange(r.id)}
          >
            <div className="mb-1.5 flex h-5 w-full items-center justify-between">
              <div className="flex h-5 w-5 items-center justify-center">
                <div className={`${r.box} rounded-sm border-2 ${active ? 'border-primary bg-primary/20' : 'border-outline/60'}`} />
              </div>
              {r.id === '1:1' && (
                <span className="px-1 rounded text-[9px] bg-primary-fixed text-on-primary-fixed font-meta-sm font-medium">
                  默认
                </span>
              )}
            </div>
            <span className="font-meta-sm text-[11px] font-medium text-on-surface leading-tight">{r.name}</span>
            <span className="font-meta-sm text-[10px] text-outline">{formatRequestSize(active ? requestSize : resolveSize(r.id, sizeTier).size)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 分段选择器 (通用: 调性/精度/数量/格式) */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: { id: T; label: string; sub?: string; tag?: string; disabled?: boolean; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div
      className={`grid p-0.5 bg-surface-container rounded-lg ${columns === 4 ? 'grid-cols-4' : columns === 3 ? 'grid-cols-3' : 'grid-cols-2'} text-center font-meta-sm text-meta-sm`}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={opt.disabled}
            title={opt.title}
            aria-pressed={active}
            className={
              active
                ? 'py-1.5 px-2 rounded-md bg-surface-container-lowest font-medium text-primary shadow-sm flex flex-col gap-0.5 items-center'
                : 'py-1.5 px-2 rounded-md text-on-surface-variant hover:text-on-surface transition-colors flex flex-col gap-0.5 items-center'
            }
            onClick={() => onChange(opt.id)}
          >
            <span className="text-[11px] font-medium flex items-center gap-2">
              {opt.label}
              {opt.tag && (
                <span className="px-1 py-0.5 rounded bg-primary-fixed text-on-primary-fixed text-[9px]">{opt.tag}</span>
              )}
            </span>
            {opt.sub && <span className="text-[10px] text-outline font-normal leading-tight">{opt.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function StitchStudioRail(props: StitchStudioRailProps) {
  const {
    prompt,
    onPromptChange,
    onPolish,
    polishing,
    onUnpinStyle,
    refImage,
    onOpenMaskEditor,
    maskStrokes,
    config,
    onConfigChange,

    onSubmit,
    submitting,
  } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const replacementId = useRef<string | undefined>(undefined);
  const [originalPreview, setOriginalPreview] = useState(false);
  const isEdit = config.mode === 'edit';
  const referenceCount = props.referenceImages.length;
  const tooManyReferences = !isEdit && referenceCount > props.maxReferences;
  const imagesDisabled = props.imageBusy || submitting;
  useEffect(() => { if (!isEdit) setOriginalPreview(false); }, [isEdit]);
  function chooseFiles(referenceId?: string) {
    if (!fileRef.current) return;
    replacementId.current = referenceId;
    fileRef.current.multiple = !referenceId;
    fileRef.current.click();
  }
  const outputFormats = props.imageCapabilities?.formats ?? [];
  const sourceRecipe = props.sourceRecord?.recipe;
  const referenceSlots = <ReferenceImageSlots references={props.referenceImages} maxReferences={props.maxReferences} disabled={imagesDisabled} busy={props.imageBusy} onAdd={() => chooseFiles()} onUpload={(files) => props.onUploadRefs(files)} onReplace={chooseFiles} onRemove={props.onRemoveRef} />;

  return (
    <section className="w-full lg:w-[440px] shrink-0 bg-surface-container-lowest/80 backdrop-blur-xl rounded-xl p-space-lg shadow-[0_12px_36px_rgba(85,95,75,0.06)] flex flex-col gap-space-lg">
      {/* 灵感提示词 */}
      <div className="flex flex-col gap-space-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-space-xs">
            <Lightbulb className="text-primary" size={20} aria-hidden />
            <span className="font-headline-sm text-headline-sm text-on-surface">{isEdit ? '局部修改要求' : '灵感提示词'}</span>
          </div>
          <button type="button" className="font-meta-sm text-meta-sm text-on-surface-variant hover:text-primary disabled:opacity-50" title="清空文案, 参考图和蒙版, 保留常用生成设置" disabled={submitting || polishing || props.imageBusy} onClick={props.onNewCreation}>新建创作</button>
        </div>
        <div className="studio-prompt-field bg-surface-container-low p-space-md shadow-sm" data-polishing={polishing} aria-busy={polishing}>
          {polishing && <PromptActivityBorder />}
          <textarea
            className="studio-prompt-input w-full bg-transparent border-0 outline-none resize-none font-body-md text-body-md text-on-surface placeholder:text-outline placeholder:italic leading-relaxed"
            maxLength={MAX_PROMPT_LENGTH}
            aria-label={isEdit ? '局部修改要求' : '画面提示词'}
            placeholder={isEdit ? '描述涂抹区域需要怎样修改, 例如: 把衣服改成红色, 保持人物姿势和背景.' : '描述清晨第一缕阳光穿透温室玻璃，照亮案头破土新芽的轻柔笔触，苔藓与湿润泥土的水彩质感...'}
            rows={4}
            value={prompt}
            readOnly={polishing}
            onChange={(event) => onPromptChange(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 pt-space-xs mt-space-xs text-on-surface-variant font-meta-sm text-meta-sm">
            <div className="flex flex-wrap items-center gap-x-space-sm gap-y-2">
              <button
                type="button"
                className="flex items-center gap-1 hover:text-error transition-colors disabled:opacity-50"
                disabled={polishing}
                onClick={() => onPromptChange('')}
              >
                <Eraser size={14} aria-hidden />
                <span>清空</span>
              </button>
              {!isEdit && <button
                type="button"
                className="flex items-center gap-1 hover:text-primary transition-colors disabled:opacity-50"
                onClick={onPolish}
                disabled={polishing || submitting}
              >
                <Wand2 size={14} aria-hidden />
                <span>{polishing ? '润色中...' : '润色扩写'}</span>
                <CreditCost kind="text" />
              </button>}
              {!isEdit && props.promptHistory && <button type="button" className="flex items-center gap-1 hover:text-primary transition-colors disabled:opacity-50" disabled={polishing || submitting} onClick={props.onTogglePolish} title={props.promptHistory.restored ? '恢复撤销前的内容, 包括手动修改, 不消耗灵感点' : '还原本次润色前的原文, 当前修改可再次恢复'}>
                <Undo2 size={14} aria-hidden className={props.promptHistory.restored ? '-scale-x-100' : ''} />
                <span>{props.promptHistory.restored ? '恢复润色' : '撤销润色'}</span>
              </button>}
            </div>
            <span className="text-outline">{prompt.length} / {MAX_PROMPT_LENGTH}</span>
          </div>
        </div>
        <span role="status" className="sr-only">{polishing ? '正在润色, 完成后可修改或撤销' : ''}</span>
      </div>

      {!isEdit && (props.selectedTemplate
        ? <StudioTemplateCard key={`${props.selectedTemplate.id}:${props.selectedTemplate.image}`} template={props.selectedTemplate} onChange={props.onOpenStyles} onRemove={onUnpinStyle} disabled={submitting || polishing} />
        : <button type="button" onClick={props.onOpenStyles} disabled={submitting || polishing} className="flex items-center justify-between w-full p-3 rounded-xl border border-outline-variant/30 bg-surface-container-low hover:bg-surface-container text-primary font-body-sm text-body-sm disabled:opacity-50"><span className="flex items-center gap-2"><StitchIcon name="palette" size={18} />从风格库挑选提示词模板</span><StitchIcon name="north_east" size={16} /></button>)}

      {/* 基底垫图与局部重绘 */}
      <div aria-label="参考图片" className="studio-reference-area bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-sm" onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = imagesDisabled || isEdit ? 'none' : 'copy';
      }} onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
        if (files.length && !imagesDisabled && !isEdit) props.onUploadRefs(files);
      }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-space-xs">
            <Leaf className="text-primary" size={18} aria-hidden />
            <span className="font-body-md text-body-md font-medium text-on-surface">基底垫图与局部重绘</span>
          </div>
          <div className="flex items-center gap-2"><span className="px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-meta-sm text-meta-sm">{isEdit ? '1 张编辑原图' : `${referenceCount} / ${props.maxReferences} 张`}</span>{refImage && <button type="button" aria-label={referenceCount > 1 ? '清空参考图' : '移除参考图'} title="清空参考图和蒙版" disabled={imagesDisabled} onClick={() => props.onRemoveRef()} className="text-outline hover:text-error disabled:opacity-50"><X size={15} /></button>}</div>
        </div>
        {refImage ? (
          <>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-container p-1" role="group" aria-label="图片使用方式">
              <button type="button" aria-pressed={!isEdit} disabled={imagesDisabled} title="切换后清除蒙版, 可调整画幅与风格" onClick={props.onSwitchToReference} className={`rounded-md px-2 py-1.5 font-meta-sm text-meta-sm disabled:opacity-50 ${!isEdit ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant'}`}>参考图生成</button>
              <button type="button" aria-pressed={isEdit} disabled={polishing || imagesDisabled} onClick={props.onSwitchToEdit} className={`rounded-md px-2 py-1.5 font-meta-sm text-meta-sm disabled:opacity-50 ${isEdit ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant'}`}>局部重绘</button>
            </div>
            <p className="font-meta-sm text-meta-sm text-on-surface-variant">{isEdit ? '涂抹指定区域, 沿用原图参数和画风.' : referenceCount > 1 ? '按图 1, 图 2 的顺序参考, 可在提示词中说明各张图片的用途.' : '参考原图重新创作, 可自由调整画幅与风格.'}</p>
            {tooManyReferences && <p role="status" className="rounded-lg bg-secondary-container/50 px-3 py-2 font-meta-sm text-meta-sm text-on-secondary-container">配方已载入 {referenceCount} 张参考图, 单图创作最多使用 {props.maxReferences} 张. 请移除多余图片并检查文案后再绘制.</p>}
            {!isEdit ? referenceSlots : <div className="flex items-start gap-3 rounded-lg bg-surface-container-lowest p-2 shadow-sm">
              <button type="button" aria-label="查看局部重绘原图" title="点击查看大图" onClick={() => setOriginalPreview(true)} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-container">
                <img className="h-full w-full object-contain" src={refImage.dataUrl} alt="局部重绘原图" />
              </button>
              <div className="min-w-0 flex-1 space-y-2">
                <div><p className="truncate font-body-sm text-body-sm font-medium text-on-surface" title={refImage.name}>{refImage.name}</p><p className="font-meta-sm text-[11px] text-on-surface-variant">仅编辑这一张图片</p></div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={imagesDisabled} title="更换图片后回到参考图生成, 并清除当前蒙版" onClick={() => chooseFiles(refImage.id)} className="inline-flex h-8 items-center gap-1 px-2.5 rounded-lg bg-surface-container text-on-surface font-meta-sm text-meta-sm hover:bg-surface-container-high transition-colors disabled:opacity-50"><RefreshCw size={14} aria-hidden />更换图片</button>
                  <button type="button" disabled={polishing || imagesDisabled} onClick={onOpenMaskEditor} className="inline-flex h-8 items-center gap-1 px-2.5 rounded-lg bg-secondary-container text-on-secondary-container font-meta-sm text-meta-sm hover:bg-secondary-fixed transition-colors disabled:opacity-50"><Brush size={14} aria-hidden /><span>{maskStrokes > 0 ? '编辑蒙版' : '绘制蒙版'}</span></button>
                </div>
              </div>
            </div>}
            {isEdit && referenceCount > 1 && <p className="font-meta-sm text-[11px] text-secondary">其余 {referenceCount - 1} 张图片已保留, 切回参考图生成可继续使用.</p>}
            {maskStrokes > 0 && (
              <div className="flex items-center justify-between gap-2 px-space-sm py-2 rounded-lg bg-primary/10 text-on-surface">
                <div className="flex items-center gap-2 min-w-0">
                  <Brush className="text-primary shrink-0" size={18} aria-hidden />
                  <span className="font-meta-sm text-meta-sm truncate">
                    已圈定局部重绘蒙版区域 ({maskStrokes} 处笔触)
                  </span>
                </div>
                <button
                  type="button"
                  className="font-meta-sm text-meta-sm text-primary font-medium hover:underline shrink-0"
                  disabled={polishing || imagesDisabled}
                  onClick={() => onOpenMaskEditor()}
                >
                  进入工作区
                </button>
              </div>
            )}
          </>
        ) : referenceSlots}
        <input
          ref={fileRef}
          type="file"
          multiple
          aria-label="上传参考图"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          disabled={imagesDisabled}
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            const replaceId = replacementId.current;
            replacementId.current = undefined;
            if (files.length) props.onUploadRefs(files, replaceId);
            event.target.value = '';
            event.target.multiple = true;
          }}
        />
        {isEdit && refImage && originalPreview && <ReferenceImagePreview references={[refImage]} selectedId={refImage.id} onSelect={() => {}} onClose={() => setOriginalPreview(false)} />}
      </div>

      {/* 生图参数规范 */}
      {isEdit ? (
        <section aria-label="局部重绘参数" className="rounded-xl bg-surface-container-low p-space-md flex flex-col gap-space-sm">
          <div className="flex items-center gap-space-xs text-primary"><Layers size={18} aria-hidden /><span className="font-body-sm text-body-sm font-medium">{sourceRecipe ? '沿用原作品参数' : '局部重绘参数'}</span></div>
          <dl className="grid grid-cols-2 gap-space-sm font-meta-sm text-meta-sm">
            {[
              ['画幅', config.requestSize === 'auto' ? '按原图比例' : config.aspectRatio === 'auto' ? '自定义画幅' : config.aspectRatio],
              ['目标尺寸', formatRequestSize(config.requestSize)],
              ['生成质量', qualityLabel(config.quality)],
              ['输出格式', (config.outputFormat === 'auto' ? 'png' : config.outputFormat).toUpperCase()],
              ['背景', config.background === 'transparent' ? '透明' : config.background === 'opaque' ? '不透明' : '自动'],
              ['生成数量', '1 张'],
              ['画风', sourceRecipe?.styleName || '沿用原图'],
              ...(config.outputFormat === 'jpeg' || config.outputFormat === 'webp' ? [['压缩质量', `${config.outputCompression}%`]] : []),
              ...(props.sourceRecord?.width && props.sourceRecord?.height ? [['原图像素', `${props.sourceRecord.width}×${props.sourceRecord.height}`]] : []),
            ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-outline mb-1">{label}</dt><dd className="text-on-surface font-medium break-words">{value}</dd></div>)}
          </dl>
          <p className="font-meta-sm text-[11px] text-on-surface-variant">{sourceRecipe ? '参数已继承并固定. 如需更换画幅或风格, 请切换参考图生成.' : config.requestSize === 'auto' ? '使用自动尺寸, 按原图比例编辑. 未记录的生成参数使用上方设置.' : '使用已保存的编辑配方. 如需调整参数, 请切换参考图生成.'}</p>
          <p className="font-meta-sm text-[10px] text-outline">实际输出尺寸以生成文件为准, 未涂抹区域可能存在细节变化.</p>
        </section>
      ) : <div className="flex flex-col gap-space-md">
        <div className="flex items-center justify-between pb-1 border-b border-surface-container">
          <div className="flex items-center gap-space-xs">
            <Layers className="text-primary" size={18} aria-hidden />
            <span className="font-meta-sm text-meta-sm text-on-surface font-medium uppercase tracking-wider">
              生图参数规范
            </span>
          </div>
          <span className="font-meta-sm text-[11px] text-outline">图像生成</span>
        </div>

        {/* 画幅 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-meta-sm text-meta-sm text-on-surface-variant font-medium">
              画面画幅比例 (aspect_ratio)
            </span>
            <span className="font-meta-sm text-[11px] text-outline">{formatRequestSize(config.requestSize)}</span>
          </div>
          <AspectRatioGrid value={config.aspectRatio} onChange={(v) => onConfigChange({ aspectRatio: v })} customSizes={props.imageCapabilities?.customSizes} sizeTier={config.sizeTier} requestSize={config.requestSize} />
          <p className="font-meta-sm text-[10px] text-outline">目标画幅, 实际尺寸以生成文件为准</p>
        </div>

        <div className="bg-surface-container-low p-2.5 rounded-xl flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-meta-sm text-meta-sm text-on-surface font-medium">生成数量</span>
            <span className="font-meta-sm text-[10px] text-outline">n (张)</span>
          </div>
          <SegmentedControl
            columns={3}
            value={String(config.imageCount) as '1' | '2' | '4'}
            onChange={(v) => onConfigChange({ imageCount: Number(v) })}
            options={[
              { id: '1', label: '1 张' },
              { id: '2', label: '2 张' },
              { id: '4', label: '4 张' },
            ]}
          />
        </div>

        {LOCK_UNSUPPORTED_IMAGE_OPTIONS ? (
          <div role="group" aria-label="生成格式" className="rounded-xl bg-surface-container-low p-2.5 flex flex-col gap-2.5 text-on-surface-variant">
            <p className="font-meta-sm text-[11px] text-outline">上游暂不支持修改, 将使用默认值</p>
            <div className="flex items-center justify-between gap-2">
              <span className="font-meta-sm text-meta-sm">渲染精度</span>
              <span className="px-2.5 py-0.5 rounded-md bg-surface-container font-meta-sm text-[11px]">{qualityLabel(config.quality)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-meta-sm text-meta-sm">生成格式</span>
              <span aria-label="当前生成格式" className="px-2.5 py-0.5 rounded-md bg-surface-container font-meta-sm text-[11px]">{(config.outputFormat === 'auto' ? 'png' : config.outputFormat).toUpperCase()}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-meta-sm text-meta-sm">透明背景</span>
              <label className="relative inline-flex items-center opacity-50">
                <input className="sr-only" type="checkbox" aria-label="透明背景" checked={config.background === 'transparent'} disabled readOnly />
                <div className="w-9 h-5 rounded-full bg-surface-container-highest after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white" />
              </label>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-surface-container-low p-2.5 rounded-xl flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-meta-sm text-meta-sm text-on-surface font-medium">渲染精度</span>
                <span className="font-meta-sm text-[10px] text-outline">quality</span>
              </div>
              <SegmentedControl
                columns={4}
                value={config.quality}
                onChange={(quality) => onConfigChange({ quality })}
                options={[
                  { id: 'auto', label: '自动' },
                  { id: 'low', label: '快速' },
                  { id: 'medium', label: '标准' },
                  { id: 'high', label: '高清 HD' },
                ]}
              />
            </div>
            <div className="p-2.5 bg-surface-container-low rounded-xl flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Layers className="text-primary" size={18} aria-hidden />
                  <span className="font-body-sm text-body-sm font-medium text-on-surface">画布背景透光 (background)</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    className="sr-only peer"
                    type="checkbox"
                    aria-label="透明背景"
                    checked={config.background === 'transparent'}
                    onChange={(event) => onConfigChange({ background: event.target.checked ? 'transparent' : 'auto' })}
                  />
                  <div className="w-9 h-5 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary" />
                </label>
              </div>
              <div className="flex items-center justify-between text-outline font-meta-sm text-[10px]">
                <span>开启后使用支持透明的 PNG 或 WebP</span>
                <span className="text-primary">素材免抠</span>
              </div>
            </div>
            <div role="group" aria-label="生成格式" className="flex flex-col gap-1.5 p-2.5 bg-surface-container-low rounded-xl">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Download className="text-outline" size={16} aria-hidden />
                  <span className="font-meta-sm text-meta-sm text-on-surface-variant font-medium">生成格式</span>
                </div>
                {outputFormats.length === 1 ? (
                  <span aria-label="当前生成格式" className="px-2.5 py-0.5 rounded-md bg-surface-container font-meta-sm text-[11px] text-primary font-medium">{outputFormats[0].toUpperCase()}</span>
                ) : outputFormats.length > 1 ? (
                  <div className="flex items-center gap-1 bg-surface-container p-0.5 rounded-lg">
                    {outputFormats.map((fmt) => {
                      const active = (config.outputFormat === 'auto' ? 'png' : config.outputFormat) === fmt;
                      return (
                        <button
                          key={fmt}
                          type="button"
                          aria-pressed={active}
                          className={
                            active
                              ? 'px-2.5 py-0.5 rounded-md bg-surface-container-lowest font-meta-sm text-[11px] text-primary font-medium shadow-sm'
                              : 'px-2 py-0.5 rounded-md font-meta-sm text-[11px] text-on-surface-variant hover:text-on-surface transition-colors'
                          }
                          onClick={() => onConfigChange({ outputFormat: fmt })}
                        >
                          {fmt.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                ) : <span role="status" className="font-meta-sm text-meta-sm text-outline">正在读取可用格式...</span>}
              </div>
              {outputFormats.length === 1 && <p className="font-meta-sm text-meta-sm text-on-surface-variant">当前支持 {outputFormats[0].toUpperCase()} 格式</p>}
            </div>
          </>
        )}
      </div>}

      {/* 提交按钮 */}
      <div className="pt-space-xs mt-auto">
        <button
          type="button"
          className="w-full py-3.5 px-space-lg rounded-xl bg-primary hover:bg-primary-container text-on-primary font-headline-sm text-headline-sm flex items-center justify-center gap-space-sm shadow-[0_4px_16px_rgba(65,91,47,0.28)] hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:hover:translate-y-0"
          disabled={submitting || polishing || props.imageBusy || tooManyReferences || !props.imageCapabilities || prompt.trim().length === 0 || (isEdit && maskStrokes === 0)}
          onClick={onSubmit}
        >
          <Leaf size={20} aria-hidden />
          <span>{submitting ? '入队中...' : isEdit ? '开始局部重绘' : '开始绘制'}</span>
          <CreditCost count={isEdit ? 1 : config.imageCount} />
        </button>
        {isEdit && maskStrokes === 0 && <p role="status" className="mt-2 font-meta-sm text-meta-sm text-on-surface-variant">请先涂抹并保存需要修改的区域.</p>}
      </div>
    </section>
  );
}

/* ============ 单图创作 · 最近创作 ============ */

export type CanvasEntry = { key: string } & ({ kind: 'job'; job: QueueJobView } | { kind: 'result'; record: ResultRecord });

export interface StitchCanvasStreamProps {
  entries: CanvasEntry[];
  onOpenGallery: () => void;
  onDownload: (record: ResultRecord) => void;
  onCopy: (record: ResultRecord) => void | Promise<void>;
  onOpenMask: (record: ResultRecord) => void;
  onFullscreen: (record: ResultRecord) => void;
  onCancelJob: (jobId: string) => void;
  onRetryJob: (jobId: string) => void;
  onEditPrompt: (prompt: string) => void;
}

export interface QueueJobView {
  recoveryPoints?: number;
  recoveryUnlimited?: boolean;
  credit?: CreditCharge | null;
  settlementPending?: boolean;
  delivery?: QueueDelivery;
  id: string;
  status: 'queued' | 'running' | 'receiving' | 'failed' | 'submitting' | 'unsubmitted';
  prompt: string;
  timing: QueueTiming;
  position: number;
  error: string;
  createdAt: number;
  canRetry: boolean;
  retrying: boolean;
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function StitchCanvasStream(props: StitchCanvasStreamProps) {
  const {
    entries,
    onOpenGallery,
    onDownload,
    onCopy,
    onOpenMask,
    onFullscreen,
    onCancelJob,
    onRetryJob,
  } = props;
  const results = useMemo(() => entries.flatMap((entry) => entry.kind === 'result' ? [entry.record] : []), [entries]);
  const metadata = useImageMetadata(results);

  return (
    <section aria-label="创作画卷" className="studio-canvas flex-1 w-full min-w-0 flex flex-col gap-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-sm pb-space-xs">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">创作画卷</h1>
          <p className="mt-1 font-meta-sm text-meta-sm text-on-surface-variant">最近创作, 最多显示 4 个记录</p>
        </div>
        <button type="button" onClick={onOpenGallery} className="flex items-center gap-2 rounded-xl px-3 py-2 bg-surface-container-low text-primary font-body-sm text-body-sm hover:bg-surface-container transition-colors">前往展馆<StitchIcon name="arrow_forward" size={17} /></button>
      </div>

      {/* 卡片流 */}
      <div className="studio-feed grid grid-cols-1 xl:grid-cols-2 gap-space-lg">
        {entries.length === 0 && (
          <div className="col-span-full rounded-xl bg-surface-container-lowest p-space-md shadow-[0_8px_24px_rgba(85,95,75,0.06)]">
            <div className="min-h-[440px] rounded-lg bg-surface-container-low flex flex-col items-center justify-center gap-space-md text-center p-space-xl">
              <div className="w-16 h-16 rounded-full bg-surface-container-lowest shadow-md flex items-center justify-center text-primary">
                <StitchIcon name="spa" size={32} />
              </div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface">开始第一幅画作</h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                填写提示词并开始绘制, 排队状态与作品会显示在这里.
              </p>
            </div>
          </div>
        )}
        {/* 使用状态图标与真实时长表达任务状态, 不展示模拟进度 */}
        {entries.map((entry) => {
          if (entry.kind === 'job') {
            const job = entry.job;
            if (job.status === 'failed') {
              return (
                <article
                  key={entry.key}
                  data-studio-entry={entry.key}
                  aria-label={`未完成画稿: ${job.prompt}`}
                  className="relative flex flex-col bg-error-container/40 rounded-xl p-space-md shadow-[0_8px_24px_rgba(85,95,75,0.06)]"
                >
                  <div className="w-full aspect-square rounded-lg bg-surface-container-lowest/80 flex flex-col items-center justify-center p-space-xl text-center">
                    <div className="w-12 h-12 rounded-full bg-error/10 text-error flex items-center justify-center mb-space-sm">
                      <StitchIcon name="gpp_bad" size={28} />
                    </div>
                    <h4 className="font-headline-sm text-headline-sm text-on-error-container mb-1">生成未完成</h4>
                    <CreditStatus credit={job.credit} pending={job.settlementPending} />
                    <p className="font-body-sm text-body-sm text-on-surface-variant max-w-sm mb-space-md leading-relaxed">
                      {job.error || '生成暂时不可用, 请稍后重试'}
                    </p>
                    <div className="flex items-center gap-space-sm">
                      <button
                        type="button"
                        className="px-space-md py-2 rounded-lg bg-surface-container text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high transition-colors"
                        disabled={job.retrying}
                        onClick={() => props.onEditPrompt(job.prompt)}
                      >
                        修改提示词
                      </button>
                      <button
                        type="button"
                        className="px-space-md py-2 rounded-lg bg-primary text-on-primary font-body-sm text-body-sm hover:bg-primary-container shadow-sm flex items-center gap-1 transition-colors"
                        disabled={!job.canRetry || job.retrying}
                        onClick={() => onRetryJob(job.id)}
                      >
                        <RefreshCw size={16} aria-hidden />
                        <span>{job.retrying ? '正在提交...' : '一键重试'}</span>
                        <CreditCost points={job.recoveryPoints} unlimited={job.recoveryUnlimited} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-space-md text-on-surface-variant font-meta-sm text-meta-sm">
                    <span className="truncate">任务已停止 · 可重试</span>
                    <span>{relativeTime(job.createdAt)}</span>
                  </div>
                </article>
              );
            }
            const isRunning = job.status === 'running';
            const isReceiving = job.status === 'receiving';
            const isSubmitting = job.status === 'submitting';
            const isUnsubmitted = job.status === 'unsubmitted';
            const receipt = deliveryMessage(job.delivery);
            const deliveryFailed = isReceiving && job.delivery?.phase === 'error';
            const active = isRunning || isSubmitting || isReceiving && Boolean(job.delivery) && !deliveryFailed;
            const title = isReceiving ? receipt.title : isSubmitting ? '正在提交画稿' : isUnsubmitted ? '提交待确认' : isRunning ? '正在渲染' : '排队等候中';
            const detail = isReceiving ? receipt.detail : isSubmitting ? '正在上传并等待确认' : isUnsubmitted ? '可继续提交, 已受理的任务不会重复生成' : isRunning ? <QueueElapsed job={job.timing} /> : personalQueuePosition(job.position);
            return (
              <article
                key={entry.key}
                data-studio-entry={entry.key}
                className="relative flex flex-col bg-surface-container-lowest rounded-xl p-space-md shadow-[0_8px_24px_rgba(85,95,75,0.06)] overflow-hidden"
              >
                <div className="relative w-full aspect-square rounded-lg bg-surface-container-low overflow-hidden flex flex-col items-center justify-center p-space-lg">
                  <div className="absolute inset-0 bg-gradient-to-tr from-surface-container via-surface-container-low to-secondary-fixed-dim/20" />
                  <div className="relative z-10 flex flex-col items-center gap-space-md text-center">
                    <div className={`w-16 h-16 rounded-full bg-surface-container-lowest/80 backdrop-blur-md shadow-md flex items-center justify-center ${deliveryFailed ? 'text-error' : 'text-primary'}`}>
                      <StitchIcon name={active ? 'progress_activity' : deliveryFailed ? 'error' : 'schedule'} size={32} className={active ? 'motion-safe:animate-spin' : ''} />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-headline-sm text-headline-sm text-on-surface">
                        {title}
                      </h3>
                      <p className="font-meta-sm text-meta-sm text-on-surface-variant truncate max-w-[240px]">
                        {job.prompt.slice(0, 40)}
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-bright text-on-surface-variant font-meta-sm text-meta-sm shadow-sm">
                      <span className="break-words">{detail}</span>
                    </div>
                    {job.status === 'queued' && <div className="font-meta-sm text-meta-sm text-on-surface-variant"><QueueElapsed job={job.timing} /></div>}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-space-md">
                  <span className="font-meta-sm text-meta-sm text-on-surface-variant truncate max-w-[240px]">
                    {job.status === 'queued' ? '轮到后自动开始' : job.prompt.slice(0, 50)}
                  </span>
                  {isReceiving && job.delivery?.phase === 'error' ? (
                    <button type="button" className="font-meta-sm text-meta-sm text-primary hover:underline shrink-0" disabled={job.retrying} onClick={() => onRetryJob(job.id)}>重试领取</button>
                  ) : isUnsubmitted ? (
                    <button type="button" className="inline-flex items-center gap-1.5 font-meta-sm text-meta-sm text-primary shrink-0" disabled={!job.canRetry || job.retrying} onClick={() => onRetryJob(job.id)}>继续提交<CreditCost /></button>
                  ) : job.status === 'queued' ? (
                    <button type="button" className="font-meta-sm text-meta-sm text-error hover:underline shrink-0" onClick={() => onCancelJob(job.id)}>取消排队</button>
                  ) : <span className="font-meta-sm text-meta-sm text-outline shrink-0">{isSubmitting ? '提交中' : isReceiving ? '领取中' : '生成中'}</span>}
                </div>
              </article>
            );
          }
          const record = entry.record;
          return (
            <article
              key={entry.key}
              data-studio-entry={entry.key}
              className="group relative flex flex-col bg-surface-container-lowest rounded-xl p-space-md shadow-[0_8px_24px_rgba(85,95,75,0.06)] hover:shadow-[0_16px_40px_rgba(85,95,75,0.12)] transition-all"
            >
              <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-surface-container">
                <button
                  type="button"
                  className="absolute inset-0 cursor-zoom-in"
                  aria-label={`查看作品详情: ${record.prompt.slice(0, 24) || '未命名作品'}`}
                  title="查看作品详情"
                  onClick={() => onFullscreen(record)}
                >
                  <RecordImage
                    className="pointer-events-none h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                    record={record}
                    alt=""
                  />
                </button>
                <div className="absolute top-space-sm right-space-sm z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200 bg-surface-bright/90 backdrop-blur-md p-1 rounded-lg shadow-md">
                  <button
                    type="button"
                    className="w-8 h-8 rounded-md hover:bg-surface-container flex items-center justify-center text-on-surface transition-colors"
                    title="下载无损图"
                    onClick={(event) => { event.stopPropagation(); onDownload(record); }}
                  >
                    <Download size={18} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="w-8 h-8 rounded-md hover:bg-surface-container flex items-center justify-center text-on-surface transition-colors"
                    title="复制原图"
                    aria-label="复制原图"
                    onClick={(event) => { event.stopPropagation(); void onCopy(record); }}
                  >
                    <Copy size={18} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="w-8 h-8 rounded-md hover:bg-surface-container flex items-center justify-center text-on-surface transition-colors"
                    title="局部涂抹修改"
                    onClick={(event) => { event.stopPropagation(); onOpenMask(record); }}
                  >
                    <Brush size={18} aria-hidden />
                  </button>
                </div>
                <div className="pointer-events-none absolute top-space-sm left-space-sm z-10">
                  <span className="px-2 py-0.5 rounded bg-surface-bright/90 backdrop-blur-md font-meta-sm text-meta-sm text-primary font-medium shadow-sm">
                    作品 #{record.id.slice(-3)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 pt-space-md">
                <div className="flex items-center justify-between">
                  <h3 className="font-headline-sm text-headline-sm text-on-surface truncate">
                    {record.prompt.slice(0, 24) || '未命名作品'}
                  </h3>
                  <span className="font-meta-sm text-meta-sm text-on-surface-variant shrink-0">
                    {relativeTime(record.createdAt)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-on-surface-variant font-meta-sm text-meta-sm">
                  <span className="px-2 py-0.5 rounded bg-surface-container-low">
                    {metadata[record.id]?.size || '读取画幅...'}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-surface-container-low">
                    {record.mode === 'edit' ? '局部重绘' : record.mode === 'reference' ? '参考图生成' : '文生图'}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-secondary-container text-on-secondary-container">
                    {imageFileExtension(record.dataUrl, record.outputFormat).toUpperCase()}
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <p className="font-meta-sm text-meta-sm text-on-surface-variant">作品仅保存在此浏览器, 完整作品可前往展馆查看.</p>
    </section>
  );
}
