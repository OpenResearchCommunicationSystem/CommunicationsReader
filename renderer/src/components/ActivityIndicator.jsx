export default function ActivityIndicator({ label }) {
  const active = Boolean(label);
  return (
    <div className={`activity-indicator ${active ? 'active' : ''}`} title={active ? label : 'Idle -- nothing running'}>
      <span className="activity-dot" />
      <span className="activity-label">{active ? label : 'Idle'}</span>
    </div>
  );
}
