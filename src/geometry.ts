import * as THREE from 'three';
import { documentSchema, type Form, type Sketch } from './domain';

export interface MeshPacket {
  id: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}
export interface BuildOutput {
  meshes: MeshPacket[];
  vertices: number;
  triangles: number;
  warnings: string[];
}
const lerp = THREE.MathUtils.lerp;

function loft(source: Extract<Form['source'], { kind: 'loft' }>): THREE.BufferGeometry {
  const sections = source.sections;
  for (let i = 1; i < sections.length; i++) {
    if (sections[i].y <= sections[i - 1].y) throw new Error('截面高度必须递增');
  }
  const radial = source.angular ? 4 : 40;
  const rows = source.angular ? sections.length - 1 : 64;
  const start = sections[0].y, end = sections.at(-1)!.y;
  const positions: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const y = source.angular ? sections[row].y : lerp(start, end, row / rows);
    let i = 0;
    while (i < sections.length - 2 && y > sections[i + 1].y) i++;
    const a = sections[i], b = sections[i + 1];
    const t = THREE.MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1);
    const x = lerp(a.x, b.x, t), rx = lerp(a.rx, b.rx, t), rz = lerp(a.rz, b.rz, t);
    for (let col = 0; col < radial; col++) {
      const angle = (col / radial) * Math.PI * 2 + (source.angular ? Math.PI / 4 : 0);
      positions.push(x + Math.cos(angle) * rx, y, Math.sin(angle) * rz);
      if (row < rows) {
        const n = (col + 1) % radial, p = row * radial + col;
        indices.push(p, (row + 1) * radial + col, row * radial + n);
        indices.push(row * radial + n, (row + 1) * radial + col, (row + 1) * radial + n);
      }
    }
  }
  // End caps make the loft a closed volume; no printability claim is implied.
  const bottom = positions.length / 3;
  positions.push(sections[0].x, start, 0);
  const top = positions.length / 3;
  positions.push(sections.at(-1)!.x, end, 0);
  for (let col = 0; col < radial; col++) {
    const n = (col + 1) % radial;
    indices.push(bottom, col, n);
    indices.push(top, rows * radial + n, rows * radial + col);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
}

function orientation(a: number[], b: number[], c: number[]) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
export function validateContour(points: number[][]) {
  const count = points.length;
  let area = 0;
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % count];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) throw new Error('轮廓包含重复点');
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue;
      const c = points[j], d = points[(j + 1) % count];
      if (orientation(a, b, c) * orientation(a, b, d) < 0 &&
          orientation(c, d, a) * orientation(c, d, b) < 0) throw new Error('轮廓自交，请重新画一个不交叉的闭合轮廓');
    }
  }
  if (Math.abs(area) < 1e-6) throw new Error('轮廓面积太小');
}

function generate(form: Form): THREE.BufferGeometry {
  const s = form.source;
  if (s.kind === 'loft') return loft(s);
  if (s.kind === 'sweep') {
    const points = s.points.map(p => new THREE.Vector3(...p));
    if (points.every(p => p.distanceTo(points[0]) < 1e-6)) throw new Error('走势线长度为零');
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    return new THREE.TubeGeometry(curve, 80, s.radius, 12, false);
  }
  validateContour(s.points);
  const path = new THREE.Shape(s.points.map(p => new THREE.Vector2(...p)));
  path.closePath();
  return new THREE.ExtrudeGeometry(path, {
    depth: s.depth, steps: 12, bevelEnabled: s.bevel > 0,
    bevelSize: s.bevel, bevelThickness: s.bevel, bevelSegments: 2, curveSegments: 8,
  });
}

export function buildForm(form: Form): MeshPacket {
  const g = generate(form);
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const height = Math.max(.001, box.max.y - box.min.y);
  const centerX = (box.min.x + box.max.x) / 2;
  const centerZ = (box.min.z + box.max.z) / 2;
  const c = form.controls;
  const positions = g.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x0 = positions.getX(i), y0 = positions.getY(i), z0 = positions.getZ(i);
    const t = THREE.MathUtils.clamp((y0 - box.min.y) / height, 0, 1);
    const scale = 1 + c.taper * t;
    const x = (x0 - centerX) * scale, z = (z0 - centerZ) * scale;
    const angle = c.twist * t;
    const distance = Math.sqrt(
      ((x0 - centerX) / height) ** 2 +
      (t - c.region) ** 2 +
      ((z0 - centerZ) / height) ** 2,
    );
    const v = Math.max(0, 1 - distance / c.radius);
    const weight = v * v * (3 - 2 * v);
    positions.setXYZ(i,
      centerX + Math.cos(angle) * x - Math.sin(angle) * z + c.bend * height * t * t + c.pull * weight,
      y0,
      centerZ + Math.sin(angle) * x + Math.cos(angle) * z,
    );
  }
  // Actual vertex deformation, not a shader-only preview.
  g.computeVertexNormals();
  const p = new Float32Array(g.getAttribute('position').array);
  const n = new Float32Array(g.getAttribute('normal').array);
  const indices = g.index ? new Uint32Array(g.index.array) : Uint32Array.from({ length: p.length / 3 }, (_, i) => i);
  g.dispose();
  for (const value of p) if (!Number.isFinite(value)) throw new Error(`${form.name} 包含无效坐标`);
  return { id: form.id, positions: p, normals: n, indices };
}

export function buildDocument(raw: Sketch): BuildOutput {
  const document = documentSchema.parse(raw);
  const meshes = document.forms.map(buildForm);
  const vertices = meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  if (vertices > 500000) throw new Error('草图过于复杂，请减少对象或轮廓点');
  return {
    meshes, vertices, triangles: meshes.reduce((sum, m) => sum + m.indices.length / 3, 0),
    warnings: ['未检测自交、最小壁厚和制造可行性'],
  };
}

export function packetGeometry(packet: MeshPacket) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(packet.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(packet.normals, 3));
  g.setIndex(new THREE.BufferAttribute(packet.indices, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
