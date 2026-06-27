path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { indexDocument, getDocument } from "../documentIndexer";
import { summarize } from "../documentSummarizer";
import { addClassificationRule, classifyDocument } from "../documentClassifier";
import { createVersion, getLatestVersion, diffVersions } from "../documentVersionManager";
import { registerTemplate, renderTemplate } from "../documentTemplateEngine";
import { addToSearchIndex, searchDocuments } from "../documentSearchEngine";"""

old_line = 'import { indexSymbol, searchSymbols } from "../codeSearchIndexer";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v82 imports wired successfully.")
