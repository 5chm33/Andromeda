# Local Launcher

Andromeda has one supported local startup command:

```bash
pnpm launch
```

The launcher is responsible for verifying the local environment, installing dependencies when they are absent, building the application, and opening the Electron launcher.

## Requirements

| Requirement | Supported configuration |
|---|---|
| Node.js | **22 LTS or newer**; Node 22 LTS is recommended for repeatable native-dependency installs |
| pnpm | **11+**; install with `npm install -g pnpm@11.9.0` if needed |
| Configuration | Copy `.env.local.example` to `.env.local`, then set at least one supported LLM provider key |

## Windows first run

Open **Command Prompt** in the repository folder and run:

```bat
npm install -g pnpm@11.9.0
pnpm launch
```

The first run can take several minutes because it installs the JavaScript packages and native dependencies. Do not close the terminal while installation or building is in progress.

## Diagnostics

The launcher writes a timestamped log for every local startup attempt:

```text
.andromeda\launcher-logs\launch-<timestamp>.log
```

If setup fails, the Electron launcher exposes **Open diagnostics**. When requesting help, share the final 30–60 log lines but never share `.env.local`, API keys, or other secrets.

## Supported entry points

The supported entry point is `pnpm launch`. The repository no longer contains legacy `.bat` or `.vbs` launchers because they hid dependency-install errors and could silently fall back to incompatible global Electron installations.
