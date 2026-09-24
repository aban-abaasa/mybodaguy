// Classic barcode-scanner viewfinder: dimmed surround, corner brackets and a sweeping
// red laser line. Purely visual — drop it inside a relative, overflow-hidden camera box.
// status: null (scanning) | 'ok' (green corners) | 'error' (red corners)
interface ScanFrameOverlayProps {
  status?: 'ok' | 'error' | null;
  hint?: string;
  frameClassName?: string;
}

const ScanFrameOverlay = ({ status = null, hint = '', frameClassName = 'inset-x-[10%] top-[22%] bottom-[22%]' }: ScanFrameOverlayProps) => {
  const corner = status === 'ok' ? 'border-green-400' : status === 'error' ? 'border-red-400' : 'border-white';
  return (
    <>
      <style>{`@keyframes ican-scan-line { from { top: 4%; } to { top: 96%; } }`}</style>
      {/* The huge box-shadow dims everything outside the frame; the parent must be overflow-hidden */}
      <div className={`pointer-events-none absolute rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ${frameClassName}`}>
        <div className={`absolute left-0 top-0 h-8 w-8 rounded-tl-lg border-l-4 border-t-4 ${corner}`} />
        <div className={`absolute right-0 top-0 h-8 w-8 rounded-tr-lg border-r-4 border-t-4 ${corner}`} />
        <div className={`absolute bottom-0 left-0 h-8 w-8 rounded-bl-lg border-b-4 border-l-4 ${corner}`} />
        <div className={`absolute bottom-0 right-0 h-8 w-8 rounded-br-lg border-b-4 border-r-4 ${corner}`} />
        {!status && (
          <div
            className="absolute left-3 right-3 h-0.5 rounded-full bg-red-500 shadow-[0_0_10px_2px_rgba(239,68,68,0.8)]"
            style={{ animation: 'ican-scan-line 1.8s ease-in-out infinite alternate' }}
          />
        )}
      </div>
      {hint && (
        <p className="pointer-events-none absolute inset-x-0 bottom-3 px-3 text-center text-sm font-medium text-white drop-shadow">
          {hint}
        </p>
      )}
    </>
  );
};

export default ScanFrameOverlay;
