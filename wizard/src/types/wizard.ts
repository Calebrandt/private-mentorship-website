// Mirrors the existing hiring-apply.html STEP_FIELDS structure so the React rebuild
// can drop into the existing js/hiring-service.js Supabase wiring without changing
// any step_key, field name, or validator semantic.

export type PhaseKey = 'ONBOARDING' | 'ABOUT_YOU' | 'VERIFICATION' | 'SCENARIOS' | 'AGREEMENTS';

export type StepKey =
  | 'WELCOME'
  | 'CONSENT'
  | 'POSITION_STRATEGY'
  | 'EARNINGS'
  | 'IDENTITY'
  | 'ADDRESS'
  | 'TRANSPORTATION'
  | 'WORK_ENV'
  | 'AVAILABILITY'
  | 'WORK_HISTORY'
  | 'CHILD_EXP'
  | 'VALUES'
  | 'UPLOADS_CORE'
  | 'BACKGROUND_INFO'
  | 'UPLOADS_BACKGROUND'
  | 'CERTS_INFO'
  | 'UPLOADS_CERTS'
  | 'SCENARIOS'
  | 'PROFILE_PREVIEW'
  | 'BOUNDARIES'
  | 'CONFIDENTIALITY'
  | 'LEGAL_LIABILITY'
  | 'FINAL_REVIEW'
  | 'SUBMIT';

export interface PhaseDef {
  key: PhaseKey;
  label: string;
  illustration: string; // public/illustrations/{phase}.svg
  steps: StepKey[];
}

export const PHASES: PhaseDef[] = [
  {
    key: 'ONBOARDING',
    label: 'Welcome',
    illustration: '/illustrations/welcome.svg',
    steps: ['WELCOME', 'CONSENT', 'POSITION_STRATEGY', 'EARNINGS'],
  },
  {
    key: 'ABOUT_YOU',
    label: 'About You',
    illustration: '/illustrations/about-you.svg',
    steps: [
      'IDENTITY',
      'ADDRESS',
      'TRANSPORTATION',
      'WORK_ENV',
      'AVAILABILITY',
      'WORK_HISTORY',
      'CHILD_EXP',
      'VALUES',
    ],
  },
  {
    key: 'VERIFICATION',
    label: 'Documents',
    illustration: '/illustrations/documents.svg',
    steps: [
      'UPLOADS_CORE',
      'BACKGROUND_INFO',
      'UPLOADS_BACKGROUND',
      'CERTS_INFO',
      'UPLOADS_CERTS',
    ],
  },
  {
    key: 'SCENARIOS',
    label: 'Scenarios',
    illustration: '/illustrations/scenarios.svg',
    steps: ['SCENARIOS', 'PROFILE_PREVIEW'],
  },
  {
    key: 'AGREEMENTS',
    label: 'Agreements',
    illustration: '/illustrations/agreements.svg',
    steps: [
      'BOUNDARIES',
      'CONFIDENTIALITY',
      'LEGAL_LIABILITY',
      'FINAL_REVIEW',
      'SUBMIT',
    ],
  },
];

export const ALL_STEPS: StepKey[] = PHASES.flatMap(p => p.steps);
export const TOTAL_STEPS = ALL_STEPS.length; // 24

export function phaseOfStep(step: StepKey): PhaseDef {
  const found = PHASES.find(p => p.steps.includes(step));
  if (!found) throw new Error(`Step ${step} not in any phase`);
  return found;
}

export function stepIndexInPhase(step: StepKey): { index: number; total: number } {
  const phase = phaseOfStep(step);
  return { index: phase.steps.indexOf(step) + 1, total: phase.steps.length };
}

export function overallStepNumber(step: StepKey): number {
  return ALL_STEPS.indexOf(step) + 1;
}

// Mirror of state shape from hiring-apply.html. Kept open via [key: string] for
// progressive build-out of all 24 steps.
export interface WizardState {
  // Phase 1 — Onboarding
  welcomeAck?: boolean;
  consentShare?: boolean;
  consentReview?: boolean;
  formatSelection?: 'IN_PERSON' | 'ONLINE' | 'HYBRID';
  serviceTypes?: string[]; // ['EDUCATION', 'LIFE_SKILLS', 'PERSONAL_SUPPORT']
  contractorAck1?: boolean;
  contractorAck2?: boolean;
  contractorAck3?: boolean;
  // Open shape — later phases will add their fields here.
  [key: string]: unknown;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
