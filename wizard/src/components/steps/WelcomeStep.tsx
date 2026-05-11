import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

export default function WelcomeStep({ state, patch }: Props) {
  const ack = !!state.welcomeAck;
  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 1 of 24 · Welcome</p>
      <h1 className="hw-step__title">Welcome to the Application</h1>
      <p className="hw-step__sub">
        Thank you for your interest in joining Private Mentorship as a Private Family Assistant. Each application is reviewed individually and typically takes about thirty minutes to complete.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">Before you begin</h3>
        <p className="hw-card__sub">
          Twenty-four short steps. Your progress is saved automatically — you can leave and return any time.
        </p>
        <button
          type="button"
          className={`hw-ack ${ack ? 'is-active' : ''}`}
          onClick={() => patch({ welcomeAck: !ack })}
        >
          <span className="hw-ack__box" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span className="hw-ack__text">
            <strong>I understand.</strong> I'll answer honestly and complete every section.
          </span>
        </button>
      </div>
    </div>
  );
}
