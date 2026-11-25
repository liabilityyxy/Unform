import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight,
  CircleHelp, Copy, CornerUpLeft, Download, Expand, GitBranch, Layers2, LoaderCircle, LockKeyhole,
  Maximize2, MousePointer2, Move3D, Palette, PanelLeftClose, PenLine, Plus, RotateCcw,
  Settings2, Shapes, Sparkles, Split, Square, UnlockKeyhole, Upload, Workflow, X,
} from 'lucide-react';
import {
  applyOperations, clone, commitRevision, controls, copyPart, parseProject, planSchema, uid,
  type Candidate, type Form, type Operation, type Plan, type Project, type Revision, type Sketch,
} from './domain';
import { initialProject, presets } from './presets';
import { Viewport, type Mode, type ViewportHandle } from './Viewport';
import { GeometryClient } from './worker-client';
import { loadProject, saveProject } from './storage';
import { download, exportGlb, thumbnail } from './scene';
import { localPlan } from './local-planner';
import './style.css';

function IconButton({ title, children, active, ...props }: {
  title: string; children: ReactNode; active?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} title={title} aria-label={title} className={`icon-button ${active ? 'active' : ''} ${props.className || ''}`}>{children}</button>;
}
function Mini({ document, alt }: { document: Sketch; alt: string }) {
  const src = useMemo(() => {
    try { return thumbnail(document); } catch { return ''; }
  }, [document]);
  return src ? <img src={src} alt={alt} draggable={false} /> : <div className="mini-empty"><Shapes size={24} /></div>;
}
function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose(): void; wide?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => [...root.current!.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]')].filter(e => !e.hasAttribute('disabled'));
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key === 'Tab') {
        const items = focusable(), index = items.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section ref={root} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><IconButton title="关闭" onClick={onClose}><X size={18} /></IconButton></header>
      {children}
    </section>
  </div>;
}

