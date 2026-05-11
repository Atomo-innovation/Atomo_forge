import LoginScreen from "@/components/onboarding/LoginScreen";
import { useNavigate } from "react-router-dom";
import { hasDeviceProfile } from "@/services/deviceProfile";

const Login = ({ onLoginSuccess }: { onLoginSuccess: () => void }) => {
  const navigate = useNavigate();

  // After a successful login, send the user to the device registration page
  // unless this device has already been registered (in which case go straight
  // to the dashboard).
  const routeAfterLogin = () => {
    onLoginSuccess();
    if (hasDeviceProfile()) {
      navigate("/dashboard");
    } else {
      navigate("/register");
    }
  };

  return (
    <LoginScreen
      onGetStarted={() => navigate("/register")}
      onLoginSuccess={routeAfterLogin}
    />
  );
};

export default Login;

