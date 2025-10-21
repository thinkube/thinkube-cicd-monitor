import * as WebSocket from 'ws';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';

export class EventStream extends EventEmitter {
    private ws: WebSocket.WebSocket | null = null;
    private apiUrl: string;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectDelay = 5000;

    constructor(apiUrl: string) {
        super();
        this.apiUrl = apiUrl;
    }

    async connect(): Promise<void> {
        const wsUrl = this.apiUrl.replace(/^http/, 'ws') + '/ws/pipelines/all';
        
        try {
            this.ws = new WebSocket.WebSocket(wsUrl);
            
            this.ws!.on('open', () => {
                console.log('WebSocket connected to CI/CD monitor');
                this.reconnectAttempts = 0;
                this.emit('connected');
            });
            
            this.ws!.on('message', (data: any) => {
                try {
                    const event = JSON.parse(data.toString());
                    this.emit('pipeline-event', event);
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            });
            
            this.ws!.on('close', (code: any, reason: any) => {
                console.log(`WebSocket closed: ${code} - ${reason}`);
                this.emit('disconnected');
                this.scheduleReconnect();
            });
            
            this.ws!.on('error', (error: any) => {
                console.error('WebSocket error:', error);
                this.emit('error', error);
            });
            
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            vscode.window.showErrorMessage(
                'Failed to connect to CI/CD monitor after multiple attempts. Please check your configuration.'
            );
            return;
        }
        
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }
        
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
        
        this.reconnectTimeout = setTimeout(() => {
            console.log(`Attempting to reconnect (attempt ${this.reconnectAttempts})...`);
            this.connect();
        }, delay);
    }

    disconnect(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    send(data: any): void {
        if (this.isConnected()) {
            this.ws!.send(JSON.stringify(data));
        } else {
            console.warn('Cannot send message: WebSocket is not connected');
        }
    }
}