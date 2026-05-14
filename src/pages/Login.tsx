import LoginScreen from "@/components/onboarding/LoginScreen";
import { hasDeviceProfile } from "@/services/deviceProfile";
import { useNavigate } from "react-router-dom";

const Login = ({ onLoginSuccess }: { onLoginSuccess: (username: string) => void }) => {
  const navigate = useNavigate();

  const routeAfterLogin = (username: string) => {
    onLoginSuccess(username);
    navigate(hasDeviceProfile(username) ? "/dashboard" : "/register");
  };

  return (
    <LoginScreen
      onGetStarted={() => navigate("/register")}
      onLoginSuccess={routeAfterLogin}
    />
  );
};

export default Login;

