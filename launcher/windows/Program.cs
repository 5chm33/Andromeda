using System.Diagnostics;
using System.Text;

namespace AndromedaProjectLauncher;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        var root = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        var logDirectory = Path.Combine(root, ".andromeda", "launcher-logs");
        Directory.CreateDirectory(logDirectory);
        var logPath = Path.Combine(logDirectory, $"project-launch-{DateTime.UtcNow:yyyyMMddTHHmmssZ}.log");

        using var form = new LauncherForm(root, logPath);
        Application.Run(form);
    }
}

internal sealed class LauncherForm : Form
{
    private readonly string _root;
    private readonly string _logPath;
    private readonly Label _status;
    private readonly TextBox _output;
    private readonly Button _retry;
    private readonly Button _openLog;
    private readonly Button _openFolder;

    public LauncherForm(string root, string logPath)
    {
        _root = root;
        _logPath = logPath;

        Text = "Andromeda Launcher";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(760, 560);
        BackColor = Color.FromArgb(12, 14, 20);
        ForeColor = Color.FromArgb(235, 238, 245);
        Font = new Font("Segoe UI", 10);

        var title = new Label
        {
            Text = "Andromeda AI",
            Font = new Font("Segoe UI Semibold", 24),
            ForeColor = Color.White,
            AutoSize = true,
            Location = new Point(28, 24)
        };
        Controls.Add(title);

        var subtitle = new Label
        {
            Text = "Project-local launcher — uses the Andromeda folder beside this executable",
            ForeColor = Color.FromArgb(161, 172, 195),
            AutoSize = true,
            Location = new Point(31, 67)
        };
        Controls.Add(subtitle);

        _status = new Label
        {
            Text = "Checking local project…",
            Font = new Font("Segoe UI Semibold", 11),
            ForeColor = Color.FromArgb(121, 184, 255),
            AutoSize = true,
            Location = new Point(31, 108)
        };
        Controls.Add(_status);

        _output = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            WordWrap = false,
            BackColor = Color.FromArgb(19, 23, 34),
            ForeColor = Color.FromArgb(204, 218, 235),
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Cascadia Mono", 9),
            Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
            Location = new Point(28, 140),
            Size = new Size(690, 320)
        };
        Controls.Add(_output);

        _retry = CreateButton("Launch Andromeda", new Point(28, 482));
        _retry.Click += async (_, _) => await LaunchAsync();
        Controls.Add(_retry);

        _openLog = CreateButton("Open diagnostics", new Point(202, 482));
        _openLog.Click += (_, _) => OpenPath(_logPath);
        Controls.Add(_openLog);

        _openFolder = CreateButton("Open project folder", new Point(376, 482));
        _openFolder.Click += (_, _) => OpenPath(_root);
        Controls.Add(_openFolder);

        Shown += async (_, _) => await LaunchAsync();
    }

    private Button CreateButton(string text, Point location) => new()
    {
        Text = text,
        Location = location,
        AutoSize = true,
        FlatStyle = FlatStyle.Flat,
        BackColor = Color.FromArgb(43, 89, 165),
        ForeColor = Color.White,
        Padding = new Padding(12, 7, 12, 7),
        Cursor = Cursors.Hand
    };

    private async Task LaunchAsync()
    {
        _retry.Enabled = false;
        _status.Text = "Verifying and launching the project beside this executable…";
        _status.ForeColor = Color.FromArgb(121, 184, 255);
        _output.Clear();
        Write($"Project root: {_root}");
        Write($"Diagnostics: {_logPath}");

        if (!File.Exists(Path.Combine(_root, "package.json")))
        {
            Fail("package.json was not found beside Andromeda Launcher.exe.",
                "Keep the launcher in the root of the downloaded Andromeda project folder; do not move it into another directory by itself.");
            return;
        }
        if (!File.Exists(Path.Combine(_root, ".env.local")))
        {
            Fail(".env.local was not found in this project folder.",
                "Copy .env.local.example to .env.local, add your own API key, save it, and launch again.");
            return;
        }

        var pnpmPath = FindPnpmCommand();
        if (pnpmPath is null)
        {
            Fail("pnpm 11+ was not found for this Windows user.",
                "Install it once with: npm install -g pnpm@11.9.0. Expected locations were checked under %APPDATA%\\npm, %LOCALAPPDATA%\\pnpm, PNPM_HOME, and PATH.");
            return;
        }
        Write($"Using pnpm command: {pnpmPath}");

        try
        {
            var exitCode = await RunPnpmLaunchAsync(pnpmPath);
            if (exitCode == 0)
            {
                _status.Text = "Andromeda started successfully.";
                _status.ForeColor = Color.FromArgb(102, 212, 146);
                Write("Launcher finished successfully.");
            }
            else
            {
                Fail($"Andromeda startup exited with code {exitCode}.",
                    "The real installation or build error is shown above and saved in the diagnostic log.");
            }
        }
        catch (Exception ex)
        {
            Fail("Could not start pnpm launch.", ex.Message);
        }
        finally
        {
            _retry.Enabled = true;
        }
    }

    private string? FindPnpmCommand()
    {
        var candidates = new List<string>();
        void AddCandidate(string? directory, string fileName = "pnpm.cmd")
        {
            if (!string.IsNullOrWhiteSpace(directory)) candidates.Add(Path.Combine(directory, fileName));
        }

        // npm -g on Windows installs command shims here. Explorer-launched apps
        // do not always inherit this directory in PATH, so check it explicitly.
        AddCandidate(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm"));
        AddCandidate(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "pnpm"));
        AddCandidate(Environment.GetEnvironmentVariable("PNPM_HOME"));

        foreach (var pathEntry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            AddCandidate(pathEntry);
            AddCandidate(pathEntry, "pnpm.exe");
        }

        return candidates.FirstOrDefault(File.Exists);
    }

    private async Task<int> RunPnpmLaunchAsync(string pnpmPath)
    {
        var cmdPath = Environment.GetEnvironmentVariable("ComSpec") ?? Path.Combine(Environment.SystemDirectory, "cmd.exe");
        if (!File.Exists(cmdPath)) throw new InvalidOperationException("Windows cmd.exe could not be located.");

        var startInfo = new ProcessStartInfo
        {
            FileName = cmdPath,
            WorkingDirectory = _root,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        startInfo.ArgumentList.Add("/d");
        startInfo.ArgumentList.Add("/s");
        startInfo.ArgumentList.Add("/c");
        startInfo.ArgumentList.Add($"\"\"{pnpmPath}\" launch\"");
        startInfo.Environment["CI"] = "";

        using var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) Write(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) Write(e.Data); };
        if (!process.Start()) throw new InvalidOperationException("Windows could not start pnpm. Install pnpm 11+ and Node.js 22 LTS, then try again.");
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync();
        return process.ExitCode;
    }

    private void Fail(string heading, string detail)
    {
        _status.Text = heading;
        _status.ForeColor = Color.FromArgb(244, 112, 112);
        Write($"ERROR: {heading}");
        Write(detail);
        Write("Click Open diagnostics if you need to share the real error output.");
        _retry.Enabled = true;
    }

    private void Write(string message)
    {
        var line = $"[{DateTime.Now:HH:mm:ss}] {message}";
        if (InvokeRequired)
        {
            BeginInvoke(() => Write(message));
            return;
        }
        _output.AppendText(line + Environment.NewLine);
        File.AppendAllText(_logPath, line + Environment.NewLine);
    }

    private static void OpenPath(string path)
    {
        Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
    }
}
