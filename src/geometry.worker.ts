import { buildDocument } from './geometry';

self.onmessage = (event: MessageEvent) => {
  const { jobId, document } = event.data;
  try {
    const output = buildDocument(document);
    const transfer = output.meshes.flatMap(mesh => [
      mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer,
    ]);
    self.postMessage({ jobId, ok: true, output }, { transfer });
  } catch (error) {
    self.postMessage({ jobId, ok: false, error: error instanceof Error ? error.message : '几何构建失败' });
  }
};
