/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';
import { ForgeRun, MillRun, MillStage, ServicesAPI } from '../api/ServicesAPI';

const MILL_RUNS = 30;
const FORGE_RUNS = 30;

export function when(iso: string | null | undefined): string {
    if (!iso) {
        return '';
    }
    const date = new Date(iso);
    const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${day} ${time}`;
}

export function duration(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) { return `${s}s`; }
    if (s < 3600) { return `${Math.floor(s / 60)}m ${s % 60}s`; }
    const h = Math.floor(s / 3600);
    if (h < 48) { return `${h}h ${Math.floor((s % 3600) / 60)}m`; }
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function stateIcon(state: string): vscode.ThemeIcon {
    switch (state) {
        case 'completed':
            return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        case 'failed':
            return new vscode.ThemeIcon('x', new vscode.ThemeColor('testing.iconFailed'));
        case 'running':
        case 'training':
        case 'preprocessing':
        case 'planning':
        case 'revising':
            return new vscode.ThemeIcon('sync~spin');
        case 'stopped':
        case 'cancelled':
            return new vscode.ThemeIcon('circle-slash');
        case 'paused':
            return new vscode.ThemeIcon('debug-pause');
        default:
            return new vscode.ThemeIcon('circle-outline');
    }
}

class MessageItem extends vscode.TreeItem {
    constructor(label: string, icon: string, tooltip?: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(icon);
        this.tooltip = tooltip ?? label;
        this.contextValue = 'message';
    }
}

/**
 * A list of runs read from one service while the view is visible. A read is
 * skipped while the previous one is still waiting, so a slow answer never
 * piles requests up; a failed read shows its error in the view.
 */
abstract class RunsProvider<T, Node extends vscode.TreeItem> implements vscode.TreeDataProvider<vscode.TreeItem> {
    private changed = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this.changed.event;

    protected runs: T[] = [];
    private error: string | undefined;
    private loaded = false;
    private inFlight = false;
    private visible = false;

    constructor(protected api: ServicesAPI, private noun: string) {}

    protected abstract read(): Promise<T[]>;
    protected abstract item(run: T): Node;
    protected children(_element: Node): vscode.TreeItem[] {
        return [];
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        if (visible) {
            this.refresh();
        }
    }

    /** Called by the timer: reads only while the view is visible. */
    tick(): void {
        if (this.visible) {
            this.refresh();
        }
    }

    async refresh(): Promise<void> {
        if (this.inFlight) {
            return;
        }
        this.inFlight = true;
        try {
            this.runs = await this.read();
            this.error = undefined;
        } catch (error: any) {
            this.error = error?.message ?? String(error);
        } finally {
            this.loaded = true;
            this.inFlight = false;
            this.changed.fire();
        }
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        if (element) {
            return this.children(element as Node);
        }
        if (!this.loaded) {
            return [new MessageItem(`Loading ${this.noun}...`, 'sync~spin')];
        }
        const items: vscode.TreeItem[] = this.runs.map(run => this.item(run));
        if (this.error) {
            items.unshift(new MessageItem(this.error, 'error', `Reading the ${this.noun} failed: ${this.error}`));
        } else if (items.length === 0) {
            items.push(new MessageItem(`No ${this.noun}.`, 'info'));
        }
        return items;
    }
}

export class MillRunItem extends vscode.TreeItem {
    constructor(public readonly run: MillRun) {
        super(run.task, run.stages.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        this.id = `mill:${run.id}`;
        const took = run.ended_at
            ? duration((Date.parse(run.ended_at) - Date.parse(run.started_at)) / 1000)
            : 'running';
        this.description = `${run.state} - ${took} - ${when(run.started_at)}${run.node ? ` - ${run.node}` : ''}`;
        const lines = [
            `${run.task} (${run.file})`,
            `Run: ${run.id}`,
            `State: ${run.state}`,
            `Started: ${new Date(run.started_at).toLocaleString()}`,
            run.ended_at ? `Ended: ${new Date(run.ended_at).toLocaleString()}` : '',
            run.node ? `Node: ${run.node}` : (run.host ? `Host: ${run.host}` : ''),
            `Samples: ${run.samples}, failures: ${run.failures}`,
            Object.keys(run.tags ?? {}).length
                ? `Tags: ${Object.entries(run.tags).map(([k, v]) => `${k}=${v}`).join(', ')}` : '',
            run.error ? `Error: ${run.error}` : ''
        ];
        this.tooltip = lines.filter(Boolean).join('\n');
        this.iconPath = stateIcon(run.state);
        this.contextValue = 'millRun';
        this.command = { command: 'thinkube-cicd.viewMillRunLog', title: 'View Run Log', arguments: [this] };
    }
}

class MillStageItem extends vscode.TreeItem {
    constructor(stage: MillStage) {
        super(stage.name, vscode.TreeItemCollapsibleState.None);
        this.description = stage.total ? `${stage.done} / ${stage.total}` : `${stage.done}`;
        this.iconPath = new vscode.ThemeIcon(stage.total && stage.done >= stage.total ? 'pass' : 'circle-outline');
        this.contextValue = 'millStage';
    }
}

export class MillRunsProvider extends RunsProvider<MillRun, MillRunItem> {
    constructor(api: ServicesAPI) {
        super(api, 'Mill runs');
    }

    protected read(): Promise<MillRun[]> {
        return this.api.millRuns(MILL_RUNS);
    }

    protected item(run: MillRun): MillRunItem {
        return new MillRunItem(run);
    }

    protected children(element: MillRunItem): vscode.TreeItem[] {
        return element.run.stages.map(stage => new MillStageItem(stage));
    }
}

export class ForgeRunItem extends vscode.TreeItem {
    constructor(public readonly run: ForgeRun) {
        super(run.name, vscode.TreeItemCollapsibleState.None);
        this.id = `forge:${run.id}`;
        const progress = run.progress;
        const parts = [run.status];
        if (run.status === 'running' && progress?.step && progress.total_steps) {
            parts.push(`step ${progress.step}/${progress.total_steps}`);
            if (typeof progress.loss === 'number') {
                parts.push(`loss ${progress.loss.toFixed(3)}`);
            }
        } else if (run.started_at && run.finished_at) {
            parts.push(duration((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000));
        }
        parts.push(when(run.started_at ?? run.created_at));
        if (run.node) {
            parts.push(run.node);
        }
        this.description = parts.join(' - ');
        const lines = [
            run.name,
            `Run: ${run.id}`,
            `Kind: ${run.kind === 'task' ? 'task (reports to Mill)' : 'fine-tune'}`,
            `Status: ${run.status}`,
            run.base_model ? `Base model: ${run.base_model}` : '',
            run.method ? `Method: ${run.method}` : '',
            run.node ? `Node: ${run.node}` : '',
            `Created: ${new Date(run.created_at).toLocaleString()}`,
            run.waiting ? `Waiting: ${run.waiting}` : '',
            run.eta_seconds ? `Time left: ${duration(run.eta_seconds)}` : '',
            run.error ? `Error: ${run.error}` : ''
        ];
        this.tooltip = lines.filter(Boolean).join('\n');
        this.iconPath = stateIcon(run.status === 'running' && progress?.state ? progress.state : run.status);
        this.contextValue = 'forgeRun';
        this.command = { command: 'thinkube-cicd.showForgeRun', title: 'Show Forge Run', arguments: [this] };
    }
}

export class ForgeRunsProvider extends RunsProvider<ForgeRun, ForgeRunItem> {
    constructor(api: ServicesAPI) {
        super(api, 'Forge runs');
    }

    protected async read(): Promise<ForgeRun[]> {
        return (await this.api.forgeRuns()).slice(0, FORGE_RUNS);
    }

    protected item(run: ForgeRun): ForgeRunItem {
        return new ForgeRunItem(run);
    }
}
