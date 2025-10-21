import * as vscode from 'vscode';
import { PipelineTreeProvider } from './views/PipelineTreeProvider';
import { PipelineTimelinePanel } from './views/PipelineTimelinePanel';
import { ControlHubAPI } from './api/ControlHubAPI';
import { WebSocketManager } from './api/WebSocketManager';

let controlHubAPI: ControlHubAPI;

export function activate(context: vscode.ExtensionContext) {
    console.log('Thinkube CI/CD Monitor is now active!');

    // Initialize the API client
    controlHubAPI = new ControlHubAPI();

    // Create tree data provider using the API
    const pipelineProvider = new PipelineTreeProvider(controlHubAPI);

    // Register tree data provider
    vscode.window.registerTreeDataProvider('thinkube-cicd.pipelines', pipelineProvider);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.refreshPipelines', () => {
            pipelineProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.showPipeline', async (arg: any) => {
            let pipelineId: string | undefined;
            
            // Check if arg is a PipelineItem (from inline button click)
            if (arg && arg.pipeline && arg.pipeline.id) {
                pipelineId = arg.pipeline.id;
            }
            // Check if arg is a string (from tree item click or programmatic call)
            else if (typeof arg === 'string') {
                pipelineId = arg;
            }
            
            if (!pipelineId) {
                vscode.window.showErrorMessage('Pipeline ID not provided');
                return;
            }
            
            const pipeline = await controlHubAPI.getPipeline(pipelineId);
            if (pipeline) {
                PipelineTimelinePanel.render(context.extensionUri, pipeline);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.showTimeline', async (pipelineId: string) => {
            const pipeline = await controlHubAPI.getPipeline(pipelineId);
            if (pipeline) {
                PipelineTimelinePanel.render(context.extensionUri, pipeline);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.triggerBuild', async () => {
            const apps = await controlHubAPI.listApplications();
            const selected = await vscode.window.showQuickPick(apps, {
                placeHolder: 'Select application to build'
            });
            
            if (selected) {
                // TODO: Implement build trigger via API
                vscode.window.showInformationMessage(`Triggering build for ${selected}...`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.showMetrics', async () => {
            const apps = await controlHubAPI.listApplications();
            const selected = await vscode.window.showQuickPick(apps, {
                placeHolder: 'Select application for metrics'
            });
            
            if (selected) {
                const metrics = await controlHubAPI.getMetrics(selected);
                // TODO: Show metrics in webview
                vscode.window.showInformationMessage(`Metrics for ${selected}: Success rate ${metrics.successRate.toFixed(1)}%`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.analyzePipeline', async (pipelineId: string) => {
            // TODO: Implement pipeline analysis via API
            vscode.window.showInformationMessage('Pipeline analysis coming soon!');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.configureToken', async () => {
            const currentToken = vscode.workspace.getConfiguration('thinkube-cicd').get<string>('apiToken');
            
            const token = await vscode.window.showInputBox({
                prompt: 'Enter your Thinkube API token (starts with tk_)',
                placeHolder: 'tk_...',
                password: true,
                value: currentToken || '',
                validateInput: (value) => {
                    if (value && !value.startsWith('tk_')) {
                        return 'API token must start with tk_';
                    }
                    return null;
                }
            });
            
            if (token !== undefined) {
                await vscode.workspace.getConfiguration('thinkube-cicd').update('apiToken', token, true);
                if (token) {
                    vscode.window.showInformationMessage('API token configured successfully. Refreshing...');
                    pipelineProvider.refresh();
                } else {
                    vscode.window.showInformationMessage('API token removed.');
                }
            }
        })
    );

    // Set up auto-refresh
    const refreshInterval = vscode.workspace.getConfiguration('thinkube-cicd').get('refreshInterval', 5000);
    const refreshTimer = setInterval(() => {
        if (pipelineProvider.isVisible()) {
            pipelineProvider.refresh();
        }
    }, refreshInterval);

    context.subscriptions.push({
        dispose: () => clearInterval(refreshTimer)
    });

    // Set up WebSocket connection for real-time updates
    setupWebSocket(context, pipelineProvider);

    // Check API connection and authentication
    controlHubAPI.testConnection().then(connected => {
        if (connected) {
            // Check if we have authentication
            const config = vscode.workspace.getConfiguration('thinkube-cicd');
            const apiToken = config.get<string>('apiToken');
            
            if (apiToken && apiToken.startsWith('tk_')) {
                vscode.window.showInformationMessage('CI/CD Monitor authenticated and ready');
            } else {
                vscode.window.showWarningMessage(
                    'CI/CD Monitor requires an API token to function. Click "Configure Token" to set one up.',
                    'Configure Token'
                ).then(selection => {
                    if (selection === 'Configure Token') {
                        vscode.commands.executeCommand('thinkube-cicd.configureToken');
                    }
                });
            }
        } else {
            vscode.window.showWarningMessage('CI/CD Monitor: Unable to connect to API. Check your network connection.');
        }
    });
}

async function setupWebSocket(
    context: vscode.ExtensionContext, 
    pipelineProvider: PipelineTreeProvider
) {
    // Connect to WebSocket for real-time pipeline updates
    const websocketManager = new WebSocketManager(controlHubAPI);
    
    // When receiving events, refresh the views
    websocketManager.on('pipelineEvent', (event) => {
        // Show notification based on event type and settings
        const config = vscode.workspace.getConfiguration('thinkube-cicd');
        const showNotifications = config.get<boolean>('showNotifications', true);
        const notificationLevel = config.get<string>('notificationLevel', 'failures');
        
        if (showNotifications && event && event.status && event.eventType) {
            const shouldNotify = notificationLevel === 'all' || 
                (notificationLevel === 'failures' && ['failed', 'error'].includes(event.status));
            
            if (shouldNotify) {
                const message = `${event.appName || event.component}: ${event.eventType} - ${event.status}`;
                if (event.status === 'failed' || event.status === 'error') {
                    vscode.window.showErrorMessage(message);
                } else {
                    vscode.window.showInformationMessage(message);
                }
            }
        }
        
        // Refresh the view
        pipelineProvider.refresh();
    });
    
    // Track pipelines when tree items are expanded
    pipelineProvider.on('pipelineExpanded', (pipelineId: string) => {
        websocketManager.trackPipeline(pipelineId);
    });
    
    // Connect to WebSocket
    await websocketManager.connect();
    
    // Cleanup on deactivation
    context.subscriptions.push({
        dispose: () => websocketManager.disconnect()
    });
}

export function deactivate() {
    // Cleanup if needed
}

// 🤖 Generated with Claude