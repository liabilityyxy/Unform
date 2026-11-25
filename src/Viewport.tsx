import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Form, Sketch } from './domain';
import { makeGroup, disposeGroup, lightScene, frameCamera } from './scene';
import { GeometryClient } from './worker-client';
import { buildForm, packetGeometry, type BuildOutput } from './geometry';

export type Mode = 'orbit' | 'draw' | 'pull' | 'move';
export interface ViewportHandle { fit(): void; front(): void; capture(): string }
interface Props {
  document: Sketch;
  selectedId: string;
  mode: Mode;
  wireframe: boolean;
  onSelect(id: string): void;
  onDraw(points: [number, number][]): void;
  onPull(id: string, value: number): void;
  onTransform(form: Form): void;
  onError(error: string): void;
  onStats(stats: { vertices: number; triangles: number }): void;
}
interface Engine {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  controls: OrbitControls; transform: TransformControls; group: THREE.Group;
  overlay: THREE.Group; selection?: THREE.BoxHelper; worker: GeometryClient;
}
function fitWorkspace(e: Engine, direction?: THREE.Vector3) {
  const canvas = e.renderer.domElement;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const composer = canvas.closest('.canvas-region')?.querySelector('.agent-composer');
  const bottom = (composer?.getBoundingClientRect().height ?? 140) + 55;
  const top = 55, available = Math.max(130, height - bottom - top);
  const center = frameCamera(e.camera, e.group, width / Math.max(1, height), direction);
  e.camera.position.sub(center).multiplyScalar(height / available).add(center);
  e.camera.setViewOffset(width, height, 0, (bottom - top) / 2, width, height);
  e.controls.target.copy(center); e.controls.update();
}

