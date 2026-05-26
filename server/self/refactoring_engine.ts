/**
 * Refactoring Proposal Engine
 * 
 * Analyzes the dependency graph and proposes architecture-level
 * refactorings such as module extraction, consolidation, and splitting.
 */

import { DependencyGraph } from './dependency_graph.js';

export interface RefactoringProposal {
  id: string;
  type: 'extract_module' | 'merge_modules' | 'split_module' | 'extract_interface' | 'move_file';
  description: string;
  rationale: string;
  impact: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  targetFiles: string[];
}

export function generateRefactoringProposals(graph: DependencyGraph): RefactoringProposal[] {
  const proposals: RefactoringProposal[] = [];
  
  // 1. Propose splitting large files
  for (const [path, node] of graph.nodes) {
    if (node.fileSize > 15000 && !node.isEntryPoint) { // > 15KB
      proposals.push({
        id: `split_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        type: 'split_module',
        description: `Split ${path} into smaller modules`,
        rationale: `File is large (${Math.round(node.fileSize / 1024)}KB) and likely has mixed concerns.`,
        impact: 'high',
        risk: 'medium',
        targetFiles: [path],
      });
    }
  }
  
  // 2. Propose extracting interfaces from files with many exports but low size
  for (const [path, node] of graph.nodes) {
    if (node.exports.length > 10 && node.fileSize < 5000 && !path.includes('types') && !path.includes('interface')) {
      proposals.push({
        id: `extract_interfaces_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        type: 'extract_interface',
        description: `Extract interfaces from ${path} to a dedicated types file`,
        rationale: `File exports many symbols (${node.exports.length}) but is small, suggesting it contains many type definitions mixed with logic.`,
        impact: 'medium',
        risk: 'low',
        targetFiles: [path],
      });
    }
  }
  
  // 3. Propose moving orphaned files or files with specific naming patterns
  for (const path of graph.orphanedModules) {
    if (path.includes('utils/') || path.includes('helpers/')) {
      proposals.push({
        id: `move_orphaned_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        type: 'move_file',
        description: `Review or remove orphaned utility file ${path}`,
        rationale: `File is not imported by any other module in the project.`,
        impact: 'low',
        risk: 'low',
        targetFiles: [path],
      });
    }
  }
  
  return proposals;
}
