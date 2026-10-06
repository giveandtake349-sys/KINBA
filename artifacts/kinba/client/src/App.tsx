import { Route, Switch, useLocation } from "wouter";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { SupabaseAuthProvider } from "./contexts/SupabaseAuthContext";
import Home from "./pages/Home";
import Admin from "./pages/Admin";
import AuthCallback from "./pages/AuthCallback";
import HypeRooms from "./pages/HypeRooms";
import CreateHypeRoom from "./pages/CreateHypeRoom";
import HypeRoomDetail from "./pages/HypeRoomDetail";
import Drops from "./pages/Drops";
import DropDetail from "./pages/DropDetail";
import Messages from "./pages/Messages";
import MessageRequests from "./pages/MessageRequests";
import MessageRequestDetail from "./pages/MessageRequestDetail";
import Settings from "./pages/settings/Settings";
import NotFound from "./pages/NotFound";
import { DesktopMessages } from "./pages/DesktopMessages";

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} />;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/admin" component={Admin} />
      <Route path="/auth/callback" component={AuthCallback} />
      {/* Account Center: /settings shows the category index (and, on desktop,
          the default pane); /settings/:section deep-links one category. */}
      <Route path="/settings" component={Settings} />
      <Route path="/settings/:section" component={Settings} />
      {/* /rooms/new must be registered before /rooms/:id so "new" is not captured as an id. */}
      <Route path="/rooms/new" component={CreateHypeRoom} />
      <Route path="/rooms/:id" component={HypeRoomDetail} />
      <Route path="/rooms" component={HypeRooms} />
      <Route path="/drops/:id" component={DropDetail} />
      <Route path="/drops" component={Drops} />
      <Route path="/messages/requests" component={MessageRequests} />
      <Route path="/messages/requests/:requestId" component={MessageRequestDetail} />
      {/* /messages/:id must mount DesktopMessages, not MessageDetail: the
          desktop two-pane shell renders MessageDetail inside its own
          /messages/:id route. Mobile keeps the same full-screen MessageDetail
          because DesktopMessages hides its sidebar for conversations. */}
      <Route path="/messages/:id" component={DesktopMessages} />
      <Route path="/messages" component={DesktopMessages} />
      <Route path="/login" component={Home} />
      <Route path="/" component={Home} />
      <Route path="/profile" component={Home} />
      <Route path="/profile/:id" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <SupabaseAuthProvider>
            <ThemedToaster />
            <AppRoutes />
          </SupabaseAuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
