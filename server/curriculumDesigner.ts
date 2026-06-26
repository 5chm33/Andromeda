/**
 * Autonomous Curriculum Designer — self-evolving curriculum for improvement tasks.
 * Implements zone-of-proximal-development (ZPD) algorithm to always select tasks
 * just beyond current capability, maximizing learning efficiency.
 */

export interface CapabilityProfile {
  dimension: string;
  currentLevel: number;   // 0-1
  targetLevel: number;    // 0-1
  learningRate: number;   // 0-1, how fast this dimension improves
  prerequisites: string[];
}

export interface CurriculumTask {
  id: string;
  title: string;
  targetDimension: string;
  difficulty: number;     // 0-1
  estimatedGain: number;  // 0-1
  prerequisites: string[];
  isInZPD: boolean;
}

export interface CurriculumPlan {
  tasks: CurriculumTask[];
  estimatedTotalGain: number;
  estimatedDurationCycles: number;
  focusDimensions: string[];
}

class CurriculumDesigner {
  private capabilities: Map<string, CapabilityProfile> = new Map();
  private completedTasks: Set<string> = new Set();
  private taskHistory: Array<{ taskId: string; actualGain: number; timestamp: number }> = [];

  constructor() {
    // Initialize default capability dimensions
    const defaults: CapabilityProfile[] = [
      { dimension: "accuracy", currentLevel: 0.9999999, targetLevel: 1.0, learningRate: 0.001, prerequisites: [] },
      { dimension: "speed", currentLevel: 0.95, targetLevel: 0.999, learningRate: 0.01, prerequisites: [] },
      { dimension: "safety", currentLevel: 0.9999999, targetLevel: 1.0, learningRate: 0.0001, prerequisites: ["accuracy"] },
      { dimension: "generalization", currentLevel: 0.85, targetLevel: 0.99, learningRate: 0.02, prerequisites: ["accuracy", "speed"] },
      { dimension: "meta_learning", currentLevel: 0.7, targetLevel: 0.95, learningRate: 0.03, prerequisites: ["generalization"] },
      { dimension: "autonomy", currentLevel: 0.8, targetLevel: 0.99, learningRate: 0.015, prerequisites: ["meta_learning"] },
    ];
    for (const cap of defaults) {
      this.capabilities.set(cap.dimension, cap);
    }
  }

  assessCurrentCapabilities(): Map<string, CapabilityProfile> {
    return new Map(this.capabilities);
  }

  /**
   * Compute ZPD: tasks should be at difficulty = currentLevel + 0.05 to 0.15
   */
  private _isInZPD(task: CurriculumTask, profile: CapabilityProfile): boolean {
    const zpd_low = profile.currentLevel + 0.02;
    const zpd_high = profile.currentLevel + 0.20;
    return task.difficulty >= zpd_low && task.difficulty <= zpd_high;
  }

  private _prerequisitesMet(task: CurriculumTask): boolean {
    return task.prerequisites.every(prereq => {
      const cap = this.capabilities.get(prereq);
      return cap ? cap.currentLevel >= 0.7 : this.completedTasks.has(prereq);
    });
  }

  designNextCurriculum(capabilities?: Map<string, CapabilityProfile>): CurriculumPlan {
    const caps = capabilities ?? this.capabilities;
    const tasks: CurriculumTask[] = [];

    for (const [dim, profile] of caps) {
      const gap = profile.targetLevel - profile.currentLevel;
      if (gap <= 0.0001) continue; // Already at target

      // Generate 3 tasks per dimension at increasing difficulty
      for (let i = 0; i < 3; i++) {
        const difficulty = profile.currentLevel + (i + 1) * 0.05;
        const task: CurriculumTask = {
          id: `task-${dim}-${i}-${Date.now()}`,
          title: `Improve ${dim} from ${(profile.currentLevel * 100).toFixed(2)}% to ${((profile.currentLevel + (i + 1) * 0.02) * 100).toFixed(2)}%`,
          targetDimension: dim,
          difficulty: Math.min(difficulty, 1.0),
          estimatedGain: profile.learningRate * (i + 1),
          prerequisites: profile.prerequisites,
          isInZPD: false,
        };
        task.isInZPD = this._isInZPD(task, profile);
        tasks.push(task);
      }
    }

    // Sort by ZPD first, then by estimated gain
    tasks.sort((a, b) => {
      if (a.isInZPD && !b.isInZPD) return -1;
      if (!a.isInZPD && b.isInZPD) return 1;
      return b.estimatedGain - a.estimatedGain;
    });

    const focusDimensions = [...new Set(tasks.filter(t => t.isInZPD).map(t => t.targetDimension))];
    const estimatedTotalGain = tasks.reduce((sum, t) => sum + t.estimatedGain, 0);

    return {
      tasks,
      estimatedTotalGain,
      estimatedDurationCycles: Math.ceil(tasks.length / 3),
      focusDimensions,
    };
  }

  getZPDTasks(): CurriculumTask[] {
    const plan = this.designNextCurriculum();
    return plan.tasks.filter(t => t.isInZPD && this._prerequisitesMet(t));
  }

  trackCurriculumProgress(completedTaskId: string, actualGain: number): void {
    this.completedTasks.add(completedTaskId);
    this.taskHistory.push({ taskId: completedTaskId, actualGain, timestamp: Date.now() });

    // Update capability levels based on actual gain
    const plan = this.designNextCurriculum();
    const task = plan.tasks.find(t => t.id === completedTaskId);
    if (task) {
      const profile = this.capabilities.get(task.targetDimension);
      if (profile) {
        profile.currentLevel = Math.min(profile.targetLevel, profile.currentLevel + actualGain);
        console.log(`[Curriculum] ${task.targetDimension} improved to ${(profile.currentLevel * 100).toFixed(4)}%`);
      }
    }
  }

  updateCapabilityLevel(dimension: string, newLevel: number): void {
    const profile = this.capabilities.get(dimension);
    if (profile) {
      profile.currentLevel = Math.max(0, Math.min(1, newLevel));
    }
  }
}

export const globalCurriculumDesigner = new CurriculumDesigner();

export function assessCurrentCapabilities(): Map<string, CapabilityProfile> {
  return globalCurriculumDesigner.assessCurrentCapabilities();
}

export function designNextCurriculum(capabilities?: Map<string, CapabilityProfile>): CurriculumPlan {
  return globalCurriculumDesigner.designNextCurriculum(capabilities);
}

export function getZPDTasks(): CurriculumTask[] {
  return globalCurriculumDesigner.getZPDTasks();
}

export function trackCurriculumProgress(taskId: string, actualGain: number): void {
  globalCurriculumDesigner.trackCurriculumProgress(taskId, actualGain);
}

export function initCurriculumDesigner(): void {
  console.log("[Curriculum] Autonomous Curriculum Designer initialized.");
  const zdpTasks = globalCurriculumDesigner.getZPDTasks();
  console.log(`[Curriculum] ${zdpTasks.length} ZPD tasks ready for next cycle.`);
}
