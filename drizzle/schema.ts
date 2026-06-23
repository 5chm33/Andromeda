import {
  bigint,
  index,
  int,
  json,
  longtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const searchHistory = mysqlTable("search_history", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  userId: int("userId").references(() => users.id, { onDelete: "cascade" }),
  sessionId: varchar("sessionId", { length: 64 }),
  query: text("query").notNull(),
  aiAnswer: longtext("aiAnswer"), // v5.28: longtext for large AI responses (was text, limited to 65KB)
  sources: json("sources").$type<SearchSource[]>(),
  filter: varchar("filter", { length: 32 }).default("all"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // v5.28: Indexes for query performance
  sessionIdx: index("session_idx").on(table.sessionId),
  userIdx: index("user_idx").on(table.userId),
  createdIdx: index("created_idx").on(table.createdAt),
}));

export type SearchHistoryRow = typeof searchHistory.$inferSelect;
export type InsertSearchHistory = typeof searchHistory.$inferInsert;

export const searchSuggestions = mysqlTable("search_suggestions", {
  id: int("id").autoincrement().primaryKey(),
  query: varchar("query", { length: 256 }).notNull().unique(),
  count: int("count").default(1).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SearchSuggestion = typeof searchSuggestions.$inferSelect;

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  favicon?: string;
  credibility?: "high" | "medium" | "low";
  publishedAt?: string;
  source?: string;
}

// v5.15: Goals table for persistent self-improvement tracking
export const goals = mysqlTable("goals", {
  id: varchar("id", { length: 64 }).primaryKey(),
  title: varchar("title", { length: 512 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["pending", "in_progress", "completed", "failed", "cancelled"]).default("pending").notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  category: varchar("category", { length: 64 }),
  parentGoalId: varchar("parentGoalId", { length: 64 }),
  metadata: json("metadata").$type<Record<string, any>>(),
  progress: int("progress").default(0),
  errorLog: text("errorLog"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type GoalRow = typeof goals.$inferSelect;
export type InsertGoal = typeof goals.$inferInsert;