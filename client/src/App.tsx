import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SupabaseAuthProvider } from "./contexts/SupabaseAuthContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import Home from "./pages/Home";

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <SupabaseAuthProvider>
            <LanguageProvider>
            <Toaster theme="dark" />
            <Switch>
            <Route path="/" component={Home} />
            <Route path="/discover" component={Home} />
            <Route path="/connections" component={Home} />
            <Route path="/profile" component={Home} />
            <Route path="/members/:id" component={Home} />
            <Route path="/chat/:id" component={Home} />
            <Route component={Home} />
            </Switch>
            </LanguageProvider>
          </SupabaseAuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