export default function App() {
  const [project, setProject] = useState<Project>(() => initialProject());
  const projectRef = useRef(project); projectRef.current = project;
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState('head');
  const [mode, setMode] = useState<Mode>('orbit');
  const [wireframe, setWireframe] = useState(false);
  const [draft, updateDraft] = useState<Sketch | null>(null);
  const draftRef = useRef<Sketch | null>(null);
  const setDraft = (value: Sketch | null) => { draftRef.current = value; updateDraft(value); };
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(0);
  const [instruction, setInstruction] = useState('');
  const [message, setMessage] = useState('从这片卷叶开始，看看它还能成为什么。');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [status, setStatus] = useState<{ configured: boolean; model?: string }>({ configured: false });
  const [local, setLocal] = useState(true);
  const [toast, setToast] = useState('');
  const [saveState, setSaveState] = useState('本地草稿');
  const [stats, setStats] = useState({ vertices: 0, triangles: 0 });
  const [modal, setModal] = useState<'new' | 'settings' | 'help' | 'compare' | 'dsl' | null>(null);
  const [explore, setExplore] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [borrowForm, setBorrowForm] = useState('');
  const [showObjects, setShowObjects] = useState(true);
  const [showInspector, setShowInspector] = useState(false);
  const [redo, setRedo] = useState<string[]>([]);
  const [cancelToken, setCancelToken] = useState(0);
  const runSequence = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const viewport = useRef<ViewportHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const geometry = useRef<GeometryClient | null>(null);
  const current = project.revisions.find(r => r.id === project.currentId)!;
  const document = draft ?? current.document;
  const selectedForm = document.forms.find(f => f.id === selected);
  const comparison = project.revisions.find(r => r.id === compareId);
  const notify = (text: string) => setToast(text);

  useEffect(() => {
    const client = new GeometryClient(); geometry.current = client;
    loadProject().then(saved => {
      if (saved) { setProject(saved); setSelected(saved.revisions.find(r => r.id === saved.currentId)!.document.forms.at(-1)!.id); }
    }).catch(() => notify('本地项目无法读取，已打开新草稿。可以导入项目备份。')).finally(() => setLoaded(true));
    fetch('/api/status').then(r => r.json()).then(data => {
      setStatus(data); setLocal(!data.configured);
    }).catch(() => setStatus({ configured: false }));
    return () => { client.dispose(); geometry.current = null; abort.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    setSaveState('正在保存');
    const timer = setTimeout(() => {
      saveProject(project).then(() => setSaveState('已保存到本机')).catch(() => {
        setSaveState('保存失败'); notify('本地空间不足或存储不可用，请导出项目备份');
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [project, loaded]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!current.document.forms.some(f => f.id === selected)) setSelected(current.document.forms.at(-1)!.id);
    setDraft(null);
  }, [project.currentId]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select')) return;
      if (event.key === 'Escape') { setDraft(null); setMode('orbit'); setCandidates([]); }
      if (event.key.toLowerCase() === 'f') viewport.current?.fit();
      if ((event.metaKey || event.ctrlKey) && event.key === 'z') { event.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });

  async function saveRevision(next: Sketch, title: string, note: string, options: {
    baseId?: string; source?: Revision['source']; operations?: Operation[]; references?: Revision['references']; force?: boolean;
  } = {}) {
    const baseId = options.baseId ?? projectRef.current.currentId;
    const base = projectRef.current.revisions.find(r => r.id === baseId)!;
    if (!options.force && JSON.stringify(next) === JSON.stringify(base.document)) { setDraft(null); return true; }
    if (projectRef.current.revisions.length >= 300) { notify('已达到本项目 300 个记录，请先导出备份并开启新项目'); return false; }
    setBuilding(n => n + 1);
    try {
      await geometry.current!.build(next);
      if (!projectRef.current.revisions.some(r => r.id === baseId)) throw new Error('工作区已切换，本次修改未写入');
      const revision: Revision = {
        id: uid(), parentId: baseId, document: next, title, note, createdAt: Date.now(),
        source: options.source ?? 'human', references: options.references ?? [],
      };
      const branched = projectRef.current.currentId !== baseId;
      setProject(previous => {
        const result = commitRevision(previous, revision, baseId);
        const changedId = options.operations?.find(o => 'targetId' in o);
        const targetId = changedId && 'targetId' in changedId ? changedId.targetId : selected;
        return {
          ...result.project,
          actions: [...previous.actions, {
            revisionId: revision.id, targetId, description: note,
            operations: options.operations ?? [],
            before: base.document.forms.find(f => f.id === targetId) ?? null,
            after: next.forms.find(f => f.id === targetId) ?? null,
          }].slice(-30),
        };
      });
      setDraft(null); setRedo([]);
      if (branched) notify('结果已保存为独立分支，当前版本未被覆盖');
      return true;
    } catch (error) {
      setDraft(null); notify(error instanceof Error ? error.message : '修改未成功，原版本已保留');
      return false;
    } finally { setBuilding(n => n - 1); }
  }
  function apply(operations: Operation[], title: string, note: string) {
    const base = projectRef.current.revisions.find(r => r.id === projectRef.current.currentId)!;
    try { void saveRevision(applyOperations(base.document, operations), title, note, { baseId: base.id, operations }); }
    catch (error) { notify((error as Error).message); }
  }
  function navigate(id: string) { setDraft(null); setProject(p => ({ ...p, currentId: id })); }
  function undo() {
    const c = projectRef.current.revisions.find(r => r.id === projectRef.current.currentId)!;
    if (c.parentId) { setRedo(ids => [...ids, c.id]); navigate(c.parentId); }
  }
  function redoAction() { const id = redo.at(-1); if (id) { navigate(id); setRedo(ids => ids.slice(0, -1)); } }
  function previewControl(key: keyof Form['controls'], value: number) {
    if (!selectedForm || selectedForm.locked) return;
    const next = clone(draftRef.current ?? current.document);
    next.forms.find(f => f.id === selected)!.controls[key] = value;
    draftRef.current = next;
    setDraft(next);
  }
  function finishControl(key: keyof Form['controls']) {
    const next = draftRef.current;
    if (!next) return;
    draftRef.current = null;
    const f = next.forms.find(f => f.id === selected)!;
    const label = controlLabels[key];
    void saveRevision(next, `调整${label}`, `${f.name} · ${label} ${f.controls[key].toFixed(2)}`, {
      operations: [{ type: 'set_control', targetId: f.id, key, value: f.controls[key] }],
    });
  }
  function lockSelected() {
    if (!selectedForm) return;
    const next = clone(current.document), f = next.forms.find(f => f.id === selected)!;
    f.locked = !f.locked;
    void saveRevision(next, f.locked ? '保持部件' : '解除保持', `${f.name} · ${f.locked ? '形状与位置保持' : '允许修改'}`);
  }
  function addDrawn(points: [number, number][]) {
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
    const id = uid();
    const form: Form = {
      id, name: `轮廓薄片 ${current.document.forms.length + 1}`, color: '#d5ae72',
      source: { kind: 'extrude', points: points.map(p => [p[0] - cx, p[1] - cy]), depth: .012, bevel: 0 },
      position: [cx, cy, 0], rotation: [0, 0, 0], scale: [1, 1, 1], controls: controls(), locked: false, detail: 'exploring',
    };
    apply([{ type: 'add_form', form }], '画一个新形', '在正面工作平面绘制闭合轮廓，拉伸为薄片');
    setSelected(id); setMode('orbit');
  }
  async function borrow(mode: 'copy' | 'controls') {
    if (!comparison) return;
    const source = comparison.document.forms.find(f => f.id === borrowForm) ?? comparison.document.forms.at(-1)!;
    try {
      const next = copyPart(current.document, source, selected, mode);
      const saved = await saveRevision(next, mode === 'copy' ? '借回一个局部' : '借用形变', `从「${comparison.title}」借用 ${source.name}`, {
        references: [{ revisionId: comparison.id, formId: source.id, mode }],
      });
      if (saved) setModal(null);
    } catch (error) { notify((error as Error).message); }
  }

  async function prepare(plan: Plan, base: Revision, source: 'agent' | 'local') {
    const result: Candidate[] = [], reports: { title: string; ok: boolean; error?: string; vertices?: number; triangles?: number }[] = [];
    for (const item of plan.candidates) {
      try {
        const doc = applyOperations(base.document, item.operations);
        const output = await geometry.current!.build(doc);
        result.push({ id: uid(), baseId: base.id, title: item.title, description: item.description, document: doc, source });
        reports.push({ title: item.title, ok: true, vertices: output.vertices, triangles: output.triangles });
      } catch (error) { reports.push({ title: item.title, ok: false, error: (error as Error).message }); }
    }
    return { result, reports };
  }
  async function ask(event?: React.FormEvent) {
    event?.preventDefault();
    if (!instruction.trim() || busy) return;
    const seq = ++runSequence.current;
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const base = projectRef.current.revisions.find(r => r.id === projectRef.current.currentId)!;
    const prompt = instruction.trim();
    setBusy(true); setCandidates([]); setDraft(null);
    setMessage(local ? '本地规则正在构建形态预览…' : 'Agent 正在读取选区与最近动作…');
    try {
      let plan: Plan, runId = '', callId = '';
      if (local) plan = localPlan(prompt, base.document, selected);
      else {
        const response = await fetch('/api/agent', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({
            instruction: prompt, document: base.document, selectedId: selected,
            baseRevisionId: base.id, recentActions: projectRef.current.actions.slice(-4),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Agent 请求失败');
        plan = planSchema.parse(data.plan); runId = data.runId; callId = data.callId;
      }
      let built = await prepare(plan, base, local ? 'local' : 'agent');
      if (seq !== runSequence.current) return;
      if (!local) {
        setMessage('已执行几何工具，正在回传构建结果…');
        const feedback = await fetch(`/api/agent/${runId}/results`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ callId, results: built.reports }),
        });
        const data = await feedback.json();
        if (!feedback.ok) notify(data.error || '反馈回传失败，保留可用候选');
        else if (data.plan) {
          plan = planSchema.parse(data.plan);
          const repaired = await prepare(plan, base, 'agent');
          built = { result: [...built.result, ...repaired.result].slice(0, 3), reports: repaired.reports };
        }
      }
      if (seq !== runSequence.current) return;
      setCandidates(built.result); setMessage(plan.message);
      if (!built.result.length) throw new Error(built.reports.map(r => r.error).join('；') || '没有可用候选');
      if (built.reports.some(r => !r.ok)) notify('部分候选未通过几何检查，只展示可用结果');
      setInstruction('');
    } catch (error) {
      if (seq !== runSequence.current) return;
      const text = error instanceof Error ? error.message : '未能生成候选';
      setMessage(text); notify(text);
    } finally { if (seq === runSequence.current) setBusy(false); }
  }
  function cancelRun() {
    runSequence.current++; abort.current?.abort(); setBusy(false);
    setMessage('已停止本轮尝试，当前作品保持不变。'); setCancelToken(n => n + 1);
  }
  async function accept(candidate: Candidate) {
    const saved = await saveRevision(candidate.document, candidate.title, candidate.description, {
      baseId: candidate.baseId, source: candidate.source, force: true,
    });
    if (!saved) return;
    setCandidates(items => items.filter(c => c.id !== candidate.id));
    setMessage(`已留住「${candidate.title}」，可以接着直接改形。`);
  }
  async function exportModel() {
    try { download(await exportGlb(current.document), `Unform-${current.title}.glb`); notify('已导出当前版本的实际几何 · 单位为米'); }
    catch (error) { notify((error as Error).message); }
  }
  async function importFile(file: File) {
    if (file.size > 25 * 1024 * 1024) { notify('项目包超过 25 MB'); return; }
    try {
      const imported = parseProject(JSON.parse(await file.text()));
      for (const r of imported.revisions) await geometry.current!.build(r.document);
      // Keep the existing workspace in a downloaded backup before replacing it.
      download(new Blob([JSON.stringify(projectRef.current)], { type: 'application/json' }), 'Unform-导入前备份.json');
      runSequence.current++; abort.current?.abort(); setBusy(false);
      setProject(imported); setCandidates([]); setDraft(null); notify('项目已导入，原工作区已下载备份');
    } catch (error) { notify(`导入失败：${(error as Error).message}`); }
  }
  const recent = [...project.revisions].reverse();
  const graph = useMemo(() => {
    const nodes = new Map<string, { x: number; y: number }>();
    const usedParents = new Set<string>();
    let lanes = 0;
    for (const revision of project.revisions) {
      const parent = revision.parentId ? nodes.get(revision.parentId) : undefined;
      const lane = parent && !usedParents.has(revision.parentId!) ? parent.y / 142 : lanes++;
      if (revision.parentId) usedParents.add(revision.parentId);
      nodes.set(revision.id, { x: parent ? parent.x + 164 : 12, y: lane * 142 + 0 });
    }
    return {
      nodes,
      width: Math.max(...[...nodes.values()].map(n => n.x)) + 160,
      height: Math.max(...[...nodes.values()].map(n => n.y)) + 132,
    };
  }, [project.revisions]);
  const closeModal = () => setModal(null);

  return <div className="workspace">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Unform 首页"><span className="brand-mark"><Shapes size={22} strokeWidth={1.6} /></span><strong>unform<span>未形</span></strong></a>
      <span className="header-divider" />
      <div className="project-heading"><span>{current.document.title}</span><small><span className={`save-dot ${saveState === '保存失败' ? 'error' : ''}`} />{saveState}</small></div>
      <div className="header-actions">
        <button className="text-button model-settings" title="模型连接设置" onClick={() => setModal('settings')}><Settings2 size={16} /><span>配置模型</span></button>
        <button className="text-button new-button" onClick={() => setModal('new')}><Plus size={15} />新方向</button>
        <IconButton title="导入项目" onClick={() => fileInput.current?.click()}><Upload size={17} /></IconButton>
        <IconButton title="导出项目备份" onClick={() => download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'Unform-草图项目.json')}><Download size={17} /></IconButton>
        <button className="export-button" onClick={exportModel}><ArrowUpRight size={16} /><span>导出 GLB</span></button>
      </div>
      <input ref={fileInput} type="file" accept=".json" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = ''; }} />
    </header>

    <main className="studio">
      <aside className={`objects-panel ${showObjects ? '' : 'collapsed'}`}>
        <div className="panel-heading"><span>草图元素 <b>{document.forms.length.toString().padStart(2, '0')}</b></span><IconButton title={showObjects ? '收起元素' : '展开元素'} onClick={() => setShowObjects(v => !v)}><PanelLeftClose size={15} /></IconButton></div>
        {showObjects && <>
          <div className="object-list">{document.forms.map((form, index) => <button
            key={form.id} className={`object-row ${form.id === selected ? 'selected' : ''}`}
            onClick={() => setSelected(form.id)} data-testid={`object-${form.id}`}
          >
            <span className="object-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="object-color" style={{ background: form.color }} />
            <span className="object-name">{form.name}<small>{form.detail === 'placeholder' ? '占位' : form.source.kind === 'sweep' ? '曲线扫掠' : form.source.kind === 'loft' ? '截面体块' : '轮廓拉伸'}</small></span>
            {form.locked ? <LockKeyhole size={12} /> : <ChevronRight size={12} />}
          </button>)}</div>
          <button className="add-outline" onClick={() => { setMode('draw'); viewport.current?.front(); }}><Plus size={15} />画一个新形</button>
          <div className="panel-foot"><span className="eyebrow">FORM STUDY / 001</span><p>形还未定，想法继续。</p><button onClick={() => setModal('help')} className="help-link"><CircleHelp size={14} />操作提示</button></div>
        </>}
      </aside>

      <section className="canvas-region">
        <div className="canvas-top"><span className="canvas-label"><span className="tiny-cross">+</span>形态工作台 <small>SHAPE EXPLORATION</small></span><span className="revision-label">{current.title}<span>v{String(project.revisions.findIndex(r => r.id === current.id) + 1).padStart(2, '0')}</span></span></div>
        <Viewport ref={viewport} document={document} selectedId={selected} mode={mode} wireframe={wireframe}
          onSelect={setSelected} onDraw={addDrawn}
          onPull={(id, value) => apply([{ type: 'set_control', targetId: id, key: 'pull', value }], '局部拉动', `${selectedForm?.name} · 局部向侧面拉动`)}
          onTransform={form => apply([{ type: 'set_transform', targetId: form.id, key: 'position', value: form.position }], '移动部件', `${form.name} · 调整位置`)}
          onError={notify} onStats={setStats}
        />
        <nav className="tool-rail" aria-label="建模工具">
          <IconButton title="观察与选择" active={mode === 'orbit'} onClick={() => setMode('orbit')}><MousePointer2 size={19} /></IconButton>
          <IconButton title="绘制闭合轮廓" active={mode === 'draw'} onClick={() => { setMode('draw'); viewport.current?.front(); }}><PenLine size={19} /></IconButton>
          <IconButton title="局部拉动" active={mode === 'pull'} onClick={() => setMode('pull')}><Move3D size={20} /></IconButton>
          <IconButton title="移动部件" active={mode === 'move'} onClick={() => setMode('move')}><Expand size={19} /></IconButton>
          <span className="tool-separator" />
          <IconButton title="线框显示" active={wireframe} onClick={() => setWireframe(v => !v)}><Shapes size={19} /></IconButton>
          <IconButton title="适应视图" onClick={() => viewport.current?.fit()}><Maximize2 size={18} /></IconButton>
          <IconButton title="正面视图" onClick={() => viewport.current?.front()}><Square size={17} /></IconButton>
          <IconButton title="局部参数" className="mobile-inspector-toggle" active={showInspector} onClick={() => setShowInspector(v => !v)}><Settings2 size={18} /></IconButton>
        </nav>
        <div className="history-tools">
          <IconButton title="回到上一步" onClick={undo} disabled={!current.parentId}><CornerUpLeft size={17} /></IconButton>
          <IconButton title="重做" onClick={redoAction} disabled={!redo.length}><ArrowRight size={17} /></IconButton>
          <span />
          <button onClick={() => void saveRevision(clone(current.document), `方向 ${project.revisions.length + 1}`, '从当前版本留一个独立方向', { force: true })}><GitBranch size={15} />留一版</button>
        </div>
        <div className="canvas-bottom-meta"><span>Y ↑ <i />{stats.triangles.toLocaleString()} 三角面</span><span>{building > 0 ? <><LoaderCircle className="spin" size={12} />构建中</> : <><span className="status-dot" />可继续编辑</>}</span></div>

        <section className={`agent-composer ${candidates.length ? 'with-candidates' : ''}`} aria-label="Agent 创作">
          {candidates.length > 0 && <div className="candidate-strip">{candidates.map(candidate => <article className="candidate" key={candidate.id}>
            <Mini document={candidate.document} alt={candidate.title} />
            <div><strong>{candidate.title}</strong><p>{candidate.description}</p>
              {candidate.baseId !== current.id && <small className="stale-label">基于旧版 · 将保留为分支</small>}
              <button onClick={() => void accept(candidate)} disabled={building > 0}><Check size={13} />留住这版</button>
            </div>
          </article>)}</div>}
          <div className="agent-meta"><span><Sparkles size={14} /><strong>一起推敲</strong><button className={`mode-badge ${local ? '' : 'online'}`} onClick={() => setModal('settings')}>{local ? '配置模型' : status.model || '模型已配置'}<ChevronDown size={10} /></button></span><IconButton title="Agent 设置" onClick={() => setModal('settings')}><Settings2 size={14} /></IconButton></div>
          <p className="agent-message" aria-live="polite">{message}</p>
          <form onSubmit={ask}><textarea aria-label="创作想法" placeholder={selectedForm ? `对「${selectedForm.name}」说点什么…` : '说说接下来想怎么试…'} value={instruction} onChange={e => setInstruction(e.target.value)} rows={1}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(); } }} />
            {busy ? <button className="send-button cancel" type="button" onClick={cancelRun} aria-label="停止本轮尝试"><Square size={15} fill="currentColor" /></button> :
              <button className="send-button" disabled={!instruction.trim()} aria-label="生成候选"><ArrowUpRight size={20} /></button>}
          </form>
          <div className="suggestions">{['沿这个方向再夸张一点', '更舒展一些', '更薄一点'].map(text => <button key={text} disabled={busy} onClick={() => setInstruction(text)}>{text}<ArrowUpRight size={10} /></button>)}</div>
        </section>
      </section>

      <aside className={`inspector ${showInspector ? 'mobile-open' : ''}`}>
        <div className="panel-heading"><span>局部推敲</span><span className="small-label">LOCAL</span></div>
        {selectedForm && <>
          <div className="selected-title"><span className="object-color" style={{ background: selectedForm.color }} /><h2>{selectedForm.name}</h2><IconButton title={selectedForm.locked ? '解除保持' : '保持这个部件'} active={selectedForm.locked} onClick={lockSelected}>{selectedForm.locked ? <LockKeyhole size={15} /> : <UnlockKeyhole size={15} />}</IconButton></div>
          <div className="detail-selector" role="group" aria-label="细化状态">{(['placeholder', 'exploring', 'refined'] as const).map(detail => <button key={detail} className={selectedForm.detail === detail ? 'chosen' : ''} onClick={() => {
            const next = clone(current.document); next.forms.find(f => f.id === selected)!.detail = detail;
            void saveRevision(next, '标记细化状态', `${selectedForm.name} · ${detailNames[detail]}`);
          }}>{detailNames[detail]}</button>)}</div>
          {selectedForm.locked && <p className="lock-note"><LockKeyhole size={12} />形状与位置已保持</p>}
          <div className="control-section"><h3>形态</h3>
            {(['bend', 'twist', 'taper'] as const).map(key => <Control key={key} name={controlLabels[key]} value={selectedForm.controls[key]} min={controlRanges[key][0]} max={controlRanges[key][1]}
              disabled={selectedForm.locked} onChange={value => previewControl(key, value)} onCommit={() => finishControl(key)} />)}
          </div>
          <div className="control-section"><h3>局部拉动 <span>沿局部 X 轴</span></h3>
            {(['pull', 'region', 'radius'] as const).map(key => <Control key={key} name={controlLabels[key]} value={selectedForm.controls[key]} min={controlRanges[key][0]} max={controlRanges[key][1]}
              disabled={selectedForm.locked} onChange={value => previewControl(key, value)} onCommit={() => finishControl(key)} />)}
          </div>
          <div className="control-section"><h3>色块 <Palette size={12} /></h3><div className="swatches">{['#d77860', '#47695d', '#d5d4bf', '#d5ae72', '#8ba1aa', '#383d38'].map(color => <button
            key={color} aria-label={`颜色 ${color}`} title={color} style={{ background: color }} disabled={selectedForm.locked}
            className={selectedForm.color === color ? 'picked' : ''}
            onClick={() => apply([{ type: 'set_color', targetId: selected, color }], '换一个色块', `${selectedForm.name} · 色块调整`)}
          >{selectedForm.color === color && <Check size={12} />}</button>)}</div></div>
          <div className="inspector-actions">
            <button disabled={selectedForm.locked} onClick={() => {
              const form = clone(selectedForm); form.id = uid(); form.name += ' · 副本'; form.position[0] += .1;
              apply([{ type: 'add_form', form }], '复制部件', `复制 ${selectedForm.name}`);
            }}><Copy size={14} />复制部件</button>
            <button disabled={selectedForm.locked} onClick={() => {
              const next = clone(current.document); next.forms.find(f => f.id === selected)!.controls = controls();
              void saveRevision(next, '恢复基础形态', `${selectedForm.name} · 清除当前形变`);
            }}><RotateCcw size={14} />重置形变</button>
          </div>
          <div className="inspector-bottom"><button onClick={() => setModal('dsl')}><Workflow size={14} />查看草图表达<ChevronRight size={12} /></button><span>单位 m · 制造检查未启用</span></div>
        </>}
      </aside>
    </main>

    <section className={`exploration ${explore ? 'expanded' : ''}`}>
      <header><div><GitBranch size={15} /><strong>可能性</strong><span>{project.revisions.length} 个记录</span></div><div>
        {compareId && <button className="text-button" onClick={() => setModal('compare')}><Split size={14} />比较与借用</button>}
        <button className="text-button" onClick={() => setExplore(v => !v)}><Workflow size={14} />{explore ? '收起关系' : '展开关系'}</button>
      </div></header>
      <div className={`version-track ${explore ? 'graph' : ''}`} data-testid="version-track">
        <div className={explore ? 'graph-surface' : 'timeline-surface'} style={explore ? { width: graph.width, height: graph.height } : {}}>
        {explore && <svg className="graph-edges" width={graph.width} height={graph.height} aria-label="版本父子关系">
          {project.revisions.flatMap(r => {
            const to = graph.nodes.get(r.id)!;
            return [
              ...(r.parentId ? [{ id: r.parentId, reference: false }] : []),
              ...r.references.map(ref => ({ id: ref.revisionId, reference: true })),
            ].map((edge, i) => {
              const from = graph.nodes.get(edge.id)!;
              const x1 = from.x + 136, y1 = from.y + 44, x2 = to.x, y2 = to.y + 44;
              return <path key={`${r.id}-${i}`} data-reference={edge.reference} d={`M${x1},${y1} C${x1 + 24},${y1} ${x2 - 24},${y2} ${x2},${y2}`}><title>{edge.reference ? '局部借用来源' : '父版本'}</title></path>;
            });
          })}
        </svg>}
        {(explore ? project.revisions : [...recent].reverse()).map((revision, index) => {
          const parentIndex = project.revisions.findIndex(r => r.id === revision.parentId);
          return <article key={revision.id} className={`version-card ${current.id === revision.id ? 'current' : ''} ${compareId === revision.id ? 'comparing' : ''}`}
            style={explore ? { position: 'absolute', left: graph.nodes.get(revision.id)!.x, top: graph.nodes.get(revision.id)!.y } : {}}>
            <button className="version-image" onClick={() => navigate(revision.id)} aria-label={`打开版本 ${index + 1} ${revision.title}`}><Mini document={revision.document} alt={revision.title} /><span>{String(index + 1).padStart(2, '0')}</span>{current.id === revision.id && <i>当前</i>}</button>
            <div className="version-caption"><button onClick={() => navigate(revision.id)}>{revision.title}</button>
              <IconButton title={`选择比较版本 ${index + 1}`} active={compareId === revision.id} onClick={() => { setCompareId(compareId === revision.id ? null : revision.id); setBorrowForm(revision.document.forms.at(-1)!.id); }}><Split size={12} /></IconButton>
            </div>
            {explore && revision.parentId && <div className="branch-label"><GitBranch size={10} />来自 {String(parentIndex + 1).padStart(2, '0')}{revision.references.length > 0 && ' + 局部借用'}</div>}
          </article>;
        })}
        {!explore && <button className="new-direction" onClick={() => void saveRevision(clone(current.document), `方向 ${project.revisions.length + 1}`, '从当前版本继续另一个方向', { force: true })}><Plus size={20} /><span>另一种可能</span></button>}
        </div>
      </div>
    </section>
    <footer className="statusbar"><span><span className="status-dot" />{local ? '本地规则 · 未启用模型' : `Agent · ${status.model}`}</span><span>UNFORM / A SHAPE IN PROGRESS</span><button onClick={() => setModal('help')}><CircleHelp size={12} />快捷操作</button></footer>
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="关闭通知" onClick={() => setToast('')}><X size={14} /></button></div>}

    {modal === 'new' && <Modal title="从一个新方向开始" onClose={closeModal}>
      <div className="preset-grid">{presets.map(preset => <button key={preset.id} onClick={() => {
        const doc = preset.create(); void saveRevision(doc, preset.name, '使用本地示例开启一个新方向', { force: true });
        setCandidates([]); setModal(null); setSelected(doc.forms.at(-1)!.id);
        setTimeout(() => viewport.current?.fit(), 300);
      }}><Mini document={preset.create()} alt={preset.name} /><strong>{preset.name}</strong><ArrowUpRight size={16} /></button>)}</div>
      <p className="modal-note">新方向将保留在同一项目，现有版本不会删除。</p>
    </Modal>}
    {modal === 'settings' && <Modal title="Agent 连接" onClose={closeModal}>
      <AgentSettings status={status} local={local} onMode={setLocal} onConnected={s => { setStatus(s); setLocal(false); }} />
    </Modal>}
    {modal === 'help' && <Modal title="随手推敲" onClose={closeModal}>
      <div className="help-content">
        <p><MousePointer2 size={17} /><span>拖动画布旋转，滚轮缩放，点击形体选择部件。</span></p>
        <p><PenLine size={17} /><span>画笔切换正面工作平面。画一个不交叉的闭合轮廓，松手后形成薄片。</span></p>
        <p><Move3D size={17} /><span>局部拉动时横向拖动；右侧调整影响位置和范围。移动工具调整整个部件。</span></p>
        <p><Sparkles size={17} /><span>本地规则仅演示列出的操作。连接模型后，可自由描述想法并提交最近动作。</span></p>
        <p><GitBranch size={17} /><span>选择旧版可以继续分支。勾选比较版本后，可查看差异并借用局部。</span></p>
        <div className="shortcut-row"><kbd>F</kbd>适应视图 <kbd>⌘ Z</kbd>上一步 <kbd>Esc</kbd>退出当前工具</div>
      </div>
    </Modal>}
    {modal === 'dsl' && <Modal title="当前草图 · DSL" onClose={closeModal} wide>
      <div className="dsl-toolbar"><span>schema v1 · 实际构造与形变记录</span><button className="text-button" onClick={() => download(new Blob([JSON.stringify(current.document, null, 2)], { type: 'application/json' }), 'Unform-scene.json')}><Download size={14} />下载场景</button></div>
      <pre className="dsl-code">{JSON.stringify(current.document, null, 2)}</pre>
    </Modal>}
    {modal === 'compare' && comparison && <Modal title="比较，然后借回一点" onClose={closeModal} wide>
      <Compare documentA={comparison.document} documentB={current.document} titleA={comparison.title} titleB={current.title} />
      <div className="borrow-controls">
        <label>来源部件<select value={borrowForm} onChange={e => setBorrowForm(e.target.value)}>{comparison.document.forms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <span className="borrow-arrow"><ArrowRight size={16} /></span>
        <label>替换当前部件<select value={selected} onChange={e => setSelected(e.target.value)}>{current.document.forms.map(f => <option key={f.id} value={f.id}>{f.name}{f.locked ? ' · 已保持' : ''}</option>)}</select></label>
      </div>
      <div className="modal-footer"><span>复制为独立内容；形变迁移仅支持相同构造。</span><button className="text-button" onClick={() => void borrow('controls')}><Workflow size={14} />借用形变</button><button className="primary-button" onClick={() => void borrow('copy')}><Copy size={14} />借回部件</button></div>
    </Modal>}
    <span hidden data-testid="cancel-token">{cancelToken}</span>
  </div>;
}

