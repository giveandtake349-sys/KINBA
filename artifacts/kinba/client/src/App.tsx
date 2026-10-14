import { lazy, Suspense } from "react";
import { Route, Switch, useLocation } from "wouter";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { SupabaseAuthProvider } from "./contexts/SupabaseAuthContext";
import Home from "./pages/Home";
import "./components/kinbaModern.css";
import { OfflineBanner } from "./components/OfflineBanner";

const Admin = lazy(() => import("./pages/Admin"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const HypeRooms = lazy(() => import("./pages/HypeRooms"));
const CreateHypeRoom = lazy(() => import("./pages/CreateHypeRoom"));
const HypeRoomDetail = lazy(() => import("./pages/HypeRoomDetail"));
const Drops = lazy(() => import("./pages/Drops"));
const CreateDrop = lazy(() => import("./pages/CreateDrop"));
const DropDetail = lazy(() => import("./pages/DropDetail"));
const MessageRequests = lazy(() => import("./pages/MessageRequests"));
const MessageRequestDetail = lazy(() => import("./pages/MessageRequestDetail"));
const Settings = lazy(() => import("./pages/settings/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));
const DesktopMessages = lazy(() =>
  import("./pages/DesktopMessages").then(module => ({
    default: module.DesktopMessages,
  }))
);
const HashtagPage = lazy(() => import("./pages/HashtagPage"));
const Advertise = lazy(() => import("./pages/Advertise"));
const BrandApply = lazy(() => import("./pages/BrandApply"));

function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      Loading page…
    </div>
  );
}

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} />;
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Switch>
        {/* /advertise/apply must be registered before /advertise. */}
        <Route path="/advertise/apply" component={BrandApply} />
        <Route path="/advertise" component={Advertise} />
        <Route path="/admin" component={Admin} />
        <Route path="/auth/callback" component={AuthCallback} />
        {/* Account Center: /settings shows the category index (and, on desktop,
          the default pane); /settings/:section deep-links one category. */}
        <Route path="/settings" component={Settings} />
        <Route path="/settings/:section" component={Settings} />
        {/* /rooms/new must be registered before /rooms/:id so "new" is not captured as an id. */}
        <Route path="/rooms/new" component={CreateHypeRoom} />
        {/* Backward-compatible alias for older drop-creation return URLs. */}
        <Route path="/hype-rooms/new" component={CreateHypeRoom} />
        <Route path="/rooms/:id" component={HypeRoomDetail} />
        <Route path="/rooms" component={HypeRooms} />
        <Route path="/drops/new" component={CreateDrop} />
        <Route path="/drops/:id" component={DropDetail} />
        <Route path="/drops" component={Drops} />
        <Route path="/messages/requests" component={MessageRequests} />
        <Route
          path="/messages/requests/:requestId"
          component={MessageRequestDetail}
        />
        {/* /messages/:id must mount DesktopMessages, not MessageDetail: the
          desktop two-pane shell renders MessageDetail inside its own
          /messages/:id route. Mobile keeps the same full-screen MessageDetail
          because DesktopMessages hides its sidebar for conversations. */}
        <Route path="/messages/:id" component={DesktopMessages} />
        <Route path="/messages" component={DesktopMessages} />
        {/* Hashtag page - case-insensitive via backend normalization */}
        <Route path="/tag/:tag" component={HashtagPage} />
        <Route path="/login" component={Home} />
        <Route path="/" component={Home} />
        <Route path="/profile" component={Home} />
        <Route path="/@:username" component={Home} />
        <Route path="/profile/:id" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <SupabaseAuthProvider>
            <ThemedToaster />
            <OfflineBanner />
            <AppRoutes />
          </SupabaseAuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
