import { useEffect, useState } from 'react';

const ANIMATION_MS = 180;

export default function MobileSlidePanel({ open, onClose, title, className = '', children }) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return undefined;
    }
    if (!mounted) return undefined;
    setClosing(true);
    const timer = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;

  return (
    <div className={`mobile-slide-overlay${closing ? ' closing' : ''}`} onClick={onClose}>
      <div
        className={`mobile-slide-panel ${className}${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mobile-slide-header">
          <h3>{title}</h3>
          <button className="mobile-slide-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
