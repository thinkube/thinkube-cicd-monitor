import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { Pipeline, PipelineStatus, PipelineStage, StageStatus } from '../models/Pipeline';
import { ControlHubAPI } from '../api/ControlHubAPI';

type TreeNode = PipelineItem | StageItem | LoadingItem;

export class PipelineTreeProvider extends EventEmitter implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private pipelines: Pipeline[] = [];
    private visible = false;
    private expandedPipelines = new Set<string>();
    private loading = true;
    private pipelineCache = new Map<string, Pipeline>();
    private previousStatuses = new Map<string, PipelineStatus>();

    constructor(private controlHubAPI: ControlHubAPI) {
        super();
        this.refresh();
    }

    refresh(): void {
        this.pipelineCache.clear();
        this.loadPipelines(true);
    }

    silentRefresh(): void {
        this.loadPipelines(false);
    }

    isVisible(): boolean {
        return this.visible;
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeNode): Thenable<TreeNode[]> {
        if (!element) {
            if (this.loading) {
                return Promise.resolve([new LoadingItem()]);
            }

            return Promise.resolve(
                this.pipelines.map(pipeline => {
                    const hasStages = (pipeline.stageCount && pipeline.stageCount > 0) ||
                                    (pipeline.stages && pipeline.stages.length > 0);
                    return new PipelineItem(
                        pipeline,
                        hasStages ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
                    );
                })
            );
        } else if (element instanceof PipelineItem) {
            return this.loadPipelineStages(element);
        } else {
            return Promise.resolve([]);
        }
    }

    private async loadPipelineStages(element: PipelineItem): Promise<TreeNode[]> {
        const pipelineId = element.pipeline.id;

        if (!this.expandedPipelines.has(pipelineId)) {
            this.expandedPipelines.add(pipelineId);
        }

        let fullPipeline = this.pipelineCache.get(pipelineId);

        const shouldRefresh = !fullPipeline ||
                            !fullPipeline.stages ||
                            fullPipeline.status === PipelineStatus.RUNNING ||
                            element.pipeline.status === PipelineStatus.RUNNING;

        if (shouldRefresh) {
            try {
                const pipelineDetails = await this.controlHubAPI.getPipeline(pipelineId);
                if (pipelineDetails) {
                    fullPipeline = pipelineDetails;
                    this.pipelineCache.set(pipelineId, fullPipeline);
                }
            } catch (error) {
                console.error('Failed to load pipeline details:', error);
                return [];
            }
        }

        if (fullPipeline && fullPipeline.stages) {
            return this.getStages(fullPipeline);
        }

        return [];
    }

    private async loadPipelines(showLoading: boolean) {
        if (showLoading) {
            this.loading = true;
            this._onDidChangeTreeData.fire();
        }

        try {
            this.pipelines = await this.controlHubAPI.listPipelines(undefined, undefined, 20);
            this.notifyCompletedPipelines(this.pipelines);
        } catch (error) {
            console.error('Failed to load pipelines:', error);
        } finally {
            this.loading = false;
            this._onDidChangeTreeData.fire();
        }
    }

    private notifyCompletedPipelines(pipelines: Pipeline[]) {
        const config = vscode.workspace.getConfiguration('thinkube-cicd');
        if (!config.get<boolean>('showNotifications', true)) { return; }
        const level = config.get<string>('notificationLevel', 'failures');
        if (level === 'none') { return; }

        for (const pipeline of pipelines) {
            const prev = this.previousStatuses.get(pipeline.id);
            this.previousStatuses.set(pipeline.id, pipeline.status);

            if (prev !== PipelineStatus.RUNNING && prev !== PipelineStatus.PENDING) { continue; }

            const duration = pipeline.duration ? ` in ${Math.round(pipeline.duration)}s` : '';

            if (pipeline.status === PipelineStatus.SUCCEEDED && level === 'all') {
                vscode.window.showInformationMessage(
                    `Pipeline "${pipeline.appName}" succeeded${duration}`
                );
            } else if (pipeline.status === PipelineStatus.FAILED) {
                vscode.window.showErrorMessage(
                    `Pipeline "${pipeline.appName}" failed${duration}`,
                    'View Details'
                ).then(selection => {
                    if (selection === 'View Details') {
                        vscode.commands.executeCommand('thinkube-cicd.showPipeline', pipeline.id);
                    }
                });
            } else if (pipeline.status === PipelineStatus.CANCELLED && level === 'all') {
                vscode.window.showWarningMessage(
                    `Pipeline "${pipeline.appName}" was cancelled`
                );
            }
        }
    }

    private getStages(pipeline: Pipeline): StageItem[] {
        return pipeline.stages.map(stage => {
            const duration = stage.duration !== undefined ? stage.duration :
                (stage.completedAt && stage.startedAt ?
                    (stage.completedAt - stage.startedAt) : 0);

            return new StageItem(
                stage.stageName,
                stage.status,
                duration,
                pipeline.id,
                stage.id,
                stage.podName,
                stage.details?.namespace
            );
        });
    }
}

