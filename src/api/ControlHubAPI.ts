import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { Pipeline, PipelineStage } from '../models/Pipeline';

export class ControlHubAPI {
    private client: AxiosInstance;
    private baseURL: string;

    constructor() {
        const config = vscode.workspace.getConfiguration('thinkube-cicd');
        this.baseURL = config.get('apiUrl', 'https://control.thinkube.com');

        this.client = axios.create({
            baseURL: `${this.baseURL}/api/v1/cicd`,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        this.setupAuthInterceptor();
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

    public refreshConfig(): void {
        const config = vscode.workspace.getConfiguration('thinkube-cicd');
        const newBaseURL = config.get('apiUrl', 'https://control.thinkube.com');

        if (newBaseURL !== this.baseURL) {
            this.baseURL = newBaseURL;
            this.client.defaults.baseURL = `${this.baseURL}/api/v1/cicd`;
        }
    }

    async listPipelines(appName?: string, status?: string, limit: number = 20): Promise<Pipeline[]> {
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

    async getLogs(workflowName: string, podName: string, tailLines: number = 500): Promise<string> {
        try {
            const response = await this.client.get(`/pipelines/${workflowName}/logs/${podName}`, {
                params: { tail_lines: tailLines }
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
