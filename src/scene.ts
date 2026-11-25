import * as THREE from 'three';
import type { Sketch } from './domain';
import { buildDocument, packetGeometry, type BuildOutput } from './geometry';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export function makeGroup(document: Sketch, output = buildDocument(document), wireframe = false) {
  const group = new THREE.Group();
  group.name = document.title;
  for (const packet of output.meshes) {
    const form = document.forms.find(f => f.id === packet.id)!;
    const mesh = new THREE.Mesh(packetGeometry(packet), new THREE.MeshStandardMaterial({
      color: form.color, roughness: .72, metalness: .03,
      flatShading: form.source.kind === 'extrude' || (form.source.kind === 'loft' && form.source.angular),
      side: THREE.DoubleSide, wireframe,
    }));
    mesh.name = form.name;
    mesh.userData.formId = form.id;
    mesh.position.fromArray(form.position);
    mesh.rotation.fromArray([...form.rotation, 'XYZ']);
    mesh.scale.fromArray(form.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
export function disposeGroup(group: THREE.Object3D) {
  group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(m => m.dispose());
    }
  });
}
export function lightScene(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x89958a, 3));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-.5, .8, .6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  rim.position.set(.5, .4, -.6);
  scene.add(rim);
}
export function frameCamera(camera: THREE.PerspectiveCamera, group: THREE.Object3D, aspect: number, direction = new THREE.Vector3(1, .5, 1.8)) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const extent = Math.max(size.y, size.x / aspect, size.z, .12);
  const distance = extent / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.65;
  camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  return center;
}
let thumbnailRenderer: THREE.WebGLRenderer | undefined;
const thumbnailCache = new Map<string, string>();
export function thumbnail(document: Sketch): string {
  const key = JSON.stringify(document);
  if (thumbnailCache.has(key)) return thumbnailCache.get(key)!;
  thumbnailRenderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: false });
  thumbnailRenderer.setSize(280, 190, false);
  thumbnailRenderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9ede6');
  lightScene(scene);
  const group = makeGroup(document);
  scene.add(group);
  const camera = new THREE.PerspectiveCamera(34, 280 / 190, .001, 100);
  frameCamera(camera, group, 280 / 190);
  thumbnailRenderer.render(scene, camera);
  const url = thumbnailRenderer.domElement.toDataURL('image/jpeg', .75);
  disposeGroup(group);
  thumbnailCache.set(key, url);
  if (thumbnailCache.size > 120) thumbnailCache.delete(thumbnailCache.keys().next().value!);
  return url;
}
export async function exportGlb(document: Sketch): Promise<Blob> {
  const group = makeGroup(document);
  group.updateMatrixWorld(true);
  try {
    const result = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: true });
    if (!(result instanceof ArrayBuffer)) throw new Error('GLB 输出格式不正确');
    return new Blob([result], { type: 'model/gltf-binary' });
  } finally { disposeGroup(group); }
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
