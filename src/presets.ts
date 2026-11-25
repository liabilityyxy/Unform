import { controls, type Form, type Sketch, type Project, uid } from './domain';

function form(id: string, name: string, source: Form['source'], color: string, position: Form['position'] = [0, 0, 0]): Form {
  return { id, name, source, color, position, rotation: [0, 0, 0], scale: [1, 1, 1], controls: controls(), locked: false, detail: 'exploring' };
}
export function lamp(): Sketch {
  const head = form('head', '卷叶灯头', {
    kind: 'loft', angular: false,
    sections: [
      { y: 0, x: 0, rx: .004, rz: .003 },
      { y: .025, x: -.006, rx: .035, rz: .004 },
      { y: .065, x: -.025, rx: .075, rz: .006 },
      { y: .11, x: -.048, rx: .085, rz: .009 },
      { y: .15, x: -.058, rx: .054, rz: .007 },
      { y: .185, x: -.05, rx: .001, rz: .002 },
    ],
  }, '#d77860', [.015, .245, 0]);
  head.controls.bend = -.55;
  head.controls.twist = .65;
  head.rotation = [.2, .12, -.48];
  const stem = form('stem', '弯曲灯杆', {
    kind: 'sweep', radius: .006,
    points: [[0, .017, 0], [-.012, .075, 0], [.008, .155, 0], [.015, .245, 0]],
  }, '#3e6157');
  const base = form('base', '石形底座', {
    kind: 'loft', angular: false,
    sections: [
      { y: 0, x: 0, rx: .06, rz: .045 },
      { y: .006, x: .003, rx: .075, rz: .054 },
      { y: .018, x: .005, rx: .065, rz: .047 },
      { y: .027, x: -.002, rx: .015, rz: .013 },
    ],
  }, '#d5d4bf');
  base.detail = 'placeholder';
  return { schemaVersion: 1, unit: 'm', title: '卷叶 · 一盏未定形的灯', forms: [base, stem, head] };
}

export function pavilion(): Sketch {
  const body = form('body', '偏斜主体', {
    kind: 'extrude', depth: .09, bevel: 0,
    points: [[-.07, 0], [.07, 0], [.055, .14], [-.045, .16]],
  }, '#bdccbd', [0, 0, -.045]);
  const roof = form('roof', '折面屋顶', {
    kind: 'extrude', depth: .14, bevel: 0,
    points: [[-.105, .145], [.01, .215], [.105, .16], [.095, .146], [.006, .194], [-.1, .135]],
  }, '#d77860', [0, 0, -.07]);
  const window = form('window', '窗 · 占位', {
    kind: 'extrude', depth: .008, bevel: 0,
    points: [[-.025, .05], [.02, .05], [.02, .105], [-.025, .105]],
  }, '#45665f', [.018, 0, .046]);
  window.detail = 'placeholder';
  return { schemaVersion: 1, unit: 'm', title: '街角 · 一个歪斜的小店', forms: [body, roof, window] };
}

export function sculpture(): Sketch {
  const shape = form('ribbon', '伸展的薄片', {
    kind: 'loft', angular: false,
    sections: [
      { y: 0, x: 0, rx: .045, rz: .015 },
      { y: .06, x: -.025, rx: .06, rz: .008 },
      { y: .13, x: .03, rx: .04, rz: .009 },
      { y: .20, x: .015, rx: .08, rz: .006 },
      { y: .28, x: -.015, rx: .002, rz: .003 },
    ],
  }, '#d77860');
  shape.controls.twist = 1.2;
  const foot = form('foot', '基座', {
    kind: 'extrude', points: [[-.065, -.04], [.065, -.04], [.065, .04], [-.065, .04]], depth: .018, bevel: .003,
  }, '#47695d');
  foot.rotation = [-Math.PI / 2, 0, 0];
  return { schemaVersion: 1, unit: 'm', title: '风折 · 抽象形态习作', forms: [foot, shape] };
}
export const presets = [
  { id: 'lamp', name: '卷叶灯', create: lamp },
  { id: 'pavilion', name: '小商店', create: pavilion },
  { id: 'sculpture', name: '抽象薄片', create: sculpture },
];
export function initialProject(document = lamp()): Project {
  const id = uid();
  return {
    schemaVersion: 1, currentId: id, actions: [],
    revisions: [{
      id, parentId: null, title: '起形', note: '本地示例，可直接改形或接入 Agent。',
      document, createdAt: Date.now(), references: [], source: 'initial',
    }],
  };
}
