path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { parseFile } from "../codeParser";
import { highlight, highlightCode } from "../syntaxHighlighter";
import { analyzeFunctionComplexity, analyzeFileComplexity } from "../codeComplexityAnalyzer";
import { detectDeadCode } from "../deadCodeDetector";
import { formatCode } from "../codeFormatterEngine";
import { indexSymbol, searchSymbols } from "../codeSearchIndexer";"""

old_line = 'import { indexTrace, queryTraces } from "../traceQueryEngine";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v81 imports wired successfully.")
