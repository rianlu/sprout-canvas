import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { StitchIcon } from '../components/ui/StitchIcon';
import { useTheme } from '../hooks/useTheme';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useStyleCatalog } from '../hooks/useStyleCatalog';
import { adminStatus, adminLogin, adminLogout, saveStyle, deleteStyle, exportStyles, previewStylesImport, importStyles } from '../lib/api/styles';
import { prepareStylePreview } from '../lib/image/style-preview';
import { STYLE_LIMITS, type StyleInput, type StyleRecord, type StyleImportPreview } from '../../shared/style-contract.mjs';

type Editor = { record: StyleRecord | null; input: StyleInput };
const button = 'px-3 py-2 rounded-xl font-body-sm text-body-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50';
const field = 'w-full rounded-xl bg-surface-container-low border border-outline-variant/40 px-3 py-2.5 outline-none focus:border-primary font-body-sm text-body-sm text-on-surface';
function editInput(style: StyleRecord): StyleInput { return { name: style.name, prompt: style.prompt, author: style.author, category: style.category, sourceUrl: style.sourceUrl, published: style.published, sortOrder: style.sortOrder, version: style.version }; }

export function StyleAdmin({ onBack }: { onBack: () => void }) {
  const { theme, toggle } = useTheme();
  const [session, setSession] = useState<{ configured: boolean; authenticated: boolean } | null>(null);
  const [password, setPassword] = useState('');
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
  const catalog = useStyleCatalog(true, Boolean(session?.authenticated));
  const dialogRef = useFocusTrap<HTMLDivElement>(Boolean(session?.authenticated && (editor || pendingImport)));
  const checkSession = useCallback(async () => {
    try { setSession(await adminStatus()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '管理后台连接失败'); }
  }, []);
  useEffect(() => {
    void checkSession();
    const expired = () => setSession((value) => value && { ...value, authenticated: false });
    window.addEventListener('sprout:admin-expired', expired);
    return () => window.removeEventListener('sprout:admin-expired', expired);
  }, [checkSession]);
  const modalOpen = Boolean(session?.authenticated && (editor || pendingImport));
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

  return <div className="min-h-screen bg-surface text-on-surface font-body-md text-body-md">
    <header className="border-b border-outline-variant/30 bg-surface-container-lowest/70">
      <div className="max-w-[1560px] mx-auto px-gutter-canvas py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><img src="/assets/stitch/gallery-00.png" alt="芽绘台" className="w-9 h-9 object-contain" /><span className="font-headline-sm text-headline-sm">芽绘台 · 风格管理</span></div>
        <div className="flex items-center gap-2">
          <button type="button" className={`${button} hover:bg-surface-container`} onClick={onBack}><StitchIcon name="arrow_back" size={17} />返回风格库</button>
          <button type="button" aria-label="切换主题" className={`${button} bg-surface-container-low`} onClick={toggle}><StitchIcon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} size={18} /></button>
          {session?.authenticated && <button type="button" className={`${button} bg-surface-container-low`} disabled={working} onClick={() => void run(async () => { await adminLogout(); setSession((value) => value && { ...value, authenticated: false }); setEditor(null); setPendingImport(null); })}>退出管理</button>}
        </div>
      </div>
    </header>
    {!session?.authenticated ? <main className="max-w-md mx-auto px-4 py-16">
      <section className="p-7 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm flex flex-col gap-5">
        <div className="w-12 h-12 rounded-2xl bg-primary-fixed text-primary flex items-center justify-center"><StitchIcon name="lock" size={27} /></div>
        <h1 className="font-headline-lg text-headline-lg tracking-tight">进入风格管理</h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant">使用管理员密码维护图片和提示词.</p>
        {feedback}
        {!session ? <><p role="status">正在连接...</p>{error && <button type="button" className={`${button} bg-primary text-on-primary`} onClick={() => void checkSession()}>重新连接</button>}</> : !session.configured ? <p className="font-body-sm text-body-sm text-on-surface-variant">管理员入口尚未启用. 请在服务端配置管理员密码后重新进入.</p> : <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void run(async () => { await adminLogin(password); setPassword(''); await checkSession(); }); }}>
          <label className="flex flex-col gap-2 font-body-sm text-body-sm">管理员密码<input className={field} type="password" autoComplete="current-password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} maxLength={256} required /></label>
          <button type="submit" disabled={working || !password} className={`${button} bg-primary text-on-primary hover:bg-primary-container`}>{working ? '登录中...' : '登录管理后台'}</button>
        </form>}
      </section>
    </main> : <main className="max-w-[1560px] mx-auto px-gutter-canvas py-space-lg">
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div><p className="font-meta-sm text-meta-sm text-secondary mb-1">素材与提示词</p><h1 className="font-headline-lg text-headline-lg tracking-tight">风格管理</h1><p className="font-body-sm text-body-sm text-on-surface-variant mt-2">共 {catalog.styles.length} 条, 已上架 {catalog.styles.filter((style) => style.published).length} 条. 粘贴图片与提示词, 整理每一次灵感.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={working} className={`${button} bg-surface-container hover:bg-surface-container-high`} onClick={() => importInput.current?.click()}><StitchIcon name="upload_file" size={18} />导入备份</button>
          <button type="button" disabled={working || catalog.loading} className={`${button} bg-surface-container hover:bg-surface-container-high`} onClick={() => void run(async () => { await exportStyles(); setMessage('备份已导出, 包含提示词和示例图'); })}><StitchIcon name="download" size={18} />导出备份</button>
          <button type="button" disabled={working} className={`${button} bg-primary text-on-primary hover:bg-primary-container`} onClick={() => openEditor(null)}><StitchIcon name="add" size={18} />添加风格</button>
        </div>
        <input ref={importInput} type="file" accept=".json,application/json" aria-label="导入风格备份" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readImport(file); }} />
      </section>
      {!editor && !pendingImport && feedback}
      {catalog.error && <div role="alert" className="p-3 my-3 rounded-xl bg-error-container text-on-error-container">{catalog.error}<button type="button" className="ml-3 underline" onClick={() => void catalog.refresh()}>重新读取</button></div>}
      <div className="flex flex-col sm:flex-row gap-3 my-5"><input aria-label="搜索管理风格" className={`${field} sm:max-w-md`} placeholder="搜索名称, 提示词或作者..." value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="上架状态" className={`${field} sm:w-36`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="published">已上架</option><option value="hidden">未上架</option></select></div>
      {catalog.loading && <p role="status" className="py-8 text-center">正在读取风格...</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((style) => <article key={style.id} className="admin-style-card p-3 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest flex gap-3">
          <button type="button" aria-label={`编辑 ${style.name}`} onClick={() => openEditor(style)} disabled={working} className="w-24 sm:w-28 h-32 self-start shrink-0 rounded-xl overflow-hidden bg-surface-container-low"><img src={style.image} alt={style.name} loading="lazy" className="w-full h-full object-cover" /></button>
          <div className="min-w-0 flex-1 flex flex-col gap-2"><div className="flex items-start gap-2 justify-between"><h2 className="font-body-md text-body-md font-medium line-clamp-2 break-words">{style.name}</h2><span className={`shrink-0 px-1.5 py-0.5 rounded font-meta-sm text-[11px] ${style.published ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{style.published ? '已上架' : '未上架'}</span></div><p className="font-meta-sm text-meta-sm text-on-surface-variant truncate">{style.author || '未注明作者'} · {style.category || '未分类'}</p><p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-2 break-words">{style.prompt}</p><div className="flex flex-wrap gap-3 font-meta-sm text-meta-sm pt-1 mt-auto">
            <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={working} onClick={() => openEditor(style)}>编辑</button>
            <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={working} onClick={() => void run(async () => { await saveStyle({ ...editInput(style), published: !style.published }, style.id); await catalog.refresh(); setMessage(style.published ? '已下架, 风格库不再展示这条内容' : '已上架'); })}>{style.published ? '下架' : '上架'}</button>
            <button type="button" className="text-error hover:underline disabled:opacity-50" disabled={working} onClick={() => { if (window.confirm(`永久删除 ${style.name}? 此操作会清理不再使用的示例图.`)) void run(async () => { await deleteStyle(style); await catalog.refresh(); setMessage('已删除风格'); }); }}>删除</button>
          </div></div>
        </article>)}
      </div>
      {!catalog.loading && !catalog.error && items.length === 0 && <p className="py-12 text-center text-on-surface-variant">没有匹配的内容, 可以调整搜索或添加风格.</p>}
    </main>}
    {modalOpen && <div className="fixed inset-0 z-50 bg-inverse-surface/45 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5" role="dialog" aria-modal="true" aria-label={editor ? editor.record ? '编辑风格' : '添加风格' : '确认导入备份'}>
      <div ref={dialogRef} className={`w-full ${editor ? 'max-w-5xl' : 'max-w-lg'} max-h-[94vh] overflow-y-auto rounded-2xl bg-surface shadow-2xl`}>
        <div className="sticky top-0 z-10 bg-surface flex items-center justify-between px-5 py-4 border-b border-outline-variant/30"><h2 className="font-headline-sm text-headline-sm">{editor ? editor.record ? '编辑风格' : '添加风格' : '确认导入备份'}</h2><button type="button" aria-label="关闭管理弹窗" className="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center" disabled={working} onClick={() => { imageSequence.current++; setEditor(null); setPendingImport(null); }}><StitchIcon name="close" size={20} /></button></div>
        {editor ? <form onSubmit={submitEditor} onPaste={paste} className="p-5 flex flex-col gap-4">
          {feedback}
          <fieldset disabled={working} className="contents">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
            <div className="md:col-span-2 flex flex-col gap-2">
              <span className="font-body-sm text-body-sm font-medium">示例图</span>
              <div tabIndex={0} role="group" aria-label="示例图粘贴区" className="relative min-h-60 md:min-h-80 rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low flex flex-col items-center justify-center overflow-hidden focus:outline-primary" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void chooseImage(file); }}>
                {editor.input.imageDataUrl || editor.record?.image ? <img src={editor.input.imageDataUrl || editor.record?.image} alt="示例图预览" className="w-full max-h-[52vh] object-contain" /> : <div className="p-6 text-center text-on-surface-variant flex flex-col items-center gap-3"><StitchIcon name="add_photo_alternate" size={36} /><span className="font-body-sm text-body-sm">拖拽图片到这里<br />或按 Cmd+V / Ctrl+V 粘贴</span></div>}
              </div>
              <button type="button" disabled={working || imageBusy} className={`${button} bg-surface-container hover:bg-surface-container-high`} onClick={() => fileInput.current?.click()}>{imageBusy ? '处理图片中...' : editor.input.imageDataUrl || editor.record?.image ? '更换图片' : '选择图片'}</button>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传风格示例图" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void chooseImage(file); }} />
              <p className="font-meta-sm text-meta-sm text-outline">PNG, JPEG 或 WebP, 最大 12 MB.</p>
            </div>
            <div className="md:col-span-3 flex flex-col gap-4">
              <label className="flex flex-col gap-2 font-body-sm text-body-sm font-medium">提示词<textarea aria-label="风格提示词" className={`${field} resize-y leading-relaxed min-h-60`} rows={10} required maxLength={STYLE_LIMITS.prompt} value={editor.input.prompt} onChange={(event) => update({ prompt: event.target.value })} placeholder="粘贴收集到的完整提示词, 保留原文即可." /></label>
              <label className="flex flex-col gap-2 font-body-sm text-body-sm">作者<input className={field} maxLength={200} value={editor.input.author || ''} onChange={(event) => update({ author: event.target.value })} placeholder="知道就填, 也可以留空" /></label>
              <details className="rounded-xl border border-outline-variant/30 p-3"><summary className="cursor-pointer font-body-sm text-body-sm text-primary">可选信息</summary><div className="flex flex-col gap-3 mt-4">
                <label className="flex flex-col gap-1.5 font-body-sm text-body-sm">名称<input className={field} maxLength={100} value={editor.input.name || ''} onChange={(event) => update({ name: event.target.value })} placeholder="不填时取提示词开头" /></label>
                <label className="flex flex-col gap-1.5 font-body-sm text-body-sm">分类<input className={field} list="admin-style-categories" maxLength={60} value={editor.input.category || ''} onChange={(event) => update({ category: event.target.value })} placeholder="未分类, 可选择或输入分类" /></label>
                <datalist id="admin-style-categories">{catalog.categories.map((category) => <option value={category} key={category} />)}</datalist>
                <label className="flex flex-col gap-1.5 font-body-sm text-body-sm">来源链接<input className={field} type="url" maxLength={2048} value={editor.input.sourceUrl || ''} onChange={(event) => update({ sourceUrl: event.target.value })} placeholder="原始帖子或作品地址" /></label>
                <label className="flex flex-col gap-1.5 font-body-sm text-body-sm">排序 (越小越靠前)<input className={field} type="number" min={0} max={999999} step={1} value={editor.input.sortOrder ?? 0} onChange={(event) => update({ sortOrder: Number(event.target.value) })} /></label>
              </div></details>
              {editor.record?.license && <p className="font-meta-sm text-meta-sm text-outline">{editor.input.imageDataUrl || (editor.input.author || '').trim() !== editor.record.author || (editor.input.sourceUrl || '').trim() !== editor.record.sourceUrl ? '更换素材或来源后, 将移除原素材的许可标记.' : `原素材许可: ${editor.record.license}`}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/30 pt-4"><label className="flex items-center gap-2 font-body-sm text-body-sm"><input type="checkbox" className="accent-primary w-4 h-4" checked={editor.input.published} onChange={(event) => update({ published: event.target.checked })} />在风格库上架</label><div className="flex items-center gap-2"><button type="button" disabled={working} className={`${button} bg-surface-container`} onClick={() => { imageSequence.current++; setEditor(null); }}>取消</button><button type="submit" disabled={working || imageBusy || !editor.input.prompt.trim() || !(editor.input.imageDataUrl || editor.record?.image)} className={`${button} bg-primary text-on-primary hover:bg-primary-container`}>{working ? '保存中...' : '保存风格'}</button></div></div>
          </fieldset>
        </form> : pendingImport && <div className="p-5 flex flex-col gap-4">{feedback}<p className="font-body-sm text-body-sm break-words">{pendingImport.filename}</p><p>新增 {pendingImport.preview.added} 条, 更新 {pendingImport.preview.updated} 条, 相同 {pendingImport.preview.unchanged} 条.</p><p className="font-body-sm text-body-sm text-on-surface-variant">同一编号的内容将按备份更新. 其他已有风格会保留.</p><button type="button" disabled={working} className={`${button} bg-primary text-on-primary`} onClick={() => void run(async () => { const result = await importStyles(pendingImport.archive, pendingImport.preview.revision); setPendingImport(null); await catalog.refresh(); setMessage(`导入完成, 新增 ${result.added} 条, 更新 ${result.updated} 条`); })}>{working ? '导入中...' : '确认导入'}</button></div>}
      </div>
    </div>}
  </div>;
}
