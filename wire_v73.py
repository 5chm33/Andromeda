import re

path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """import { segmentScenes } from "../sceneSegmenter";
import { trackObjects } from "../objectTracker";
import { detectMotionEvents } from "../motionEventDetector";
import { generateTemporalCaptions } from "../temporalCaptioner";
import { alignSubtitles } from "../subtitleAligner";
import { summarizeVideo } from "../videoSummarizer";
"""

old_line = 'import { indexDocument, retrieveCrossModal } from "../crossModalRetriever";'
content = content.replace(old_line, old_line + "\n" + new_imports.rstrip())

with open(path, "w") as f:
    f.write(content)

print("v73 imports wired successfully.")
