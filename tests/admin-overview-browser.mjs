import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import { startHarness, TEST_ADMIN_PASSWORD, until } from './server-harness.mjs';
import { submission } from './fixtures.mjs';

const output = path.join(process.env.SPROUT_TEST_OUTPUT || tmpdir(), 'admin-overview');
await mkdir(output, { recursive: true });
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage(); page.setDefaultTimeout(8000);
const checks = [], errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const nav = (name) => page.getByRole('navigation', { name: '后台导航' }).getByRole('button', { name, exact: true });
const overview = async () => (await app.api('/api/admin/overview', { cookie: app.adminCookie })).data;
async function screenshot(name) {
  await page.evaluate(async () => document.fonts.ready);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => [...document.images].filter((image) => { const box = image.getBoundingClientRect(); return box.width > 0 && box.top < innerHeight && box.bottom > 0; }).every((image) => image.complete && image.naturalWidth > 0));
  const geometry = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth,
    header: [...document.querySelector('header > div').children].map((element) => element.getBoundingClientRect().toJSON()),
    dialog: document.querySelector('[role="dialog"]')?.getBoundingClientRect().toJSON(),
    icons: [...document.querySelectorAll('.material-symbols-outlined')].filter((element) => element.getClientRects().length).map((element) => ({ name: element.textContent, width: element.getBoundingClientRect().width, size: parseFloat(getComputedStyle(element).fontSize) })),
  }));
  assert.ok(geometry.scroll <= geometry.width + 1, `${name}: 页面不横向溢出`);
  for (const rect of geometry.header) assert.ok(rect.left >= 0 && rect.right <= geometry.width + 1, `${name}: 导航位于视口内`);
  for (const a of geometry.header) for (const b of geometry.header) {
    if (a === b) continue;
    assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, `${name}: 导航不重叠`);
  }
  if (geometry.dialog) assert.ok(geometry.dialog.left >= 0 && geometry.dialog.right <= geometry.width + 1 && geometry.dialog.top >= 0 && geometry.dialog.bottom <= geometry.height + 1);
  for (const icon of geometry.icons) assert.ok(Math.abs(icon.width - icon.size) < 1, `${name}: 图标字形 ${icon.name}`);
  await page.screenshot({ path: path.join(output, name + '.png') });
}
async function signIn() {
  await page.getByLabel('管理员密码', { exact: true }).fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: '登录管理后台', exact: true }).click();
  await page.getByRole('heading', { name: '仪表盘', exact: true }).waitFor();
}
async function submitImage(cookie) {
  const response = await app.api('/api/jobs', { cookie, method: 'POST', body: { ...submission(randomUUID()), creditQuote: app.quote(cookie) } });
  assert.equal(response.status, 202);
  return until(async () => {
    const { data } = await app.api(`/api/jobs/${response.data.id}`, { cookie });
    return !['pending', 'running'].includes(data.status) && data;
  }, 'fixture image completion');
}
try {
  let requests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/admin/overview')) requests++; });
  await page.goto(app.base + '/#admin');
  await page.getByLabel('管理员密码', { exact: true }).waitFor();
  assert.equal(requests, 0, '登录前不读取后台统计');
  await screenshot('login-desktop-light');
  await page.getByLabel('管理员密码', { exact: true }).fill('temporary-visible-password');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  assert.equal(await page.getByLabel('管理员密码', { exact: true }).getAttribute('type'), 'text');
  await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
  assert.equal(await page.getByLabel('管理员密码', { exact: true }).getAttribute('type'), 'password');
  await page.getByLabel('管理员密码', { exact: true }).fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('login-mobile-light');
  await page.getByRole('button', { name: '切换主题' }).click();
  await screenshot('login-mobile-dark');
  await page.getByRole('button', { name: '切换主题' }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push('登录页深浅主题, 手机布局与密码显隐, 未登录不读取管理数据');

  let failOnce = true;
  await page.route('**/api/admin/overview', (route) => {
    if (failOnce) { failOnce = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '统计暂时不可用' }) }); }
    return route.continue();
  });
  await signIn();
  await page.getByRole('alert').filter({ hasText: '统计暂时不可用' }).waitFor();
  assert.equal(await page.getByRole('region', { name: '后台概览统计' }).count(), 0);
  await page.getByRole('button', { name: '重新读取概览' }).click();
  await page.getByRole('region', { name: '后台概览统计' }).waitFor();
  assert.equal(await nav('仪表盘').getAttribute('aria-pressed'), 'true');
  assert.ok((await page.getByRole('region', { name: '后台概览统计' }).innerText()).includes('36'));
  await page.getByText('暂无待核实任务', { exact: true }).waitFor();
  checks.push('默认进入仪表盘, 读取失败可重试, 空用量显示真实零值');

  const create = async (note, unlimited = false) => (await app.api('/api/admin/access-codes', { cookie: app.adminCookie, method: 'POST', body: { requestId: randomUUID(), note, initialPoints: unlimited ? 0 : 100, unlimited } })).data.codes[0];
  const finite = await create('朋友共享'), unlimited = await create('无限测试', true);
  const finiteCookie = await app.login('overview-finite', finite.code), unlimitedCookie = await app.login('overview-unlimited', unlimited.code);
  assert.equal((await submitImage(finiteCookie)).status, 'succeeded');
  assert.equal((await app.api('/api/text', { cookie: finiteCookie, method: 'POST', body: app.textInput(finiteCookie) })).status, 200);
  assert.equal((await app.api('/api/text', { cookie: unlimitedCookie, method: 'POST', body: app.textInput(unlimitedCookie) })).status, 200);
  app.controls.respond = (call, res) => {
    if (!call.path.includes('/images/')) return false;
    res.writeHead(504, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Gateway timeout' })); return true;
  };
  assert.equal((await submitImage(finiteCookie)).credit.state, 'unknown');
  const data = await overview();
  assert.equal(data.usage.points, 12); assert.equal(data.usage.deducted, 11); assert.equal(data.pendingReview.total, 1);
  await page.getByRole('button', { name: '刷新概览', exact: true }).click();
  await page.getByRole('button', { name: '核实 朋友共享' }).waitFor();
  assert.ok((await page.getByRole('region', { name: '创作使用概览' }).innerText()).includes('实际扣减 11 点'));
  await page.waitForFunction(() => [...document.querySelectorAll('main:where(:not([hidden])) img')].filter((img) => img.getClientRects().length).every((img) => img.complete && img.naturalWidth > 0));
  for (const [width, height] of [[1440, 1000], [1024, 900], [768, 1024], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
    await screenshot(`dashboard-${width}-light`);
    await page.getByRole('button', { name: '切换主题' }).click();
    await screenshot(`dashboard-${width}-dark`);
    await page.getByRole('button', { name: '切换主题' }).click();
  }
  checks.push('真实结算数据, 有限与无限用量分离, 5 种视口与深浅主题布局');

  const today = data.activity.endDate;
  const dayStart = Date.parse(`${today}T00:00:00+08:00`);
  const monthStart = Date.parse(`${today.slice(0, 7)}-01T00:00:00+08:00`);
  // Re-date completed fixture operations in this isolated test database to exercise real day/month queries.
  const db = new DatabaseSync(path.join(app.directory, 'data/runtime.sqlite'));
  db.prepare("UPDATE credit_operations SET updated_at=? WHERE state='charged' AND kind='image'").run(monthStart - 1);
  db.prepare("UPDATE credit_operations SET updated_at=? WHERE state='charged' AND kind='prompt' AND unlimited=0").run(Math.max(monthStart, dayStart - 1));
  db.close();
  const dated = await overview();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '刷新概览', exact: true }).click();
  await until(async () => (await page.getByRole('group', { name: '灵感点用量', exact: true }).locator('strong').textContent()) === String(dated.usagePeriods.month.points), 'dated summary');
  const pointsCard = page.getByRole('group', { name: '灵感点用量', exact: true });
  const creationCard = page.getByRole('region', { name: '创作使用概览' });
  for (const [period, label] of [['today', '今日'], ['month', '本月'], ['all', '累计']]) {
    const expected = period === 'all' ? dated.usage : dated.usagePeriods[period];
    await pointsCard.getByRole('button', { name: label, exact: true }).click();
    assert.equal(await pointsCard.locator('strong').textContent(), String(expected.points));
    assert.equal(await pointsCard.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed'), 'true');
    await creationCard.getByRole('button', { name: label, exact: true }).click();
    await creationCard.getByText(`实际扣减 ${expected.deducted} 点 · 无限额度用量 ${expected.points - expected.deducted} 点`, { exact: true }).waitFor();
  }
  await pointsCard.getByRole('button', { name: '今日', exact: true }).click();
  assert.equal(await creationCard.getByRole('button', { name: '累计', exact: true }).getAttribute('aria-pressed'), 'true', '两个卡片的时段独立切换');
  const heatmap = page.getByRole('region', { name: '创作活跃度', exact: true });
  assert.equal(await heatmap.locator('[data-activity-date]').count(), 365);
  assert.equal(await heatmap.locator('[data-activity-date]').evaluateAll((cells) => cells.reduce((sum, cell) => sum + Number(cell.dataset.activityCount), 0)), 3);
  await heatmap.locator(`[data-activity-date="${today}"]`).click();
  await heatmap.getByRole('status').filter({ hasText: today }).waitFor();
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.activityDate), dated.activity.days.at(-2).date);
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.activityDate), dated.activity.startDate);
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.activityDate), today);
  await screenshot('dashboard-periods-heatmap');
  await pointsCard.getByRole('button', { name: '本月', exact: true }).click();
  await creationCard.getByRole('button', { name: '本月', exact: true }).click();
  checks.push('今日/本月/累计使用真实日期记录且分别切换, 365 天热力图支持点击与方向键查看');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav('风格管理').click();
  await page.getByRole('button', { name: '添加风格', exact: true }).waitFor();
  await page.locator('.admin-style-card').first().waitFor();
  await screenshot('styles-desktop-light');
  assert.equal(new URL(page.url()).hash, '#admin/styles');
  await page.reload();
  await page.getByRole('button', { name: '添加风格', exact: true }).waitFor();
  assert.equal(await nav('风格管理').getAttribute('aria-pressed'), 'true');
  await page.goBack();
  await page.getByRole('heading', { name: '仪表盘', exact: true }).waitFor();
  await page.goForward();
  await page.getByRole('heading', { name: '风格管理', exact: true }).waitFor();
  await nav('仪表盘').click();
  checks.push('后台子页支持刷新与浏览器前进后退');

  const recent = data.styles.recent[0];
  await page.getByRole('button', { name: `编辑最近风格 ${recent.name}`, exact: true }).click();
  const styleDialog = page.getByRole('dialog', { name: '编辑风格', exact: true });
  await styleDialog.getByLabel('风格提示词').waitFor();
  assert.equal(await styleDialog.getByLabel('名称', { exact: true }).inputValue(), recent.name);
  await screenshot('style-editor-desktop-light');
  await styleDialog.getByRole('button', { name: '取消', exact: true }).click();
  await nav('访问码管理').click();
  await page.getByRole('button', { name: '创建访问码', exact: true }).waitFor();
  await page.getByRole('button', { name: '管理访问码 朋友共享', exact: true }).waitFor();
  await screenshot('access-desktop-light');
  await nav('仪表盘').click();
  checks.push('最近风格直达对应编辑表单, 管理页保留真实内容与操作');

  await page.getByRole('button', { name: '核实 朋友共享' }).click();
  const dialog = page.getByRole('dialog', { name: '用量明细', exact: true });
  await dialog.getByRole('heading', { name: '待核实任务', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: '管理访问码', exact: true }).count(), 0);
  assert.ok((await dialog.innerText()).includes(finite.tail));
  await screenshot('dashboard-review-dialog');
  await dialog.getByRole('button', { name: '返还点数', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: '核实结果已保存' }).waitFor();
  await dialog.getByRole('button', { name: '关闭访问码弹窗' }).click();
  await nav('仪表盘').click();
  await page.getByText('暂无待核实任务', { exact: true }).waitFor();
  assert.equal((await overview()).usage.deducted, 11);
  assert.equal((await overview()).pendingReview.reserved, 0);
  checks.push('仪表盘直达对应访问码的核实弹窗, 处理后统计刷新且不重复扣点');

  await page.route('**/api/admin/overview', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '刷新暂时失败' }) }));
  await page.getByRole('button', { name: '刷新概览', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '当前显示上次读取的数据' }).waitFor();
  assert.ok(await page.getByRole('region', { name: '后台概览统计' }).isVisible());
  await page.unroute('**/api/admin/overview');
  await page.evaluate(() => fetch('/api/admin/auth/logout', { method: 'POST' }));
  await page.getByRole('button', { name: '刷新概览', exact: true }).click();
  await page.getByLabel('管理员密码', { exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: '后台概览统计' }).count(), 0);
  await signIn();
  await page.getByRole('region', { name: '后台概览统计' }).waitFor();
  checks.push('刷新失败保留并标注旧数据, 会话过期回到登录且可以重新进入');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: checks, errors, virtualUpstreamCalls: app.calls.length }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, artifacts: output }));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally { await browser.close(); await app.close(); }
