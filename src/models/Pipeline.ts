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
    podName?: string;
}

export enum StageStatus {
    PENDING = 'PENDING',
    RUNNING = 'RUNNING',
    SUCCEEDED = 'SUCCEEDED',
    FAILED = 'FAILED',
    SKIPPED = 'SKIPPED'
}

export interface PipelineTrigger {
    type: 'manual' | 'git_push' | 'scheduled' | 'api' | 'webhook';
    user?: string;
    branch?: string;
    commit?: string;
    message?: string;
}
