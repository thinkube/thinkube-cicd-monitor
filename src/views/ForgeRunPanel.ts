/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ForgeRun, ServicesAPI } from '../api/ServicesAPI';

/** A run in one of these states does not change any more: the panel stops reading it. */
const FINISHED = new Set(['completed', 'failed', 'cancelled']);
const REFRESH_MS = 15000;

/**
 * One Forge run: what it is, where it runs, how far it is, and its training
 * loss by step from MLflow. The page is written once; each read of the run
 * is posted to it, so the chart keeps the reader's place and smoothing.
 */
export class ForgeRunPanel {
    private static current: ForgeRunPanel | undefined;
    private timer: ReturnType<typeof setInterval> | undefined;
    private disposables: vscode.Disposable[] = [];
    private reading = false;

    static show(api: ServicesAPI, runId: string, name: string): void {
        if (ForgeRunPanel.current) {
            ForgeRunPanel.current.panel.reveal();
            ForgeRunPanel.current.open(runId, name);
            return;
        }
        const panel = vscode.window.createWebviewPanel('forgeRun', `Forge: ${name}`, vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true
        });
        ForgeRunPanel.current = new ForgeRunPanel(panel, api, runId, name);
    }

    private constructor(private panel: vscode.WebviewPanel, private api: ServicesAPI, private runId: string, name: string) {
        this.panel.webview.html = this.html();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(message => {
            if (message.command === 'ready') {
                this.read();
            } else if (message.command === 'open' && typeof message.url === 'string') {
                vscode.env.openExternal(vscode.Uri.parse(message.url));
            } else if (message.command === 'millLog' && typeof message.runId === 'string') {
                vscode.commands.executeCommand('thinkube-cicd.viewMillRunLog', message.runId);
            }
        }, null, this.disposables);
        // The first read is made when the page says it is ready, so its answer is not posted before the page listens
        this.startTimer();
    }

    private open(runId: string, name: string): void {
        this.runId = runId;
        this.panel.title = `Forge: ${name}`;
        this.panel.webview.postMessage({ command: 'clear', name });
        this.read();
        this.startTimer();
    }

    private startTimer(): void {
        this.stopTimer();
        this.timer = setInterval(() => this.read(), REFRESH_MS);
    }

    private async read(): Promise<void> {
        if (this.reading) {
            return;
        }
        this.reading = true;
        const runId = this.runId;
        let run: ForgeRun | undefined;
        try {
            run = await this.api.forgeRun(runId);
            const progress = await this.api.forgeProgress(runId);
            if (runId !== this.runId) {
                return;
            }
            this.panel.webview.postMessage({
                command: 'run',
                run,
                progress,
                controlUrl: this.api.pageUrl('forge', runId),
                millUrl: run.kind === 'task' && run.task?.mill_run ? this.api.pageUrl('mill', run.task.mill_run) : null
            });
            if (FINISHED.has(run.status)) {
                this.stopTimer();
            }
        } catch (error: any) {
            if (runId === this.runId) {
                this.panel.webview.postMessage({ command: 'error', message: error?.message ?? String(error), run: run ?? null });
            }
        } finally {
            this.reading = false;
        }
    }

    private stopTimer(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    private dispose(): void {
        ForgeRunPanel.current = undefined;
        this.stopTimer();
        this.disposables.forEach(d => d.dispose());
    }

    private html(): string {
        const nonce = crypto.randomBytes(16).toString('base64');
        const csp = `default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Forge run</title>
<style>
  :root {
    --loss: var(--vscode-charts-blue);
    --eval: var(--vscode-charts-orange);
    --muted: var(--vscode-descriptionForeground);
    --grid: var(--vscode-editorWidget-border, rgba(128,128,128,.25));
  }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); padding: 16px 20px; margin: 0; }
  h1 { font-size: 1.35em; font-weight: 600; margin: 0 0 4px; }
  .sub { color: var(--muted); margin-bottom: 16px; }
  .facts { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-bottom: 16px; }
  .fact .k { color: var(--muted); font-size: .85em; }
  .fact .v { font-size: 1.1em; font-variant-numeric: tabular-nums; }
  .bar { height: 4px; background: var(--grid); border-radius: 2px; margin: -6px 0 18px; max-width: 640px; }
  .bar > div { height: 100%; background: var(--loss); border-radius: 2px; }
  .actions { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
           border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .error { color: var(--vscode-errorForeground); white-space: pre-wrap; margin-bottom: 12px; }
  .note { color: var(--muted); margin: 8px 0; }
  .chart-head { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 6px; }
  .chart-head h2 { font-size: 1.05em; font-weight: 600; margin: 0; }
  .legend { display: flex; gap: 14px; color: var(--muted); font-size: .9em; }
  .legend span::before { content: ''; display: inline-block; width: 14px; height: 2px; margin-right: 6px;
                         vertical-align: middle; background: var(--c); opacity: var(--o, 1); }
  .smooth { margin-left: auto; color: var(--muted); font-size: .9em; display: flex; align-items: center; gap: 6px; }
  #chart { position: relative; }
  svg { display: block; width: 100%; overflow: visible; }
  svg text { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .tip { position: absolute; pointer-events: none; background: var(--vscode-editorHoverWidget-background);
         border: 1px solid var(--vscode-editorHoverWidget-border); color: var(--vscode-editorHoverWidget-foreground);
         padding: 6px 8px; border-radius: 3px; font-size: .9em; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .tip b { font-weight: 600; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<h1 id="name">Loading...</h1>
<div class="sub" id="sub"></div>
<div class="error" id="error" hidden></div>
<div class="facts" id="facts"></div>
<div class="bar" id="bar" hidden><div></div></div>
<div class="actions" id="actions"></div>
<div id="task" class="note" hidden></div>
<section id="loss" hidden>
  <div class="chart-head">
    <h2>Training loss</h2>
    <div class="legend" id="legend"></div>
    <label class="smooth">Smoothing
      <select id="smoothing">
        <option value="0">none</option>
        <option value="0.6">0.6</option>
        <option value="0.9" selected>0.9</option>
        <option value="0.97">0.97</option>
        <option value="0.99">0.99</option>
      </select>
    </label>
  </div>
  <div id="chart"><svg id="svg" height="340"></svg><div class="tip" id="tip" hidden></div></div>
  <div class="note" id="chart-note"></div>
</section>
<div class="note" id="no-loss" hidden></div>
<script nonce="${nonce}">
${PANEL_SCRIPT}
</script>
</body>
</html>`;
    }
}

