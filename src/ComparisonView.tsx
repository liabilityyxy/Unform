import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { disposeGroup, lightScene, makeGroup, frameCamera } from './scene';
import type { Sketch } from './domain';

export function ComparisonView({ documentA, documentB, titleA, titleB }: {
  documentA: Sketch; documentB: Sketch; titleA: string; titleB: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setScissorTest(true);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scenes = [documentA, documentB].map(doc => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#edf0e9');
      lightScene(scene);
      scene.add(makeGroup(doc));
      const grid = new THREE.GridHelper(2, 60, '#ccd4c6', '#dde3d8');
      grid.position.y = -.002; scene.add(grid);
      return scene;
    });
    const camera = new THREE.PerspectiveCamera(34, 1, .001, 100);
    const union = new THREE.Group();
    union.add(makeGroup(documentA), makeGroup(documentB));
    const controls = new OrbitControls(camera, renderer.domElement);
    const observer = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / 2 / h;
      controls.target.copy(frameCamera(camera, union, camera.aspect));
      controls.update();
    });
    container.append(renderer.domElement); observer.observe(container);
    let frame = 0;
    const render = () => {
      controls.update();
      const width = container.clientWidth / 2, height = container.clientHeight;
      scenes.forEach((scene, i) => {
        renderer.setViewport(i * width, 0, width, height);
        renderer.setScissor(i * width, 0, width, height);
        renderer.render(scene, camera);
      });
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      scenes.forEach(disposeGroup); disposeGroup(union); renderer.dispose(); container.replaceChildren();
    };
  }, [documentA, documentB]);
  return <div className="comparison">
    <div className="comparison-labels"><span>来源 · {titleA}</span><span>当前 · {titleB}</span></div>
    <div ref={host} className="comparison-canvas" />
    <div className="comparison-axis" />
    <span className="comparison-note">相同视角与尺度 · 拖动可联动旋转</span>
  </div>;
}
