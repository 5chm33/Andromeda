/**
 * sweBenchMultilingualSupport.ts — Language-neutral support for SWE-bench Multilingual
 *
 * Provides:
 *   - Language detection from repo name and FAIL_TO_PASS test format
 *   - Language-aware file extension policy for source discovery
 *   - Test-command inference from FAIL_TO_PASS format and repo language
 *   - Structured unsupported_language outcome for unrecognized repos
 *
 * This module replaces the Python-only assumptions in run_swebench.ts and
 * sweBenchContextBuilder.ts when SWEBENCH_DATASET_NAME contains "Multilingual".
 */

export type SupportedLanguage =
  | 'python'
  | 'java'
  | 'rust'
  | 'go'
  | 'javascript'
  | 'typescript'
  | 'ruby'
  | 'php'
  | 'c'
  | 'cpp'
  | 'c_python'  // C with Python bindings (micropython)
  | 'unknown';

export interface LanguageProfile {
  language: SupportedLanguage;
  /** File extensions to include in source discovery (git ls-files patterns) */
  extensions: string[];
  /** Primary test runner command template. {tests} = space-joined test IDs */
  testCommandTemplate: string;
  /** Whether the test runner is supported in the current harness */
  supported: boolean;
  /** Human-readable note for unsupported paths */
  supportNote?: string;
}

// ─── Repo → Language mapping ──────────────────────────────────────────────────

const REPO_LANGUAGE_MAP: Record<string, SupportedLanguage> = {
  // Java
  'apache/druid': 'java', 'apache/lucene': 'java',
  'google/gson': 'java', 'google/guava': 'java',
  'projectlombok/lombok': 'java', 'javaparser/javaparser': 'java',
  'reactivex/rxjava': 'java',
  // Rust
  'tokio-rs/tokio': 'rust', 'tokio-rs/axum': 'rust',
  'astral-sh/ruff': 'rust', 'sharkdp/bat': 'rust',
  'BurntSushi/ripgrep': 'rust', 'burntsushi/ripgrep': 'rust',
  'rust-lang/rust': 'rust', 'serde-rs/serde': 'rust',
  'launchbadge/sqlx': 'rust', 'nickel-lang/nickel': 'rust',
  'nushell/nushell': 'rust', 'uutils/coreutils': 'rust',
  // PHP
  'laravel/framework': 'php', 'briannesbitt/carbon': 'php',
  'php-cs-fixer/php-cs-fixer': 'php', 'phpoffice/phpspreadsheet': 'php',
  'sebastianbergmann/phpunit': 'php', 'symfony/symfony': 'php',
  // Ruby
  'rubocop/rubocop': 'ruby', 'fastlane/fastlane': 'ruby',
  'fluent/fluentd': 'ruby', 'rails/rails': 'ruby',
  'rubygems/rubygems': 'ruby', 'ruby/ruby': 'ruby',
  'jekyll/jekyll': 'ruby', 'faker-ruby/faker': 'ruby',
  'jordansissel/fpm': 'ruby',
  // Go
  'caddyserver/caddy': 'go', 'gin-gonic/gin': 'go',
  'prometheus/prometheus': 'go', 'golang/go': 'go',
  'kubernetes/kubernetes': 'go', 'moby/moby': 'go',
  'gohugoio/hugo': 'go', 'hashicorp/terraform': 'go',
  // JavaScript
  'preactjs/preact': 'javascript', 'expressjs/express': 'javascript',
  'facebook/jest': 'javascript', 'lodash/lodash': 'javascript',
  'moment/moment': 'javascript', 'nodejs/node': 'javascript',
  'axios/axios': 'javascript', 'babel/babel': 'javascript',
  'facebook/docusaurus': 'javascript', 'vuejs/core': 'javascript',
  'mrdoob/three.js': 'javascript', 'immutable-js/immutable-js': 'javascript',
  // C
  'redis/redis': 'c', 'jqlang/jq': 'c',
  'FFmpeg/FFmpeg': 'c', 'git/git': 'c',
  'libgit2/libgit2': 'c', 'openssl/openssl': 'c',
  'valkey-io/valkey': 'c',
  // C++
  'fmtlib/fmt': 'cpp', 'llvm/llvm-project': 'cpp',
  'nlohmann/json': 'cpp',
  // TypeScript
  'microsoft/TypeScript': 'typescript', 'denoland/deno': 'typescript',
  // C/Python
  'micropython/micropython': 'c_python',
};

// ─── Language profiles ────────────────────────────────────────────────────────

