import * as vscode from 'vscode';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { ControlHubAPI } from './ControlHubAPI';

export class WebSocketManager extends EventEmitter {
    private websockets: Map<string, WebSocket> = new Map();
    private api: ControlHubAPI;
    private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
    private isActive: boolean = true;
    private globalWebSocket: WebSocket | null = null;
    private globalReconnectTimer: NodeJS.Timeout | null = null;

    constructor(api: ControlHubAPI) {
        super();
        this.api = api;
    }

    async connect(): Promise<void> {
        console.log('WebSocket manager initialized');
        // Connect to global event stream
        await this.connectToGlobalStream();
    }

    trackPipeline(pipelineId: string): void {
        if (this.websockets.has(pipelineId)) {
            return; // Already tracking
        }

        this.connectToPipeline(pipelineId);
    }

    private async connectToPipeline(pipelineId: string): Promise<void> {
        try {
            // Get base URL from settings
            const config = vscode.workspace.getConfiguration('thinkube-cicd');
            const baseUrl = config.get('apiUrl', 'https://control.thinkube.com');
            
            // Convert to WebSocket URL (use wss for https)
            const wsUrl = baseUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
            
            // Server WebSocket is at /api/v1/cicd/ws/pipelines/{id} because the cicd router has /cicd prefix
            // Also, server currently has NO authentication on WebSocket
            const fullUrl = `${wsUrl}/api/v1/cicd/ws/pipelines/${pipelineId}`;
            
            // Create WebSocket (server doesn't check auth currently)
            const ws = new WebSocket(fullUrl, {
                rejectUnauthorized: false // For self-signed certificates
            });

            ws.on('open', () => {
                console.log(`WebSocket connected for pipeline ${pipelineId}`);
                this.websockets.set(pipelineId, ws);
                
                // Clear any reconnect timer
                const timer = this.reconnectTimers.get(pipelineId);
                if (timer) {
                    clearTimeout(timer);
                    this.reconnectTimers.delete(pipelineId);
                }
            });

            ws.on('message', (data) => {
                try {
                    const event = JSON.parse(data.toString());
                    console.log(`Received event for pipeline ${pipelineId}:`, event);
                    
                    // Emit the event for the extension to handle
                    this.emit('pipelineEvent', {
                        pipelineId,
                        ...event
                    });
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            });

            ws.on('error', (error) => {
                console.error(`WebSocket error for pipeline ${pipelineId}:`, error);
            });

            ws.on('close', (code, reason) => {
                console.log(`WebSocket closed for pipeline ${pipelineId}: ${code} - ${reason}`);
                this.websockets.delete(pipelineId);
                
                // Attempt to reconnect after a delay if still active
                if (this.isActive && code !== 1000) { // 1000 = normal closure
                    const timer = setTimeout(() => {
                        if (this.isActive) {
                            console.log(`Attempting to reconnect to pipeline ${pipelineId}`);
                            this.connectToPipeline(pipelineId);
                        }
                    }, 5000); // Reconnect after 5 seconds
                    
                    this.reconnectTimers.set(pipelineId, timer);
                }
            });

        } catch (error) {
            console.error(`Failed to connect WebSocket for pipeline ${pipelineId}:`, error);
        }
    }

    private async getAuthToken(): Promise<string | null> {
        const config = vscode.workspace.getConfiguration('thinkube-cicd');
        const apiToken = config.get<string>('apiToken');
        
        if (apiToken && apiToken.startsWith('tk_')) {
            return apiToken;
        }
        
        return null;
    }

    private async connectToGlobalStream(): Promise<void> {
        try {
            // Get base URL from settings
            const config = vscode.workspace.getConfiguration('thinkube-cicd');
            const baseUrl = config.get('apiUrl', 'https://control.thinkube.com');
            
            // Convert to WebSocket URL (use wss for https)
            const wsUrl = baseUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
            
            // Global events endpoint is not implemented in server
            // For now, disable global WebSocket connection
            console.log('Global WebSocket endpoint not implemented on server - skipping connection');
            return;

        } catch (error) {
            console.error('Failed to connect global WebSocket:', error);
        }
    }

    disconnect(): void {
        this.isActive = false;
        
        // Clear global reconnect timer
        if (this.globalReconnectTimer) {
            clearTimeout(this.globalReconnectTimer);
            this.globalReconnectTimer = null;
        }
        
        // Close global WebSocket
        if (this.globalWebSocket) {
            this.globalWebSocket.close(1000, 'Extension deactivating');
            this.globalWebSocket = null;
        }
        
        // Clear all reconnect timers
        for (const timer of this.reconnectTimers.values()) {
            clearTimeout(timer);
        }
        this.reconnectTimers.clear();
        
        // Close all WebSocket connections
        for (const [pipelineId, ws] of this.websockets.entries()) {
            ws.close(1000, 'Extension deactivating');
        }
        this.websockets.clear();
    }

    stopTrackingPipeline(pipelineId: string): void {
        const ws = this.websockets.get(pipelineId);
        if (ws) {
            ws.close(1000, 'No longer tracking');
            this.websockets.delete(pipelineId);
        }
        
        const timer = this.reconnectTimers.get(pipelineId);
        if (timer) {
            clearTimeout(timer);
            this.reconnectTimers.delete(pipelineId);
        }
    }
}

// 🤖 Generated with Claude