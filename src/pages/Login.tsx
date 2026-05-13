import LoginScreen from "@/components/onboarding/LoginScreen";
import { useNavigate } from "react-router-dom";

const Login = ({ onLoginSuccess }: { onLoginSuccess: () => void }) => {
  const navigate = useNavigate();

  // Flow is strictly: /login -> /register -> /dashboard.
  // /register decides what to do (and triggers the App-level "registered"
  // flag) when the user finishes the form.
  const routeAfterLogin = () => {
    onLoginSuccess();
    navigate("/register");
  };

  return (
    <LoginScreen
      onGetStarted={() => navigate("/register")}
      onLoginSuccess={routeAfterLogin}
    />
  );
};

export default Login;

