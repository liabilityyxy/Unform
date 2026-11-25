import { z } from 'zod';

const number = z.number().finite();
const vec = z.tuple([number, number, number]);
const identifier = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const point = z.tuple([number.min(-3).max(3), number.min(-3).max(3)]);
export const sourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('loft'),
    sections: z.array(z.object({
      y: number.min(-2).max(2),
      x: number.min(-2).max(2),
      rx: number.min(0.0005).max(1),
      rz: number.min(0.0005).max(1),
    }).strict()).min(3).max(40),
    angular: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal('sweep'),
    points: z.array(vec).min(2).max(40),
    radius: number.min(0.001).max(0.3),
  }).strict(),
  z.object({
    kind: z.literal('extrude'),
    points: z.array(point).min(3).max(120),
    depth: number.min(0.001).max(1),
    bevel: number.min(0).max(0.03),
  }).strict(),
]);
export const formSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  source: sourceSchema,
  position: vec,
  rotation: vec,
  scale: vec.refine(v => v.every(n => n >= 0.05 && n <= 10), '缩放超出范围'),
  controls: z.object({
    bend: number.min(-1.8).max(1.8),
    twist: number.min(-2.5).max(2.5),
    taper: number.min(-0.75).max(0.75),
    pull: number.min(-0.2).max(0.2),
    region: number.min(0).max(1),
    radius: number.min(0.08).max(1),
  }).strict(),
  locked: z.boolean(),
  detail: z.enum(['placeholder', 'exploring', 'refined']),
}).strict();
export const documentSchema = z.object({
  schemaVersion: z.literal(1),
  unit: z.literal('m'),
  title: z.string().min(1).max(100),
  forms: z.array(formSchema).min(1).max(30),
}).strict().superRefine((doc, ctx) => {
  if (new Set(doc.forms.map(f => f.id)).size !== doc.forms.length) {
    ctx.addIssue({ code: 'custom', message: '对象 ID 重复' });
  }
});
export type Form = z.infer<typeof formSchema>;
export type Sketch = z.infer<typeof documentSchema>;
export type Source = z.infer<typeof sourceSchema>;
export const operationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set_control'), targetId: identifier,
    key: z.enum(['bend', 'twist', 'taper', 'pull', 'region', 'radius']), value: number,
  }).strict(),
  z.object({
    type: z.literal('set_transform'), targetId: identifier,
    key: z.enum(['position', 'rotation', 'scale']), value: vec,
  }).strict(),
  z.object({
    type: z.literal('set_color'), targetId: identifier, color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }).strict(),
  z.object({ type: z.literal('add_form'), form: formSchema }).strict(),
  z.object({ type: z.literal('remove_form'), targetId: identifier }).strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export const planSchema = z.object({
  message: z.string().min(1).max(700),
  candidates: z.array(z.object({
    title: z.string().min(1).max(40),
    description: z.string().min(1).max(200),
    operations: z.array(operationSchema).min(1).max(24),
  }).strict()).min(1).max(3),
}).strict();
export type Plan = z.infer<typeof planSchema>;
export interface Reference {
  revisionId: string;
  formId: string;
  mode: 'copy' | 'controls';
}
export interface Revision {
  id: string;
  parentId: string | null;
  title: string;
  note: string;
  document: Sketch;
  createdAt: number;
  thumbnail?: string;
  references: Reference[];
  source: 'human' | 'agent' | 'local' | 'initial';
}
export interface Action {
  revisionId: string;
  targetId: string;
  description: string;
  operations: Operation[];
  before: Form | null;
  after: Form | null;
}
export interface Project {
  schemaVersion: 1;
  currentId: string;
  revisions: Revision[];
  actions: Action[];
}
export interface Candidate {
  id: string;
  baseId: string;
  title: string;
  description: string;
  document: Sketch;
  source: 'agent' | 'local';
}
export const uid = () => crypto.randomUUID();
export const clone = <T,>(value: T): T => structuredClone(value);
export const controls = (): Form['controls'] => ({
  bend: 0, twist: 0, taper: 0, pull: 0, region: 0.72, radius: 0.5,
});

