path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { createSeries, appendDataPoint, queryRange } from "../timeSeriesStore";
import { computeMA, simpleMovingAverage } from "../movingAverageCalculator";
import { detectAnomalies } from "../anomalyDetector";
import { forecast } from "../forecastEngine";
import { analyzeSeasonality } from "../seasonalityAnalyzer";
import { extractTrend, detectChangePoints } from "../trendExtractor";"""

old_line = 'import { addToSearchIndex, searchDocuments } from "../documentSearchEngine";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v83 imports wired successfully.")
