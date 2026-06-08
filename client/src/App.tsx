import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Search from "./pages/Search";
import History from "./pages/History";
import Chat from "./pages/Chat";
import RsiDashboard from "./pages/RsiDashboard";
import { ProposalNotifier } from "./components/rsi/ProposalNotifier";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/search"} component={Search} />
      <Route path={"/history"} component={History} />
      <Route path={"/chat"} component={Chat} />
      <Route path={"/rsi"} component={RsiDashboard} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster
            theme="dark"
            toastOptions={{
              style: {
                background: "oklch(0.14 0.015 265)",
                border: "1px solid oklch(0.22 0.015 265)",
                color: "oklch(0.95 0.005 265)",
              },
            }}
          />
          <ProposalNotifier />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