const PANEL_SCRIPT = `
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
let state = { loss: [], evalLoss: [], totalSteps: null };

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function fmtDuration(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  const h = Math.floor(s / 3600);
  if (h < 48) return h + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}
function fmtNum(v) {
  if (v === null || v === undefined || !isFinite(v)) return '';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.001 || a >= 100000)) return v.toExponential(2);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(2) : v.toFixed(4);
}
function fmtStep(v) { return v >= 10000 ? (v / 1000).toFixed(v >= 100000 ? 0 : 1) + 'k' : String(Math.round(v)); }
function niceTicks(min, max, count) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}
function fact(k, v) {
  const d = document.createElement('div'); d.className = 'fact';
  const a = document.createElement('div'); a.className = 'k'; a.textContent = k;
  const b = document.createElement('div'); b.className = 'v'; b.textContent = v;
  d.append(a, b); return d;
}
function button(label, onClick) {
  const b = document.createElement('button'); b.textContent = label; b.onclick = onClick; return b;
}

function smooth(points, weight) {
  let last = null;
  return points.map(p => {
    last = last === null ? p.value : last * weight + p.value * (1 - weight);
    return { step: p.step, value: last };
  });
}
// At most about two points per pixel column: the lowest and the highest of each column, in step order
function thin(points, columns) {
  if (points.length <= columns * 2) return points;
  const size = points.length / columns, out = [];
  for (let c = 0; c < columns; c++) {
    const part = points.slice(Math.floor(c * size), Math.floor((c + 1) * size));
    if (!part.length) continue;
    let lo = part[0], hi = part[0];
    for (const p of part) { if (p.value < lo.value) lo = p; if (p.value > hi.value) hi = p; }
    if (lo === hi) out.push(lo); else if (lo.step < hi.step) out.push(lo, hi); else out.push(hi, lo);
  }
  return out;
}
function nearest(points, step) {
  let lo = 0, hi = points.length - 1;
  if (hi < 0) return null;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (points[mid].step < step) lo = mid + 1; else hi = mid; }
  if (lo > 0 && Math.abs(points[lo - 1].step - step) <= Math.abs(points[lo].step - step)) lo--;
  return points[lo];
}

function draw() {
  const svg = $('svg');
  svg.replaceChildren();
  const loss = state.loss, evalLoss = state.evalLoss;
  if (!loss.length && !evalLoss.length) return;
  const weight = parseFloat($('smoothing').value);
  const smoothed = weight > 0 ? smooth(loss, weight) : null;
  const W = svg.clientWidth || 800, H = 340, m = { l: 56, r: 16, t: 10, b: 30 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const all = loss.concat(evalLoss);
  const lastStep = Math.max(...all.map(p => p.step));
  const xMax = Math.max(lastStep, 1);
  let yMin = Math.min(...all.map(p => p.value)), yMax = Math.max(...all.map(p => p.value));
  const pad = (yMax - yMin) * 0.05 || Math.abs(yMax) * 0.05 || 1;
  yMin = yMin >= 0 ? Math.max(0, yMin - pad) : yMin - pad; yMax += pad;
  const yt = niceTicks(yMin, yMax, 5);
  yMin = Math.min(yMin, yt[0]); yMax = Math.max(yMax, yt[yt.length - 1]);
  const x = s => m.l + (s / xMax) * iw;
  const y = v => m.t + ih - ((v - yMin) / (yMax - yMin)) * ih;

  // A tick label has the decimals its spacing needs, no more
  const decimals = yt.length > 1 ? Math.max(0, -Math.floor(Math.log10(yt[1] - yt[0]) + 1e-9)) : 2;
  for (const t of yt) {
    el('line', { x1: m.l, x2: m.l + iw, y1: y(t), y2: y(t), stroke: 'var(--grid)', 'stroke-width': 1 }, svg);
    const label = el('text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, svg); label.textContent = t.toFixed(decimals);
  }
  for (const t of niceTicks(0, xMax, Math.max(2, Math.floor(iw / 90)))) {
    if (t > xMax) continue;
    const label = el('text', { x: x(t), y: H - 8, 'text-anchor': 'middle' }, svg); label.textContent = fmtStep(t);
  }
  const path = (points, attrs) => {
    if (!points.length) return;
    const d = points.map((p, i) => (i ? 'L' : 'M') + x(p.step).toFixed(1) + ' ' + y(p.value).toFixed(1)).join('');
    el('path', Object.assign({ d, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, attrs), svg);
  };
  const columns = Math.max(50, Math.floor(iw));
  path(thin(loss, columns), { stroke: 'var(--loss)', 'stroke-width': smoothed ? 1 : 2, 'stroke-opacity': smoothed ? 0.3 : 1 });
  if (smoothed) path(thin(smoothed, columns), { stroke: 'var(--loss)', 'stroke-width': 2 });
  if (evalLoss.length) {
    path(evalLoss, { stroke: 'var(--eval)', 'stroke-width': 2 });
    for (const p of evalLoss) el('circle', { cx: x(p.step), cy: y(p.value), r: 4, fill: 'var(--eval)',
      stroke: 'var(--vscode-editor-background)', 'stroke-width': 2 }, svg);
  }

  const cross = el('line', { y1: m.t, y2: m.t + ih, stroke: 'var(--muted)', 'stroke-width': 1, visibility: 'hidden' }, svg);
  const dots = ['var(--loss)', 'var(--eval)']
    .map(c => el('circle', { r: 4, fill: c, stroke: 'var(--vscode-editor-background)', 'stroke-width': 2, visibility: 'hidden' }, svg));
  const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);
  const tip = $('tip');
  hit.addEventListener('mousemove', ev => {
    const box = svg.getBoundingClientRect();
    const step = ((ev.clientX - box.left - m.l) / iw) * xMax;
    const raw = nearest(loss, step), sm = smoothed ? nearest(smoothed, step) : null, ev2 = nearest(evalLoss, step);
    const at = raw || ev2;
    if (!at) return;
    cross.setAttribute('x1', x(at.step)); cross.setAttribute('x2', x(at.step)); cross.setAttribute('visibility', 'visible');
    // An eval point is shown when it is within 6 pixels of the step under the pointer
    const near = ev2 && Math.abs(ev2.step - at.step) <= xMax / iw * 6 ? ev2 : null;
    const shown = [sm || raw, near];
    dots.forEach((d, i) => {
      const p = shown[i];
      if (p) { d.setAttribute('cx', x(p.step)); d.setAttribute('cy', y(p.value)); d.setAttribute('visibility', 'visible'); }
      else d.setAttribute('visibility', 'hidden');
    });
    const rows = ['<b>step ' + at.step + '</b>'];
    if (raw) rows.push('loss ' + fmtNum(raw.value));
    if (sm) rows.push('smoothed ' + fmtNum(sm.value));
    if (near) rows.push('eval loss ' + fmtNum(near.value) + (near.step !== at.step ? ' (step ' + near.step + ')' : ''));
    tip.innerHTML = rows.join('<br>');
    tip.hidden = false;
    const left = x(at.step) + 12, wide = tip.offsetWidth;
    tip.style.left = (left + wide > W ? x(at.step) - wide - 12 : left) + 'px';
    tip.style.top = (m.t + 4) + 'px';
  });
  hit.addEventListener('mouseleave', () => {
    tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden'));
  });

  const legend = $('legend'); legend.replaceChildren();
  const item = (text, color, opacity) => {
    const s = document.createElement('span'); s.textContent = text;
    s.style.setProperty('--c', color); if (opacity) s.style.setProperty('--o', opacity); legend.appendChild(s);
  };
  if (smoothed) { item('loss, smoothed', 'var(--loss)'); item('loss', 'var(--loss)', 0.3); }
  else item('loss', 'var(--loss)');
  if (evalLoss.length) item('eval loss', 'var(--eval)');
  const lastLoss = loss[loss.length - 1];
  $('chart-note').textContent = loss.length
    ? 'Logged ' + loss.length + ' steps; last at step ' + lastLoss.step + ', loss ' + fmtNum(lastLoss.value) +
      (state.totalSteps ? ', of ' + state.totalSteps + ' steps in the run.' : '.')
    : '';
}

function showRun(run, progress, controlUrl, millUrl) {
  $('error').hidden = true;
  $('name').textContent = run.name;
  $('sub').textContent = (run.kind === 'task' ? 'Task' : 'Fine-tune') + ' · ' + run.id;
  const p = run.progress || {};
  const facts = $('facts'); facts.replaceChildren();
  facts.append(fact('Status', run.status + (run.status === 'running' && p.state ? ' (' + p.state + ')' : '')));
  if (run.node) facts.append(fact('Node', run.node));
  if (run.base_model) facts.append(fact('Base model', run.base_model));
  if (run.method) facts.append(fact('Method', run.method));
  if (p.step && p.total_steps) facts.append(fact('Step', p.step + ' / ' + p.total_steps));
  if (typeof p.loss === 'number') facts.append(fact('Loss', fmtNum(p.loss)));
  if (p.seconds_per_step) facts.append(fact('Per step', p.seconds_per_step.toFixed(2) + 's'));
  const eta = run.eta_seconds || p.eta_seconds;
  if (eta && run.status === 'running') facts.append(fact('Time left', fmtDuration(eta)));
  if (run.started_at) facts.append(fact('Started', new Date(run.started_at).toLocaleString()));
  if (run.finished_at) facts.append(fact('Finished', new Date(run.finished_at).toLocaleString()));
  if (run.waiting) facts.append(fact('Waiting', run.waiting));
  if (run.error) { $('error').textContent = run.error; $('error').hidden = false; }
  const bar = $('bar');
  if (p.step && p.total_steps && run.status === 'running') {
    bar.hidden = false; bar.firstElementChild.style.width = Math.min(100, 100 * p.step / p.total_steps) + '%';
  } else bar.hidden = true;

  const actions = $('actions'); actions.replaceChildren();
  actions.append(button('Open in Thinkube Control', () => vscode.postMessage({ command: 'open', url: controlUrl })));
  if (progress && progress.url && progress.kind !== 'task') {
    actions.append(button('Open in MLflow', () => vscode.postMessage({ command: 'open', url: progress.url })));
  }

  const task = $('task');
  if (run.kind === 'task') {
    $('loss').hidden = true; $('no-loss').hidden = true;
    const millRun = progress && progress.mill_run;
    task.hidden = false;
    task.textContent = millRun ? 'A task run reports to Mill, not MLflow: it has no loss. Its run of Mill is ' + millRun + '.'
                               : 'A task run reports to Mill, not MLflow. It has no run of Mill yet.';
    if (millRun) {
      actions.append(button('View Mill run log', () => vscode.postMessage({ command: 'millLog', runId: millRun })));
      if (millUrl) actions.append(button('Open Mill run', () => vscode.postMessage({ command: 'open', url: millUrl })));
    }
    return;
  }
  task.hidden = true;
  const metrics = (progress && progress.metrics) || {};
  state = { loss: metrics.loss || [], evalLoss: metrics.eval_loss || [], totalSteps: p.total_steps || null };
  const has = state.loss.length || state.evalLoss.length;
  $('loss').hidden = !has;
  $('no-loss').hidden = !!has;
  $('no-loss').textContent = progress ? 'The training has logged no loss yet.' : 'The training has not begun: MLflow has no run for it yet.';
  if (has) draw();
}

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.command === 'clear') {
    $('name').textContent = msg.name; $('sub').textContent = 'Loading...';
    $('facts').replaceChildren(); $('actions').replaceChildren(); $('loss').hidden = true; $('no-loss').hidden = true;
    $('task').hidden = true; $('error').hidden = true; $('bar').hidden = true;
    state = { loss: [], evalLoss: [], totalSteps: null };
  } else if (msg.command === 'run') {
    showRun(msg.run, msg.progress, msg.controlUrl, msg.millUrl);
  } else if (msg.command === 'error') {
    $('error').textContent = 'Reading the run failed: ' + msg.message; $('error').hidden = false;
  }
});
$('smoothing').addEventListener('change', draw);
new ResizeObserver(() => { if (!$('loss').hidden) draw(); }).observe($('chart'));
vscode.postMessage({ command: 'ready' });
`;
