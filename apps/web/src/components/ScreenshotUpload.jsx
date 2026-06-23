import { useId, useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { readScreenshotFile, SCREENSHOT_ACCEPT } from '../lib/screenshot-file';

export default function ScreenshotUpload({
  value,
  onChange,
  onError,
  label = 'Upload IP setup screenshot',
  hint = 'JPEG, PNG, or WebP · max 4 MB',
  caption = 'As evidence for operator review',
}) {
  const inputId = useId();
  const inputRef = useRef(null);
  const blockOpenRef = useRef(false);

  function openFilePicker() {
    if (blockOpenRef.current) return;
    inputRef.current?.click();
  }

  function handleRemove(e) {
    e.preventDefault();
    e.stopPropagation();
    blockOpenRef.current = true;
    onChange('');
    window.setTimeout(() => {
      blockOpenRef.current = false;
    }, 300);
  }

  async function handleFile(file) {
    try {
      const dataUrl = await readScreenshotFile(file);
      onChange(dataUrl);
    } catch (err) {
      onChange('');
      throw err;
    }
  }

  async function onPickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await handleFile(file);
    } catch (err) {
      onChange('');
      (onError || ((msg) => window.alert(msg)))(err.message || 'Could not load screenshot');
    }
  }

  return (
    <div className="shot-upload-field">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={SCREENSHOT_ACCEPT}
        className="sr-only"
        onChange={onPickFile}
      />
      {value ? (
        <div className="shot-upload shot-upload--filled">
          <div className="shot-upload-preview">
            <img src={value} alt="IP setup screenshot preview" className="shot-upload-img" />
            <button
              type="button"
              className="shot-upload-remove"
              onClick={handleRemove}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Remove screenshot"
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>
          <button
            type="button"
            className="shot-upload-replace"
            onClick={openFilePicker}
          >
            Change image
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="shot-upload"
          onClick={openFilePicker}
          aria-labelledby={inputId}
        >
          <div className="shot-upload-inner">
            <ImagePlus size={20} strokeWidth={1.75} className="text-ams-faint" />
            <span className="shot-upload-prompt">Click to upload screenshot</span>
            <span className="shot-upload-hint">{hint}</span>
          </div>
          {caption && <p className="shot-upload-caption">{caption}</p>}
          <span className="sr-only">{label}</span>
        </button>
      )}
    </div>
  );
}
