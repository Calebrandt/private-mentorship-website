interface Props {
  canBack: boolean;
  canContinue: boolean;
  onBack: () => void;
  onContinue: () => void;
  continueLabel?: string;
}

export default function StepNav({
  canBack,
  canContinue,
  onBack,
  onContinue,
  continueLabel = 'Continue',
}: Props) {
  return (
    <div className="hw-actions">
      <button
        type="button"
        className="hw-actions__back"
        onClick={onBack}
        disabled={!canBack}
      >
        ← Back
      </button>
      <button
        type="button"
        className="hw-actions__continue"
        onClick={onContinue}
        disabled={!canContinue}
      >
        {continueLabel}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>
    </div>
  );
}