export const Viewport = forwardRef<ViewportHandle, Props>(function Viewport(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const current = useRef(props); current.current = props;
  const engine = useRef<Engine | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  useImperativeHandle(ref, () => ({
    fit() {
      const e = engine.current; if (!e) return;
      fitWorkspace(e);
    },
    front() {
      const e = engine.current; if (!e) return;
      fitWorkspace(e, new THREE.Vector3(0, 0, 1));
    },
    capture() {
      const e = engine.current;
      if (!e) return '';
      e.renderer.render(e.scene, e.camera);
      return e.renderer.domElement.toDataURL('image/jpeg', .65);
    },
  }));

  useEffect(() => {
    const host = container.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { setFailure('当前浏览器无法启动 WebGL，请启用硬件加速后重试。'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor('#edf0e9');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '三维创作画布');
    renderer.domElement.setAttribute('data-testid', 'scene-canvas');
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#edf0e9', 1.8, 5);
    lightScene(scene);
    const grid = new THREE.GridHelper(3, 100, '#c6cfc2', '#d8dfd2');
    grid.position.y = -.002;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = .42;
    scene.add(grid);
    const camera = new THREE.PerspectiveCamera(34, 1, .001, 100);
    camera.position.set(.6, .42, .85);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, .19, 0);
    controls.enableDamping = true;
    controls.minDistance = .08;
    controls.maxDistance = 4;
    controls.maxPolarAngle = Math.PI * .92;
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode('translate'); transform.setSize(.7);
    scene.add(transform.getHelper());
    const group = new THREE.Group(), overlay = new THREE.Group();
    scene.add(group, overlay);
    const e: Engine = { renderer, scene, camera, controls, transform, group, overlay, worker: new GeometryClient() };
    engine.current = e;
    transform.addEventListener('dragging-changed', event => { controls.enabled = !event.value; });
    transform.addEventListener('mouseUp', () => {
      const object = transform.object;
      if (!object) return;
      const f = current.current.document.forms.find(f => f.id === object.userData.formId);
      if (f) current.current.onTransform({
        ...f, position: object.position.toArray(),
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
        scale: object.scale.toArray(),
      });
    });
    const resize = new ResizeObserver(() => {
      const width = host.clientWidth, height = host.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix();
      if (e.group.children.length) fitWorkspace(e, camera.position.clone().sub(controls.target));
    });
    resize.observe(host);
    const composer = host.parentElement?.querySelector('.agent-composer');
    if (composer) resize.observe(composer);
    let frame = 0;
    const animate = () => {
      controls.update(); e.selection?.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    const ray = new THREE.Raycaster();
    function pointer(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(
        (event.clientX - rect.left) / rect.width * 2 - 1,
        -(event.clientY - rect.top) / rect.height * 2 + 1,
      ), camera);
    }
    let start: { x: number; y: number; pull: number; form?: Form } | null = null;
    let originalGeometry: THREE.BufferGeometry | null = null;
    let previewMesh: THREE.Mesh | null = null;
    function restorePreview() {
      if (previewMesh && originalGeometry) {
        if (previewMesh.geometry !== originalGeometry) previewMesh.geometry.dispose();
        previewMesh.geometry = originalGeometry;
      }
      previewMesh = null; originalGeometry = null;
      delete host.dataset.pullPreview;
    }
    let points: [number, number][] = [];
    let line: THREE.Line | null = null;
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    function addPoint(event: PointerEvent) {
      pointer(event);
      const p = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!p) return;
      const previous = points.at(-1);
      if (!previous || Math.hypot(p.x - previous[0], p.y - previous[1]) > .003) {
        points.push([p.x, p.y]);
        if (line) { overlay.remove(line); disposeGroup(line); }
        const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(p[0], p[1], .002)));
        line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#d46e54', depthTest: false }));
        overlay.add(line);
      }
    }
    function down(event: PointerEvent) {
      if (event.button !== 0 || transform.dragging) return;
      const state = current.current;
      if (state.mode === 'draw') {
        controls.enabled = false; points = []; addPoint(event);
        start = { x: event.clientX, y: event.clientY, pull: 0 };
        renderer.domElement.setPointerCapture(event.pointerId);
        return;
      }
      pointer(event);
      const hit = ray.intersectObjects(e.group.children, false)[0];
      if (hit) {
        const id = hit.object.userData.formId as string;
        state.onSelect(id);
        const f = state.document.forms.find(f => f.id === id)!;
        if (state.mode === 'pull' && !f.locked) {
          controls.enabled = false;
          start = { x: event.clientX, y: event.clientY, pull: f.controls.pull, form: structuredClone(f) };
          previewMesh = hit.object as THREE.Mesh;
          originalGeometry = previewMesh.geometry;
          renderer.domElement.setPointerCapture(event.pointerId);
        }
      }
    }
    function move(event: PointerEvent) {
      if (!start) return;
      if (current.current.mode === 'draw') addPoint(event);
      if (current.current.mode === 'pull') {
        const value = THREE.MathUtils.clamp(start.pull + (event.clientX - start.x) * .00045, -.2, .2);
        host.dataset.pullPreview = String(value);
        if (previewMesh && start.form) {
          const form = { ...start.form, controls: { ...start.form.controls, pull: value } };
          const next = packetGeometry(buildForm(form));
          if (previewMesh.geometry !== originalGeometry) previewMesh.geometry.dispose();
          previewMesh.geometry = next;
        }
      }
    }
    function up(event: PointerEvent) {
      if (!start) return;
      const was = start; start = null; controls.enabled = true;
      if (current.current.mode === 'draw') {
        if (line) { overlay.remove(line); disposeGroup(line); line = null; }
        if (points.length >= 4) {
          const step = Math.max(1, Math.ceil(points.length / 90));
          const simplified = points.filter((_, i) => i % step === 0);
          if (Math.hypot(simplified[0][0] - simplified.at(-1)![0], simplified[0][1] - simplified.at(-1)![1]) < .003) simplified.pop();
          current.current.onDraw(simplified);
        } else current.current.onError('轮廓太短，试着画一个更大的闭合形状');
      } else if (current.current.mode === 'pull') {
        const value = THREE.MathUtils.clamp(was.pull + (event.clientX - was.x) * .00045, -.2, .2);
        restorePreview();
        if (was.form) current.current.onPull(was.form.id, value);
      }
    }
    function cancel() {
      restorePreview(); start = null; points = []; controls.enabled = true;
      if (line) { overlay.remove(line); disposeGroup(line); line = null; }
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('keydown', escape);
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', cancel);
    setReady(true);
    return () => {
      cancel(); window.removeEventListener('keydown', escape);
      cancelAnimationFrame(frame); resize.disconnect(); e.worker.dispose();
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointercancel', cancel);
      controls.dispose(); transform.dispose(); disposeGroup(scene); renderer.dispose();
      host.replaceChildren(); engine.current = null;
    };
  }, []);

  const framed = useRef(false);
  useEffect(() => {
    const e = engine.current; if (!e) return;
    let canceled = false;
    e.worker.build(props.document).then((output: BuildOutput) => {
      if (canceled) return;
      e.transform.detach();
      e.scene.remove(e.group); disposeGroup(e.group);
      e.group = makeGroup(props.document, output, props.wireframe);
      e.scene.add(e.group);
      if (!framed.current) {
        fitWorkspace(e);
        framed.current = true;
      }
      updateSelection(e, current.current);
      current.current.onStats(output);
    }).catch(error => { if (!canceled) current.current.onError(error.message); });
    return () => { canceled = true; };
  }, [props.document, props.wireframe, ready]);

  useEffect(() => {
    const e = engine.current;
    if (e) {
      updateSelection(e, props);
      e.controls.enableRotate = props.mode !== 'draw' && props.mode !== 'pull';
    }
  }, [props.selectedId, props.mode, ready]);

  return <div className={`viewport viewport-${props.mode}`} ref={container}>
    {failure && <div className="viewport-error">{failure}</div>}
  </div>;
});

function updateSelection(e: Engine, props: Props) {
  if (e.selection) { e.scene.remove(e.selection); e.selection.dispose(); e.selection = undefined; }
  const object = e.group.children.find(o => o.userData.formId === props.selectedId);
  const form = props.document.forms.find(f => f.id === props.selectedId);
  if (object) {
    e.selection = new THREE.BoxHelper(object, '#b06c43');
    (e.selection.material as THREE.LineBasicMaterial).transparent = true;
    (e.selection.material as THREE.LineBasicMaterial).opacity = .38;
    e.scene.add(e.selection);
    if (props.mode === 'move' && !form?.locked) e.transform.attach(object);
    else e.transform.detach();
  } else e.transform.detach();
}
