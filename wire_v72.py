import re

path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """import { analyzeVideo } from "../videoFrameAnalyzer";
import { recognizeSpeech } from "../speechRecognizer";
import { interpretDiagram } from "../diagramInterpreter";
import { fuseModalities } from "../multimodalFusion";
import { routeByMimeType } from "../modalityRouter";
import { indexDocument, retrieveCrossModal } from "../crossModalRetriever";
"""

# Insert after last import line (line 341 = ocrEngine import)
old_line = 'import { getOCRHistory } from "../ocrEngine";'
content = content.replace(old_line, old_line + "\n" + new_imports.rstrip())

with open(path, "w") as f:
    f.write(content)

print("v72 imports wired successfully.")
