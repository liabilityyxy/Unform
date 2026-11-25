import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { lamp } from '../src/presets';

test('model tool contract includes geometry feedback and permits one bounded repair', { timeout: 20000 }, async t => {
  const requests: any[] = [];
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    const repaired = requests.length > 1;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [{
        id: repaired ? 'call-repair' : 'call-first', type: 'function',
        function: { name: 'propose_candidates', arguments: JSON.stringify({
          message: repaired ? '修复形变参数' : '试试这个方向',
          candidates: [{ title: '试验', description: '修改灯头', operations: [
            { type: 'set_control', targetId: 'head', key: 'bend', value: repaired ? .8 : 80 },
          ] }],
        }) },
      }] } }],
    }));
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerPort = (provider.address() as { port: number }).port;
  const reserve = createServer();
  await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), AGENT_API_BASE: `http://127.0.0.1:${providerPort}`, AGENT_MODEL: 'contract-test', AGENT_API_KEY: 'mock-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise<void>(resolve => child.exitCode !== null ? resolve() : child.once('exit', () => resolve()));
    await new Promise<void>(resolve => provider.close(() => resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout.on('data', chunk => { if (String(chunk).includes('Unform agent service')) resolve(); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`API exited ${code}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown, headers = {}) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.model, 'contract-test');
  assert.ok(!JSON.stringify(status).includes('mock-key'));
  const response = await post('/api/agent', {
    instruction: '沿刚才的弯曲再夸张一点', document: lamp(), selectedId: 'head', baseRevisionId: 'base',
    recentActions: [{ description: '手动弯曲', before: { bend: 0 }, after: { bend: .5 } }],
  });
  assert.equal(response.status, 200);
  const run = await response.json();
  assert.equal(requests[0].tool_choice.function.name, 'propose_candidates');
  assert.match(requests[0].messages[1].content, /手动弯曲/);
  const results = { callId: run.callId, results: [{ title: '试验', ok: false, error: 'bend 超出范围' }] };
  const repaired = await (await post(`/api/agent/${run.runId}/results`, results)).json();
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.plan.candidates[0].operations[0].value, .8);
  assert.ok(requests[1].messages.some((m: any) => m.role === 'tool' && m.tool_call_id === 'call-first' && m.content.includes('超出范围')));
  assert.equal((await post(`/api/agent/${run.runId}/results`, results)).status, 409);
  assert.equal((await post('/api/config', { base: 'https://example.com', model: 'x', key: 'x' }, { Origin: 'https://untrusted.example' })).status, 403);
});
