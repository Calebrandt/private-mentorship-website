import { useEffect, useRef, useState } from 'react';
import {
  ALL_STEPS,
  TOTAL_STEPS,
  phaseOfStep,
  type StepKey,
  type WizardState,
  type SaveStatus,
} from '../types/wizard';
import PhaseSidebar from './PhaseSidebar';
import IllustrationPanel from './IllustrationPanel';
import StepNav from './StepNav';
import WelcomeStep from './steps/WelcomeStep';
import ConsentStep from './steps/ConsentStep';
import PositionStrategyStep from './steps/PositionStrategyStep';
import EarningsStep from './steps/EarningsStep';

// Validators mirror the existing hiring-apply.html STEPS array — same semantics,
// so when we wire to Supabase later the contract is identical.
const VALIDATORS: Partial<Record<StepKey, { ok: (s: WizardState) => boolean; err: string }>> = {
  WELCOME: {
    ok: s => s.welcomeAck === true,
    err: 'Please acknowledge to continue.',
  },
  CONSENT: {
    ok: s => !!s.consentShare && !!s.consentReview,
    err: 'Please acknowledge both consents.',
  },
  POSITION_STRATEGY: {
    ok: s => !!s.formatSelection && Array.isArray(s.serviceTypes) && (s.serviceTypes as string[]).length > 0,
    err: 'Pick a format and at least one type of work.',
  },
  EARNINGS: {
    ok: s => !!s.contractorAck1 && !!s.contractorAck2 && !!s.contractorAck3,
    err: 'Please acknowledge all three terms.',
  },
};

const PHASE_1_STEPS: StepKey[] = ['WELCOME', 'CONSENT', 'POSITION_STRATEGY', 'EARNINGS'];

export default function HiringWizard() {
  const [state, setState] = useState<WizardState>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentStep: StepKey = ALL_STEPS[stepIndex] || 'WELCOME';
  const currentPhase = phaseOfStep(currentStep);

  function patch(next: Partial<WizardState>) {
    setState(prev => ({ ...prev, ...next }));
    setErrorMsg(null);
    setSaveStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveStatus('saved'), 600);
  }

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  function handleContinue() {
    const v = VALIDATORS[currentStep];
    if (v && !v.ok(state)) {
      setErrorMsg(v.err);
      return;
    }
    setErrorMsg(null);
    if (stepIndex < TOTAL_STEPS - 1) {
      setStepIndex(stepIndex + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function handleBack() {
    setErrorMsg(null);
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function handleJumpTo(step: StepKey) {
    const idx = ALL_STEPS.indexOf(step);
    if (idx >= 0 && idx <= stepIndex) {
      setErrorMsg(null);
      setStepIndex(idx);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  const inPhase1 = PHASE_1_STEPS.includes(currentStep);
  const continueLabel = stepIndex === TOTAL_STEPS - 1 ? 'Submit application' : 'Continue';
  const continueEnabled = inPhase1;

  return (
    <>
      <nav className="hw-nav">
        <a className="hw-nav__logo" href="/hiring-apply">Private Mentorship</a>
        <div className="hw-nav__right">
          <NavSaveIndicator status={saveStatus} />
          <button
            type="button"
            className="hw-nav__help"
            onClick={() => alert('Save & Exit — wires to existing flow next session.')}
          >
            Save &amp; Exit
          </button>
        </div>
      </nav>

      <main className="hw-stage">
        <PhaseSidebar currentStep={currentStep} onJumpTo={handleJumpTo} />
        <section className="hw-stage__form">
          {renderStep(currentStep, state, patch)}
          {errorMsg && <div className="hw-error">{errorMsg}</div>}
          <StepNav
            canBack={stepIndex > 0}
            canContinue={continueEnabled}
            onBack={handleBack}
            onContinue={handleContinue}
            continueLabel={continueLabel}
          />
        </section>
        <IllustrationPanel phase={currentPhase} />
      </main>
    </>
  );
}

function NavSaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'saving') return <span className="hw-nav__saving">Saving…</span>;
  if (status === 'saved') {
    return (
      <span className="hw-nav__saved">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Saved
      </span>
    );
  }
  if (status === 'error') {
    return <span className="hw-nav__saving" style={{ color: 'var(--danger)' }}>Save failed</span>;
  }
  return null;
}

function renderStep(
  step: StepKey,
  state: WizardState,
  patch: (next: Partial<WizardState>) => void
) {
  switch (step) {
    case 'WELCOME':
      return <WelcomeStep state={state} patch={patch} />;
    case 'CONSENT':
      return <ConsentStep state={state} patch={patch} />;
    case 'POSITION_STRATEGY':
      return <PositionStrategyStep state={state} patch={patch} />;
    case 'EARNINGS':
      return <EarningsStep state={state} patch={patch} />;
    default:
      return <BuildInProgress step={step} />;
  }
}

function BuildInProgress({ step }: { step: StepKey }) {
  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Coming next session</p>
      <h1 className="hw-step__title">Step {step}</h1>
      <p className="hw-step__sub">
        This step is part of the next build phase. Phase 1 (steps 1–4) is complete. The remaining 20 steps are queued for sessions 2 and 3.
      </p>
      <div className="hw-callout">
        <p className="hw-callout__title">Prototype scope</p>
        <p className="hw-callout__body">
          The framework, sidebar, two-column body, and step transitions are all here. We just haven't ported steps 5–24 yet — that's the next session.
        </p>
      </div>
    </div>
  );
}
