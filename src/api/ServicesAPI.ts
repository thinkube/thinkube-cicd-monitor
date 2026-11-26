/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import * as vscode from 'vscode';

/**
 * Mill and Forge, the extensions of Thinkube Control that run tasks and
 * trainings. Each one answers at its own host of the cluster's domain
 * (mill.<domain>, forge.<domain>), the domain of thinkube-cicd.apiUrl
 * (control.<domain>), with the same API token.
 */
export type Service = 'mill' | 'forge';

export interface MillStage {
    name: string;
    total: number | null;
    done: number;
}

export interface MillRun {
    id: string;
    task: string;
    file: string;
    node: string | null;
    host: string | null;
    runner: string | null;
    state: string;
    error: string | null;
    started_at: string;
    ended_at: string | null;
    stages: MillStage[];
    samples: number;
    failures: number;
    tags: Record<string, string>;
}

export interface ForgeRun {
    id: string;
    name: string;
    kind: 'finetune' | 'task';
    status: string;
    node: string | null;
    base_model: string | null;
    method: string | null;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
    eta_seconds: number | null;
    waiting: string | null;
    tags: Record<string, string>;
    task: { mill_run?: string } | null;
    progress: {
        state?: string;
        step?: number;
        total_steps?: number;
        loss?: number;
        eta_seconds?: number;
    } | null;
}

export interface MetricPoint {
    step: number;
    value: number;
}

export interface ForgeProgress {
    mlflow_run_id: string;
    status: string;
    url: string;
    metrics: Record<string, MetricPoint[]>;
}

export interface ForgeTaskProgress {
    kind: 'task';
    mill_run: string | null;
    url: string | null;
}

export class ServicesAPI {
    /**
     * The address of Thinkube Control from thinkube-cicd.apiUrl, which every
     * other address is made from. Throws when it is not set or its host is
     * not control.<domain>.
     */
    controlUrl(): URL {
        const apiUrl = (vscode.workspace.getConfiguration('thinkube-cicd').get<string>('apiUrl') ?? '').trim();
        if (!apiUrl) {
            throw new Error('thinkube-cicd.apiUrl is not set. Thinkube sets it in code-server; set it in Settings to your thinkube-control address.');
        }
        const url = new URL(apiUrl);
        if (!url.hostname.startsWith('control.')) {
            throw new Error(`thinkube-cicd.apiUrl is ${apiUrl}: Mill and Forge are found at mill.<domain> and forge.<domain>, so it must be https://control.<domain>`);
        }
        return url;
    }

    serviceUrl(service: Service): string {
        const control = this.controlUrl();
        return `${control.protocol}//${service}.${control.hostname.slice('control.'.length)}`;
    }

    /** The run's page in Thinkube Control. */
    pageUrl(service: Service, runId: string): string {
        const control = this.controlUrl();
        return `${control.protocol}//${control.host}/x/${service}/runs/${encodeURIComponent(runId)}`;
    }

    private async get<T>(service: Service, path: string, params?: Record<string, unknown>): Promise<T> {
        const token = vscode.workspace.getConfiguration('thinkube-cicd').get<string>('apiToken') ?? '';
        if (!token.startsWith('tk_')) {
            throw new Error('thinkube-cicd.apiToken is not set: run "Configure API Token" with a token from the Tokens page of thinkube-control');
        }
        try {
            const response = await axios.get(`${this.serviceUrl(service)}/api/v1${path}`, {
                params,
                timeout: 30000,
                headers: { Authorization: `Bearer ${token}` }
            });
            return response.data as T;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response) {
                const detail = error.response.data?.detail;
                throw new Error(`${service} answered ${error.response.status}${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
            }
            throw error;
        }
    }

    async millRuns(limit: number): Promise<MillRun[]> {
        const answer = await this.get<{ runs: MillRun[] }>('mill', '/runs', { limit });
        return answer.runs;
    }

    async millRunLog(runId: string, lines: number): Promise<string> {
        const answer = await this.get<{ lines: string[]; total_lines: number }>('mill', `/runs/${encodeURIComponent(runId)}/log`, { lines });
        return answer.lines.join('\n');
    }

    async forgeRuns(): Promise<ForgeRun[]> {
        return this.get<ForgeRun[]>('forge', '/runs');
    }

    async forgeRun(runId: string): Promise<ForgeRun> {
        return this.get<ForgeRun>('forge', `/runs/${encodeURIComponent(runId)}`);
    }

    /** The run's metric histories from MLflow; null while its training has not begun. */
    async forgeProgress(runId: string): Promise<ForgeProgress | ForgeTaskProgress | null> {
        return this.get<ForgeProgress | ForgeTaskProgress | null>('forge', `/runs/${encodeURIComponent(runId)}/progress`);
    }
}
