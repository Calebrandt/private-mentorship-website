import {
  PHASES,
  ALL_STEPS,
  type PhaseKey,
  type StepKey,
} from '../types/wizard';

// Display labels for each step — mirrors STEP_LABELS in the existing
// hiring-apply.html so the sidebar reads identical to the production wizard
// when the rest of the steps are wired up.
const STEP_LABEL: Record<StepKey, string> = {
  WELCOME: 'Welcome',
  CONSENT: 'Transparency',
  POSITION_STRATEGY: 'The work',
  EARNINGS: 'Pay & terms',
  IDENTITY: 'Identity',
  ADDRESS: 'Address',
  TRANSPORTATION: 'Transportation',
  WORK_ENV: 'Work environment',
  AVAILABILITY: 'Availability',
  WORK_HISTORY: 'Work history',
  CHILD_EXP: 'Child experience',
  VALUES: 'Strengths',
  UPLOADS_CORE: 'Documents',
  BACKGROUND_INFO: 'Background check',
  UPLOADS_BACKGROUND: 'Upload check',
  CERTS_INFO: 'Certificates',
  UPLOADS_CERTS: 'Upload certs',
  SCENARIOS: 'Scenarios',
  PROFILE_PREVIEW: 'Profile preview',
  BOUNDARIES: 'Boundaries',
  CONFIDENTIALITY: 'Confidentiality',
  LEGAL_LIABILITY: 'Legal liability',
  FINAL_REVIEW: 'Final review',
  SUBMIT: 'Submit',
};

interface Props {
  currentStep: StepKey;
  onJumpTo?: (step: StepKey) => void;
}

export default function PhaseSidebar({ currentStep, onJumpTo }: Props) {
  const currentIndex = ALL_STEPS.indexOf(currentStep);

  return (
    <aside className="hw-sidebar">
      <div className="hw-sidebar__head">
        <p className="hw-sidebar__eyebrow">Application</p>
        <h2 className="hw-sidebar__title">Your progress</h2>
      </div>
      <ol className="hw-sidebar__list">
        {PHASES.map((phase, phaseIdx) => {
          const phaseStepIndices = phase.steps.map(s => ALL_STEPS.indexOf(s));
          const isPhaseDone = phaseStepIndices.every(i => i < currentIndex);
          const isPhaseCurrent = phase.steps.includes(currentStep);
          const isPhaseFuture = !isPhaseDone && !isPhaseCurrent;

          return (
            <li key={phase.key} className={`hw-sidebar__phase ${isPhaseCurrent ? 'is-current' : ''} ${isPhaseDone ? 'is-done' : ''}`}>
              <div className="hw-sidebar__phase-row">
                <span className={`hw-sidebar__phase-dot ${isPhaseDone ? 'is-done' : isPhaseCurrent ? 'is-current' : ''}`}>
                  {isPhaseDone ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <span className="hw-sidebar__phase-num">{phaseIdx + 1}</span>
                  )}
                </span>
                <span className="hw-sidebar__phase-label">{phase.label}</span>
              </div>

              {isPhaseCurrent && (
                <ul className="hw-sidebar__steps">
                  {phase.steps.map(step => {
                    const stepIdx = ALL_STEPS.indexOf(step);
                    const isStepDone = stepIdx < currentIndex;
                    const isStepCurrent = step === currentStep;
                    const canJumpBack = isStepDone && !!onJumpTo;
                    const cls = [
                      'hw-sidebar__step',
                      isStepDone ? 'is-done' : '',
                      isStepCurrent ? 'is-current' : '',
                      canJumpBack ? 'is-clickable' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <li key={step}>
                        <button
                          type="button"
                          className={cls}
                          onClick={() => canJumpBack && onJumpTo?.(step)}
                          disabled={!canJumpBack && !isStepCurrent}
                        >
                          <span className="hw-sidebar__step-mark">
                            {isStepDone ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : isStepCurrent ? (
                              <span className="hw-sidebar__step-active-dot" />
                            ) : null}
                          </span>
                          <span className="hw-sidebar__step-label">{STEP_LABEL[step]}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {!isPhaseCurrent && (
                <p className="hw-sidebar__phase-meta">
                  {isPhaseDone
                    ? `${phase.steps.length} of ${phase.steps.length} done`
                    : `${phase.steps.length} step${phase.steps.length === 1 ? '' : 's'}`}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
