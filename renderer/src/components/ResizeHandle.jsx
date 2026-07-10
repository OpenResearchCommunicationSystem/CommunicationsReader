import { useRef } from 'react';

// Drag handle placed between two panel columns. Reports relative pixel
// deltas via onResize rather than absolute positions -- the caller owns
// which panel's width state actually moves (and in which direction) since
// that mapping differs for the handle to the right of the flexible
// reading pane (see App.jsx).
export default function ResizeHandle({ onResize }) {
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);

  function handleMouseMove(e) {
    if (!draggingRef.current) return;
    const delta = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    if (delta !== 0) onResize(delta);
  }

  function handleMouseUp() {
    draggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  function handleMouseDown(e) {
    draggingRef.current = true;
    lastXRef.current = e.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  return <div className="resize-handle" onMouseDown={handleMouseDown} />;
}
