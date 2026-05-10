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
      <h1 className="hw-step__title">A serious application for serious work.</h1>
      <p className="hw-step__sub">
        This application is intentionally detailed. We do not offer interviews until your application is complete and verified — usually within five business days.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">Before you begin</h3>
        <p className="hw-card__sub">
          Twenty-four steps. About thirty minutes. Save and resume any time on this device.
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
            <strong>I understand.</strong> I'm ready to give this application my full attention. I will answer honestly and completely.
          </span>
        </button>
      </div>
    </div>
  );
}
