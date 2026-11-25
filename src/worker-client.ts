import type { Sketch } from './domain';
import type { BuildOutput } from './geometry';

export class GeometryClient {
  private worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
  private pending = new Map<string, {
    resolve: (output: BuildOutput) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  constructor() {
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.jobId);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(data.jobId);
      if (data.ok) request.resolve(data.output);
      else request.reject(new Error(data.error));
    };
    this.worker.onerror = () => this.dispose();
  }
  build(document: Sketch): Promise<BuildOutput> {
    return new Promise((resolve, reject) => {
      const jobId = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(jobId);
        reject(new Error('几何构建超时'));
      }, 20000);
      this.pending.set(jobId, { resolve, reject, timer });
      this.worker.postMessage({ jobId, document });
    });
  }
  dispose() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('几何执行器已关闭'));
    }
    this.pending.clear();
    this.worker.terminate();
  }
}
