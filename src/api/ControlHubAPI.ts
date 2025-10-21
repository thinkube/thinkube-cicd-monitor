import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { Pipeline, PipelineStage, PipelineMetrics } from '../models/Pipeline';

export class ControlHubAPI {
    private client: AxiosInstance;
    private baseURL: string;

    constructor() {
        // Get base URL from settings or use default
        const config = vscode.workspace.getConfiguration('thinkube-cicd');
        this.baseURL = config.get('apiUrl', 'https://control.thinkube.com');
        
        this.client = axios.create({
            baseURL: `${this.baseURL}/api/v1/cicd`,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Add auth token if available
        this.setupAuthInterceptor();
    }

    private setupAuthInterceptor() {
        this.client.interceptors.request.use(
            async (config) => {
                // Try to get auth token from thinkube-control
                try {
                    const token = await this.getAuthToken();
                    if (token) {
                        config.headers.Authorization = `Bearer ${token}`;
                        console.log('API request with token:', config.url);
                    } else {
                        console.warn('No API token available for request:', config.url);
                    }
                } catch (error) {
                    console.warn('Could not get auth token:', error);
                }
                return config;
            },
            (error) => {
                return Promise.reject(error);
            }
        );
    }

    private async getAuthToken(): Promise<string | null> {
        // Always get fresh config to ensure we have the latest token
        const config = vscode.workspace.getConfiguration('thinkube-cicd');
        const apiToken = config.get<string>('apiToken');
        
        if (apiToken && apiToken.startsWith('tk_')) {
            return apiToken;
        }
        
        // No token configured
        console.warn('No API token configured or token does not start with tk_');
        return null;
    }
    
    public refreshConfig(): void {
        // Update base URL if changed
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
            // The API returns { pipelines: [...], total: ..., limit: ..., offset: ... }
            const pipelines = response.data.pipelines || [];
            
            // Map API response to Pipeline interface
            return pipelines.map((p: any) => ({
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
                    duration: s.duration
                })) : [],
                trigger: {
                    type: p.triggerType,
                    user: p.triggerUser,
                    branch: p.branch,
                    commit: p.commitSha,
                    message: p.commitMessage
                },
                duration: p.duration,
                stageCount: p.stageCount
            }));
        } catch (error: any) {
            if (error.response?.status === 401) {
                console.warn('CI/CD API requires authentication. Returning empty list.');
                // TODO: Trigger VS Code authentication flow
            } else {
                console.error('Failed to list pipelines:', error.message);
            }
            return [];
        }
    }

    async getPipeline(pipelineId: string): Promise<Pipeline | null> {
        try {
            const response = await this.client.get(`/pipelines/${pipelineId}`);
            const p = response.data;
            
            // Map API response to Pipeline interface
            return {
                id: p.id,
                appName: p.appName,
                startTime: p.startedAt,
                endTime: p.completedAt,
                status: p.status,
                stages: p.stages.map((s: any) => ({
                    id: s.id,
                    stageName: s.stageName,
                    component: s.component,
                    status: s.status,
                    startedAt: s.startedAt,
                    completedAt: s.completedAt,
                    errorMessage: s.errorMessage,
                    details: s.details,
                    duration: s.duration
                })),
                trigger: {
                    type: p.triggerType,
                    user: p.triggerUser,
                    branch: p.branch,
                    commit: p.commitSha,
                    message: p.commitMessage
                },
                duration: p.duration,
                stageCount: p.stageCount,
                mermaidGantt: p.mermaidGantt  // Include backend-generated Mermaid diagram
            };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 404) {
                    return null;
                }
                if (error.response?.status === 401) {
                    console.error('Authentication failed for pipeline request. Token may be invalid or expired.');
                    vscode.window.showErrorMessage('Authentication failed. Please check your API token configuration.');
                }
            }
            console.error('Failed to get pipeline:', error);
            throw error;
        }
    }


    async getMetrics(appName: string, period: string = '7d'): Promise<PipelineMetrics> {
        try {
            const response = await this.client.get('/metrics', {
                params: { app_name: appName, period }
            });
            return response.data.metrics;
        } catch (error) {
            console.error('Failed to get metrics:', error);
            throw error;
        }
    }

    async listApplications(): Promise<string[]> {
        try {
            const response = await this.client.get('/applications');
            return response.data;
        } catch (error) {
            console.error('Failed to list applications:', error);
            throw error;
        }
    }

    connectWebSocket(pipelineId: string, onMessage: (data: any) => void): WebSocket {
        const wsUrl = this.baseURL.replace(/^https?/, 'ws') + `/api/v1/cicd/ws/pipelines/${pipelineId}`;
        const ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onMessage(data);
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        return ws;
    }

    async testConnection(): Promise<boolean> {
        try {
            // Use health endpoint which doesn't require auth
            const response = await this.client.get('/health');
            return response.data.status === 'healthy';
        } catch (error: any) {
            // If we get 404, try the pipelines endpoint and accept 401 as valid
            try {
                const response = await this.client.get('/pipelines', {
                    params: { limit: 1 },
                    validateStatus: (status) => {
                        // Accept 401 (not authenticated) as a valid response
                        // This means the API is reachable
                        return status === 200 || status === 401;
                    }
                });
                return true;
            } catch (secondError) {
                console.error('Failed to connect to CI/CD API:', secondError);
                return false;
            }
        }
    }
}

// 🤖 Generated with Claude