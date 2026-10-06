import { useEffect, useRef } from 'react';
import { useAds } from './adsContext';
import { ADSENSE_CLIENT, getPlacementSlotId } from '../../config/ads';

// A controlled ad placement. It renders nothing at all unless the
// AdSenseManager has authorised the current screen — the manager is the only
// place the route policy is evaluated, this component just mirrors it.
//
// Layout rules: contained and full-width, never fixed/overlaid, never styled to
// look like a PolyNurse card or button, and kept away from primary controls by
// the call site. It must never dominate the page content around it.
const AdSenseSlot = ({ placement, format = 'auto' }) => {
  const { adsEnabled } = useAds();
  const slotId = getPlacementSlotId(placement);
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!adsEnabled || !slotId || pushedRef.current) return;
    // The queue pattern is safe before the loader finishes: adsbygoogle.js
    // drains window.adsbygoogle once it arrives. Exactly one push per mounted
    // slot — Strict Mode and remounts never double-request an <ins>.
    window.adsbygoogle = window.adsbygoogle || [];
    try {
      window.adsbygoogle.push({});
      pushedRef.current = true;
    } catch (err) {
      console.warn('AdSense push skipped:', err);
    }
  }, [adsEnabled, slotId]);

  if (!adsEnabled || !slotId) return null;

  return (
    <div className="w-full overflow-hidden" role="complementary" aria-label="Advertisement">
      <div className="w-full text-center mb-1">
        <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-slate-300 dark:text-slate-600">
          Ad
        </span>
      </div>
      <ins
        className="adsbygoogle"
        style={{ display: 'block', minHeight: 90 }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slotId}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
};

export default AdSenseSlot;