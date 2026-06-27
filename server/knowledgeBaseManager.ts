/**
 * knowledgeBaseManager.ts — v85.0.0 "Knowledge Graph & Reasoning"
 * Manages structured knowledge bases with facts, rules, and Q&A retrieval.
 */
export interface KBArticle {
  articleId: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  confidence: number;
  createdAt: number;
  updatedAt: number;
  viewCount: number;
}

export interface KBQuery {
  question: string;
  category?: string;
  tags?: string[];
  limit?: number;
}

export interface KBAnswer {
  articleId: string;
  title: string;
  excerpt: string;
  relevanceScore: number;
  confidence: number;
}

const articles = new Map<string, KBArticle>();
let articleCounter = 0;

export function addArticle(title: string, content: string, category: string, tags: string[], confidence = 1.0): KBArticle {
  const article: KBArticle = {
    articleId: `kb-${++articleCounter}`,
    title, content, category, tags, confidence,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    viewCount: 0,
  };
  articles.set(article.articleId, article);
  return article;
}

export function queryKnowledgeBase(query: KBQuery): KBAnswer[] {
  const qWords = query.question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const answers: KBAnswer[] = [];

  for (const article of articles.values()) {
    if (query.category && article.category !== query.category) continue;
    if (query.tags && !query.tags.some(t => article.tags.includes(t))) continue;

    const searchText = `${article.title} ${article.content}`.toLowerCase();
    const matchCount = qWords.filter(w => searchText.includes(w)).length;
    if (matchCount === 0) continue;

    const relevanceScore = (matchCount / qWords.length) * article.confidence;
    const excerptStart = Math.max(0, searchText.indexOf(qWords[0] ?? "") - 50);
    const excerpt = article.content.slice(excerptStart, excerptStart + 200) + "...";

    answers.push({ articleId: article.articleId, title: article.title, excerpt, relevanceScore, confidence: article.confidence });
    article.viewCount++;
  }

  answers.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return query.limit ? answers.slice(0, query.limit) : answers;
}

export function updateArticle(articleId: string, updates: Partial<Pick<KBArticle, "title" | "content" | "tags" | "confidence">>): KBArticle | null {
  const article = articles.get(articleId);
  if (!article) return null;
  Object.assign(article, updates, { updatedAt: Date.now() });
  return article;
}

export function getTopArticles(limit = 5): KBArticle[] {
  return [...articles.values()].sort((a, b) => b.viewCount - a.viewCount).slice(0, limit);
}

export function getArticle(articleId: string): KBArticle | undefined { return articles.get(articleId); }
export function getArticleCount(): number { return articles.size; }
export function getArticlesByCategory(category: string): KBArticle[] { return [...articles.values()].filter(a => a.category === category); }
export function _resetKnowledgeBaseManagerForTest(): void { articles.clear(); articleCounter = 0; }