export class PipelineItem extends vscode.TreeItem {
    constructor(
        public readonly pipeline: Pipeline,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(pipeline.appName, collapsibleState);

        this.description = this.getDescription();
        this.tooltip = this.getTooltip();
        this.iconPath = this.getIcon();
        this.contextValue = 'pipeline';

        this.command = {
            command: 'thinkube-cicd.showPipeline',
            title: 'Show Pipeline',
            arguments: [pipeline.id]
        };
    }

    private getDescription(): string {
        // Duration is already in seconds from K8s API
        const duration = this.pipeline.duration
            ? `${Math.round(this.pipeline.duration)}s`
            : 'Running';

        const date = new Date(this.pipeline.startTime * 1000);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const timeStr = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        return `${this.pipeline.status} - ${duration} - ${dateStr} ${timeStr}`;
    }

    private getTooltip(): string {
        const trigger = this.pipeline.trigger;
        let triggerInfo = `Trigger: ${trigger.type}`;

        if (trigger.user) { triggerInfo += ` by ${trigger.user}`; }
        if (trigger.branch) { triggerInfo += ` on ${trigger.branch}`; }

        const startDate = new Date(this.pipeline.startTime * 1000);
        const dateOptions: Intl.DateTimeFormatOptions = {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        };

        return `${this.pipeline.appName}\n` +
            `Status: ${this.pipeline.status}\n` +
            `${triggerInfo}\n` +
            `Started: ${startDate.toLocaleString('en-US', dateOptions)}`;
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.pipeline.status) {
            case PipelineStatus.SUCCEEDED:
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            case PipelineStatus.FAILED:
                return new vscode.ThemeIcon('x', new vscode.ThemeColor('testing.iconFailed'));
            case PipelineStatus.RUNNING:
                return new vscode.ThemeIcon('sync~spin');
            case PipelineStatus.CANCELLED:
                return new vscode.ThemeIcon('circle-slash');
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
}

export class StageItem extends vscode.TreeItem {
    constructor(
        public readonly stage: string,
        public readonly status: string,
        public readonly duration: number,
        public readonly pipelineId: string,
        public readonly stageId: string,
        public readonly podName?: string,
        public readonly namespace?: string
    ) {
        super(stage, vscode.TreeItemCollapsibleState.None);

        this.description = status === StageStatus.RUNNING ? 'Running' : `${Math.round(duration)}s`;
        this.tooltip = `${stage}: ${status}${status === StageStatus.RUNNING ? '' : ` (${Math.round(duration)}s)`}`;
        this.iconPath = this.getIcon();
        this.contextValue = 'stage';
    }

    private getIcon(): vscode.ThemeIcon {
        if (this.status === StageStatus.SUCCEEDED) {
            return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        } else if (this.status === StageStatus.FAILED) {
            return new vscode.ThemeIcon('x', new vscode.ThemeColor('testing.iconFailed'));
        } else if (this.status === StageStatus.RUNNING) {
            return new vscode.ThemeIcon('sync~spin');
        } else if (this.status === StageStatus.SKIPPED) {
            return new vscode.ThemeIcon('circle-slash');
        } else {
            return new vscode.ThemeIcon('circle-outline');
        }
    }
}

class LoadingItem extends vscode.TreeItem {
    constructor() {
        super('Loading pipelines...', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('sync~spin');
        this.contextValue = 'loading';
    }
}
