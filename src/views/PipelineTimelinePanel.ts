import * as vscode from 'vscode';
import { Pipeline, StageStatus } from '../models/Pipeline';

export class PipelineTimelinePanel {
    public static currentPanel: PipelineTimelinePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static render(extensionUri: vscode.Uri, pipeline: Pipeline) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (PipelineTimelinePanel.currentPanel) {
            PipelineTimelinePanel.currentPanel._panel.reveal(column);
            PipelineTimelinePanel.currentPanel._update(pipeline);
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

        PipelineTimelinePanel.currentPanel = new PipelineTimelinePanel(panel, extensionUri);
        PipelineTimelinePanel.currentPanel._update(pipeline);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public dispose() {
        PipelineTimelinePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update(pipeline: Pipeline) {
        this._panel.title = `Pipeline: ${pipeline.appName}`;
        this._panel.webview.html = this._getHtmlForWebview(pipeline);
    }

    private _getHtmlForWebview(pipeline: Pipeline) {
        const styleUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'timeline.css')
        );

        // Generate custom timeline
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
        .header {
            margin-bottom: 30px;
        }
        .header h1 {
            margin: 0 0 10px 0;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .status {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 14px;
            font-weight: normal;
        }
        .status.success {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
        }
        .status.failed {
            background-color: var(--vscode-testing-iconFailed);
            color: white;
        }
        .status.running {
            background-color: var(--vscode-progressBar-background);
            color: white;
        }
        .metadata {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }
        .timeline-container {
            margin: 40px 0;
            padding: 20px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            overflow-x: auto;
        }
        .timeline-chart {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 800px;
        }
        .timeline-row {
            display: flex;
            align-items: center;
            height: 24px;
            position: relative;
        }
        .timeline-label {
            width: 140px;
            padding-right: 15px;
            text-align: right;
            font-weight: 500;
            color: var(--vscode-foreground);
            flex-shrink: 0;
            font-size: 13px;
        }
        .timeline-bar-container {
            flex: 1;
            position: relative;
            height: 20px;
            background: var(--vscode-editor-lineHighlightBackground);
            border-radius: 3px;
        }
        .timeline-bar {
            position: absolute;
            height: 100%;
            border-radius: 3px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0 4px;
            color: white;
            font-size: 11px;
            font-weight: 500;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            transition: transform 0.2s;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            min-width: 20px;
        }
        .timeline-bar:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            cursor: pointer;
        }
        .timeline-bar.workflow {
            background: #5DADE2;
            border: 1px solid #3498DB;
        }
        .timeline-bar.deployment {
            background: #82E0AA;
            border: 1px solid #58D68D;
        }
        .timeline-bar.other {
            background: #F8C471;
            border: 1px solid #F39C12;
        }
        .timeline-bar.failed {
            background: #ff6b6b;
            border: 1px solid #ff4444;
        }
        .timeline-time-axis {
            display: flex;
            margin-top: 8px;
            padding-left: 155px;
            color: var(--vscode-descriptionForeground);
            font-size: 10px;
        }
        .timeline-time-marker {
            flex: 1;
            text-align: left;
        }
        .event-details {
            margin-top: 30px;
            border-top: 1px solid var(--vscode-widget-border);
            padding-top: 20px;
        }
        .event-item {
            padding: 10px;
            margin-bottom: 10px;
            background-color: var(--vscode-editor-lineHighlightBackground);
            border-radius: 4px;
            cursor: pointer;
        }
        .event-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .event-time {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .event-details-panel {
            margin-top: 10px;
            padding: 10px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
            display: none;
        }
        .event-details-panel.show {
            display: block;
        }
        pre {
            margin: 0;
            white-space: pre-wrap;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>
            ${pipeline.appName}
            <span class="status ${pipeline.status}">${pipeline.status.toUpperCase()}</span>
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
        ${pipeline.stages.sort((a, b) => a.startedAt - b.startedAt).map((stage, index) => `
            <div class="event-item" id="event-${stage.id}" onclick="toggleDetails('${stage.id}')">
                <div style="display: flex; justify-content: space-between;">
                    <strong>${stage.stageName}</strong>
                    <span class="event-time">${new Date(stage.startedAt * 1000).toLocaleTimeString()}</span>
                </div>
                <div>Component: ${stage.component} | Status: ${stage.status} | Duration: ${stage.duration !== null && stage.duration !== undefined && stage.duration >= 0 ? Math.round(stage.duration) + 's' : 'Running'}</div>
                ${stage.errorMessage ? `<div style="color: var(--vscode-errorForeground);">Error: ${stage.errorMessage}</div>` : ''}
                <div class="event-details-panel" id="details-${stage.id}">
                    <pre>${JSON.stringify(stage.details || {}, null, 2)}</pre>
                </div>
            </div>
        `).join('')}
    </div>

    <script>
        function toggleDetails(eventId) {
            const panel = document.getElementById('details-' + eventId);
            panel.classList.toggle('show');
        }

        function scrollToEvent(eventId) {
            const element = document.getElementById('event-' + eventId);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                element.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground)';
                setTimeout(() => {
                    element.style.backgroundColor = '';
                }, 2000);
            }
        }
    </script>
</body>
</html>`;
    }

    private _generateCustomTimeline(pipeline: Pipeline) {
        if (pipeline.stages.length === 0) {
            return '<div style="text-align: center; color: var(--vscode-descriptionForeground);">No stages to display</div>';
        }

        // Sort stages by start time
        const sortedStages = [...pipeline.stages].sort((a, b) => a.startedAt - b.startedAt);
        
        // Calculate total duration and find min/max times
        const minTime = sortedStages[0].startedAt;
        const maxTime = Math.max(...sortedStages.map(s => s.completedAt || Math.floor(Date.now() / 1000)));
        const totalDuration = maxTime - minTime;
        
        // Generate timeline bars
        let timeline = '<div class="timeline-chart">';
        
        sortedStages.forEach((stage) => {
            const startOffset = ((stage.startedAt - minTime) / totalDuration) * 100;
            const endTime = stage.completedAt || Math.floor(Date.now() / 1000);
            const duration = endTime - stage.startedAt;
            const width = (duration / totalDuration) * 100;
            
            // Determine task type and status
            const stageLower = stage.stageName.toLowerCase();
            let taskType = 'other';
            if (stageLower.includes('deploy') || stageLower.includes('argocd') || stageLower.includes('sync')) {
                taskType = 'deployment';
            } else if (stageLower.includes('build') || stageLower.includes('test')) {
                taskType = 'workflow';
            }
            // workflow_triggered should be orange (other), not blue
            
            const statusClass = stage.status === StageStatus.FAILED ? 'failed' : taskType;
            
            // For very short tasks, use actual width but ensure visibility
            const displayWidth = Math.max(width, 0.5); // At least 0.5% to be visible
            
            // Only show text in bars that are wide enough (> 3% of total width)
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
        
        // Add time axis
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