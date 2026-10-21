import { useState, useRef } from 'react';
import { Upload, Trash2, Volume2, Music } from 'lucide-react';
import { toast } from 'sonner';
import {
  RINGTONES,
  CUSTOM_RINGTONE_ID,
  getSelectedRingtoneId,
  setSelectedRingtoneId,
  getCustomRingtoneMeta,
  saveCustomJobRingtone,
  removeCustomJobRingtone,
  playNewJobChime,
  getSelectedCallRingtoneId,
  setSelectedCallRingtoneId,
  getCustomCallRingtoneMeta,
  saveCustomCallRingtone,
  removeCustomCallRingtone,
  playCallRingtonePreview,
} from '../services/notificationSound';

interface RingtonePickerProps {
  kind: 'job' | 'call';
  title: string;
  description: string;
}

/** Shared preset-grid + "upload your own song" picker, used for both the
 * new-job ringtone (riders/drivers) and the incoming-call ringtone
 * (everyone) — see notificationSound.ts for how each `kind` is stored.
 * Rendered in the profile and on the rider's request page. */
export default function RingtonePicker({ kind, title, description }: RingtonePickerProps) {
  const isJob = kind === 'job';
  const getSelected = isJob ? getSelectedRingtoneId : getSelectedCallRingtoneId;
  const setSelected = isJob ? setSelectedRingtoneId : setSelectedCallRingtoneId;
  const getMeta = isJob ? getCustomRingtoneMeta : getCustomCallRingtoneMeta;
  const saveCustom = isJob ? saveCustomJobRingtone : saveCustomCallRingtone;
  const removeCustom = isJob ? removeCustomJobRingtone : removeCustomCallRingtone;
  const preview = isJob ? playNewJobChime : playCallRingtonePreview;

  const [selectedId, setSelectedIdState] = useState(() => getSelected());
  const [customMeta, setCustomMeta] = useState(() => getMeta());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const choose = (id: string) => {
    setSelectedIdState(id);
    setSelected(id);
    preview(id);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      await saveCustom(file);
      setCustomMeta({ name: file.name });
      choose(CUSTOM_RINGTONE_ID);
      toast.success('Ringtone uploaded');
    } catch (error: any) {
      toast.error(error.message || 'Could not use that file as a ringtone');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    await removeCustom();
    setCustomMeta(null);
    setSelectedIdState(getSelected());
  };

  return (
    <div className="mt-4">
      <label className="block text-sm font-medium text-slate-700 mb-1">{title}</label>
      <p className="text-xs text-slate-500 mb-2">{description}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {RINGTONES.map(tone => (
          <button
            key={tone.id}
            type="button"
            onClick={() => choose(tone.id)}
            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-colors ${
              selectedId === tone.id
                ? 'border-orange-500 bg-orange-50 text-orange-700'
                : 'border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            <span>{tone.label}</span>
            <Volume2 size={16} className="flex-shrink-0" />
          </button>
        ))}
      </div>

      <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFile} />

      {customMeta ? (
        <div className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-colors ${
          selectedId === CUSTOM_RINGTONE_ID ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-600'
        }`}>
          <button type="button" onClick={() => choose(CUSTOM_RINGTONE_ID)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
            <Music size={16} className="flex-shrink-0" />
            <span className="truncate">{customMeta.name}</span>
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} title="Replace song" className="p-1 rounded hover:bg-black/5 flex-shrink-0">
            <Upload size={14} />
          </button>
          <button type="button" onClick={handleRemove} title="Remove" className="p-1 rounded hover:bg-red-50 text-red-500 flex-shrink-0">
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-orange-300 hover:text-orange-600 transition-colors disabled:opacity-50"
        >
          <Music size={16} />
          {uploading ? 'Uploading…' : 'Upload a song from your phone'}
        </button>
      )}
      <p className="text-[11px] text-slate-400 mt-1">MP3, M4A or WAV, up to 8MB. Stays on this device only.</p>
    </div>
  );
}
