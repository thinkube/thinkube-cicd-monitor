/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { Pipeline, PipelineStage } from '../models/Pipeline';

const API_URL_MISSING = 'thinkube-cicd.apiUrl is not set. Thinkube sets it in code-server; set it in Settings to your thinkube-control address.';

export class ControlHubAPI {
    private client: AxiosInstance;
    private baseURL = '';
    private missingUrlReported = false;

    constructor() {
        this.client = axios.create({
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        this.setupAuthInterceptor();
        this.isConfigured();
    }

    /**
     * Reads thinkube-cicd.apiUrl and points the HTTP client at it.
     * Returns false when the setting is empty; the error message is shown
     * once until the setting is filled in.
     */
    public isConfigured(): boolean {
        const apiUrl = (vscode.workspace.getConfiguration('thinkube-cicd').get<string>('apiUrl') ?? '').trim();
        if (!apiUrl) {
            if (!this.missingUrlReported) {
                this.missingUrlReported = true;
                vscode.window.showErrorMessage(API_URL_MISSING);
            }
            return false;
        }
        this.missingUrlReported = false;
        if (apiUrl !== this.baseURL) {
            this.baseURL = apiUrl;
            this.client.defaults.baseURL = `${this.baseURL}/api/v1/cicd`;
        }
        return true;
    }

    private requireConfigured(): void {
        if (!this.isConfigured()) {
            throw new Error(API_URL_MISSING);
        }
    }

    private setupAuthInterceptor() {
        this.client.interceptors.request.use(
            async (config) => {
                try {
                    const token = await this.getAuthToken();
                    if (token) {
                        config.headers.Authorization = `Bearer ${token}`;
                    }
                } catch (error) {
                    console.warn('Could not get auth token:', error);
                }
                return config;
            },
            (error) => Promise.reject(error)
        );
    }

    private async getAuthToken(): Promise<string | null> {
        const config = vscode.workspace.getConfiguration('thinkube-cicd');
        const apiToken = config.get<string>('apiToken');

        if (apiToken && apiToken.startsWith('tk_')) {
            return apiToken;
        }
        return null;
    }

    async listPipelines(appName?: string, status?: string, limit: number = 20): Promise<Pipeline[]> {
        if (!this.isConfigured()) {
            return [];
        }
        try {
            const response = await this.client.get('/pipelines', {
                params: { app_name: appName, status, limit },
                validateStatus: (status) => status === 200
            });
            const pipelines = response.data.pipelines || [];

            return pipelines.map((p: any) => this.mapPipeline(p));
        } catch (error: any) {
            if (error.response?.status === 401) {
                console.warn('CI/CD API requires authentication. Returning empty list.');
            } else {
                console.error('Failed to list pipelines:', error.message);
            }
            return [];
        }
    }

    async getPipeline(pipelineId: string): Promise<Pipeline | null> {
        this.requireConfigured();
        try {
            const response = await this.client.get(`/pipelines/${pipelineId}`);
            return this.mapPipeline(response.data);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 404) {
                    return null;
                }
                if (error.response?.status === 401) {
                    vscode.window.showErrorMessage('Authentication failed. Please check your API token configuration.');
                }
            }
            console.error('Failed to get pipeline:', error);
            throw error;
        }
    }

    async getLogs(workflowName: string, podName: string, tailLines: number = 500, namespace?: string): Promise<string> {
        this.requireConfigured();
        try {
            const params: any = { tail_lines: tailLines };
            if (namespace) {
                params.namespace = namespace;
            }
            const response = await this.client.get(`/pipelines/${workflowName}/logs/${podName}`, {
                params
            });
            return response.data.logs || '';
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return 'Logs not available — pod may have been garbage collected.';
            }
            console.error('Failed to get logs:', error);
            throw error;
        }
    }

    async testConnection(): Promise<boolean> {
        this.requireConfigured();
        try {
            const response = await this.client.get('/health');
            return response.data.status === 'healthy';
        } catch (error: any) {
            try {
                await this.client.get('/pipelines', {
                    params: { limit: 1 },
                    validateStatus: (status) => status === 200 || status === 401
                });
                return true;
            } catch (secondError) {
                console.error('Failed to connect to CI/CD API:', secondError);
                return false;
            }
        }
    }

    private mapPipeline(p: any): Pipeline {
        return {
            id: p.id,
            appName: p.appName,
            startTime: p.startedAt,
            endTime: p.completedAt,
            status: p.status,
            stages: p.stages ? p.stages.map((s: any) => ({
                id: s.id,
                stageName: s.stageName,
                component: s.component,
                status: s.status,
                startedAt: s.startedAt,
                completedAt: s.completedAt,
                errorMessage: s.errorMessage,
                details: s.details,
                duration: s.duration,
                podName: s.podName
            })) : [],
            trigger: {
                type: p.triggerType || 'webhook',
                user: p.triggerUser,
                branch: p.branch,
                commit: p.commitSha,
                message: p.commitMessage
            },
            duration: p.duration,
            stageCount: p.stageCount
        };
    }
}
