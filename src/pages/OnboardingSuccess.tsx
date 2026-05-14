import SuccessScreen from "@/components/onboarding/SuccessScreen";

const OnboardingSuccess = ({ onComplete }: { onComplete: (meshUsername?: string | null) => void }) => {
  return <SuccessScreen onComplete={onComplete} />;
};

export default OnboardingSuccess;

