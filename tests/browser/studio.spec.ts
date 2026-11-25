import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('editable geometry, candidates, branches, borrow, exports and persistence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.goto('/');
  await expect(page.getByText('已保存到本机')).toBeVisible({ timeout: 15000 });
  const canvas = page.getByTestId('scene-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByText(/三角面/)).toContainText(/[1-9][\d,]* 三角面/);
  const pixels = await canvas.evaluate((canvas: HTMLCanvasElement) => {
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    const p = ctx.getImageData(0, 0, copy.width, copy.height).data;
    let coral = 0;
    for (let i = 0; i < p.length; i += 4) if (p[i] > p[i + 1] * 1.15 && p[i + 1] > p[i + 2]) coral++;
    return coral;
  });
  expect(pixels).toBeGreaterThan(100);
  await page.screenshot({ path: 'test-results/desktop-initial.png' });
  const before = await canvas.screenshot();
  const rect = (await canvas.boundingBox())!;
  await page.mouse.move(rect.x + rect.width * .68, rect.y + rect.height * .35);
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width * .8, rect.y + rect.height * .4, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole('slider', { name: '弯曲', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('2 个记录')).toBeVisible();
  await page.getByRole('button', { name: '保持这个部件', exact: true }).click();
  await expect(page.getByRole('slider', { name: '弯曲', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '解除保持', exact: true }).click();
  await expect(page.getByRole('slider', { name: '弯曲', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: '创作想法' }).fill('沿这个方向再夸张一点');
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.locator('.candidate')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/desktop-candidates.png' });
  await page.getByRole('button', { name: '留住这版' }).first().click();
  await expect(page.getByText('5 个记录')).toBeVisible();
  await page.locator('.version-image').first().click();
  await page.getByRole('button', { name: '留一版', exact: true }).click();
  await expect(page.getByText('6 个记录')).toBeVisible();
  await page.getByRole('button', { name: '展开关系' }).click();
  await expect(page.locator('.graph-edges path')).toHaveCount(5);
  await page.getByRole('button', { name: '选择比较版本 5', exact: true }).click();
  await page.getByRole('button', { name: '比较与借用', exact: true }).click();
  await expect(page.locator('.comparison-canvas canvas')).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop-comparison.png' });
  await page.getByRole('button', { name: '借回部件', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('7 个记录')).toBeVisible();
  await expect(page.locator('.graph-edges path[data-reference=true]')).toHaveCount(1);
  await page.getByRole('button', { name: '收起关系', exact: true }).click();
  const glbEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 GLB', exact: true }).click();
  const glb = await glbEvent;
  const bytes = await readFile((await glb.path())!);
  expect(bytes.subarray(0, 4).toString()).toBe('glTF');
  expect(bytes.readUInt32LE(4)).toBe(2);
  const scene = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  expect(scene.meshes.length).toBe(3);
  const exportEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目备份', exact: true }).click();
  const backup = JSON.parse(await readFile((await (await exportEvent).path())!, 'utf8'));
  expect(backup.revisions).toHaveLength(7);
  expect(backup.revisions.at(-1).references).toHaveLength(1);
  await expect(page.getByText('已保存到本机')).toBeVisible();
  await page.reload();
  await expect(page.getByText('7 个记录')).toBeVisible();
  await page.getByRole('button', { name: '留一版', exact: true }).click();
  await expect(page.getByText('8 个记录')).toBeVisible();
  const autoBackup = page.waitForEvent('download');
  await page.locator('input[type=file]').setInputFiles({
    name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  });
  expect(JSON.parse(await readFile((await (await autoBackup).path())!, 'utf8')).revisions).toHaveLength(8);
  await expect(page.getByText('7 个记录')).toBeVisible();
  expect(errors).toEqual([]);
});

test('draw a contour, inspect mobile layout and switch hard-form preset', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('已保存到本机')).toBeVisible();
  await page.getByRole('button', { name: '绘制闭合轮廓', exact: true }).click();
  const rect = (await page.getByTestId('scene-canvas').boundingBox())!;
  const x = rect.x + rect.width * .7, y = rect.y + rect.height * .35;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 50, y + 10, { steps: 12 });
  await page.mouse.move(x + 40, y + 80, { steps: 12 });
  await page.mouse.move(x - 25, y + 55, { steps: 12 });
  await page.mouse.move(x, y, { steps: 12 }); await page.mouse.up();
  await expect(page.locator('.object-row')).toHaveCount(4);
  await expect(page.getByText('2 个记录')).toBeVisible();
  await page.getByRole('button', { name: '新方向', exact: true }).click();
  await page.locator('.preset-grid button').filter({ hasText: '小商店' }).click();
  await expect(page.getByTestId('object-roof')).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop-hardforms.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/mobile-initial.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('.inspector')).toBeHidden();
  await page.getByRole('button', { name: '局部参数', exact: true }).click();
  await expect(page.getByRole('slider', { name: '弯曲', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '局部参数', exact: true }).click();
  await page.getByRole('textbox', { name: '创作想法' }).fill('更薄一点');
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.locator('.candidate')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/mobile-candidates.png' });
});

test('local pull previews actual geometry, commits once, and Escape cancels', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('已保存到本机')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '局部拉动', exact: true }).click();
  const canvas = page.getByTestId('scene-canvas');
  const point = await canvas.evaluate((canvas: HTMLCanvasElement) => {
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    const ctx = copy.getContext('2d')!; ctx.drawImage(canvas, 0, 0);
    const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
    let x = 0, y = 0, count = 0;
    for (let row = 0; row < copy.height; row++) for (let col = 0; col < copy.width; col++) {
      const i = (row * copy.width + col) * 4;
      if (pixels[i] > pixels[i + 1] * 1.15 && pixels[i + 1] > pixels[i + 2]) {
        x += col; y += row; count++;
      }
    }
    return { x: x / count / copy.width, y: y / count / copy.height };
  });
  const rect = (await canvas.boundingBox())!;
  const x = rect.x + point.x * rect.width, y = rect.y + point.y * rect.height;
  const before = await canvas.screenshot();
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 55, y, { steps: 12 });
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.mouse.up();
  await expect(page.getByText('2 个记录')).toBeVisible();
  await expect(page.getByRole('slider', { name: '拉动', exact: true })).toHaveValue('0.024');
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 20, y, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.getByText('2 个记录')).toBeVisible();
});

