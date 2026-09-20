import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startHarness, until } from './server-harness.mjs';
import { PNG, PNG_URL, MASK_URL, png, submission } from './fixtures.mjs';
import { toImagesPayload, validateGenerationSubmission } from '../shared/generation-contract.mjs';
import { buildResponsesPayloadFromImagesPayload } from '../server/provider-adapter.mjs';

test('series references retain four uploads plus a separate continuity image', async (t) => {
  const app = await startHarness();
  try {
    const cookie = await app.login();
    const api = (url, options = {}) => app.api(url, { cookie, ...options });
    const bytes = Array.from({ length: 4 }, (_, index) => png(20 + index, 30 + index, [30 + index * 40, 150, 90, 255]));
    const references = bytes.map((image, index) => ({ id: `ref-${index}`, name: `user-${index + 1}.png`, dataUrl: `data:image/png;base64,${image.toString('base64')}` }));
    const input = (id, index = 0) => ({ ...submission(id, { references }), creditQuote: app.quote(cookie), clientContext: { kind: 'series', seriesId: 'free-series', sceneId: id, sceneIndex: index, placeholderId: `art-${id}`, prompt: '图 1 的人物在图 4 的环境中, 保留文字 {{name}}', mode: 'reference' } });
    const finished = (id) => until(async () => { const job = (await api(`/api/jobs/${id}`)).data; return !['pending', 'running'].includes(job.status) && job; }, `finished ${id}`);
    const balance = async () => (await api('/api/auth/status')).data.credits;
    let firstJob;

    await t.test('batch keeps upload order in every scene and charges by output count', async () => {
      const before = await balance();
      const originals = [input('first'), { ...input('second', 1), referenceJobId: 'first' }, { ...input('third', 2), referenceJobId: 'first' }];
      const response = await api('/api/jobs/batch', { method: 'POST', body: { jobs: originals } });
      assert.equal(response.status, 202, JSON.stringify(response.data));
      const jobs = await Promise.all(response.data.jobs.map((job) => finished(job.id)));
      assert.ok(jobs.every((job) => job.status === 'succeeded'));
      firstJob = jobs[0];
      assert.equal(app.calls.length, 3);
      for (const [index, call] of app.calls.entries()) {
        assert.match(call.path, /images\/edits$/);
        assert.equal([...call.body.toString('latin1').matchAll(/name="image\[\]"; filename=/g)].length, index === 0 ? 4 : 5);
        let previous = -1;
        for (const image of bytes) {
          const position = call.body.indexOf(image);
          assert.ok(position > previous, 'every uploaded image keeps its number');
          previous = position;
        }
        if (index > 0) assert.ok(call.body.indexOf(PNG) > previous, 'continuity image is last');
        assert.equal(jobs[index].clientContext.template, undefined);
        assert.deepEqual(jobs[index].recipe.references.map((ref) => ref.id), references.map((ref) => ref.id));
        if (index > 0) assert.equal(jobs[index].recipe.referenceImage.recordId, firstJob.clientContext.placeholderId);
      }
      const after = await balance();
      assert.equal(before.available - after.available, 30);
      assert.equal(after.reserved, 0);
    });

    await t.test('local continuity snapshots are part of the request intent and reach Responses intact', async () => {
      const referenceImage = { id: 'local-anchor', recordId: 'local-anchor', name: 'local-continuity.png', dataUrl: PNG_URL };
      const local = { ...input('local'), referenceImage };
      const response = await api('/api/jobs', { method: 'POST', body: local });
      assert.equal(response.status, 202, JSON.stringify(response.data));
      assert.equal((await finished(response.data.id)).status, 'succeeded');
      assert.equal((await api('/api/jobs', { method: 'POST', body: local })).data.id, response.data.id);
      assert.equal((await api('/api/jobs', { method: 'POST', body: { ...local, referenceImage: { ...referenceImage, dataUrl: MASK_URL } } })).status, 409);
      const payload = buildResponsesPayloadFromImagesPayload({ imageModel: 'gpt-5' }, toImagesPayload(validateGenerationSubmission(local)));
      assert.deepEqual(payload.input[1].content.filter((part) => part.type === 'input_image').map((part) => part.image_url), [...references.map((ref) => ref.dataUrl), PNG_URL]);
    });

    await t.test('claimed first frames can be restored without dropping uploads or generating the first again', async () => {
      await api(`/api/jobs/${firstJob.id}/ack`, { method: 'POST' });
      assert.equal((await api(`/api/jobs/${firstJob.id}/result`)).status, 410);
      const referenceImage = { id: firstJob.clientContext.placeholderId, recordId: firstJob.clientContext.placeholderId, name: 'original.png', dataUrl: PNG_URL };
      const restored = { ...input('restored'), referenceJobId: firstJob.id, referenceImage };
      const before = app.calls.length;
      const response = await api('/api/jobs', { method: 'POST', body: restored });
      assert.equal(response.status, 202, JSON.stringify(response.data));
      assert.equal((await finished(response.data.id)).status, 'succeeded');
      assert.equal(app.calls.length, before + 1);
      assert.equal([...app.calls.at(-1).body.toString('latin1').matchAll(/name="image\[\]"; filename=/g)].length, 5);
      assert.equal((await api('/api/jobs', { method: 'POST', body: { ...restored, requestId: 'bad-snapshot', referenceImage: { ...referenceImage, dataUrl: MASK_URL } } })).status, 409);
    });

    await t.test('invalid uploads and masks are rejected before credits or upstream work', async () => {
      const before = await balance(), calls = app.calls.length;
      const base = input('invalid');
      const referenceImage = { id: 'local-anchor', name: 'anchor.png', dataUrl: PNG_URL };
      for (const body of [
        { ...base, request: { ...base.request, references: [...references, references[0]] } },
        { ...base, request: { ...base.request, references: [references[0]], mask: MASK_URL }, referenceImage },
        { ...base, clientContext: { ...base.clientContext, sceneId: undefined } },
      ]) assert.equal((await api('/api/jobs', { method: 'POST', body })).status, 400);
      assert.equal(app.calls.length, calls);
      assert.deepEqual(await balance(), before);
    });
  } finally { await app.close(); }
});
