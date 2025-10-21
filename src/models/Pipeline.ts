export interface Pipeline {
    id: string;
    appName: string;
    startTime: number;
    endTime?: number;
    status: PipelineStatus;
    stages: PipelineStage[];
    trigger: PipelineTrigger;
    duration?: number;
    stageCount?: number;
    mermaidGantt?: string;  // Backend-generated Mermaid Gantt chart
}

export enum PipelineStatus {
    PENDING = 'PENDING',
    RUNNING = 'RUNNING',
    SUCCEEDED = 'SUCCEEDED',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED'
}

export interface PipelineStage {
    id: string;
    stageName: string;
    component: string;
    status: StageStatus;
    startedAt: number;
    completedAt?: number;
    errorMessage?: string;
    details: any;
    duration?: number;
}

export enum StageStatus {
    PENDING = 'PENDING',
    RUNNING = 'RUNNING',
    SUCCEEDED = 'SUCCEEDED',
    FAILED = 'FAILED',
    SKIPPED = 'SKIPPED'
}



export interface PipelineTrigger {
    type: 'manual' | 'git_push' | 'scheduled' | 'api';
    user?: string;
    branch?: string;
    commit?: string;
    message?: string;
}

export interface PipelineMetrics {
    appName: string;
    period: string;
    totalPipelines: number;
    successRate: number;
    averageDuration: number;
    failureReasons: { [key: string]: number };
    deploymentFrequency: number;
}

export interface PipelineAnalysis {
    pipelineId: string;
    summary: string;
    bottlenecks: AnalysisItem[];
    failures: AnalysisItem[];
    suggestions: string[];
    performanceScore: number;
}

export interface AnalysisItem {
    stage: string;
    duration: number;
    issue: string;
    impact: 'high' | 'medium' | 'low';
}