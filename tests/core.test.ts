import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, clone, commitRevision, copyPart, controls, parseProject, uid } from '../src/domain';
import { initialProject, lamp, pavilion, sculpture } from '../src/presets';
import { buildDocument, buildForm, validateContour } from '../src/geometry';

test('operations are atomic and respect held objects and parameter limits', () => {
  const doc = lamp();
  doc.forms[1].locked = true;
  const before = clone(doc);
  assert.throws(() => applyOperations(doc, [
    { type: 'set_control', targetId: 'head', key: 'bend', value: .8 },
    { type: 'set_control', targetId: 'stem', key: 'bend', value: .8 },
  ]), /保持/);
  assert.deepEqual(doc, before);
  assert.throws(() => applyOperations(doc, [{ type: 'set_control', targetId: 'head', key: 'bend', value: 50 }]));
  assert.throws(() => applyOperations(doc, [{ type: 'add_form', form: doc.forms[0] }]), /ID/);
});

test('late candidates save a branch without changing the active version', () => {
  const project = initialProject();
  const base = project.revisions[0];
  const first = { ...clone(base), id: uid(), parentId: base.id, title: 'first' };
  const a = commitRevision(project, first, base.id);
  const second = { ...clone(first), id: uid(), title: 'late' };
  const b = commitRevision(a.project, second, base.id);
  assert.equal(b.branched, true);
  assert.equal(b.project.currentId, first.id);
  assert.equal(b.project.revisions.at(-1)?.parentId, base.id);
  assert.equal(project.revisions.length, 1);
});

test('borrowed parts remain independent; controls require compatible source', () => {
  const a = lamp(), b = lamp();
  b.forms[2].controls.bend = .9;
  const result = copyPart(a, b.forms[2], 'head', 'controls');
  assert.equal(result.forms[2].controls.bend, .9);
  result.forms[2].controls.bend = .3;
  assert.equal(b.forms[2].controls.bend, .9);
  assert.throws(() => copyPart(a, pavilion().forms[0], 'head', 'controls'), /不兼容/);
  a.forms[2].locked = true;
  assert.throws(() => copyPart(a, b.forms[2], 'head'), /保持/);
});

test('imports reject cyclic versions, missing references and duplicate form ids', () => {
  const p = initialProject();
  assert.deepEqual(parseProject(p), p);
  const bad = clone(p); bad.revisions[0].parentId = bad.currentId;
  assert.throws(() => parseProject(bad), /循环/);
  const ref = clone(p); ref.revisions[0].references = [{ revisionId: 'missing', formId: 'head', mode: 'copy' }];
  assert.throws(() => parseProject(ref), /来源/);
  const dupe = clone(p); dupe.revisions[0].document.forms[1].id = 'head';
  assert.throws(() => parseProject(dupe));
});

test('all example geometries are finite and deformation changes only its target', () => {
  for (const doc of [lamp(), pavilion(), sculpture()]) {
    const out = buildDocument(doc);
    assert.ok(out.triangles > 100);
    assert.ok(out.meshes.every(m => [...m.positions, ...m.normals].every(Number.isFinite)));
  }
  const a = lamp();
  const b = applyOperations(a, [{ type: 'set_control', targetId: 'head', key: 'pull', value: .09 }]);
  const before = buildDocument(a), after = buildDocument(b);
  assert.deepEqual(before.meshes[0].positions, after.meshes[0].positions);
  assert.notDeepEqual(before.meshes[2].positions, after.meshes[2].positions);
});

test('closed loft has outward winding and positive volume; thin sheets retain thickness', () => {
  const f = lamp().forms[0];
  f.controls = controls();
  const m = buildForm(f);
  let volume = 0;
  const p = m.positions;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.indices[i] * 3, b = m.indices[i + 1] * 3, c = m.indices[i + 2] * 3;
    volume += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  assert.ok(volume > 0);
  const sheet = pavilion().forms[2];
  const points = buildForm(sheet).positions;
  const z = Array.from({ length: points.length / 3 }, (_, i) => points[i * 3 + 2]);
  assert.ok(Math.abs(Math.max(...z) - Math.min(...z) - .008) < 1e-6);
});

test('invalid profiles fail before saving', () => {
  assert.throws(() => validateContour([[0, 0], [1, 1], [0, 1], [1, 0]]), /自交/);
  const f = lamp().forms[0];
  if (f.source.kind === 'loft') f.source.sections[1].y = -1;
  assert.throws(() => buildForm(f), /递增/);
});
