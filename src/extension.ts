/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';
import { PipelineTreeProvider, StageItem } from './views/PipelineTreeProvider';
import { PipelineTimelinePanel } from './views/PipelineTimelinePanel';
import { ControlHubAPI } from './api/ControlHubAPI';
import { ServicesAPI } from './api/ServicesAPI';
import { ForgeRunItem, ForgeRunsProvider, MillRunItem, MillRunsProvider } from './views/RunsTreeProviders';
import { ForgeRunPanel } from './views/ForgeRunPanel';

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

    const treeView = vscode.window.createTreeView('thinkube-cicd.pipelines', {
        treeDataProvider: pipelineProvider
    });

    treeView.onDidChangeVisibility(e => {
        pipelineProvider.setVisible(e.visible);
        if (e.visible) {
            pipelineProvider.refresh();
        }
    });

    context.subscriptions.push(treeView);

    // Refresh command
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.refreshPipelines', () => {
            pipelineProvider.refresh();
        })
    );

    // Show pipeline details (timeline panel). The tree's menus pass the row,
    // other callers the pipeline id; showTimeline is the same command.
    const showPipeline = async (arg: any) => {
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
    };
    context.subscriptions.push(
        vscode.commands.registerCommand('thinkube-cicd.showPipeline', showPipeline),
        vscode.commands.registerCommand('thinkube-cicd.showTimeline', showPipeline)
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

    // Mill runs and Forge runs: read while their view is visible
    const services = new ServicesAPI();
    const millProvider = new MillRunsProvider(services);
    const forgeProvider = new ForgeRunsProvider(services);
    const millView = vscode.window.createTreeView('thinkube-cicd.millRuns', { treeDataProvider: millProvider });
    const forgeView = vscode.window.createTreeView('thinkube-cicd.forgeRuns', { treeDataProvider: forgeProvider });
    millView.onDidChangeVisibility(e => millProvider.setVisible(e.visible));
    forgeView.onDidChangeVisibility(e => forgeProvider.setVisible(e.visible));
    millProvider.setVisible(millView.visible);
    forgeProvider.setVisible(forgeView.visible);

    const openExternal = (url: string) => vscode.env.openExternal(vscode.Uri.parse(url));
    const failed = (what: string) => (error: any) =>
        vscode.window.showErrorMessage(`${what} failed: ${error?.message ?? error}`);

    context.subscriptions.push(
        millView,
        forgeView,
        vscode.commands.registerCommand('thinkube-cicd.refreshMillRuns', () => millProvider.refresh()),
        vscode.commands.registerCommand('thinkube-cicd.refreshForgeRuns', () => forgeProvider.refresh()),
        // The row passes itself; the Forge run panel passes the id of a task's run of Mill
        vscode.commands.registerCommand('thinkube-cicd.viewMillRunLog', async (arg: MillRunItem | string) => {
            const runId = typeof arg === 'string' ? arg : arg.run.id;
            try {
                const log = await services.millRunLog(runId, 500);
                const uri = vscode.Uri.parse(`${LOG_SCHEME}:${runId}.log`);
                logContents.set(uri.toString(), log || '(the run printed nothing)');
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, { preview: true });
            } catch (error) {
                failed(`Reading the log of ${runId}`)(error);
            }
        }),
        vscode.commands.registerCommand('thinkube-cicd.openMillRun', (item: MillRunItem) => {
            try {
                openExternal(services.pageUrl('mill', item.run.id));
            } catch (error) {
                failed('Opening the Mill run')(error);
            }
        }),
        vscode.commands.registerCommand('thinkube-cicd.showForgeRun', (item: ForgeRunItem) => {
            ForgeRunPanel.show(services, item.run.id, item.run.name);
        }),
        vscode.commands.registerCommand('thinkube-cicd.openForgeRun', (item: ForgeRunItem) => {
            try {
                openExternal(services.pageUrl('forge', item.run.id));
            } catch (error) {
                failed('Opening the Forge run')(error);
            }
        })
    );

    // Auto-refresh on interval (runs regardless of visibility for notifications)
    const refreshInterval = vscode.workspace.getConfiguration('thinkube-cicd').get('refreshInterval', 30000);
    const refreshTimer = setInterval(() => {
        pipelineProvider.silentRefresh();
        millProvider.tick();
        forgeProvider.tick();
    }, refreshInterval);

    context.subscriptions.push({
        dispose: () => clearInterval(refreshTimer)
    });

    // Check API connection; an empty apiUrl was already reported by ControlHubAPI
    if (!controlHubAPI.isConfigured()) {
        return;
    }
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
