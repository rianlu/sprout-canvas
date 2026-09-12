import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startHarness } from './server-harness.mjs';
import { MAX_PROMPT_LENGTH } from '../shared/generation-contract.mjs';
import { PROMPT_POLISH_INSTRUCTIONS } from '../shared/prompt-polish.mjs';

test('润色保留完整长文, 超长结果在扣点前拒绝, 领取与失败重放不重复调用', async () => {
  const app = await startHarness();
  try {
    const cookie = await app.login();
    let output = '主题: 两只小熊, 保留 "SPRING 2026" 和 {品牌名称}.\n构图与材质: ' + '温润水彩, 层次清晰. '.repeat(30).trimEnd();
    app.controls.respond = (_call, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: output } }] }));
      return true;
    };
    const input = (id) => ({ ...app.textInput(cookie, id), input: [
      { role: 'system', content: [{ type: 'input_text', text: PROMPT_POLISH_INSTRUCTIONS }] },
      { role: 'user', content: [{ type: 'input_text', text: '保留多段描述与原有画面文字' }] },
    ] });
    const id = randomUUID();
    const result = await app.api('/api/text', { cookie, method: 'POST', body: input(id) });
    assert.equal(result.status, 200);
    assert.equal(result.data.text, output);
    assert.equal(result.data.credit.state, 'charged');
    assert.equal((await app.api(`/api/text/${id}`, { cookie })).data.text, output);
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0].json.messages[0].content, PROMPT_POLISH_INSTRUCTIONS);
    const balance = (await app.api('/api/credits', { cookie })).data.credits;
    output = '字'.repeat(MAX_PROMPT_LENGTH + 1);
    const longId = randomUUID();
    const failure = await app.api('/api/text', { cookie, method: 'POST', body: input(longId) });
    assert.equal(failure.status, 502);
    assert.equal(failure.data.code, 'TEXT_FAILED');
    assert.equal(failure.data.credit.state, 'refunded');
    assert.equal(failure.data.text, undefined, '不能截断结果再收费');
    assert.deepEqual((await app.api('/api/credits', { cookie })).data.credits, balance);
    assert.equal((await app.api('/api/text', { cookie, method: 'POST', body: input(longId) })).data.credit.state, 'refunded');
    assert.equal(app.calls.length, 2);
  } finally { await app.close(); }
});
