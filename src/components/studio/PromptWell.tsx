import { Eraser, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { requestTextGeneration } from '../../lib/api/text';

interface PromptWellProps {
  value: string;
  onChange: (value: string) => void;
  styleName: string | null;
  onClearStyle: () => void;
  onOptimize?: (text: string) => void;
}

const MAX_CHARS = 1000;
const POLISH_SYSTEM_PROMPT = '你是提示词润色助手。把用户的中文描述改写为更具体、更适合图像生成模型的提示词：补充主体细节、构图、光线与质感描述，去除冗余词。直接输出改写后的提示词，不要解释，不要加引号。';

export function PromptWell({ value, onChange, styleName, onClearStyle, onOptimize }: PromptWellProps) {
  const [polishing, setPolishing] = useState(false);
  const [error, setError] = useState('');

  async function handlePolish() {
    if (!value.trim() || polishing) return;
    setPolishing(true);
    setError('');
    try {
      const response = await requestTextGeneration(POLISH_SYSTEM_PROMPT, value);
      const optimized = (response.text || '').trim();
      if (optimized) {
        onChange(optimized.slice(0, MAX_CHARS));
      } else {
        setError('润色结果为空, 已保留原文');
      }
    } catch {
      setError('润色失败, 请稍后再试');
    } finally {
      setPolishing(false);
    }
  }

  return (
    <div className="rail-section">
      <div className="rail-section-head">
        <span className="rail-title"><Sparkles size={16} aria-hidden="true" />灵感提示词</span>
        {styleName && (
          <button type="button" className="pinned-style" onClick={onClearStyle} aria-label={`清除已选风格 ${styleName}`}>
            {styleName}
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="prompt-well">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value.slice(0, MAX_CHARS))}
          placeholder="描述主体、风格、构图、光线…"
          aria-label="灵感提示词"
          rows={5}
        />
        <div className="prompt-well-footer">
          <div className="prompt-well-actions">
            <button type="button" className="link-btn" onClick={() => onChange('')} disabled={!value}>
              <Eraser size={13} aria-hidden="true" />清空
            </button>
            <button type="button" className="link-btn" onClick={() => { void handlePolish(); }} disabled={!value.trim() || polishing}>
              <Sparkles size={13} aria-hidden="true" />{polishing ? '润色中...' : '润色扩写'}
            </button>
          </div>
          <span className="char-counter">{value.length} / {MAX_CHARS}</span>
        </div>
        {error && <p className="error-text t-meta-sm" role="status">{error}</p>}
      </div>
    </div>
  );
}
