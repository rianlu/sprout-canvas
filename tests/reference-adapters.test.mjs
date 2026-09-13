import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildImagesEditMultipartFromPayload, buildResponsesPayloadFromImagesPayload } from '../server/provider-adapter.mjs';
import { validateGenerationSubmission, toImagesPayload, MAX_REFERENCE_IMAGES } from '../shared/generation-contract.mjs';
import { png, submission } from './fixtures.mjs';

const files = Array.from({ length: MAX_REFERENCE_IMAGES }, (_, index) => png(20 + index, 30 + index, [50 + index * 20, 120, 80, 255]));
const references = files.map((file, index) => ({ id: `reference-${index}`, name: `image-${index + 1}.png`, dataUrl: `data:image/png;base64,${file.toString('base64')}` }));
const payload = toImagesPayload(validateGenerationSubmission(submission('multi-adapter', { references })));

test('Images uploads every reference once, in the selected order, without a mask', () => {
  const { body, contentType } = buildImagesEditMultipartFromPayload({ imageModel: 'gpt-image-2' }, payload);
  assert.match(contentType, /multipart\/form-data; boundary=/);
  assert.equal([...body.toString('latin1').matchAll(/name="image\[\]"; filename=/g)].length, 4);
  assert.doesNotMatch(body.toString('latin1'), /name="mask"/);
  let previous = -1;
  for (const bytes of files) {
    const index = body.indexOf(bytes);
    assert.ok(index > previous);
    assert.equal(body.indexOf(bytes, index + bytes.length), -1);
    previous = index;
  }
});

test('Responses keeps all reference images in order without forcing a mask edit', () => {
  const result = buildResponsesPayloadFromImagesPayload({ imageModel: 'gpt-5' }, payload);
  assert.deepEqual(result.input[1].content.filter((part) => part.type === 'input_image').map((part) => part.image_url), references.map((ref) => ref.dataUrl));
  assert.equal(result.tools[0].input_image_mask, undefined);
  assert.equal(result.tools[0].action, undefined);
});
