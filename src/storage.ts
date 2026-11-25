import { openDB } from 'idb';
import { parseProject, type Project } from './domain';

const database = () => openDB('unform-workspace', 1, {
  upgrade(db) { db.createObjectStore('projects'); },
});
export async function loadProject(): Promise<Project | null> {
  const db = await database();
  try {
    const raw = await db.get('projects', 'current');
    return raw ? parseProject(raw) : null;
  } finally { db.close(); }
}
// Serialize writes so a slower old save cannot overwrite the latest project.
let queue = Promise.resolve();
export function saveProject(project: Project): Promise<void> {
  const snapshot = structuredClone(project);
  queue = queue.catch(() => {}).then(async () => {
    const db = await database();
    try { await db.put('projects', snapshot, 'current'); }
    finally { db.close(); }
  });
  return queue;
}
