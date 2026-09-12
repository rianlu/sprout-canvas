import { MAX_PROMPT_LENGTH } from '../../shared/generation-contract.mjs';

export interface PromptHistory {
  before: string;
  after: string;
  restored: boolean;
}

export function readPromptHistory(value: unknown): PromptHistory | null {
  if (!value || typeof value !== 'object') return null;
  const history = value as Partial<PromptHistory>;
  if (typeof history.before !== 'string' || typeof history.after !== 'string' || typeof history.restored !== 'boolean') return null;
  if (history.before.length > MAX_PROMPT_LENGTH || history.after.length > MAX_PROMPT_LENGTH) return null;
  return { before: history.before, after: history.after, restored: history.restored };
}

/** Capture edits on the version being left so switching versions never discards them. */
export function togglePromptHistory(history: PromptHistory, current: string) {
  return history.restored
    ? { prompt: history.after, history: { ...history, before: current, restored: false } }
    : { prompt: history.before, history: { ...history, after: current, restored: true } };
}
