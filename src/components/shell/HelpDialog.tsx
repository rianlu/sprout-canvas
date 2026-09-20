import { useEffect } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { StitchIcon } from '../ui/StitchIcon';

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useFocusTrap<HTMLDivElement>(open);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="工作台帮助" className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-surface p-space-lg shadow-xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between mb-space-lg"><h2 className="font-headline-lg text-headline-lg">工作台帮助</h2><button type="button" aria-label="关闭帮助" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-container"><StitchIcon name="close" size={20} /></button></div>
      <div className="space-y-space-md text-body-sm leading-relaxed">
        <section><h3 className="font-medium mb-1">创作与下载</h3><p>描述画面, 或从风格库载入完整提示词后修改. 已选模板会展示示例图与名称, 移除模板关联会保留当前文案. 可多选上传最多 4 张参考图, 单张不超过 12 MiB, 在提示词中按图 1, 图 2 说明用途. 已有图片可继续添加, 或逐张更换和移除. 参考区为空时也可拖入图片或在左侧配置区按 ⌘/Ctrl + V 粘贴, 已有素材时不会覆盖. 按 ⌘/Ctrl + Enter 提交. 文生图和参考图生成可一次生成 1, 2 或 4 张, 队列会逐张执行, 按输出张数使用灵感点.</p></section>
        <section><h3 className="font-medium mb-1">提示词润色</h3><p>润色会参考原文的完整程度调整表达, 按指令保留原语言, 主体数量, 画面文字和占位符. 完成后请检查内容, 可点击撤销润色回到原文, 再点击恢复润色找回结果, 两边的手工修改都会保留. 当前草稿保存最近一次润色的前后版本, 刷新后仍可切换. 撤销和恢复不消耗灵感点, 已成功的润色不会因撤销退点.</p></section>
        <section><h3 className="font-medium mb-1">局部重绘</h3><p>在作品上选择局部重绘, 自动继承原作品的画幅, 质量与格式. 多图参考时先选择一张需要修改的原图, 其他参考图会保留在草稿中, 不参与本次编辑. 涂抹需要修改的区域并填写修改要求, 保存蒙版后点击开始局部重绘. 每次生成一个新版本, 原图保留. 如需调整画幅或风格, 切换参考图生成. 清空蒙版会阻止编辑提交, 未涂抹区域仍可能存在模型生成的细节变化.</p></section>
        <section><h3 className="font-medium mb-1">灵感点与访问码</h3><p>有限额度下, 生成图片, 润色提示词和拆解分镜都会使用灵感点, 每次消耗以操作按钮上的点数为准. 提交时先占用点数, 成功后扣除; 明确失败或在开始前取消会返还. 结果暂不明确时保留占用, 请联系管理员核实, 避免重复提交.</p><p className="mt-2">共用同一个访问码的人共享名称和余额, 各自浏览器的任务独立. 无限额度不扣减余额, 只在顶部显示无限灵感点, 操作按钮不再重复标注. 用户菜单可查看访问名称, 切换外观和退出当前登录, 退出不会影响其他使用者.</p></section>
        <section><h3 className="font-medium mb-1">作品保存在此浏览器</h3><p>创作画卷最多显示 4 个近期记录, 当前批次优先, 仍在排队或生成的上一张也会保留. 点击画卷图片打开作品详情, 可再用作参考图或切图. 卡片可下载或复制原图. 展馆点开图片查看详情, 需要批量下载或删除时再点管理作品; 详情中可复制原图后粘贴到参考槽. 清理浏览器数据会清除作品, 喜欢的图片请及时下载.</p></section>
        <section><h3 className="font-medium mb-1">排队与恢复</h3><p>在顶部任务队列中查看全站生图数量和自己的全部任务及失败原因. 等待数包含你的任务, 不同创作者轮流执行, 我的待生成顺序只表示个人任务顺序. 排队和生成分别计时, 轮到后自动开始. 刷新或关闭页面不会取消已提交任务, 也不会重复扣点, 请及时回到此浏览器领取结果. 排队任务可以取消或在自己的队列中置顶, 已开始的生成无法撤回. 服务重启后的未执行任务可恢复, 结果未知的任务会单独提示.</p></section>
        <section><h3 className="font-medium mb-1">系列创作</h3><p>填写故事梗概或分段分镜剧本, 将角色外貌, 服饰或商品特征写在其中. 点击智能拆解分镜生成提示词, 逐镜检查和修改后, 点击分镜下方的确认并生成按钮开始绘图. 待确认稿会保存在此浏览器, 刷新后可继续编辑. 梗概输入框中的 ⌘/Ctrl + Enter 只执行拆解. 可添加参考图, 后续分镜引用首镜保持主体与画风连贯. 重绘会保留版本关系, 输出仍可能存在差异.</p></section>
        <section><h3 className="font-medium mb-1">文件与分享</h3><p>PNG 和 WebP 可用于透明背景, JPEG 不保留透明通道. 查看器显示实际图片尺寸与生成配方. 作品详情中的切图拆分可按行列切分图片, 一次打包下载全部切片为 ZIP, 也可逐张下载或送回创作台. 切图在浏览器完成, 不消耗灵感点. 支持文件分享的浏览器会显示系统分享入口, 图片不会上传到工作台服务器生成链接.</p></section>
        <section><h3 className="font-medium mb-1">创作守则</h3><p>使用有权使用的素材, 核对图片中的文字和事实, 尊重肖像与作品权利. 初始开源案例保留 CC BY 4.0 署名. 其他风格请查看各条详情中的来源与许可.</p></section>
      </div>
    </div>
  </div>;
}
