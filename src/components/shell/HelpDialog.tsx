import { useEffect } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { ServerConfig } from '../../types/provider';
import { StitchIcon } from '../ui/StitchIcon';

export function HelpDialog({ open, onClose, config }: { open: boolean; onClose: () => void; config: ServerConfig | null }) {
  const ref = useFocusTrap<HTMLDivElement>(open);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
  if (!open) return null;
  const labels = { available: '最近调用成功', untested: '尚未验证', degraded: '最近调用失败', cooldown: '暂停调用, 等待恢复' };
  return <div className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="工作台帮助" className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-surface p-space-lg shadow-xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between mb-space-lg"><h2 className="font-headline-lg text-headline-lg">工作台帮助</h2><button type="button" aria-label="关闭帮助" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-container"><StitchIcon name="close" size={20} /></button></div>
      <div className="space-y-space-md text-body-sm leading-relaxed">
        <section><h3 className="font-medium mb-1">创作与下载</h3><p>描述画面, 或从风格库载入完整提示词后修改, 可添加参考图重新创作. 按 ⌘/Ctrl + Enter 提交. 文生图和参考图生成可一次生成 1, 2 或 4 张, 队列会逐张执行.</p></section>
        <section><h3 className="font-medium mb-1">局部重绘</h3><p>在作品上选择局部重绘, 自动继承原作品的画幅, 质量与格式. 涂抹需要修改的区域并填写修改要求, 保存蒙版后点击开始局部重绘. 每次生成一个新版本, 原图保留. 如需调整画幅或风格, 切换参考图生成. 清空蒙版会阻止编辑提交, 未涂抹区域仍可能存在模型生成的细节变化.</p></section>
        <section><h3 className="font-medium mb-1">作品保存在此浏览器</h3><p>生成作品由服务器临时中转. 作品保存到此浏览器后即可下载, 删除会直接释放本地图片. 清理浏览器数据会清除作品, 喜欢的图片请及时下载.</p></section>
        <section><h3 className="font-medium mb-1">排队与恢复</h3><p>刷新可以继续跟踪已提交任务. 排队任务可以取消或在自己的队列中置顶. 已经发送给上游的生成无法撤回. 服务重启后的未执行任务可恢复, 结果未知的任务会单独提示.</p></section>
        <section><h3 className="font-medium mb-1">系列创作</h3><p>填写故事梗概或分段分镜剧本, 将角色外貌, 服饰或商品特征写在其中. 点击智能拆解分镜生成提示词, 逐镜检查和修改后, 点击分镜下方的确认并生成按钮开始绘图. 待确认稿会保存在此浏览器, 刷新后可继续编辑. 梗概输入框中的 ⌘/Ctrl + Enter 只执行拆解. 可添加参考图, 后续分镜引用首镜保持主体与画风连贯. 重绘会保留版本关系, 输出仍可能存在差异.</p></section>
        <section><h3 className="font-medium mb-1">文件与分享</h3><p>PNG 和 WebP 可用于透明背景, JPEG 不保留透明通道. 查看器显示实际图片尺寸与生成配方. 支持文件分享的浏览器会显示系统分享入口, 图片不会上传到工作台服务器生成链接.</p></section>
        <section><h3 className="font-medium mb-1">创作守则</h3><p>使用有权使用的素材, 核对图片中的文字和事实, 尊重肖像与作品权利. 初始开源案例保留 CC BY 4.0 署名. 其他风格请查看各条详情中的来源与许可.</p></section>
        <section className="pt-space-md border-t border-outline-variant/30"><h3 className="font-medium mb-space-sm">通道状态</h3>
          <p className="text-on-surface-variant mb-space-sm">以下是本次服务运行期间的调用记录, 连接工作台不代表上游已经验证.</p>
          {[...(config?.imageChannels || []), ...(config?.textChannels || [])].map((channel) => <div key={channel.id} className="flex items-center justify-between gap-3 py-2"><span>{channel.name}</span><span className="text-on-surface-variant text-right">{labels[channel.status]}{channel.openUntil > Date.now() ? `, ${new Date(channel.openUntil).toLocaleTimeString()} 后再试` : ''}</span></div>)}
          {!config && <p>暂时无法读取通道信息.</p>}
        </section>
      </div>
    </div>
  </div>;
}
