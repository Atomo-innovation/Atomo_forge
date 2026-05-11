import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState } from "react";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import Register from "./pages/Register";
import OnboardingSuccess from "./pages/OnboardingSuccess";
import { readLoggedIn, setLoggedIn } from "@/services/authSession";

const queryClient = new QueryClient();

const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(() => readLoggedIn());

  const handleLoginSuccess = () => {
    setLoggedIn(true);
    setIsLoggedIn(true);
  };

  const handleOnboardingComplete = () => {
    setLoggedIn(true);
    setIsLoggedIn(true);
  };

  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              isLoggedIn ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/login"
            element={
              isLoggedIn ? <Navigate to="/dashboard" replace /> : <Login onLoginSuccess={handleLoginSuccess} />
            }
          />
          <Route
            path="/register"
            element={
              isLoggedIn ? <Register /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/success"
            element={
              isLoggedIn ? <OnboardingSuccess onComplete={handleOnboardingComplete} /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/onboarding"
            element={
              isLoggedIn ? <Navigate to="/dashboard" replace /> : <Onboarding onOnboardingComplete={handleOnboardingComplete} />
            }
          />
          <Route
            path="/dashboard"
            element={
              isLoggedIn ? <Dashboard /> : <Navigate to="/login" replace />
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
