import { validateGenerationSubmission, type GenerationSubmission } from '../../shared/generation-contract.mjs';
import type { CreditQuote } from '../../shared/credits-contract.mjs';
import { bindCreditQuote, creditCost, getCreditQuote, getCreditSnapshot } from './credits';
import { randomId } from './random/id';
import { attachLocalReference, listOutbox, saveOutboxBatch } from './storage/gallery-db';

export function needsNewCreditIdentity(input: GenerationSubmission, quote: CreditQuote) {
  return !input.creditQuote || input.creditQuote.accessCodeId !== quote.accessCodeId || input.creditQuote.userId !== quote.userId;
}

/** Recreate an unproven request only after confirmation, preserving its materials and reference chain. */
export async function recoverSubmissionBatch(previous: GenerationSubmission[], quote = getCreditQuote()) {
  if (!previous.some((input) => needsNewCreditIdentity(input, quote))) {
    return { inputs: previous.map((input) => ({ ...input, creditQuote: bindCreditQuote(input.creditQuote, quote, true) })), recreated: false };
  }
  const cost = creditCost(getCreditSnapshot().prices, 'image', previous.length);
  if (!window.confirm(`这些待提交任务来自旧版本, 或原访问码/浏览器身份已变化. 原任务可能已受理. 继续将使用当前访问码重新创建 ${previous.length} 张图片, ${cost}. 是否继续?`)) throw new Error('已取消重新创建, 原始文案和图片已保留');
  const replacements = new Map(previous.map((input) => [input.requestId, randomId()]));
  const references = new Map(replacements);
  for (const row of await listOutbox()) {
    const next = replacements.get(row.requestId);
    if (row.jobId && next) references.set(row.jobId, next);
  }
  const inputs = await Promise.all(previous.map(async (source) => {
    const input = await attachLocalReference(source);
    const next: GenerationSubmission = { ...input, requestId: replacements.get(input.requestId)!, creditQuote: quote, retryOf: undefined, clientContext: { ...input.clientContext, placeholderId: randomId(), parentId: input.clientContext.placeholderId, version: (input.clientContext.version || 1) + 1 } };
    if (input.referenceJobId) {
      const anchor = references.get(input.referenceJobId);
      if (anchor) { next.referenceJobId = anchor; delete next.referenceImage; }
      else {
        if (!input.referenceImage) throw new Error('本地没有原首镜图片, 请先保存首镜, 或重新选择参考图后再提交');
        next.request = { ...input.request, references: [input.referenceImage, ...input.request.references].slice(0, 4) };
        delete next.referenceJobId; delete next.referenceImage;
      }
    }
    return validateGenerationSubmission(next);
  }));
  // Save the new intent and draft associations atomically before any network request.
  await saveOutboxBatch(inputs.map((input) => ({ input })), replacements);
  return { inputs, recreated: true };
}
