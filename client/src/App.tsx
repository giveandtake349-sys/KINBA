import { Route, Switch } from "wouter";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { SupabaseAuthProvider } from "./contexts/SupabaseAuthContext";
import Home from "./pages/Home";

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <SupabaseAuthProvider>
            <ThemedToaster />
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/profile" component={Home} />
              <Route component={Home} />
            </Switch>
          </SupabaseAuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
