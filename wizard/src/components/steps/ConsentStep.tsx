import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

export default function ConsentStep({ state, patch }: Props) {
  const consentShare = !!state.consentShare;
  const consentReview = !!state.consentReview;
  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 2 of 24 · Transparency</p>
      <h1 className="hw-step__title">How your information is used.</h1>
      <p className="hw-step__sub">
        Some profile information may be shared with families if you are accepted. Sensitive documents (ID, background check, certificates) are never made public.
      </p>

      <div className="hw-card">
        <p className="hw-card__sub" style={{ marginBottom: 14 }}>
          Please acknowledge both:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            className={`hw-ack ${consentShare ? 'is-active' : ''}`}
            onClick={() => patch({ consentShare: !consentShare })}
          >
            <span className="hw-ack__box" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span className="hw-ack__text">
              <strong>Profile sharing.</strong> If accepted, my preferred name, photo, summary, and qualifications may be shown to matched families. Personal documents stay private.
            </span>
          </button>

          <button
            type="button"
            className={`hw-ack ${consentReview ? 'is-active' : ''}`}
            onClick={() => patch({ consentReview: !consentReview })}
          >
            <span className="hw-ack__box" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span className="hw-ack__text">
              <strong>Review process.</strong> Private Mentorship reviews every application by hand. I understand a complete application is required before any interview is offered.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
