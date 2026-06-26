export interface BatchTask {
  filePath: string;
  context: string;
  priority: number;
}

export interface BatchSchedule {
  tasks: BatchTask[];
  estimatedTokens: number;
}

const MAX_BATCH_TOKENS = 12000;
let pendingTasks: BatchTask[] = [];

export function queueTaskForBatching(filePath: string, context: string, priority: number = 1): void {
  pendingTasks.push({ filePath, context, priority });
}

export function getNextBatch(): BatchSchedule | null {
  if (pendingTasks.length === 0) return null;
  
  // Sort by priority (highest first)
  pendingTasks.sort((a, b) => b.priority - a.priority);
  
  const batch: BatchTask[] = [];
  let currentTokens = 0;
  
  // Greedy pack
  for (let i = 0; i < pendingTasks.length; i++) {
    const task = pendingTasks[i];
    // Rough estimate: 1 char ~= 0.25 tokens
    const estTokens = Math.ceil(task.context.length * 0.25) + 500; // 500 for prompt overhead
    
    if (currentTokens + estTokens <= MAX_BATCH_TOKENS) {
      batch.push(task);
      currentTokens += estTokens;
      pendingTasks.splice(i, 1);
      i--; // Adjust index after removal
    }
  }
  
  if (batch.length === 0) {
    // If the highest priority task is too big for the batch on its own, just send it alone
    const oversized = pendingTasks.shift()!;
    return {
      tasks: [oversized],
      estimatedTokens: Math.ceil(oversized.context.length * 0.25) + 500
    };
  }
  
  return {
    tasks: batch,
    estimatedTokens: currentTokens
  };
}

export function clearBatchQueue(): void {
  pendingTasks = [];
}
