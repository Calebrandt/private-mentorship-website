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
      <p className="hw-step__eyebrow">Step 2 of 24 · Privacy</p>
      <h1 className="hw-step__title">Privacy and Information Sharing</h1>
      <p className="hw-step__sub">
        If accepted, certain profile information is shared with families you're matched with. All personal documents and verification materials remain confidential at all times.
      </p>

      <div className="hw-card">
        <p className="hw-card__sub" style={{ marginBottom: 14 }}>
          Please review and confirm:
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
              <strong>Profile visibility.</strong> I understand that, if accepted, my preferred name, photo, professional summary, and qualifications may be shared with families I am matched with.
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
              <strong>Application review.</strong> I understand that every application is reviewed individually by Private Mentorship, and a complete application is required before an interview is offered.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
