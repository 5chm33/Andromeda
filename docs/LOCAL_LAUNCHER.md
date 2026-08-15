# Andromeda Project Launcher (Windows)

## What the launcher does

`Andromeda Launcher.exe` is a small, double-clickable Windows launcher designed for a **downloaded Andromeda project folder**. It does not contain a separate copy of Andromeda, does not substitute a separate configuration directory, and does not send requests with a bundled API key.

The launcher always uses the folder beside the executable. It starts that folder’s `pnpm launch` command, which installs the locked project dependencies when needed, builds the local project, and starts its Electron interface.

## Installation

1. Download or clone the Andromeda repository.
2. Install **Node.js 22 LTS** and **pnpm 11+** once on the computer.
3. Create `.env.local` in the project root from `.env.local.example` and add your own provider key.
4. Download `Andromeda Launcher.exe` from the project release.
5. Place the executable directly in the **same project-root folder** as `package.json`, `.env.local`, `launcher/`, and `scripts/`.
6. Double-click `Andromeda Launcher.exe`.

> Do not move the executable into another folder by itself. The project-folder layout is deliberate: it guarantees the launcher uses the same source code and `.env.local` that you downloaded.

## Diagnostics

The launcher displays every startup line in its window and saves a timestamped log at:

```text
<your-Andromeda-folder>\.andromeda\launcher-logs\
```

If startup fails, click **Open diagnostics** and share the final error lines—never `.env.local` or an API key.

## Command-line alternative

The launcher is only a visible wrapper around the same project-local command:

```bash
pnpm launch
```

There are no legacy `.bat` or `.vbs` wrappers. The `.exe` is the supported one-click Windows entry point.
