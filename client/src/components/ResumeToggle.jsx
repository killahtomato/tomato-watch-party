function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export default function ResumeToggle({ resumeOnStart, onToggle, restoredAt, currentTime, duration }) {
  const showNote = Boolean(
    restoredAt && Date.now() - restoredAt < 15000 && Number.isFinite(currentTime) && currentTime > 5,
  );

  return (
    <div className="resume-toggle">
      <label className="resume-label">
        <span className="resume-text">Resume on restart</span>
        <button
          type="button"
          className={`resume-switch ${resumeOnStart ? 'on' : ''}`}
          role="switch"
          aria-checked={resumeOnStart}
          onClick={() => onToggle(!resumeOnStart)}
          title="When on, playback continues after a restart. When off, it pauses and waits for the host to press play."
        >
          <span className="resume-thumb" />
        </button>
      </label>
      {showNote && <span className="resume-note">Resumed from {formatClock(currentTime)}</span>}
    </div>
  );
}
