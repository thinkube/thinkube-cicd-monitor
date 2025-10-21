import * as vscode from 'vscode';
import * as path from 'path';
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

    constructor(private controlHubAPI: ControlHubAPI) {
        super();
        this.refresh();
        
        // Track which tree items are expanded
        vscode.commands.registerCommand('thinkube-cicd.trackExpanded', (pipelineId: string) => {
            this.expandedPipelines.add(pipelineId);
            this.emit('pipelineExpanded', pipelineId);
        });
    }

    refresh(): void {
        // Clear cache to ensure fresh data
        this.pipelineCache.clear();
        this.loadPipelines();
        this._onDidChangeTreeData.fire();
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
            // Root level - show loading or pipelines
            if (this.loading) {
                return Promise.resolve([new LoadingItem()]);
            }
            
            // Show pipelines with proper collapsible state
            return Promise.resolve(
                this.pipelines.map(pipeline => {
                    // Check if pipeline has stages (using stageCount from list response)
                    const hasStages = (pipeline.stageCount && pipeline.stageCount > 0) || 
                                    (pipeline.stages && pipeline.stages.length > 0);
                    return new PipelineItem(
                        pipeline,
                        hasStages ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
                    );
                })
            );
        } else if (element instanceof PipelineItem) {
            // Lazy load full pipeline details if not cached
            return this.loadPipelineStages(element);
        } else {
            // StageItem or LoadingItem has no children
            return Promise.resolve([]);
        }
    }

    private async loadPipelineStages(element: PipelineItem): Promise<TreeNode[]> {
        const pipelineId = element.pipeline.id;
        
        // Track that this pipeline is expanded
        if (!this.expandedPipelines.has(pipelineId)) {
            this.expandedPipelines.add(pipelineId);
            this.emit('pipelineExpanded', pipelineId);
        }
        
        // Check cache first
        let fullPipeline = this.pipelineCache.get(pipelineId);
        
        // Force refresh if pipeline is RUNNING or if cache is stale
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
        
        // Return stages if available
        if (fullPipeline && fullPipeline.stages) {
            return this.getStages(fullPipeline);
        }
        
        return [];
    }

    private async loadPipelines() {
        this.loading = true;
        this._onDidChangeTreeData.fire();
        
        try {
            this.pipelines = await this.controlHubAPI.listPipelines(undefined, undefined, 20);
        } catch (error) {
            console.error('Failed to load pipelines:', error);
            this.pipelines = [];
        } finally {
            this.loading = false;
            this._onDidChangeTreeData.fire();
        }
    }

    private getStages(pipeline: Pipeline): StageItem[] {
        const stages: StageItem[] = [];

        // Use actual stages from the pipeline
        pipeline.stages.forEach(stage => {
            // Duration is already in seconds from the API
            const duration = stage.duration !== undefined ? stage.duration : 
                (stage.completedAt && stage.startedAt ? 
                    (stage.completedAt - stage.startedAt) : 0);

            // Debug logging for frontend_build
            if (stage.stageName === 'frontend_build') {
                console.log('frontend_build stage data:', {
                    stageName: stage.stageName,
                    status: stage.status,
                    duration: stage.duration,
                    calculatedDuration: duration,
                    startedAt: stage.startedAt,
                    completedAt: stage.completedAt
                });
            }

            stages.push(new StageItem(
                stage.stageName, 
                stage.status, 
                duration, 
                pipeline.id,
                stage.id
            ));
        });

        return stages;
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
        
        // Set command to show pipeline details
        this.command = {
            command: 'thinkube-cicd.showPipeline',
            title: 'Show Pipeline',
            arguments: [pipeline.id]
        };
    }

    private getDescription(): string {
        const duration = this.pipeline.duration 
            ? `${Math.round(this.pipeline.duration / 1000)}s` 
            : 'Running';
        
        // Show both date and time in local timezone
        const date = new Date(this.pipeline.startTime * 1000);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const timeStr = date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        });
        
        // Status is already uppercase from API mapping
        const status = this.pipeline.status;
        
        return `${status} - ${duration} - ${dateStr} ${timeStr}`;
    }

    private getTooltip(): string {
        const trigger = this.pipeline.trigger;
        let triggerInfo = `Trigger: ${trigger.type}`;
        
        if (trigger.user) triggerInfo += ` by ${trigger.user}`;
        if (trigger.branch) triggerInfo += ` on ${trigger.branch}`;
        
        // Show full date and time in tooltip with local timezone
        const startDate = new Date(this.pipeline.startTime * 1000);
        const dateOptions: Intl.DateTimeFormatOptions = {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
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

class StageItem extends vscode.TreeItem {
    constructor(
        public readonly stage: string,
        public readonly status: string,
        public readonly duration: number,
        public readonly pipelineId: string,
        public readonly stageId: string
    ) {
        super(stage, vscode.TreeItemCollapsibleState.None);
        
        // Duration is already in seconds
        this.description = status === StageStatus.RUNNING ? 'Running' : `${Math.round(duration)}s`;
        this.tooltip = `${stage}: ${status}${status === StageStatus.RUNNING ? '' : ` (${Math.round(duration)}s)`}`;
        this.iconPath = this.getIcon();
        this.contextValue = 'stage';
    }

    private getIcon(): vscode.ThemeIcon {
        // Debug logging
        if (this.stage === 'frontend_build') {
            console.log(`frontend_build status: "${this.status}" (type: ${typeof this.status})`);
        }
        
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