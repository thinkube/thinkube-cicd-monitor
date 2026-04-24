import * as vscode from 'vscode';
import { Pipeline, StageStatus } from '../models/Pipeline';
import { ControlHubAPI } from '../api/ControlHubAPI';

export class PipelineTimelinePanel {
    public static currentPanel: PipelineTimelinePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _api: ControlHubAPI;
    private _pipeline: Pipeline;
    private _refreshTimer: ReturnType<typeof setInterval> | undefined;

    public static render(extensionUri: vscode.Uri, pipeline: Pipeline, api: ControlHubAPI) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (PipelineTimelinePanel.currentPanel) {
            PipelineTimelinePanel.currentPanel._panel.reveal(column);
            PipelineTimelinePanel.currentPanel._api = api;
            PipelineTimelinePanel.currentPanel._update(pipeline);
            PipelineTimelinePanel.currentPanel._startAutoRefresh();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'pipelineTimeline',
            `Pipeline: ${pipeline.appName}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        PipelineTimelinePanel.currentPanel = new PipelineTimelinePanel(panel, extensionUri, api, pipeline);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, api: ControlHubAPI, pipeline: Pipeline) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._api = api;
        this._pipeline = pipeline;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._startAutoRefresh();

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === 'fetchLogs') {
                    try {
                        const logs = await this._api.getLogs(this._pipeline.id, message.podName, 500, message.namespace);
                        this._panel.webview.postMessage({
                            command: 'showLogs',
                            stageId: message.stageId,
                            logs: logs
                        });
                    } catch (error: any) {
                        this._panel.webview.postMessage({
                            command: 'showLogs',
                            stageId: message.stageId,
                            logs: `Failed to fetch logs: ${error.message}`
                        });
                    }
                }
            },
            null,
            this._disposables
        );

        this._update(pipeline);
    }

    public dispose() {
        PipelineTimelinePanel.currentPanel = undefined;
        this._stopAutoRefresh();
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _startAutoRefresh() {
        this._stopAutoRefresh();
        this._refreshTimer = setInterval(async () => {
            if (!this._pipeline) { return; }
            try {
                const updated = await this._api.getPipeline(this._pipeline.id);
                if (updated) {
                    this._update(updated);
                    if (updated.status !== 'RUNNING' && updated.status !== 'PENDING') {
                        this._stopAutoRefresh();
                    }
                }
            } catch {
                // Silently skip failed refresh
            }
        }, 5000);
    }

    private _stopAutoRefresh() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = undefined;
        }
    }

    private _update(pipeline: Pipeline) {
        this._pipeline = pipeline;
        this._panel.title = `Pipeline: ${pipeline.appName}`;
        this._panel.webview.html = this._getHtmlForWebview(pipeline);
    }

    private _getHtmlForWebview(pipeline: Pipeline) {
        const customTimeline = this._generateCustomTimeline(pipeline);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pipeline Timeline</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
        }
        .header { margin-bottom: 30px; }
        .header h1 { margin: 0 0 10px 0; display: flex; align-items: center; gap: 10px; }
        .status { padding: 4px 8px; border-radius: 4px; font-size: 14px; font-weight: normal; }
        .status.SUCCEEDED { background-color: var(--vscode-testing-iconPassed); color: white; }
        .status.FAILED { background-color: var(--vscode-testing-iconFailed); color: white; }
        .status.RUNNING { background-color: var(--vscode-progressBar-background); color: white; }
        .metadata { color: var(--vscode-descriptionForeground); font-size: 14px; }
        .timeline-container {
            margin: 40px 0; padding: 20px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px; overflow-x: auto;
        }
        .timeline-chart { display: flex; flex-direction: column; gap: 4px; min-width: 800px; }
        .timeline-row { display: flex; align-items: center; height: 24px; position: relative; }
        .timeline-label {
            width: 140px; padding-right: 15px; text-align: right; font-weight: 500;
            color: var(--vscode-foreground); flex-shrink: 0; font-size: 13px;
        }
        .timeline-bar-container {
            flex: 1; position: relative; height: 20px;
            background: var(--vscode-editor-lineHighlightBackground); border-radius: 3px;
        }
        .timeline-bar {
            position: absolute; height: 100%; border-radius: 3px;
            display: flex; align-items: center; justify-content: center;
            padding: 0 4px; color: white; font-size: 11px; font-weight: 500;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: transform 0.2s;
            overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 20px;
            cursor: pointer;
        }
        .timeline-bar:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.2); }
        .timeline-bar.workflow { background: #5DADE2; border: 1px solid #3498DB; }
        .timeline-bar.deployment { background: #82E0AA; border: 1px solid #58D68D; }
        .timeline-bar.other { background: #F8C471; border: 1px solid #F39C12; }
        .timeline-bar.failed { background: #ff6b6b; border: 1px solid #ff4444; }
        .timeline-time-axis {
            display: flex; margin-top: 8px; padding-left: 155px;
            color: var(--vscode-descriptionForeground); font-size: 10px;
        }
        .timeline-time-marker { flex: 1; text-align: left; }
        .event-details { margin-top: 30px; border-top: 1px solid var(--vscode-widget-border); padding-top: 20px; }
        .event-item {
            padding: 10px; margin-bottom: 10px;
            background-color: var(--vscode-editor-lineHighlightBackground);
            border-radius: 4px; cursor: pointer;
        }
        .event-item:hover { background-color: var(--vscode-list-hoverBackground); }
        .event-time { color: var(--vscode-descriptionForeground); font-size: 12px; }
        .log-panel {
            margin-top: 10px; padding: 10px;
            background-color: var(--vscode-terminal-background, var(--vscode-editor-background));
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px; display: none; max-height: 400px; overflow: auto;
        }
        .log-panel.show { display: block; }
        .log-panel pre {
            margin: 0; white-space: pre-wrap; font-size: 12px;
            font-family: var(--vscode-editor-fontFamily, monospace);
            color: var(--vscode-terminal-foreground, var(--vscode-foreground));
        }
        .log-btn {
            margin-top: 6px; padding: 4px 10px; font-size: 12px;
            background: var(--vscode-button-background); color: var(--vscode-button-foreground);
            border: none; border-radius: 3px; cursor: pointer;
        }
        .log-btn:hover { background: var(--vscode-button-hoverBackground); }
        .log-btn:disabled { opacity: 0.5; cursor: default; }
    </style>
</head>
<body>
    <div class="header">
        <h1>
            ${pipeline.appName}
            <span class="status ${pipeline.status}">${pipeline.status}</span>
        </h1>
        <div class="metadata">
            <div>Started: ${new Date(pipeline.startTime * 1000).toLocaleString()}</div>
            ${pipeline.endTime ? `<div>Ended: ${new Date(pipeline.endTime * 1000).toLocaleString()}</div>` : ''}
            ${pipeline.duration ? `<div>Duration: ${Math.round(pipeline.duration)}s</div>` : ''}
            <div>Trigger: ${pipeline.trigger.type}${pipeline.trigger.user ? ` by ${pipeline.trigger.user}` : ''}</div>
        </div>
    </div>

    <div class="timeline-container">
        ${customTimeline}
    </div>

    <div class="event-details">
        <h2>Stage Details</h2>
        ${pipeline.stages.sort((a, b) => a.startedAt - b.startedAt).map(stage => `
            <div class="event-item" id="event-${stage.id}">
                <div style="display: flex; justify-content: space-between;">
                    <strong>${stage.stageName}</strong>
                    <span class="event-time">${new Date(stage.startedAt * 1000).toLocaleTimeString()}</span>
                </div>
                <div>Component: ${stage.component} | Status: ${stage.status} | Duration: ${stage.duration !== null && stage.duration !== undefined && stage.duration >= 0 ? Math.round(stage.duration) + 's' : 'Running'}</div>
                ${stage.errorMessage ? `<div style="color: var(--vscode-errorForeground);">Error: ${stage.errorMessage}</div>` : ''}
                ${stage.podName ? `<button class="log-btn" id="btn-${stage.id}" onclick="fetchLogs('${stage.id}', '${stage.podName}', '${stage.details?.namespace || ''}')">View Logs</button>` : ''}
                <div class="log-panel" id="logs-${stage.id}">
                    <pre id="logs-content-${stage.id}">Loading...</pre>
                </div>
            </div>
        `).join('')}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function fetchLogs(stageId, podName, namespace) {
            const btn = document.getElementById('btn-' + stageId);
            const panel = document.getElementById('logs-' + stageId);

            if (panel.classList.contains('show')) {
                panel.classList.remove('show');
                btn.textContent = 'View Logs';
                return;
            }

            btn.disabled = true;
            btn.textContent = 'Loading...';
            panel.classList.add('show');

            const msg = {
                command: 'fetchLogs',
                stageId: stageId,
                podName: podName
            };
            if (namespace) { msg.namespace = namespace; }
            vscode.postMessage(msg);
        }

        function scrollToEvent(eventId) {
            const element = document.getElementById('event-' + eventId);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                element.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground)';
                setTimeout(() => { element.style.backgroundColor = ''; }, 2000);
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'showLogs') {
                const content = document.getElementById('logs-content-' + message.stageId);
                const btn = document.getElementById('btn-' + message.stageId);
                if (content) {
                    content.textContent = message.logs;
                }
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Hide Logs';
                }
            }
        });
    </script>
</body>
</html>`;
    }

