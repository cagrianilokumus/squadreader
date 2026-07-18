// BETA notice — shown on EVERY page load. "Anladım" just closes it for the
// current view; a refresh brings it back (deliberate: it's a standing beta
// disclaimer, not a one-time tip).

import { useState } from "react";

export function BetaNotice() {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  const dismiss = () => setOpen(false);

  return (
    <div className="beta-overlay" role="dialog" aria-modal="true">
      <div className="beta-card">
        <div className="beta-badge">BETA</div>
        <h2 className="beta-title">Sistem şu an beta aşamasında</h2>
        <p className="beta-text">
          Canlı harita ve kayıt (rewind) sistemi aktif olarak geliştiriliyor.
          Hatalarla, eksik verilerle veya beklenmedik davranışlarla
          karşılaşabilirsiniz.
        </p>
        <p className="beta-text">
          Bir hata bulursanız veya öneriniz varsa sunucu adminine
          bildirebilirsiniz — her geri bildirim sistemi daha iyi yapar. 🙏
        </p>
        <button className="beta-ok" onClick={dismiss}>Anladım, devam et</button>
      </div>
    </div>
  );
}
