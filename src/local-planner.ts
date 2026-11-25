import { controls, uid, type Plan, type Sketch, type Operation } from './domain';

// Explicitly a deterministic offline preview, never presented as model reasoning.
export function localPlan(instruction: string, document: Sketch, selectedId: string): Plan {
  const target = document.forms.find(f => f.id === selectedId) ?? document.forms.find(f => !f.locked);
  if (!target || target.locked) throw new Error('选中部件已保持，请选其他部件或解除保持');
  if (/添加|加一个|加一片/.test(instruction)) {
    return {
      message: '本地规则添加一个独立薄片。自由语义理解需要接入模型。',
      candidates: [{
        title: '多一片', description: '添加可独立调整的薄片，保留现有作品。',
        operations: [{ type: 'add_form', form: {
          id: uid(), name: '新薄片', color: '#d5ae72', position: [.12, .05, 0], rotation: [0, 0, -.3],
          scale: [1, 1, 1], locked: false, detail: 'exploring', controls: controls(),
          source: { kind: 'loft', angular: false, sections: [
            { y: 0, x: 0, rx: .005, rz: .003 },
            { y: .07, x: 0, rx: .045, rz: .004 },
            { y: .14, x: 0, rx: .002, rz: .002 },
          ] },
        } }],
      }],
    };
  }
  const c = target.controls;
  const op = (key: 'bend' | 'twist' | 'taper' | 'pull', value: number): Operation => ({
    type: 'set_control', targetId: target.id, key, value,
  });
  let variants: Plan['candidates'];
  if (/直|克制|收敛|少一点|减小|小一点/.test(instruction)) {
    variants = [
      { title: '收一点', description: '减弱当前弯曲与扭转。', operations: [op('bend', c.bend * .55), op('twist', c.twist * .5)] },
      { title: '留住姿态', description: '保留弯曲，减少扭转。', operations: [op('twist', c.twist * .25)] },
    ];
  } else if (/薄|扁|窄/.test(instruction)) {
    variants = [
      { title: '更轻薄', description: '局部 Z 方向缩薄，保留其他部件。', operations: [{
        type: 'set_transform', targetId: target.id, key: 'scale', value: [target.scale[0], target.scale[1], Math.max(.08, target.scale[2] * .6)],
      }] },
      { title: '细长一点', description: '收窄局部宽度，稍微拉长。', operations: [{
        type: 'set_transform', targetId: target.id, key: 'scale', value: [Math.max(.08, target.scale[0] * .8), Math.min(8, target.scale[1] * 1.1), target.scale[2]],
      }] },
    ];
  } else if (/舒展|展开|放开/.test(instruction)) {
    variants = [
      { title: '向外舒展', description: '扩大弯曲幅度，减弱扭转。', operations: [op('bend', Math.min(1.7, c.bend + .4)), op('twist', c.twist * .65)] },
      { title: '展开轮廓', description: '保留弯曲，扩大顶部。', operations: [op('taper', Math.min(.7, c.taper + .3))] },
    ];
  } else if (/夸张|扭|弯|方向|试|变化/.test(instruction)) {
    variants = [
      { title: '沿势延伸', description: '沿现有弯曲方向增强变化。', operations: [op('bend', Math.max(-1.7, Math.min(1.7, c.bend + (c.bend < 0 ? -.35 : .35)))), op('twist', Math.max(-2.4, Math.min(2.4, c.twist + .35)))] },
      { title: '另一种张力', description: '保留扭转，向相反方向尝试。', operations: [op('bend', c.bend === 0 ? -.5 : -c.bend * .85), op('taper', Math.min(.7, c.taper + .2))] },
    ];
  } else {
    throw new Error('本地预览仅支持“更夸张”“舒展一点”“更薄”“克制一点”“添加一片”。自由描述请接入模型 API。');
  }
  return { message: `本地规则预览 · 只修改「${target.name}」，其他部件保持原样。`, candidates: variants };
}
