export default function CollapsedStrip({ label, onExpand }) {
  return (
    <div className="collapsed-strip">
      <button className="collapse-toggle" onClick={onExpand} title={`Expand ${label}`}>
        &raquo;
      </button>
      <span className="collapsed-label">{label}</span>
    </div>
  );
}
