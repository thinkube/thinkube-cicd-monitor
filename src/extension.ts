import * as vscode from 'vscode';
import { PipelineTreeProvider, StageItem } from './views/PipelineTreeProvider';
import { PipelineTimelinePanel } from './views/PipelineTimelinePanel';
import { ControlHubAPI } from './api/ControlHubAPI';

let controlHubAPI: ControlHubAPI;

// Virtual document provider for read-only log views (close without save prompt)
const LOG_SCHEME = 'thinkube-log';
const logContents = new Map<string, string>();

const logContentProvider: vscode.TextDocumentContentProvider = {
    onDidChange: undefined,
    provideTextDocumentContent(uri: vscode.Uri): string {
        return logContents.get(uri.toString()) || '';
    }
};

export function activate(context: vscode.ExtensionContext) {
    console.log('Thinkube CI/CD Monitor is now active!');

    controlHubAPI = new ControlHubAPI();

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(LOG_SCHEME, logContentProvider)
    );

    const pipelineProvider = new PipelineTreeProvider(controlHubAPI);

    vscode.window.registerTreeDataProvider('thinkube-cicd.pipelines', pipelineProvider);

    // Refresh command
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.refreshPipelines', () => {
            pipelineProvider.refresh();
        })
    );

    // Show pipeline details (timeline panel)
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.showPipeline', async (arg: any) => {
            let pipelineId: string | undefined;

            if (arg && arg.pipeline && arg.pipeline.id) {
                pipelineId = arg.pipeline.id;
            } else if (typeof arg === 'string') {
                pipelineId = arg;
            }

            if (!pipelineId) {
                vscode.window.showErrorMessage('Pipeline ID not provided');
                return;
            }

            const pipeline = await controlHubAPI.getPipeline(pipelineId);
            if (pipeline) {
                PipelineTimelinePanel.render(context.extensionUri, pipeline, controlHubAPI);
            }
        })
    );

    // Show timeline (same as showPipeline)
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.showTimeline', async (pipelineId: string) => {
            const pipeline = await controlHubAPI.getPipeline(pipelineId);
            if (pipeline) {
                PipelineTimelinePanel.render(context.extensionUri, pipeline, controlHubAPI);
            }
        })
    );

    // View logs for a stage
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.viewLogs', async (arg: any) => {
            let pipelineId: string | undefined;
            let podName: string | undefined;
            let stageName: string | undefined;
            let namespace: string | undefined;

            if (arg instanceof StageItem) {
                pipelineId = arg.pipelineId;
                podName = arg.podName;
                stageName = arg.stage;
                namespace = arg.namespace;
            }

            if (!pipelineId || !podName) {
                vscode.window.showErrorMessage('Cannot view logs: pod information not available');
                return;
            }

            try {
                const logs = await controlHubAPI.getLogs(pipelineId, podName, 500, namespace);
                const uri = vscode.Uri.parse(`${LOG_SCHEME}:${stageName || podName}.log`);
                logContents.set(uri.toString(), logs);
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, { preview: true });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to fetch logs: ${error.message}`);
            }
        })
    );

    // Configure API token
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

    // Auto-refresh on interval
    const refreshInterval = vscode.workspace.getConfiguration('thinkube-cicd').get('refreshInterval', 5000);
    const refreshTimer = setInterval(() => {
        if (pipelineProvider.isVisible()) {
            pipelineProvider.refresh();
        }
    }, refreshInterval);

    context.subscriptions.push({
        dispose: () => clearInterval(refreshTimer)
    });

    // Check API connection
    controlHubAPI.testConnection().then(connected => {
        if (connected) {
            const config = vscode.workspace.getConfiguration('thinkube-cicd');
            const apiToken = config.get<string>('apiToken');

            if (apiToken && apiToken.startsWith('tk_')) {
                vscode.window.showInformationMessage('CI/CD Monitor authenticated and ready');
            } else {
                vscode.window.showWarningMessage(
                    'CI/CD Monitor requires an API token. Click "Configure Token" to set one up.',
                    'Configure Token'
                ).then(selection => {
                    if (selection === 'Configure Token') {
                        vscode.commands.executeCommand('thinkube-cicd.configureToken');
                    }
                });
            }
        } else {
            vscode.window.showWarningMessage('CI/CD Monitor: Unable to connect to API.');
        }
    });
}

export function deactivate() {
    // Cleanup if needed
}