const LANGUAGE_PROFILES: Record<SupportedLanguage, LanguageProfile> = {
  python: {
    language: 'python',
    extensions: ['*.py'],
    testCommandTemplate: 'python -m pytest {tests} -x --no-header -rN -q',
    supported: true,
  },
  java: {
    language: 'java',
    extensions: ['*.java'],
    testCommandTemplate: 'mvn test -pl . -Dtest={tests} -q 2>&1 | tail -20',
    supported: true,
  },
  rust: {
    language: 'rust',
    extensions: ['*.rs'],
    testCommandTemplate: 'cargo test {tests} 2>&1 | tail -30',
    supported: true,
  },
  go: {
    language: 'go',
    extensions: ['*.go'],
    testCommandTemplate: 'go test ./... -run {tests} -v 2>&1 | tail -30',
    supported: true,
  },
  javascript: {
    language: 'javascript',
    extensions: ['*.js', '*.mjs', '*.cjs'],
    testCommandTemplate: 'npm test -- --testPathPattern="{tests}" 2>&1 | tail -30',
    supported: true,
  },
  typescript: {
    language: 'typescript',
    extensions: ['*.ts', '*.tsx'],
    testCommandTemplate: 'npm test -- --testPathPattern="{tests}" 2>&1 | tail -30',
    supported: true,
  },
  ruby: {
    language: 'ruby',
    extensions: ['*.rb'],
    testCommandTemplate: 'bundle exec ruby -Itest {tests} 2>&1 | tail -30',
    supported: true,
  },
  php: {
    language: 'php',
    extensions: ['*.php'],
    testCommandTemplate: 'vendor/bin/phpunit {tests} 2>&1 | tail -30',
    supported: true,
  },
  c: {
    language: 'c',
    extensions: ['*.c', '*.h'],
    testCommandTemplate: 'make test 2>&1 | tail -30',
    supported: true,
  },
  cpp: {
    language: 'cpp',
    extensions: ['*.cpp', '*.cc', '*.cxx', '*.h', '*.hpp'],
    testCommandTemplate: 'cmake --build . --target test 2>&1 | tail -30',
    supported: true,
  },
  c_python: {
    language: 'c_python',
    extensions: ['*.c', '*.h', '*.py'],
    testCommandTemplate: 'python -m pytest {tests} -x --no-header -rN -q',
    supported: true,
  },
  unknown: {
    language: 'unknown',
    extensions: [],
    testCommandTemplate: '',
    supported: false,
    supportNote: 'Repository language not recognized. Cannot perform source discovery.',
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect the language of a repository from its name.
 * Falls back to heuristic detection from FAIL_TO_PASS test format.
 */
export function detectLanguage(repo: string, failToPass?: string): SupportedLanguage {
  // Direct lookup
  const direct = REPO_LANGUAGE_MAP[repo];
  if (direct) return direct;

  // Case-insensitive lookup
  const lower = repo.toLowerCase();
  for (const [key, lang] of Object.entries(REPO_LANGUAGE_MAP)) {
    if (key.toLowerCase() === lower) return lang;
  }

  // Heuristic: infer from FAIL_TO_PASS test format
  if (failToPass) {
    // Java: org.foo.bar.ClassName#methodName
    if (/[a-z]+\.[a-z]+\.[A-Z]\w+#\w+/.test(failToPass)) return 'java';
    // Rust: crate::module::test_name
    if (/\w+::\w+::\w+/.test(failToPass)) return 'rust';
    // Go: TestFunctionName or BenchmarkName
    if (/^Test[A-Z]\w+$/.test(failToPass.split(',')[0]?.trim() ?? '')) return 'go';
    // Ruby: test_method_name (snake_case)
    if (/^test_[a-z_]+$/.test(failToPass.split(',')[0]?.trim() ?? '')) return 'ruby';
    // PHP: ClassName::testMethodName
    if (/[A-Z]\w+::[a-z]\w+/.test(failToPass)) return 'php';
  }

  return 'unknown';
}

/**
 * Get the language profile for a repository.
 */
export function getLanguageProfile(repo: string, failToPass?: string): LanguageProfile {
  const lang = detectLanguage(repo, failToPass);
  return LANGUAGE_PROFILES[lang];
}

/**
 * Build the git ls-files command for language-aware source discovery.
 * Returns a shell command that lists all source files for the detected language.
 */
export function buildSourceDiscoveryCommand(repo: string, failToPass?: string): string {
  const profile = getLanguageProfile(repo, failToPass);
  if (!profile.supported || profile.extensions.length === 0) {
    // Return a command that produces no output (empty discovery)
    return 'echo ""';
  }
  const patterns = profile.extensions.map(ext => `'${ext}'`).join(' ');
  return `cd /testbed && git ls-files ${patterns} 2>/dev/null`;
}

/**
 * Build the test command for a set of test IDs.
 * Returns null if the language is not supported.
 */
export function buildTestCommand(
  repo: string,
  testIds: string[],
  failToPass?: string
): string | null {
  const profile = getLanguageProfile(repo, failToPass);
  if (!profile.supported || !profile.testCommandTemplate) return null;
  const testsStr = testIds.join(' ');
  return profile.testCommandTemplate.replace('{tests}', testsStr);
}

/**
 * Returns true if the dataset name indicates a multilingual dataset.
 * Used to gate language-neutral code paths.
 */
export function isMultilingualDataset(datasetName: string): boolean {
  return datasetName.toLowerCase().includes('multilingual');
}

/**
 * Returns the structured unsupported_language outcome payload for a task
 * whose language cannot be determined or is not yet supported.
 */
export function makeUnsupportedLanguageOutcome(
  instanceId: string,
  repo: string,
  detectedLanguage: SupportedLanguage
): {
  outcome: 'unsupported_language';
  instance_id: string;
  repo: string;
  detected_language: string;
  note: string;
} {
  return {
    outcome: 'unsupported_language',
    instance_id: instanceId,
    repo,
    detected_language: detectedLanguage,
    note: LANGUAGE_PROFILES[detectedLanguage]?.supportNote
      ?? `Language '${detectedLanguage}' is not yet supported by the multilingual repair path.`,
  };
}
