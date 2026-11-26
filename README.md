# thinkube-cicd-monitor

A VS Code extension that shows, from thinkube-control, the build pipelines of Thinkube apps with their timeline and logs, the runs of Mill with their logs, and the runs of Forge with their training loss.

## What it does

- **Pipelines view.** The *Thinkube CI/CD* icon in the activity bar opens the
  *Pipelines* view. It lists the 20 most recent pipelines, one row per app
  build. A click on a pipeline row opens its timeline panel. A pipeline row
  opens to show its stages, each with its status and duration. With no pipelines, the view says "No pipelines running." and
  offers *Refresh*.
- **Timeline panel.** *Show Pipeline Details* opens a panel for one pipeline:
  its status, start and end time, duration and trigger; a timeline of its
  stages; and each stage's component, status, duration and error message. A
  stage that ran in a pod has a *View Logs* button. While the pipeline is
  pending or running, the panel reloads it every 5 seconds.
- **Stage logs.** *View Step Logs* on a stage opens the last 500 lines of
  that stage's pod log as a read-only document.
- **Notifications.** The extension reads the pipeline list on a timer, even
  when the view is hidden. When a pipeline that was pending or running
  finishes, it shows a notification. A failed pipeline's notification has
  *View Details*, which opens the timeline panel.
- **Mill Runs view.** The 30 newest runs of Mill tasks, wherever they ran:
  task, state, time taken, start and node. A row opens to show the run's
  stages with how many items each has done. A click on a row, or *View Run
  Log*, opens the last 500 lines the run printed; *Open in Thinkube Control*
  opens the run's page there.
- **Forge Runs view.** The 30 newest runs of Forge, fine-tunes and tasks:
  status, the step and loss of a training that runs, or the time a finished
  one took. A click on a row opens the run's panel: its status, node, base
  model, method, step, time left, and a chart of its training loss by step
  from MLflow, raw and smoothed, with its eval loss when the run has one.
  The panel reads the run every 15 seconds until it is completed, failed or
  cancelled. A task run has no loss: it reports to Mill, and its panel opens
  its run of Mill.
- **Token check.** At start the extension checks that it can reach the API.
  When no API token starting with `tk_` is set, it asks for one.

It reads everything from thinkube-control's CI/CD API, under
`<apiUrl>/api/v1/cicd`: `/pipelines`, `/pipelines/{id}`,
`/pipelines/{id}/logs/{pod}` and `/health`. Each request carries the API
token as a bearer token. The Mill Runs and Forge Runs views read Mill at
`mill.<domain>` (`/api/v1/runs`, `/api/v1/runs/{id}/log`) and Forge at
`forge.<domain>` (`/api/v1/runs`, `/api/v1/runs/{id}`,
`/api/v1/runs/{id}/progress`), the domain of `thinkube-cicd.apiUrl`, with the
same token. They read only while they are visible.

## How it reaches a user

It is built into every code-server workspace. The code-server playbook of
[Thinkube](https://github.com/thinkube/thinkube)
(`ansible/40_thinkube/core/code-server/15_configure_environment.yaml`)
clones this repository, runs `scripts/deploy.sh --no-bump`, and code-server
installs the extension. The platform writes its settings into the IDE:
`thinkube-cicd.apiUrl` (`https://control.<domain>`), the refresh interval
and notification settings (`code-server/templates/vscode-settings.json.j2`),
and `thinkube-cicd.apiToken`
(`thinkube-control/13_configure_code_server.yaml`). It is not installed on
its own.

## Commands

All commands are in the category *Thinkube CI/CD*.

| Command | What it does |
|---|---|
| Show Pipeline Details | Opens the timeline panel for a pipeline. Inline on a pipeline row. |
| Refresh Pipelines | Reads the pipeline list again. In the view's title bar. |
| Show Pipeline Timeline | Opens the timeline panel for the pipeline id it is given. In a pipeline row's menu. |
| View Step Logs | Opens the last 500 lines of a stage's pod log. Inline on a stage row. |
| Refresh Mill Runs / Refresh Forge Runs | Reads that view's runs again. In the view's title bar. |
| View Run Log | Opens the last 500 lines a Mill run printed. Inline on a Mill run row. |
| Show Forge Run | Opens the panel of a Forge run, with its loss chart. Inline on a Forge run row. |
| Open in Thinkube Control | Opens the run's page in Thinkube Control. Inline on a Mill or Forge run row. |
| Configure API Token | Asks for a thinkube-control API token (`tk_…`) and saves it in the user settings as `thinkube-cicd.apiToken`. |

## Settings

| Setting | Type | Meaning |
|---|---|---|
| `thinkube-cicd.apiUrl` | string | Address of thinkube-control. Required, with no default: when it is empty the extension shows an error and makes no requests. The platform sets it to `https://control.<domain>`. |
| `thinkube-cicd.apiToken` | string | thinkube-control API token. Only a value starting with `tk_` is sent. |
| `thinkube-cicd.refreshInterval` | number | How often, in milliseconds, the pipeline list is read. Default 5000. Read when the extension starts. |
| `thinkube-cicd.showNotifications` | boolean | Show notifications when a pipeline finishes. Default `true`. |
| `thinkube-cicd.notificationLevel` | `all`, `failures`, `none` | `all`: success, failure and cancel. `failures`: failures only. `none`: no notifications. |

The Thinkube Notebook View extension uses `thinkube-cicd.apiUrl` and
`thinkube-cicd.apiToken` when its own settings are empty.

## Working on it

The source is TypeScript compiled with `tsc` to `dist/`. `src/extension.ts`
registers the view and the commands; `src/api/ControlHubAPI.ts` calls the
API; `src/views/PipelineTreeProvider.ts` is the *Pipelines* view and the
notifications; `src/views/PipelineTimelinePanel.ts` is the timeline panel;
`src/api/ServicesAPI.ts` calls Mill and Forge; `src/views/RunsTreeProviders.ts`
is the *Mill Runs* and *Forge Runs* views; `src/views/ForgeRunPanel.ts` is a
Forge run's panel and its loss chart.

```bash
npm run deploy                 # bump the patch version, build, package, install, commit and push
npm run deploy -- --no-bump    # install the version in package.json
```

`npm run deploy` runs `scripts/deploy.sh`, the same script in every Thinkube
extension. It needs the Node major version named in `.nvmrc`. The playbook
refuses to install a repository whose copy differs from the master copy in
the Thinkube repository.

## License

Apache License 2.0 - See [LICENSE](LICENSE)

## Copyright

Copyright Alejandro Martínez Corriá and the Thinkube contributors
