import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Sparkles,
  ArrowLeft,
  History as HistoryIcon,
  Trash2,
  Search,
  Clock,
  LogIn,
  ExternalLink,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useState } from "react";

export default function History() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [confirmClear, setConfirmClear] = useState(false);
  const utils = trpc.useUtils();

  const historyQuery = trpc.history.list.useQuery(
    { limit: 50 },
    { enabled: isAuthenticated }
  );

  const deleteItem = trpc.history.deleteItem.useMutation({
    onSuccess: () => {
      utils.history.list.invalidate();
      toast.success("Search removed");
    },
  });

  const clearAll = trpc.history.clearAll.useMutation({
    onSuccess: () => {
      utils.history.list.invalidate();
      setConfirmClear(false);
      toast.success("History cleared");
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-6 px-4">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <HistoryIcon className="w-8 h-8 text-primary" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Sign in to view history</h2>
          <p className="text-muted-foreground text-sm max-w-xs">
            Your search history is saved when you're signed in to Andromeda.
          </p>
        </div>
        <Button
          onClick={() => (window.location.href = getLoginUrl())}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <LogIn className="w-4 h-4 mr-2" />
          Sign in to continue
        </Button>
        <button
          onClick={() => navigate("/")}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Andromeda
        </button>
      </div>
    );
  }

  const items = historyQuery.data?.items ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-border/50">
        <div className="flex items-center justify-between px-4 py-4 max-w-3xl mx-auto">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Andromeda</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              confirmClear ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Clear all?</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => clearAll.mutate()}
                    disabled={clearAll.isPending}
                    className="h-7 text-xs"
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmClear(false)}
                    className="h-7 text-xs"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmClear(true)}
                  className="text-muted-foreground hover:text-destructive h-7 text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Clear all
                </Button>
              )
            )}
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">
              {user?.name?.[0]?.toUpperCase() ?? "U"}
            </div>
          </div>
        </div>
      </header>

      <main className="pt-20 pb-16 px-4 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HistoryIcon className="w-6 h-6 text-primary" />
            Search History
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {items.length > 0 ? `${items.length} searches` : "No searches yet"}
          </p>
        </div>

        {historyQuery.isLoading && (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="glass rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                <div className="h-3 bg-muted rounded w-1/4" />
              </div>
            ))}
          </div>
        )}

        {!historyQuery.isLoading && items.length === 0 && (
          <div className="glass rounded-2xl p-12 text-center">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Search className="w-6 h-6 text-primary/60" />
            </div>
            <p className="text-muted-foreground text-sm">
              Your search history will appear here once you start searching.
            </p>
            <Button
              className="mt-4 bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={() => navigate("/")}
            >
              Start searching
            </Button>
          </div>
        )}

        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="glass rounded-xl p-4 group hover:border-primary/20 transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  className="flex-1 text-left"
                  onClick={() => navigate(`/search?q=${encodeURIComponent(item.query)}`)}
                >
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2">
                    {item.query}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {new Date(item.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {Array.isArray(item.sources) && item.sources.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {item.sources.length} sources
                      </span>
                    )}
                  </div>
                </button>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={() => navigate(`/search?q=${encodeURIComponent(item.query)}`)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                    title="Search again"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteItem.mutate({ id: item.id })}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
