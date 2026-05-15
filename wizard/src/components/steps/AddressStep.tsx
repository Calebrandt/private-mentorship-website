import { useEffect, useRef } from 'react';
import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

const ADDRESS_FIELDS = ['addressLine1', 'addressLine2', 'city', 'province', 'postalCode'] as const;

const PROVINCES = [
  { code: 'BC', label: 'British Columbia' },
  { code: 'AB', label: 'Alberta' },
  { code: 'SK', label: 'Saskatchewan' },
  { code: 'MB', label: 'Manitoba' },
  { code: 'ON', label: 'Ontario' },
  { code: 'QC', label: 'Quebec' },
  { code: 'NB', label: 'New Brunswick' },
  { code: 'NS', label: 'Nova Scotia' },
  { code: 'PE', label: 'Prince Edward Island' },
  { code: 'NL', label: 'Newfoundland and Labrador' },
  { code: 'YT', label: 'Yukon' },
  { code: 'NT', label: 'Northwest Territories' },
  { code: 'NU', label: 'Nunavut' },
];

export default function AddressStep({ state, patch }: Props) {
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Sync browser autofill into React state — especially for the province <select>
  // (browsers don't reliably fire change events on <select> when autofilling).
  useEffect(() => {
    const sync = () => {
      const updates: Record<string, string> = {};
      ADDRESS_FIELDS.forEach(id => {
        const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
        if (!el) return;
        const cur = (stateRef.current[id] as string) || '';
        if (el.value && el.value !== cur) updates[id] = el.value;
      });
      if (Object.keys(updates).length > 0) patch(updates as Partial<WizardState>);
    };
    const ts = [120, 350, 700, 1500].map(ms => setTimeout(sync, ms));
    return () => ts.forEach(clearTimeout);
  }, [patch]);

  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 7 of 25 · About You</p>
      <h1 className="hw-step__title">Residential Address</h1>
      <p className="hw-step__sub">
        Your address helps us match you with families in your service area. Personal address details are not shared with matched families.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">Where you live</h3>

        <div className="hw-form-row">
          <label className="hw-label" htmlFor="addressLine1">Street address</label>
          <input
            id="addressLine1"
            type="text"
            className="hw-input"
            placeholder="123 Main Street"
            value={(state.addressLine1 as string) || ''}
            onChange={e => patch({ addressLine1: e.target.value })}
          />
        </div>

        <div className="hw-form-row">
          <label className="hw-label" htmlFor="addressLine2">Apartment, suite, or unit (optional)</label>
          <input
            id="addressLine2"
            type="text"
            className="hw-input"
            placeholder="Suite 410"
            value={(state.addressLine2 as string) || ''}
            onChange={e => patch({ addressLine2: e.target.value })}
          />
        </div>

        <div className="hw-form-grid hw-form-grid--3">
          <div className="hw-form-row">
            <label className="hw-label" htmlFor="city">City</label>
            <input
              id="city"
              type="text"
              className="hw-input"
              placeholder="Vancouver"
              value={(state.city as string) || ''}
              onChange={e => patch({ city: e.target.value })}
            />
          </div>
          <div className="hw-form-row">
            <label className="hw-label" htmlFor="province">Province</label>
            <select
              id="province"
              className="hw-select"
              value={(state.province as string) || 'BC'}
              onChange={e => patch({ province: e.target.value })}
            >
              {PROVINCES.map(p => (
                <option key={p.code} value={p.code}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="hw-form-row">
            <label className="hw-label" htmlFor="postalCode">Postal code</label>
            <input
              id="postalCode"
              type="text"
              className="hw-input"
              placeholder="V6B 2N4"
              value={(state.postalCode as string) || ''}
              onChange={e => {
                const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                const formatted = raw.length > 3 ? raw.slice(0, 3) + ' ' + raw.slice(3, 6) : raw;
                patch({ postalCode: formatted });
              }}
              maxLength={7}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
