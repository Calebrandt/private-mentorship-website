import { useEffect, useRef, useState } from 'react';
import type { PhaseDef } from '../types/wizard';

interface Props {
  phase: PhaseDef;
}

const PHASE_HINT: Record<string, string> = {
  ONBOARDING: 'welcome / pana',
  ABOUT_YOU: 'online-resume / pana',
  VERIFICATION: 'personal-data / pana',
  SCENARIOS: 'job-interview / pana',
  AGREEMENTS: 'agreement / pana',
};

export default function IllustrationPanel({ phase }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
    // If the image is already cached, the browser fires the load event before
    // React attaches the listener. Check synchronously after mount so we don't
    // sit on the placeholder forever.
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [phase.illustration]);

  const showPlaceholder = errored || !loaded;

  return (
    <div className="hw-stage__art">
      <img
        ref={imgRef}
        key={phase.illustration}
        src={phase.illustration}
        alt={`${phase.label} illustration`}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        style={{ display: loaded && !errored ? 'block' : 'none' }}
      />
      {showPlaceholder && (
        <div className="hw-stage__art-placeholder">
          <strong>{phase.label}</strong>
          <p style={{ margin: 0 }}>Drop your Pana illustration here.</p>
          <code>{phase.illustration}</code>
          <p style={{ marginTop: 14, fontSize: 11.5, color: 'var(--ink-tert)' }}>
            Source: storyset.com/illustration/{PHASE_HINT[phase.key]}
          </p>
        </div>
      )}
    </div>
  );
}
