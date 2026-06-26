import { simpleChatCompletion } from "./llmProvider.js";

export interface PullRequest {
  id: string;
  title: string;
  description: string;
  diff: string;
  author: string;
}

export interface ReviewComment {
  file: string;
  line: number;
  comment: string;
  suggestion?: string;
  severity: "critical" | "warning" | "nitpick";
}

export interface ReviewResult {
  approved: boolean;
  summary: string;
  comments: ReviewComment[];
}

/**
 * Reviews a GitHub Pull Request using the RSI pipeline's criteria.
 */
export async function reviewPullRequest(pr: PullRequest): Promise<ReviewResult> {
  console.log(`[CodeReviewer] Starting review for PR #${pr.id}: ${pr.title}`);
  
  const prompt = `
You are Andromeda, an autonomous code review bot. Review the following Pull Request.
Focus on correctness, performance, security, and maintainability.

PR Title: ${pr.title}
Description: ${pr.description}

Diff:
${pr.diff}

Return a JSON object with the following structure:
{
  "approved": boolean,
  "summary": "Overall assessment of the PR",
  "comments": [
    {
      "file": "filename",
      "line": 123,
      "comment": "What is wrong and why",
      "suggestion": "Optional code snippet to fix it",
      "severity": "critical" | "warning" | "nitpick"
    }
  ]
}
`;

  try {
    const response = await simpleChatCompletion([{ role: "user", content: prompt }], { temperature: 0.2 });
    const result = JSON.parse(response) as ReviewResult;
    
    console.log(`[CodeReviewer] Completed review for PR #${pr.id}. Approved: ${result.approved}`);
    return result;
  } catch (error) {
    console.error(`[CodeReviewer] Failed to review PR #${pr.id}:`, error);
    // Fallback to manual review if LLM fails
    return {
      approved: false,
      summary: "Automated review failed. Manual review required.",
      comments: []
    };
  }
}

/**
 * Mocks the posting of a review back to GitHub.
 */
export async function postReviewToGitHub(prId: string, review: ReviewResult): Promise<boolean> {
  console.log(`[CodeReviewer] Posting review to GitHub for PR #${prId}...`);
  console.log(`[CodeReviewer] Summary: ${review.summary}`);
  console.log(`[CodeReviewer] Posted ${review.comments.length} inline comments.`);
  return true;
}
