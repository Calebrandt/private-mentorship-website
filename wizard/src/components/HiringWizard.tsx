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
import AgreementStep from './steps/AgreementStep';
import IdentityStep from './steps/IdentityStep';
import AddressStep from './steps/AddressStep';
import TransportationStep from './steps/TransportationStep';
import WorkEnvStep from './steps/WorkEnvStep';
import AvailabilityStep from './steps/AvailabilityStep';
import WorkHistoryStep from './steps/WorkHistoryStep';
import ChildExpStep from './steps/ChildExpStep';
import ValuesStep from './steps/ValuesStep';

// Validators mirror the existing hiring-apply.html STEPS array — same semantics,
// so when we wire to Supabase later the contract is identical.
type ValidatorEntry = { ok: (s: WizardState) => boolean; err: string | ((s: WizardState) => string) };
const VALIDATORS: Partial<Record<StepKey, ValidatorEntry>> = {
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
  AGREEMENT: {
    ok: s => {
      const bcAck = !!s.agreementBcFactSheetAck;
      const initialsOk = typeof s.agreementInitialsDataUrl === 'string' && (s.agreementInitialsDataUrl as string).startsWith('data:image/');
      const clauses = (s.agreementInitialedClauses as Record<string, string> | undefined) || {};
      const allTwelve = Object.keys(clauses).length === 12;
      const sigOk = typeof s.agreementSignatureDataUrl === 'string' && (s.agreementSignatureDataUrl as string).startsWith('data:image/');
      const nameOk = typeof s.agreementSignatureName === 'string' && (s.agreementSignatureName as string).trim().length >= 2;
      const ackOk = !!s.agreementFinalAck;
      return bcAck && initialsOk && allTwelve && sigOk && nameOk && ackOk;
    },
    err: s => {
      if (!s.agreementInitialsDataUrl) return 'Please draw your initials in Step A before signing the Agreement.';
      const clauses = (s.agreementInitialedClauses as Record<string, string> | undefined) || {};
      if (Object.keys(clauses).length < 12) return `Please initial all 12 clauses (${12 - Object.keys(clauses).length} remaining).`;
      if (!s.agreementSignatureName || (s.agreementSignatureName as string).trim().length < 2) return 'Please type the Assistant’s full legal name in Step B.';
      if (!s.agreementSignatureDataUrl) return 'Please draw the full signature in Step B of the Agreement.';
      if (!s.agreementFinalAck) return 'Please confirm the final acknowledgment checkbox in Step B.';
      if (!s.agreementBcFactSheetAck) return 'Please read the BC Employment Standards fact sheet in Step C and confirm before continuing.';
      return 'Please complete the Agreement before continuing.';
    },
  },
  IDENTITY: {
    ok: s =>
      typeof s.legalName === 'string' && (s.legalName as string).trim().length >= 2 &&
      typeof s.preferredName === 'string' && (s.preferredName as string).trim().length >= 1 &&
      typeof s.phone === 'string' && (s.phone as string).replace(/\D/g, '').length >= 10 &&
      typeof s.dob === 'string' && (s.dob as string).length === 10,
    err: 'Please complete all personal information fields.',
  },
  ADDRESS: {
    ok: s => {
      const line1 = typeof s.addressLine1 === 'string' && (s.addressLine1 as string).trim().length >= 3;
      const city = typeof s.city === 'string' && (s.city as string).trim().length >= 2;
      const province = typeof s.province === 'string' && (s.province as string).length === 2;
      const postal = typeof s.postalCode === 'string' && /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test((s.postalCode as string).trim());
      return line1 && city && province && postal;
    },
    err: s => {
      if (typeof s.addressLine1 !== 'string' || (s.addressLine1 as string).trim().length < 3) return 'Please enter your street address.';
      if (typeof s.city !== 'string' || (s.city as string).trim().length < 2) return 'Please enter your city.';
      if (typeof s.province !== 'string' || (s.province as string).length !== 2) return 'Please select your province.';
      if (typeof s.postalCode !== 'string' || !/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test((s.postalCode as string).trim())) return 'Please enter a valid postal code (example: V6B 2N4).';
      return 'Please complete your address.';
    },
  },
  TRANSPORTATION: {
    ok: s =>
      typeof s.hasCar === 'boolean' &&
      typeof s.willingTransit === 'boolean' &&
      typeof s.canDriveClients === 'boolean' &&
      typeof s.validLicense === 'boolean',
    err: 'Please answer all four transportation questions.',
  },
  WORK_ENV: {
    ok: s => {
      const anyLoc = !!s.locAssistantHome || !!s.locClientHome || !!s.locOnline || !!s.locCommunity;
      if (!anyLoc) return false;
      if (s.locAssistantHome) {
        return (
          typeof s.homeShareStatus === 'boolean' &&
          typeof s.homeSubstanceFree === 'boolean' &&
          typeof s.homeEnvDescription === 'string' &&
          (s.homeEnvDescription as string).trim().length >= 20
        );
      }
      return true;
    },
    err: 'Please pick at least one work location and complete any required home details.',
  },
  AVAILABILITY: {
    ok: s => {
      const anyWindow = !!s.availWeekdays || !!s.availEvenings || !!s.availWeekends;
      const hours = typeof s.minHoursPerWeek === 'number' && (s.minHoursPerWeek as number) > 0;
      return anyWindow && hours;
    },
    err: 'Select at least one availability window and your minimum weekly hours.',
  },
  WORK_HISTORY: {
    ok: s =>
      typeof s.workRole === 'string' && (s.workRole as string).trim().length >= 2 &&
      typeof s.workYears === 'number' && (s.workYears as number) >= 0 &&
      typeof s.workSummary === 'string' && (s.workSummary as string).trim().length >= 20,
    err: 'Please complete role, years, and a summary of at least 20 characters.',
  },
  CHILD_EXP: {
    ok: s => {
      const anyAge = !!s.childAges_0_5 || !!s.childAges_6_12 || !!s.childAges_13_18;
      const summaryOk = typeof s.childExpSummary === 'string' && (s.childExpSummary as string).trim().length >= 30;
      return anyAge && summaryOk;
    },
    err: 'Select at least one age group and write at least 30 characters of experience.',
  },
  VALUES: {
    ok: s => {
      const anyValue =
        !!s.valPatience || !!s.valStructure || !!s.valAccountability ||
        !!s.valSafety || !!s.valAcademic || !!s.valIndependence;
      const summaryOk = typeof s.valSummary === 'string' && (s.valSummary as string).trim().length >= 20;
      return anyValue && summaryOk;
    },
    err: 'Select at least one core value and write at least 20 characters about your approach.',
  },
};

