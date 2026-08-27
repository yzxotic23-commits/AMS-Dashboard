import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import {
  imageFileFromClipboard,
  imageFileFromList,
  readScreenshotFile,
  SCREENSHOT_ACCEPT,
} from '../lib/screenshot-file';

function isTypingTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(el.closest('input, textarea, select, [contenteditable="true"]'));
}

export default function ScreenshotUpload({
  value,
  onChange,
  onError,
  label = 'Upload IP setup screenshot',
  hint = 'Click, paste (Ctrl/Cmd+V), or drag & drop · JPEG, PNG, WebP · max 4 MB',
  caption = 'As evidence for operator review',
}) {
  const inputId = useId();
  const inputRef = useRef(null);
  const blockOpenRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  const onErrorRef = useRef(onError);
  onChangeRef.current = onChange;
  onErrorRef.current = onError;

  function reportError(err) {
    (onErrorRef.current || ((msg) => window.alert(msg)))(err?.message || 'Could not load screenshot');
  }

  function openFilePicker() {
    if (blockOpenRef.current) return;
    inputRef.current?.click();
  }

  function handleRemove(e) {
    e.preventDefault();
    e.stopPropagation();
    blockOpenRef.current = true;
    onChangeRef.current('');
    window.setTimeout(() => {
      blockOpenRef.current = false;
    }, 300);
  }

  async function handleFile(file) {
    try {
      const dataUrl = await readScreenshotFile(file);
      onChangeRef.current(dataUrl);
    } catch (err) {
      onChangeRef.current('');
      reportError(err);
    }
  }

  async function onPickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await handleFile(file);
  }

  function onDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragging(true);
  }

  function onDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  }

  async function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragging(false);
    const file = imageFileFromList(e.dataTransfer?.files);
    if (!file) {
      reportError(new Error('Drop a JPEG, PNG, or WebP image'));
      return;
    }
    await handleFile(file);
  }

  useEffect(() => {
    function onPaste(e) {
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      const file = imageFileFromClipboard(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      handleFile(file);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  return (
    <div
      className={`shot-upload-field${dragging ? ' shot-upload-field--dragging' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={SCREENSHOT_ACCEPT}
        className="sr-only"
        onChange={onPickFile}
      />
      {value ? (
        <div className={`shot-upload shot-upload--filled${dragging ? ' shot-upload--drag' : ''}`}>
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
            {dragging && (
              <div className="shot-upload-drop-overlay" aria-hidden>
                Drop to replace
              </div>
            )}
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
          className={`shot-upload${dragging ? ' shot-upload--drag' : ''}`}
          onClick={openFilePicker}
          aria-labelledby={inputId}
        >
          <div className="shot-upload-inner">
            <ImagePlus size={20} strokeWidth={1.75} className="text-ams-faint" />
            <span className="shot-upload-prompt">
              {dragging ? 'Drop screenshot here' : 'Click, paste, or drop screenshot'}
            </span>
            <span className="shot-upload-hint">{hint}</span>
          </div>
          {caption && <p className="shot-upload-caption">{caption}</p>}
          <span className="sr-only">{label}</span>
        </button>
      )}
    </div>
  );
}
