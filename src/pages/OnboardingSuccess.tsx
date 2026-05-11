import SuccessScreen from "@/components/onboarding/SuccessScreen";

const OnboardingSuccess = ({ onComplete }: { onComplete: () => void }) => {
  return <SuccessScreen onComplete={onComplete} />;
};

export default OnboardingSuccess;

