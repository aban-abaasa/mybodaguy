import { X } from 'lucide-react';

// Fullscreen tap-to-view for any message image — click the image anywhere
// it's rendered to open it here, click the backdrop or the X to dismiss.
// Deliberately just takes a src/alt: no carousel, no timers.
interface ImageLightboxProps {
  src: string | null;
  alt?: string;
  onClose: () => void;
}

export default function ImageLightbox({ src, alt = '', onClose }: ImageLightboxProps) {
  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        title="Close"
      >
        <X className="h-6 w-6" />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