    private _generateCustomTimeline(pipeline: Pipeline) {
        if (pipeline.stages.length === 0) {
            return '<div style="text-align: center; color: var(--vscode-descriptionForeground);">No stages to display</div>';
        }

        const sortedStages = [...pipeline.stages].sort((a, b) => a.startedAt - b.startedAt);

        const minTime = sortedStages[0].startedAt;
        const maxTime = Math.max(...sortedStages.map(s => s.completedAt || Math.floor(Date.now() / 1000)));
        const totalDuration = maxTime - minTime;

        let timeline = '<div class="timeline-chart">';

        sortedStages.forEach((stage) => {
            const startOffset = totalDuration > 0 ? ((stage.startedAt - minTime) / totalDuration) * 100 : 0;
            const endTime = stage.completedAt || Math.floor(Date.now() / 1000);
            const duration = endTime - stage.startedAt;
            const width = totalDuration > 0 ? (duration / totalDuration) * 100 : 100;

            const stageLower = stage.stageName.toLowerCase();
            let taskType = 'other';
            if (stageLower.includes('deploy') || stageLower.includes('argocd') || stageLower.includes('sync')) {
                taskType = 'deployment';
            } else if (stageLower.includes('build') || stageLower.includes('test')) {
                taskType = 'workflow';
            }

            const statusClass = stage.status === StageStatus.FAILED ? 'failed' : taskType;
            const displayWidth = Math.max(width, 0.5);
            const showText = width > 3;
            const durationText = duration < 1 ? '<1s' : Math.round(duration) + 's';

            timeline += `
                <div class="timeline-row">
                    <div class="timeline-label">${stage.stageName.replace(/_/g, ' ')}</div>
                    <div class="timeline-bar-container">
                        <div class="timeline-bar ${statusClass}"
                             style="left: ${startOffset}%; width: ${displayWidth}%;"
                             onclick="scrollToEvent('${stage.id}')"
                             title="${stage.stageName}: ${durationText}">
                            ${showText ? durationText : ''}
                        </div>
                    </div>
                </div>
            `;
        });

        timeline += `
            <div class="timeline-time-axis">
                <div class="timeline-time-marker">0s</div>
                <div class="timeline-time-marker" style="text-align: center">${Math.round(totalDuration / 2)}s</div>
                <div class="timeline-time-marker" style="text-align: right">${Math.round(totalDuration)}s</div>
            </div>
        `;

        timeline += '</div>';
        return timeline;
    }
}
