import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { StitchIcon } from '../components/ui/StitchIcon';
import { AdminEmpty, AdminHeading, AdminLoading, adminButton, adminField, adminPanel } from '../components/admin/AdminUI';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useStyleCatalog } from '../hooks/useStyleCatalog';
import { getStyles, saveStyle, deleteStyle, exportStyles, previewStylesImport, importStyles } from '../lib/api/styles';
import { prepareStylePreview } from '../lib/image/style-preview';
import { STYLE_LIMITS, type StyleInput, type StyleRecord, type StyleImportPreview } from '../../shared/style-contract.mjs';

type Editor = { record: StyleRecord | null; input: StyleInput };
const button = adminButton;
const field = adminField;
function editInput(style: StyleRecord): StyleInput { return { name: style.name, prompt: style.prompt, author: style.author, category: style.category, sourceUrl: style.sourceUrl, published: style.published, sortOrder: style.sortOrder, version: style.version }; }

export function StyleManager({ active, editStyleId, onStyleOpened }: { active: boolean; editStyleId?: string | null; onStyleOpened?: () => void }) {
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const imageSequence = useRef(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [pendingImport, setPendingImport] = useState<{ archive: unknown; preview: StyleImportPreview; filename: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const catalog = useStyleCatalog(true, active);
  const dialogRef = useFocusTrap<HTMLDivElement>(Boolean(active && (editor || pendingImport)));
  const modalOpen = Boolean(active && (editor || pendingImport));
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !lock.current) { imageSequence.current++; setEditor(null); setPendingImport(null); } };
    window.addEventListener('keydown', key);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', key); };
  }, [modalOpen]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setWorking(true); setError(''); setMessage('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败, 请重试'); }
    finally { lock.current = false; setWorking(false); }
  }
  function openEditor(record: StyleRecord | null) {
    imageSequence.current++; setImageBusy(false); setError(''); setMessage('');
    setEditor({ record, input: record ? editInput(record) : { name: '', prompt: '', author: '', category: '', sourceUrl: '', published: true, sortOrder: 0 } });
  }
  useEffect(() => {
    if (!active || !editStyleId || working || lock.current) return;
    onStyleOpened?.();
    void run(async () => {
      const catalog = await getStyles(true);
      const record = catalog.styles.find((style) => style.id === editStyleId);
      if (!record) throw new Error('这份风格已被删除, 请查看最新列表');
      openEditor(record);
    });
  }, [active, editStyleId, onStyleOpened, working]);
  function update(patch: Partial<StyleInput>) { setEditor((value) => value && { ...value, input: { ...value.input, ...patch } }); }
  async function chooseImage(file: File) {
    if (lock.current || !editor) return;
    const sequence = ++imageSequence.current;
    setImageBusy(true); setError('');
    try { const imageDataUrl = await prepareStylePreview(file); if (sequence === imageSequence.current) update({ imageDataUrl }); }
    catch (cause) { if (sequence === imageSequence.current) setError(cause instanceof Error ? cause.message : '图片读取失败'); }
    finally { if (sequence === imageSequence.current) setImageBusy(false); }
  }
  function paste(event: ClipboardEvent) {
    const image = Array.from(event.clipboardData.items).find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    if (image) { event.preventDefault(); void chooseImage(image); }
  }
  function submitEditor(event: FormEvent) {
    event.preventDefault();
    if (!editor || imageBusy) return;
    const value = editor;
    void run(async () => {
      const saved = await saveStyle(value.input, value.record?.id);
      setEditor(null); imageSequence.current++;
      await catalog.refresh();
      setMessage(`已保存 ${saved.style.name}${saved.style.published ? ', 已在风格库上架' : ', 暂未上架'}`);
    });
  }
  async function readImport(file: File) {
    await run(async () => {
      if (file.size > STYLE_LIMITS.archiveBytes) throw new Error('备份文件不能超过 64 MB');
      let archive: unknown;
      try { archive = JSON.parse(await file.text()); } catch { throw new Error('请选择有效的芽绘台 JSON 备份文件'); }
      const preview = await previewStylesImport(archive);
      setPendingImport({ archive, preview, filename: file.name });
    });
  }
  const feedback = (error || message) && <div role={error ? 'alert' : 'status'} className={`p-3 rounded-xl font-body-sm text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-secondary-container text-on-secondary-container'}`}>{error || message}</div>;
  const items = catalog.styles.filter((style) => (status === 'all' || style.published === (status === 'published')) && [style.name, style.prompt, style.author, style.category].join(' ').toLowerCase().includes(search.trim().toLowerCase()));

  return <>
    <main className="admin-page space-y-6">
      <AdminHeading icon="palette" eyebrow="灵感素材 · 图片与提示词" title="风格管理" description="收集喜欢的图片与提示词, 整理成随时可用的创作模板.">
          <button type="button" disabled={working} className={`${button} bg-surface-container-low hover:bg-surface-container`} onClick={() => importInput.current?.click()}><StitchIcon name="upload_file" size={18} />导入备份</button>
          <button type="button" disabled={working || catalog.loading} className={`${button} bg-surface-container-low hover:bg-surface-container`} onClick={() => void run(async () => { await exportStyles(); setMessage('备份已导出, 包含提示词和示例图'); })}><StitchIcon name="download" size={18} />导出备份</button>
          <button type="button" disabled={working} className={`${button} bg-primary text-on-primary hover:bg-primary-container`} onClick={() => openEditor(null)}><StitchIcon name="add" size={18} />添加风格</button>
      </AdminHeading>
      <input ref={importInput} type="file" accept=".json,application/json" aria-label="导入风格备份" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readImport(file); }} />
      {!editor && !pendingImport && feedback}
      {catalog.error && <div role="alert" className="p-3 my-3 rounded-xl bg-error-container text-on-error-container">{catalog.error}<button type="button" className="ml-3 underline" onClick={() => void catalog.refresh()}>重新读取</button></div>}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
        <div className="relative w-full sm:max-w-sm"><StitchIcon name="search" size={18} className="absolute left-3 top-3.5 text-outline" /><input aria-label="搜索管理风格" className={`${field} !pl-10`} placeholder="搜索名称, 提示词或作者..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <select aria-label="上架状态" className={`${field} sm:w-36`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="published">已上架</option><option value="hidden">未上架</option></select>
        <p className="sm:ml-auto font-meta-sm text-meta-sm text-on-surface-variant">共 {catalog.styles.length} 款 · 已上架 {catalog.styles.filter((style) => style.published).length} 款</p>
      </div>
      {catalog.loading && <AdminLoading label="正在读取风格..." />}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {items.map((style) => <article key={style.id} className={`admin-style-card relative group ${adminPanel} p-3 flex flex-col hover:border-primary/50 transition-colors`}>
          <div className="relative aspect-[16/10] shrink-0 rounded-xl overflow-hidden bg-surface-container-low"><img src={style.image} alt={style.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200" /><span className="absolute top-2 left-2 px-2 py-1 rounded-lg bg-surface-bright/95 text-secondary font-meta-sm text-meta-sm">{style.published ? '已上架' : '未上架'}</span></div>
          <div className="min-w-0 flex-1 flex flex-col gap-2 px-1 pt-4"><h2 className="font-body-md text-body-md font-medium line-clamp-2 break-words">{style.name}</h2><p className="font-meta-sm text-meta-sm text-secondary truncate">{style.author || '未注明作者'} · {style.category || '未分类'}</p><p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-2 break-words leading-relaxed mb-3">{style.prompt}</p>
            <div className="flex items-center justify-between gap-2 font-body-sm text-body-sm pt-2 mt-auto border-t border-outline-variant/25"><span className="inline-flex items-center gap-1 text-outline font-meta-sm text-meta-sm"><StitchIcon name="edit_note" size={16} />编辑详情</span><div className="flex items-center gap-1">
              <button type="button" className="relative z-10 px-2 py-2 rounded-lg text-primary hover:bg-secondary-container/50 disabled:opacity-50" disabled={working} onClick={() => void run(async () => { await saveStyle({ ...editInput(style), published: !style.published }, style.id); await catalog.refresh(); setMessage(style.published ? '已下架, 风格库不再展示这条内容' : '已上架'); })}>{style.published ? '下架' : '上架'}</button>
              <button type="button" className="relative z-10 px-2 py-2 rounded-lg text-on-surface-variant hover:bg-error-container/60 hover:text-on-error-container disabled:opacity-50" disabled={working} onClick={() => { if (window.confirm(`永久删除 ${style.name}? 此操作会清理不再使用的示例图.`)) void run(async () => { await deleteStyle(style); await catalog.refresh(); setMessage('已删除风格'); }); }}>删除</button>
            </div></div>
          </div>
          <button type="button" aria-label={`编辑 ${style.name}`} onClick={() => openEditor(style)} disabled={working} className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" />
        </article>)}
      </div>
      {!catalog.loading && !catalog.error && items.length === 0 && <AdminEmpty icon="palette" title={catalog.styles.length ? '没有匹配的风格' : '添加第一份风格'} description={catalog.styles.length ? '试试其他关键词, 或调整上架状态筛选.' : '准备一张图片和一段提示词, 就可以开始整理.'} />}
    </main>
    {modalOpen && <div className="fixed inset-0 z-50 bg-inverse-surface/45 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5" role="dialog" aria-modal="true" aria-label={editor ? editor.record ? '编辑风格' : '添加风格' : '确认导入备份'}>
      <div ref={dialogRef} className={`w-full ${editor ? 'max-w-5xl' : 'max-w-lg'} max-h-[92dvh] overflow-y-auto rounded-3xl bg-surface-container-lowest shadow-2xl border border-outline-variant/30`}>
        <div className="sticky top-0 z-10 bg-surface-container-lowest flex items-center justify-between px-5 sm:px-7 py-5 border-b border-outline-variant/30"><div><h2 className="font-headline-sm text-headline-sm">{editor ? editor.record ? '编辑风格' : '添加风格' : '确认导入备份'}</h2><p className="mt-1 font-meta-sm text-meta-sm text-on-surface-variant">{editor ? '图片与提示词为必填, 其他信息按需补充.' : '核对备份内容后再导入.'}</p></div><button type="button" aria-label="关闭管理弹窗" className="w-9 h-9 rounded-xl bg-surface-container-low hover:bg-surface-container flex items-center justify-center" disabled={working} onClick={() => { imageSequence.current++; setEditor(null); setPendingImport(null); }}><StitchIcon name="close" size={20} /></button></div>
        {editor ? <form onSubmit={submitEditor} onPaste={paste} className="px-5 pt-5 sm:px-7 sm:pt-6 flex flex-col gap-5">
          {feedback}
          <fieldset disabled={working} className="contents">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex flex-col gap-2">
              <span className="font-body-sm text-body-sm font-medium">示例图 <span className="text-primary">*</span></span>
              <div tabIndex={0} role="group" aria-label="示例图粘贴区" className="relative aspect-[4/3] md:aspect-auto md:h-[340px] rounded-2xl border border-dashed border-outline-variant bg-surface-container-low/60 flex flex-col items-center justify-center overflow-hidden focus:outline-primary" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void chooseImage(file); }}>
                {editor.input.imageDataUrl || editor.record?.image ? <img src={editor.input.imageDataUrl || editor.record?.image} alt="示例图预览" className="absolute inset-0 w-full h-full object-contain p-2" /> : <div className="p-6 text-center text-on-surface-variant flex flex-col items-center gap-3"><StitchIcon name="add_photo_alternate" size={36} /><span className="font-body-sm text-body-sm">拖拽图片到这里<br />或按 Cmd+V / Ctrl+V 粘贴</span></div>}
              </div>
              <button type="button" disabled={working || imageBusy} className={`${button} bg-surface-container hover:bg-surface-container-high`} onClick={() => fileInput.current?.click()}>{imageBusy ? '处理图片中...' : editor.input.imageDataUrl || editor.record?.image ? '更换图片' : '选择图片'}</button>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传风格示例图" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void chooseImage(file); }} />
              <p className="font-meta-sm text-meta-sm text-outline">PNG, JPEG 或 WebP, 最大 12 MB.</p>
              {editor.record?.license && <p className="mt-2 font-meta-sm text-meta-sm text-outline leading-relaxed">{editor.input.imageDataUrl || (editor.input.author || '').trim() !== editor.record.author || (editor.input.sourceUrl || '').trim() !== editor.record.sourceUrl ? '更换素材或来源后, 将移除原素材的许可标记.' : `原素材许可: ${editor.record.license}`}</p>}
            </div>
            <div className="md:col-span-2 flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1.5 font-body-sm text-body-sm">名称<input className={field} maxLength={100} value={editor.input.name || ''} onChange={(event) => update({ name: event.target.value })} placeholder="不填时取提示词开头" /></label>
                <label className="flex flex-col gap-1.5 font-body-sm text-body-sm">分类<input className={field} list="admin-style-categories" maxLength={60} value={editor.input.category || ''} onChange={(event) => update({ category: event.target.value })} placeholder="未分类, 可选择或输入分类" /></label>
                <datalist id="admin-style-categories">{catalog.categories.map((category) => <option value={category} key={category} />)}</datalist>
              </div>
              <label className="flex flex-col gap-2 font-body-sm text-body-sm font-medium"><span>提示词 <span className="text-primary">*</span></span><textarea aria-label="风格提示词" className={`${field} resize-y leading-relaxed min-h-44`} rows={7} required maxLength={STYLE_LIMITS.prompt} value={editor.input.prompt} onChange={(event) => update({ prompt: event.target.value })} placeholder="粘贴收集到的完整提示词, 保留原文即可." /></label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1.5 font-body-sm text-body-sm">作者<input className={field} maxLength={200} value={editor.input.author || ''} onChange={(event) => update({ author: event.target.value })} placeholder="原作者名称" /></label>
                <label className="flex flex-col gap-1.5 font-body-sm text-body-sm">排序 (越小越靠前)<input className={field} type="number" min={0} max={999999} step={1} value={editor.input.sortOrder ?? 0} onChange={(event) => update({ sortOrder: Number(event.target.value) })} /></label>
              </div>
              <label className="flex flex-col gap-1.5 font-body-sm text-body-sm">来源链接<input className={field} type="url" maxLength={2048} value={editor.input.sourceUrl || ''} onChange={(event) => update({ sourceUrl: event.target.value })} placeholder="原始帖子或作品地址" /></label>
            </div>
          </div>
          <div className="sticky bottom-0 z-10 -mx-5 sm:-mx-7 px-5 sm:px-7 py-4 bg-surface-container-lowest border-t border-outline-variant/30 flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 font-body-sm text-body-sm"><input type="checkbox" className="accent-primary w-4 h-4" checked={editor.input.published} onChange={(event) => update({ published: event.target.checked })} />在风格库上架</label><div className="flex items-center gap-2"><button type="button" disabled={working} className={`${button} bg-surface-container`} onClick={() => { imageSequence.current++; setEditor(null); }}>取消</button><button type="submit" disabled={working || imageBusy || !editor.input.prompt.trim() || !(editor.input.imageDataUrl || editor.record?.image)} className={`${button} bg-primary text-on-primary hover:bg-primary-container`}>{working ? '保存中...' : '保存风格'}</button></div></div>
          </fieldset>
        </form> : pendingImport && <div className="p-5 flex flex-col gap-4">{feedback}<p className="font-body-sm text-body-sm break-words">{pendingImport.filename}</p><p>新增 {pendingImport.preview.added} 条, 更新 {pendingImport.preview.updated} 条, 相同 {pendingImport.preview.unchanged} 条.</p><p className="font-body-sm text-body-sm text-on-surface-variant">同一编号的内容将按备份更新. 其他已有风格会保留.</p><button type="button" disabled={working} className={`${button} bg-primary text-on-primary`} onClick={() => void run(async () => { const result = await importStyles(pendingImport.archive, pendingImport.preview.revision); setPendingImport(null); await catalog.refresh(); setMessage(`导入完成, 新增 ${result.added} 条, 更新 ${result.updated} 条`); })}>{working ? '导入中...' : '确认导入'}</button></div>}
      </div>
    </div>}
  </>;
}
