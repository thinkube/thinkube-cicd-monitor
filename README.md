# Thinkube CI/CD Monitor

Real-time CI/CD pipeline monitoring extension for code-server within the Thinkube platform.

## Features

### Pipeline Monitoring
- **Real-time Updates**: WebSocket connection for instant pipeline event notifications
- **Pipeline Tree View**: Hierarchical view of running and recent pipelines
- **Event Stream**: Live feed of CI/CD events across all applications
- **Visual Timeline**: Interactive timeline showing pipeline stages and durations
- **Global Event Monitoring**: Single WebSocket connection monitors all pipelines
- **Automatic Reconnection**: Resilient connection handling with exponential backoff

### Pipeline Analysis
- **Performance Metrics**: Track build times, success rates, and deployment frequency
- **Bottleneck Detection**: Identify slow stages in your pipeline
- **Failure Analysis**: Understand why pipelines fail with detailed error information
- **Trend Analysis**: Monitor pipeline performance over time

### Notifications
- **Smart Notifications**: Configurable alerts for pipeline events
- **Failure Alerts**: Immediate notification when pipelines fail
- **Success Confirmations**: Optional notifications for successful deployments

## Installation

### From Open VSX Registry
```bash
# Once published to Open VSX
code-server --install-extension thinkube.thinkube-cicd-monitor
```

### From VSIX File
```bash
code-server --install-extension thinkube-cicd-monitor-1.0.0.vsix
```

### From Source
```bash
cd thinkube-cicd-monitor
npm install
npm run compile
npm run package
code-server --install-extension thinkube-cicd-monitor-1.0.0.vsix
```

## Configuration

### Extension Settings

- `thinkube-cicd.apiUrl`: CI/CD Monitor API server URL (default: `https://cicd-monitor.thinkube.com`)
- `thinkube-cicd.defaultApp`: Default application to monitor
- `thinkube-cicd.refreshInterval`: Refresh interval in milliseconds (default: 5000)
- `thinkube-cicd.showNotifications`: Show notifications for pipeline events (default: true)
- `thinkube-cicd.notificationLevel`: Level of notifications - `all`, `failures`, `none` (default: `failures`)
- `thinkube-cicd.kubeconfig`: Path to kubeconfig file (leave empty for in-cluster config)

## Usage

### Views

1. **Pipelines View**: Shows active and recent pipelines
   - Click on a pipeline to see its timeline
   - Expand pipelines to see individual stages
   - Right-click for additional actions

2. **Events View**: Shows recent pipeline events
   - Real-time event feed
   - Click events to jump to pipeline

### Commands

- `Thinkube CI/CD: Show Pipeline Details` - Display detailed pipeline timeline
- `Thinkube CI/CD: Refresh Pipelines` - Manually refresh pipeline list
- `Thinkube CI/CD: Show Pipeline Timeline` - Visual timeline of pipeline execution
- `Thinkube CI/CD: Trigger Build` - Start a new build for an application
- `Thinkube CI/CD: Show Pipeline Metrics` - View performance metrics
- `Thinkube CI/CD: Configure CI/CD Monitor` - Configure extension settings
- `Thinkube CI/CD: Analyze Pipeline Performance` - Detailed performance analysis

## Architecture

### Event Collection

The extension monitors Kubernetes ConfigMaps in the `cicd-monitor` namespace to track pipeline events. Events are stored as JSON and include:

- Pipeline metadata (ID, app name, trigger)
- Event timeline with timestamps
- Status information
- Error details for failures

### Real-time Updates

- WebSocket connection to monitoring API for instant updates
- Kubernetes watch API for ConfigMap changes
- Automatic reconnection on connection loss

### Data Model

```typescript
interface Pipeline {
    id: string;
    appName: string;
    startTime: number;
    endTime?: number;
    status: PipelineStatus;
    events: PipelineEvent[];
    trigger: PipelineTrigger;
}

interface PipelineEvent {
    id: string;
    timestamp: number;
    eventType: EventType;
    component: string;
    status: EventStatus;
    details: any;
    error?: string;
}
```

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Package extension
npm run package
```

### Project Structure

```
thinkube-cicd-monitor/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── api/                  # API clients
│   │   ├── K8sClient.ts     # Kubernetes API
│   │   ├── PipelineMonitor.ts
│   │   └── EventStream.ts   # WebSocket client
│   ├── models/              # Data models
│   │   └── Pipeline.ts
│   └── views/              # UI components
│       ├── PipelineTreeProvider.ts
│       ├── EventsTreeProvider.ts
│       └── PipelineTimelinePanel.ts
├── media/                   # Icons and styles
├── package.json
├── tsconfig.json
└── README.md
```

## Requirements

- code-server 1.100.0 or higher (as deployed in Thinkube)
- Access to Thinkube Kubernetes cluster
- CI/CD monitoring API deployed (optional for enhanced features)

## Troubleshooting

### Connection Issues
- Verify kubeconfig path in settings
- Check network access to Kubernetes API
- Ensure proper RBAC permissions

### Missing Events
- Verify cicd-monitor namespace exists
- Check ConfigMap labels match expected values
- Ensure event collectors are running

## Future Enhancements

- Pipeline comparison tools
- Build artifact browser
- Log streaming integration
- Cost analysis per pipeline
- Integration with Thinkube AI for intelligent insights

## License

Apache License 2.0 - Same as the Thinkube project

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🤖 AI-Assisted Development

This extension was developed with assistance from Claude AI as part of the Thinkube project.