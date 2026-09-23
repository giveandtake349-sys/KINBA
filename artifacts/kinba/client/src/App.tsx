import { Route, Switch } from "wouter";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { SupabaseAuthProvider } from "./contexts/SupabaseAuthContext";
import Home from "./pages/Home";
import Admin from "./pages/Admin";
import HypeRooms from "./pages/HypeRooms";
import HypeRoomDetail from "./pages/HypeRoomDetail";
import Drops from "./pages/Drops";
import DropDetail from "./pages/DropDetail";
import NotFound from "./pages/NotFound";

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
              <Route path="/admin" component={Admin} />
              <Route path="/rooms/:id" component={HypeRoomDetail} />
              <Route path="/rooms" component={HypeRooms} />
              <Route path="/drops/:id" component={DropDetail} />
              <Route path="/drops" component={Drops} />
              <Route path="/login" component={Home} />
              <Route path="/" component={Home} />
              <Route path="/profile" component={Home} />
              <Route path="/profile/:id" component={Home} />
              <Route component={NotFound} />
            </Switch>
          </SupabaseAuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
