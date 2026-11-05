import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeriesType, referenceInstruction, reviewSeriesPlan, seriesShotInstruction, skillForType, mentionsReference } from '../shared/series-skills.mjs';

test('series type falls back to open when the model does not name a skill', () => {
  assert.equal(parseSeriesType('这是一段解释'), 'open');
  assert.equal(parseSeriesType('product'), 'product');
  assert.equal(skillForType('missing').id, 'open');
  assert.equal(mentionsReference('参考图里的水壶'), true);
  assert.equal(mentionsReference('守株待兔'), false);
});

test('product review rejects a copied spec block, a text ban, and duplicate shots', () => {
  const skill = skillForType('product');
  const head = 'Amazon Kids Tablet 11，含一年Kids+内容订阅和家长控制';
  const issues = reviewSeriesPlan([
    { title: '一', prompt: `只输出 JSON 数组。${head}。` },
    { title: '二', prompt: `${head}。画面不出现任何文字，白底棚拍。` },
    { title: '三', prompt: `${head}。画面文字：11 英寸 2.5K。` },
    { title: '四', prompt: `${head}。画面文字：11 英寸 2.5K。` },
  ], skill);
  assert.ok(issues.some((issue) => issue.index === 0 && issue.reason.includes('规划说明')));
  assert.ok(issues.some((issue) => issue.index === 1 && issue.reason.includes('画面文字')));
  assert.ok(issues.some((issue) => issue.index === 3 && issue.reason.includes('完全相同')));
  assert.equal(issues.filter((issue) => issue.reason.includes('参数整段重复')).length, 4);
  const clean = reviewSeriesPlan([
    { title: '一', prompt: '黄绿色保护套平板居中。画面标题：11 英寸 2.5K 大屏。箭头指向屏幕。' },
    { title: '二', prompt: '黄绿色保护套平板展示背面。画面标题：星云硬壳。标注指向背面图案。' },
    { title: '三', prompt: '黄绿色保护套平板立在桌上。画面标题：家长控制。孩子在旁边观看。' },
    { title: '四', prompt: '黄绿色保护套平板被双手握住。画面标题：轻薄握持。近景拍边缘。' },
  ], skill);
  assert.deepEqual(clean, []);
});

test('reference instructions cover no image, one image, and several images', () => {
  const skill = skillForType('illustration');
  assert.match(referenceInstruction(0, '做一套手办'), /不要写“与图 1 相同”/);
  assert.match(referenceInstruction(0, '图 1 是杯身'), /没有上传参考图/);
  assert.match(referenceInstruction(1, '参考图'), /1 张参考图/);
  assert.match(seriesShotInstruction(4, skill, 3, '图 1 是衣服, 图 2 是模特'), /图 1 到图 3/);
  assert.match(referenceInstruction(3, '参考图'), /不要把所有图都收成图 1/);
  assert.match(referenceInstruction(undefined, '图 2 的森林'), /没有收到张数/);
  const issues = reviewSeriesPlan([
    { title: '一', prompt: '杯身与图 1 相同。画面标题：350ml。标注指向杯身。' },
    { title: '二', prompt: '杯盖特写。画面标题：竹盖。标注指向盖子边缘。' },
    { title: '三', prompt: '杯子放在木桌上。画面标题：日常使用。窗边柔光。' },
  ], skillForType('product'), 0);
  assert.ok(issues.some((issue) => issue.index === 0 && issue.reason.includes('没有参考图')));
});