const PHASE_1_STEPS: StepKey[] = ['WELCOME', 'CONSENT', 'POSITION_STRATEGY', 'EARNINGS', 'AGREEMENT'];
const PHASE_2_STEPS: StepKey[] = ['IDENTITY', 'ADDRESS', 'TRANSPORTATION', 'WORK_ENV', 'AVAILABILITY', 'WORK_HISTORY', 'CHILD_EXP', 'VALUES'];
const BUILT_STEPS: Set<StepKey> = new Set([...PHASE_1_STEPS, ...PHASE_2_STEPS]);

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
      setErrorMsg(typeof v.err === 'function' ? v.err(state) : v.err);
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

  const continueLabel = stepIndex === TOTAL_STEPS - 1 ? 'Submit application' : 'Continue';
  const continueEnabled = BUILT_STEPS.has(currentStep);

  return (
    <>
      <nav className="hw-nav">
        <a className="hw-nav__logo" href="/">Private Mentorship</a>
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
    case 'AGREEMENT':
      return <AgreementStep state={state} patch={patch} />;
    case 'IDENTITY':
      return <IdentityStep state={state} patch={patch} />;
    case 'ADDRESS':
      return <AddressStep state={state} patch={patch} />;
    case 'TRANSPORTATION':
      return <TransportationStep state={state} patch={patch} />;
    case 'WORK_ENV':
      return <WorkEnvStep state={state} patch={patch} />;
    case 'AVAILABILITY':
      return <AvailabilityStep state={state} patch={patch} />;
    case 'WORK_HISTORY':
      return <WorkHistoryStep state={state} patch={patch} />;
    case 'CHILD_EXP':
      return <ChildExpStep state={state} patch={patch} />;
    case 'VALUES':
      return <ValuesStep state={state} patch={patch} />;
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