test('Agent UI sends manual context, validates geometry, and displays a repaired tool result', async ({ page }) => {
  let request: any, feedback: any;
  const plan = (value: number) => ({
    message: '根据刚才的手动弯曲继续探索。',
    candidates: [{ title: '模型试验', description: '延续灯头的姿态', operations: [
      { type: 'set_control', targetId: 'head', key: 'bend', value },
    ] }],
  });
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, model: 'mock-contract' } }));
  await page.route('**/api/agent', async route => {
    request = route.request().postDataJSON();
    await route.fulfill({ json: { runId: 'mock-run', callId: 'mock-call', plan: plan(90) } });
  });
  await page.route('**/api/agent/mock-run/results', async route => {
    feedback = route.request().postDataJSON();
    await route.fulfill({ json: { complete: false, repaired: true, plan: plan(.8) } });
  });
  await page.goto('/');
  await expect(page.getByText('已保存到本机')).toBeVisible({ timeout: 15000 });
  await page.getByRole('slider', { name: '弯曲', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('2 个记录')).toBeVisible();
  await page.getByRole('textbox', { name: '创作想法' }).fill('沿刚才的手动方向继续');
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.locator('.candidate')).toHaveCount(1);
  expect(request.selectedId).toBe('head');
  expect(request.recentActions[0].before.controls.bend).not.toBe(request.recentActions[0].after.controls.bend);
  expect(feedback.callId).toBe('mock-call');
  expect(feedback.results[0].ok).toBe(false);
  await expect(page.getByText('2 个记录')).toBeVisible();
  await page.getByRole('button', { name: '留住这版', exact: true }).click();
  await expect(page.getByText('3 个记录')).toBeVisible();
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目备份', exact: true }).click();
  const project = JSON.parse(await readFile((await (await exported).path())!, 'utf8'));
  expect(project.revisions.at(-1).source).toBe('agent');
  expect(project.revisions.at(-1).document.forms.find((f: any) => f.id === 'head').controls.bend).toBe(.8);
});