export function applyOperations(base: Sketch, operations: Operation[]): Sketch {
  const document = clone(documentSchema.parse(base));
  for (const raw of operations) {
    const op = operationSchema.parse(raw);
    if (op.type === 'add_form') {
      if (document.forms.some(f => f.id === op.form.id)) throw new Error('新增对象 ID 已存在');
      document.forms.push(op.form);
      continue;
    }
    const target = document.forms.find(f => f.id === op.targetId);
    if (!target) throw new Error(`找不到对象 ${op.targetId}`);
    if (target.locked) throw new Error(`「${target.name}」已保持，请先解除保持`);
    switch (op.type) {
      case 'set_control': target.controls[op.key] = op.value; break;
      case 'set_transform': target[op.key] = [...op.value]; break;
      case 'set_color': target.color = op.color; break;
      case 'remove_form': document.forms = document.forms.filter(f => f.id !== op.targetId); break;
    }
  }
  return documentSchema.parse(document);
}

export function copyPart(base: Sketch, source: Form, replacementId?: string, mode: 'copy' | 'controls' = 'copy'): Sketch {
  const next = clone(base);
  const target = next.forms.find(f => f.id === replacementId);
  if (target?.locked) throw new Error('当前部件处于保持状态');
  if (mode === 'controls') {
    if (!target) throw new Error('先选中要接收形变的部件');
    // Control transfer is intentionally limited to the exact same source structure.
    if (JSON.stringify(target.source) !== JSON.stringify(source.source)) {
      throw new Error('控制结构不兼容。可以改用复制部件，或从该版本继续');
    }
    target.controls = clone(source.controls);
  } else {
    const part = clone(source);
    part.id = target?.id ?? uid();
    part.locked = false;
    if (target) {
      part.position = [...target.position];
      next.forms[next.forms.findIndex(f => f.id === target.id)] = part;
    } else {
      part.name += ' · 借用';
      part.position[0] += 0.12;
      next.forms.push(part);
    }
  }
  return documentSchema.parse(next);
}

export function commitRevision(project: Project, revision: Revision, baseId: string): { project: Project; branched: boolean } {
  if (!project.revisions.some(r => r.id === baseId)) throw new Error('基准版本不存在');
  if (project.revisions.some(r => r.id === revision.id)) return { project, branched: project.currentId !== revision.id };
  const branched = project.currentId !== baseId;
  return {
    branched,
    project: {
      ...project,
      currentId: branched ? project.currentId : revision.id,
      revisions: [...project.revisions, revision],
    },
  };
}

export function parseProject(value: unknown): Project {
  const record = z.object({
    schemaVersion: z.literal(1),
    currentId: z.string(),
    revisions: z.array(z.object({
      id: z.string(), parentId: z.string().nullable(), title: z.string().max(100), note: z.string().max(2000),
      document: documentSchema, createdAt: number,
      thumbnail: z.string().max(500000).optional().refine(v => !v || /^data:image\/(png|jpeg|webp);base64,/.test(v)),
      references: z.array(z.object({ revisionId: z.string(), formId: z.string(), mode: z.enum(['copy', 'controls']) })).max(100),
      source: z.enum(['human', 'agent', 'local', 'initial']),
    })).min(1).max(300),
    actions: z.array(z.object({
      revisionId: z.string(), targetId: z.string(), description: z.string().max(1000),
      operations: z.array(operationSchema).max(24), before: formSchema.nullable(), after: formSchema.nullable(),
    })).max(100),
  }).parse(value);
  const ids = new Set(record.revisions.map(r => r.id));
  if (ids.size !== record.revisions.length || !ids.has(record.currentId)) throw new Error('项目版本引用无效');
  const seen = new Set<string>();
  for (const r of record.revisions) {
    if (r.parentId && !seen.has(r.parentId)) throw new Error('版本父级不存在或存在循环');
    seen.add(r.id);
  }
  for (const r of record.revisions) {
    if (r.references.some(ref => !ids.has(ref.revisionId))) throw new Error('借用来源不存在');
  }
  return record;
}
