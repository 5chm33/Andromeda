# Local Launcher

## Recommended: one-click Windows launcher

The recommended home setup is the portable **Andromeda Launcher** Windows executable published with the project release. Download the `Andromeda-Launcher-<version>-Windows-x64.exe` asset, place it in a folder you control, and double-click it.

The executable bundles the application runtime, the required dependencies, and the prebuilt application assets. It does **not** require a separate Node.js, pnpm, Electron, `.bat`, or `.vbs` launcher installation.

On its first launch, the app creates and opens its own `.env.local` configuration file. Add a supported LLM provider key, save the file, and reopen the executable. The configuration and diagnostic logs stay in the current Windows user's application-data directory, not beside the executable.

## Diagnostics

If startup fails, click **Open diagnostics** in the launcher. It opens a timestamped log that records the startup steps and the full final process output. Never share `.env.local` or an API key when requesting help.

## Source checkout (developers only)

For contributors running a GitHub checkout rather than the portable executable:

```bash
pnpm launch
```

This development entry point requires Node.js **22 LTS or newer** and pnpm **11+**. It checks the environment, reconciles the lockfile, builds the app when needed, and then starts the same Electron launcher.

The project intentionally has no legacy `.bat` or `.vbs` startup files. They obscured dependency errors and could fall back to incompatible globally installed Electron versions.
