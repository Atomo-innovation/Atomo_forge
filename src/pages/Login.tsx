import LoginScreen from "@/components/onboarding/LoginScreen";
import { hasDeviceProfile } from "@/services/deviceProfile";
import { hydrateDeviceProfileFromServer } from "@/services/deviceRegistrations";
import { useNavigate } from "react-router-dom";

const Login = ({
  onLoginSuccess,
}: {
  onLoginSuccess: (username: string) => void | Promise<void>;
}) => {
  const navigate = useNavigate();

  const routeAfterLogin = async (username: string) => {
    await onLoginSuccess(username);
    const registered =
      hasDeviceProfile(username) ||
      (await hydrateDeviceProfileFromServer(username));
    navigate(registered ? "/dashboard" : "/register", { replace: true });
  };

  return (
    <LoginScreen
      onGetStarted={() => navigate("/register")}
      onLoginSuccess={routeAfterLogin}
    />
  );
};

export default Login;

