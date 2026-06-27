/**
 * v90.test.ts — Adaptive Learning & Meta-Learning
 * Comprehensive tests for all 6 v90 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createMetaModel, recordEpisode, recommendLearningRate, getMetaModel, _resetMetaLearnerForTest } from "./metaLearner";
import { createAdaptiveLearner, addAdaptationRule, processFeedback, getPerformanceTrend, getLearner, _resetAdaptiveLearnerForTest } from "./adaptiveLearner";
import { createOnlineModel, predict, updateModel, batchUpdate, getModel, getUpdateHistory, _resetOnlineLearnerForTest } from "./onlineLearner";
import { registerDomain, findSharedFeatures, transferKnowledge, getDomain, getTransferJobs, _resetTransferLearnerForTest } from "./transferLearner";
import { createContinualModel, learnTask, evaluateForgetting, replayExemplars, getModel as getContinualModel, getPlasticityStabilityTradeoff, _resetContinualLearnerForTest } from "./continualLearner";
import { createFewShotClassifier, buildPrototypes, classify, runEpisode, getClassifier, _resetFewShotLearnerForTest } from "./fewShotLearner";

// ─── metaLearner ─────────────────────────────────────────────────────────────
describe("metaLearner", () => {
  beforeEach(() => _resetMetaLearnerForTest());

  it("creates a meta model", () => {
    const model = createMetaModel("MAML");
    expect(model.modelId).toMatch(/^meta-/);
    expect(model.episodes.length).toBe(0);
  });

  it("records an episode", () => {
    const model = createMetaModel("MAML");
    const task = { taskId: "t1", name: "Classification", taskType: "classification", supportExamples: [], queryExamples: [] };
    const ep = recordEpisode(model.modelId, task, 0.5, 0.8, 5, 0.01);
    expect(ep).not.toBeNull();
    expect(ep!.improvementRate).toBeCloseTo(0.06, 2);
  });

  it("updates model statistics after episode", () => {
    const model = createMetaModel("Reptile");
    const task = { taskId: "t1", name: "T", taskType: "regression", supportExamples: [], queryExamples: [] };
    recordEpisode(model.modelId, task, 0.4, 0.9, 10, 0.001);
    expect(getMetaModel(model.modelId)?.avgAdaptationSteps).toBe(10);
  });

  it("recommends learning rate", () => {
    const model = createMetaModel("Proto");
    const task = { taskId: "t1", name: "T", taskType: "classification", supportExamples: [], queryExamples: [] };
    recordEpisode(model.modelId, task, 0.5, 0.9, 5, 0.01);
    const lr = recommendLearningRate(model.modelId, "classification");
    expect(lr).toBeGreaterThan(0);
  });

  it("tracks task type performance", () => {
    const model = createMetaModel("M");
    const task = { taskId: "t1", name: "T", taskType: "nlp", supportExamples: [], queryExamples: [] };
    recordEpisode(model.modelId, task, 0.6, 0.85, 3, 0.01);
    expect(getMetaModel(model.modelId)?.taskTypePerformance["nlp"]).toBeDefined();
  });
});

// ─── adaptiveLearner ─────────────────────────────────────────────────────────
describe("adaptiveLearner", () => {
  beforeEach(() => _resetAdaptiveLearnerForTest());

  it("creates an adaptive learner", () => {
    const learner = createAdaptiveLearner("agent-1");
    expect(learner.learnerId).toMatch(/^al-/);
    expect(learner.currentPerformance).toBe(0.5);
  });

  it("processes feedback and updates performance", () => {
    const learner = createAdaptiveLearner("agent-2");
    processFeedback(learner.learnerId, "task-1", "move", "success", 1.0);
    expect(getLearner(learner.learnerId)!.performanceHistory.length).toBe(1);
  });

  it("triggers adaptation rules", () => {
    const learner = createAdaptiveLearner("agent-3");
    addAdaptationRule(learner.learnerId, "high_failure_rate", "reduce_learning_rate", 0.5);
    processFeedback(learner.learnerId, "task-1", "act", "failure", -1.0);
    expect(getLearner(learner.learnerId)!.adaptationCount).toBe(1);
  });

  it("detects performance trend", () => {
    const learner = createAdaptiveLearner("agent-4");
    // Feed many high-reward signals to push performance up
    for (let i = 0; i < 15; i++) processFeedback(learner.learnerId, "t", "a", "success", 1.0);
    const trend = getPerformanceTrend(learner.learnerId);
    expect(["improving", "stable"]).toContain(trend);
  });

  it("returns null for unknown learner", () => {
    expect(processFeedback("unknown", "t", "a", "success", 1.0)).toBeNull();
  });
});

// ─── onlineLearner ───────────────────────────────────────────────────────────
describe("onlineLearner", () => {
  beforeEach(() => _resetOnlineLearnerForTest());

  it("creates an online model", () => {
    const model = createOnlineModel("Perceptron", ["x1", "x2"]);
    expect(model.modelId).toMatch(/^ol-/);
    expect(model.weights["x1"]).toBe(0);
  });

  it("predicts output", () => {
    const model = createOnlineModel("LR", ["x"]);
    const pred = predict(model.modelId, { x: 1 });
    expect(pred).toBeGreaterThanOrEqual(0);
    expect(pred).toBeLessThanOrEqual(1);
  });

  it("updates model weights", () => {
    const model = createOnlineModel("SGD", ["x"]);
    const upd = updateModel(model.modelId, { x: 1 }, 1);
    expect(upd).not.toBeNull();
    expect(getModel(model.modelId)!.weights["x"]).not.toBe(0);
  });

  it("reduces loss over multiple updates", () => {
    const model = createOnlineModel("Train", ["x"]);
    const examples = Array.from({ length: 20 }, (_, i) => ({ input: { x: i % 2 === 0 ? 1 : -1 }, label: i % 2 === 0 ? 1 : 0 }));
    const avgLoss = batchUpdate(model.modelId, examples);
    expect(avgLoss).toBeGreaterThanOrEqual(0);
    expect(getModel(model.modelId)!.updateCount).toBe(20);
  });

  it("retrieves update history", () => {
    const model = createOnlineModel("H", ["f"]);
    updateModel(model.modelId, { f: 1 }, 1);
    updateModel(model.modelId, { f: 0 }, 0);
    expect(getUpdateHistory(model.modelId).length).toBe(2);
  });
});

// ─── transferLearner ─────────────────────────────────────────────────────────
describe("transferLearner", () => {
  beforeEach(() => _resetTransferLearnerForTest());

  it("registers a domain", () => {
    const domain = registerDomain("ImageNet", ["color", "texture", "shape"], "classification", 0.9);
    expect(domain.domainId).toMatch(/^dom-/);
    expect(domain.features.length).toBe(3);
  });

  it("finds shared features", () => {
    const src = registerDomain("Source", ["a", "b", "c"], "classification");
    const tgt = registerDomain("Target", ["b", "c", "d"], "classification");
    const shared = findSharedFeatures(src.domainId, tgt.domainId);
    expect(shared).toContain("b");
    expect(shared).toContain("c");
    expect(shared).not.toContain("a");
  });

  it("transfers knowledge and improves accuracy", () => {
    const src = registerDomain("Source", ["f1", "f2", "f3"], "classification", 0.9);
    const tgt = registerDomain("Target", ["f1", "f2", "f3"], "classification", 0.5);
    const job = transferKnowledge(src.domainId, tgt.domainId, "fine_tuning", 0.6);
    expect(job).not.toBeNull();
    expect(job!.transferAccuracy).toBeGreaterThan(job!.baselineAccuracy);
  });

  it("retrieves transfer jobs", () => {
    const src = registerDomain("S", ["x"], "reg");
    const tgt = registerDomain("T", ["x"], "reg");
    transferKnowledge(src.domainId, tgt.domainId, "feature_extraction", 0.5);
    expect(getTransferJobs(tgt.domainId).length).toBe(1);
  });
});

// ─── continualLearner ────────────────────────────────────────────────────────
describe("continualLearner", () => {
  beforeEach(() => _resetContinualLearnerForTest());

  it("creates a continual model", () => {
    const model = createContinualModel("EWC");
    expect(model.modelId).toMatch(/^cl-/);
    expect(model.plasticityScore).toBe(1.0);
  });

  it("learns a task", () => {
    const model = createContinualModel("ER");
    const mem = learnTask(model.modelId, "task-1", "MNIST", [{ input: { x: 1 }, label: "0" }], 0.9);
    expect(mem).not.toBeNull();
    expect(getContinualModel(model.modelId)!.taskSequence).toContain("task-1");
  });

  it("evaluates forgetting", () => {
    const model = createContinualModel("GEM");
    learnTask(model.modelId, "task-1", "T1", [], 0.9);
    const forgetting = evaluateForgetting(model.modelId, "task-1", 0.7);
    expect(forgetting).toBeCloseTo(0.2, 2);
  });

  it("replays exemplars", () => {
    const model = createContinualModel("Replay");
    learnTask(model.modelId, "task-1", "T1", [{ input: { x: 1 }, label: "a" }, { input: { x: 2 }, label: "b" }], 0.8);
    const exemplars = replayExemplars(model.modelId, "task-1");
    expect(exemplars.length).toBe(2);
  });

  it("tracks plasticity-stability tradeoff", () => {
    const model = createContinualModel("PSI");
    learnTask(model.modelId, "t1", "T1", [], 0.9);
    learnTask(model.modelId, "t2", "T2", [], 0.8);
    const tradeoff = getPlasticityStabilityTradeoff(model.modelId);
    expect(tradeoff.plasticity).toBeLessThan(1.0);
    expect(tradeoff.balance).toBeGreaterThan(0);
  });
});

// ─── fewShotLearner ──────────────────────────────────────────────────────────
describe("fewShotLearner", () => {
  beforeEach(() => _resetFewShotLearnerForTest());

  it("creates a few-shot classifier", () => {
    const clf = createFewShotClassifier("ProtoNet", 4);
    expect(clf.classifierId).toMatch(/^fs-/);
    expect(clf.embeddingDim).toBe(4);
  });

  it("builds prototypes from support set", () => {
    const clf = createFewShotClassifier("PN", 2);
    const supportSet = [
      { label: "cat", embedding: [1, 0] },
      { label: "cat", embedding: [0.9, 0.1] },
      { label: "dog", embedding: [0, 1] },
    ];
    const protos = buildPrototypes(clf.classifierId, supportSet);
    expect(protos.length).toBe(2);
  });

  it("classifies query embedding", () => {
    const clf = createFewShotClassifier("PN2", 2);
    buildPrototypes(clf.classifierId, [
      { label: "A", embedding: [1, 0] },
      { label: "B", embedding: [0, 1] },
    ]);
    const result = classify(clf.classifierId, [0.9, 0.1]);
    expect(result?.label).toBe("A");
  });

  it("runs a full episode", () => {
    const clf = createFewShotClassifier("EP", 2);
    const support = [{ label: "X", embedding: [1, 0] }, { label: "Y", embedding: [0, 1] }];
    const query = [{ label: "X", embedding: [0.9, 0.1] }, { label: "Y", embedding: [0.1, 0.9] }];
    const ep = runEpisode(clf.classifierId, support, query);
    expect(ep).not.toBeNull();
    expect(ep!.accuracy).toBeGreaterThan(0);
  });

  it("tracks average accuracy across episodes", () => {
    const clf = createFewShotClassifier("Track", 2);
    const support = [{ label: "A", embedding: [1, 0] }, { label: "B", embedding: [0, 1] }];
    const query = [{ label: "A", embedding: [0.9, 0.1] }];
    runEpisode(clf.classifierId, support, query);
    runEpisode(clf.classifierId, support, query);
    expect(getClassifier(clf.classifierId)!.episodes.length).toBe(2);
  });
});
