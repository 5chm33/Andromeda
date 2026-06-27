path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { addNode, addEdge, bfsTraversal, findPath } from "../knowledgeGraph";
import { defineClass, defineProperty, validateInstance } from "../ontologyManager";
import { assertFact, addRule, runInference, queryFacts } from "../inferenceEngine";
import { insertTriple, queryPattern, queryChain, aggregateByPredicate } from "../graphQueryEngine";
import { registerEntity, linkEntities } from "../entityLinker";
import { addArticle, queryKnowledgeBase } from "../knowledgeBaseManager";"""

old_line = 'import { registerTrigger, processEvent, disableTrigger } from "../eventDrivenTrigger";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v85 imports wired successfully.")