const controlLabels = { bend: '弯曲', twist: '扭转', taper: '收放', pull: '拉动', region: '位置', radius: '范围' };
const controlRanges: Record<keyof Form['controls'], [number, number]> = {
  bend: [-1.8, 1.8], twist: [-2.5, 2.5], taper: [-.75, .75], pull: [-.2, .2], region: [0, 1], radius: [.08, 1],
};
const detailNames = { placeholder: '占位', exploring: '探索中', refined: '已细化' };
function Control({ name, value, min, max, disabled, onChange, onCommit }: {
  name: string; value: number; min: number; max: number; disabled: boolean; onChange(v: number): void; onCommit(): void;
}) {
  return <label className={`control ${disabled ? 'disabled' : ''}`}><span>{name}<output>{value.toFixed(2)}</output></span>
    <input type="range" aria-label={name} min={min} max={max} step={(max - min) / 200} value={value} disabled={disabled}
      onChange={e => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit}
      style={{ '--progress': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} />
  </label>;
}
function AgentSettings({ status, local, onMode, onConnected }: {
  status: { configured: boolean; model?: string }; local: boolean; onMode(v: boolean): void;
  onConnected(s: { configured: boolean; model?: string }): void;
}) {
  const [base, setBase] = useState('https://api.deepseek.com');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="settings-content">
    <div className="connection-status"><span className={`status-dot ${status.configured ? '' : 'muted'}`} />{status.configured ? `已配置 · ${status.model}` : '尚未连接模型'}<span>服务端保管凭据</span></div>
    <div className="mode-options"><button className={local ? 'chosen' : ''} onClick={() => onMode(true)}>本地规则预览</button><button disabled={!status.configured} className={!local ? 'chosen' : ''} onClick={() => onMode(false)}>真实 Agent</button></div>
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try {
        const response = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base, model, key }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || '连接配置失败');
        onConnected(data); setKey('');
      } catch (error) { setError((error as Error).message); }
      finally { setBusy(false); }
    }}>
      <label>兼容 Chat Completions 的 API 地址<input required type="url" value={base} onChange={e => setBase(e.target.value)} /></label>
      <label>模型名称<input required placeholder="填写服务商提供的模型 ID" value={model} onChange={e => setModel(e.target.value)} /></label>
      <label>API Key<input required type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label>
      <p className="modal-note">凭据仅提交到本机服务，本次进程有效，不保存到项目。创作时会向所选服务商发送场景与最近动作。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}启用模型</button>
    </form>
  </div>;
}

// Both views use identical camera pose, scale and target via a dedicated comparison component.
import { ComparisonView } from './ComparisonView';
function Compare(props: { documentA: Sketch; documentB: Sketch; titleA: string; titleB: string }) {
  return <ComparisonView {...props} />;
}
