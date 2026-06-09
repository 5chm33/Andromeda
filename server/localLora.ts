/**
 * localLora.ts — Phase 3b: Local LoRA Fine-Tuning Pipeline
 * Andromeda v9.16.0
 *
 * Provides the integration layer to trigger local PEFT/LoRA fine-tuning
 * using HuggingFace `peft` and `trl` via a Python subprocess.
 * This allows Andromeda to self-improve its own local weights (e.g. Llama 3 / Mistral)
 * based on the DPO dataset extracted in Phase 3a.
 */

import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { createLogger } from "./logger.js";
import { exportDpoDataset } from "./selfDistillation.js";

const log = createLogger("localLora");

export interface LoraConfig {
  modelId: string;
  datasetPath?: string;
  outputDir?: string;
  batchSize?: number;
  epochs?: number;
  learningRate?: number;
}

/**
 * Triggers a local LoRA fine-tuning run via a Python subprocess.
 * Generates the DPO dataset first if not provided.
 */
export async function runLocalLoraTraining(config: LoraConfig): Promise<{ success: boolean; outputDir?: string; error?: string }> {
  try {
    let datasetPath = config.datasetPath;
    
    // If no dataset provided, auto-extract from RLHF database
    if (!datasetPath) {
      log.info("[LoRA] No dataset provided, extracting DPO pairs from RLHF database...");
      const result = exportDpoDataset();
      if (!result.success || !result.path) {
        return { success: false, error: `Failed to extract dataset: ${result.error}` };
      }
      datasetPath = result.path;
    }

    const outputDir = config.outputDir ?? path.join(process.cwd(), "models", `lora_${Date.now()}`);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Ensure the python script exists
    const scriptPath = path.join(process.cwd(), "scripts", "train_lora.py");
    if (!fs.existsSync(scriptPath)) {
      writePythonTrainingScript(scriptPath);
    }

    log.info(`[LoRA] Starting fine-tuning for ${config.modelId} using dataset ${datasetPath}`);

    return new Promise((resolve) => {
      const pythonProcess = spawn("python3", [
        scriptPath,
        "--model_id", config.modelId,
        "--dataset_path", datasetPath!,
        "--output_dir", outputDir,
        "--batch_size", (config.batchSize ?? 4).toString(),
        "--epochs", (config.epochs ?? 3).toString(),
        "--learning_rate", (config.learningRate ?? 2e-4).toString(),
      ]);

      let errorOutput = "";

      pythonProcess.stdout.on("data", (data) => {
        log.info(`[LoRA-Py] ${data.toString().trim()}`);
      });

      pythonProcess.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        log.warn(`[LoRA-Py] ${msg}`);
        errorOutput += msg + "\n";
      });

      pythonProcess.on("close", (code) => {
        if (code === 0) {
          log.info(`[LoRA] Fine-tuning completed successfully. Weights saved to ${outputDir}`);
          resolve({ success: true, outputDir });
        } else {
          log.error(`[LoRA] Fine-tuning failed with code ${code}`);
          resolve({ success: false, error: `Python process exited with code ${code}\n${errorOutput}` });
        }
      });
    });
  } catch (err) {
    log.error(`[LoRA] Error starting training: ${(err as Error).message}`);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Writes the Python training script that uses HuggingFace transformers, peft, and trl.
 * This script is executed by the Node.js process.
 */
function writePythonTrainingScript(scriptPath: string): void {
  const scriptContent = `
import argparse
import os
import json
from datasets import Dataset
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import DPOTrainer

def load_dpo_dataset(path):
    data = {"prompt": [], "chosen": [], "rejected": []}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip(): continue
            obj = json.loads(line)
            data["prompt"].append(obj["prompt"])
            data["chosen"].append(obj["chosen"])
            data["rejected"].append(obj["rejected"])
    return Dataset.from_dict(data)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_id", type=str, required=True)
    parser.add_argument("--dataset_path", type=str, required=True)
    parser.add_argument("--output_dir", type=str, required=True)
    parser.add_argument("--batch_size", type=int, default=4)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--learning_rate", type=float, default=2e-4)
    args = parser.parse_args()

    print(f"Loading dataset from {args.dataset_path}")
    dataset = load_dpo_dataset(args.dataset_path)
    if len(dataset) == 0:
        print("Error: Dataset is empty")
        exit(1)

    print(f"Loading tokenizer and model: {args.model_id}")
    tokenizer = AutoTokenizer.from_pretrained(args.model_id)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # In a real environment, you'd use load_in_4bit=True for QLoRA, but we keep it simple here
    # to avoid deep dependencies if bitsandbytes isn't installed.
    model = AutoModelForCausalLM.from_pretrained(
        args.model_id, 
        device_map="auto" if torch.cuda.is_available() else None,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32
    )

    print("Configuring LoRA")
    peft_config = LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "v_proj"]
    )
    
    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()

    training_args = TrainingArguments(
        output_dir=args.output_dir,
        per_device_train_batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        num_train_epochs=args.epochs,
        logging_steps=10,
        save_steps=100,
        optim="paged_adamw_32bit",
        remove_unused_columns=False,
    )

    print("Initializing DPOTrainer")
    trainer = DPOTrainer(
        model=model,
        ref_model=None, # TRL will create a reference model automatically if None
        args=training_args,
        beta=0.1,
        train_dataset=dataset,
        tokenizer=tokenizer,
        peft_config=peft_config,
    )

    print("Starting training...")
    trainer.train()

    print(f"Saving final model to {args.output_dir}")
    trainer.model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)
    print("Done!")

if __name__ == "__main__":
    main()
`;

  const dir = path.dirname(scriptPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(scriptPath, scriptContent, "utf8");
}
