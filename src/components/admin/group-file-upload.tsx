"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileText, LoaderCircle, X } from "lucide-react";
import type { UploadedMaterial } from "@/lib/types";
import { uploadGroupFile } from "@/lib/group-upload-client";
import { fileSizeLabel, UPLOAD_ACCEPT, UPLOAD_LIMITS, uploadContentType } from "@/lib/upload-rules";
import "./group-file-upload.css";

export function GroupFileUpload({ groupId, value, onChange, disabled = false, onBusyChange }: {
  groupId: number;
  value: UploadedMaterial[];
  onChange: (files: UploadedMaterial[]) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const files = useRef(value);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const onChangeRef = useRef(onChange);
  const onBusyChangeRef = useRef(onBusyChange);
  files.current = value;
  onChangeRef.current = onChange;
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      if (busyRef.current) onBusyChangeRef.current?.(false);
      busyRef.current = false;
    };
  }, []);

  function change(next: UploadedMaterial[]) {
    files.current = next;
    onChangeRef.current(next);
  }
  async function uploadFiles(selected: File[]) {
    if (disabled || busyRef.current || !selected.length) return;
    setError("");
    if (files.current.length + selected.length > 20) { setError("Ett inlägg kan ha högst 20 dokument."); return; }
    for (const file of selected) {
      if (!uploadContentType("lesson-material", file.name)) { setError("Välj PDF- eller Word-filer (.doc eller .docx)."); return; }
      if (!file.size || file.size > UPLOAD_LIMITS["lesson-material"]) { setError("Varje fil får vara högst 20 MB."); return; }
    }
    const attempt = new AbortController();
    controller.current = attempt;
    busyRef.current = true;
    setBusy(true);
    onBusyChangeRef.current?.(true);
    try {
      for (let index = 0; index < selected.length; index++) {
        const file = selected[index];
        const label = selected.length > 1 ? `Fil ${index + 1} av ${selected.length}: ` : "";
        setProgress(`${label}Laddar upp ${file.name}…`);
        const asset = await uploadGroupFile(groupId, "document", file, attempt.signal, (percentage) => {
          if (mounted.current) setProgress(`${label}${file.name} · ${Math.round(percentage)} %`);
        });
        if (!mounted.current || attempt.signal.aborted) return;
        change([...files.current, asset]);
      }
      setProgress("Dokumenten är uppladdade. Spara inlägget för att lägga till dem.");
    } catch (failure) {
      if (mounted.current && !attempt.signal.aborted) setError(failure instanceof Error ? failure.message : "Filen kunde inte laddas upp.");
    } finally {
      if (mounted.current) {
        busyRef.current = false;
        controller.current = null;
        setBusy(false);
        onBusyChangeRef.current?.(false);
        if (input.current) input.current.value = "";
      }
    }
  }
  return <div className="group-file-upload" aria-busy={busy}>
    <div className="group-uploaded-file-list">
      {value.map((file) => <div className="group-uploaded-file" key={file.id}>
        <FileText size={24} aria-hidden="true" />
        <div className="group-uploaded-file-copy">
          <a href={file.url} target="_blank" rel="noopener noreferrer">{file.name}</a>
          <small>{fileSizeLabel(file.size)}</small>
        </div>
        <button type="button" className="group-uploaded-file-remove" disabled={disabled || busy} aria-label={`Ta bort ${file.name}`} onClick={() => {
          change(files.current.filter((item) => item.id !== file.id));
          setProgress("Dokumentet tas bort från inlägget när du sparar.");
        }}><X size={17} aria-hidden="true" /></button>
      </div>)}
    </div>
    <label className="group-upload-input-label" htmlFor={id}><FileText size={18} aria-hidden="true" />Ladda upp PDF eller Word</label>
    <input id={id} ref={input} className="group-upload-file-input" type="file" accept={UPLOAD_ACCEPT["lesson-material"]} multiple disabled={disabled || busy || value.length >= 20} onChange={(event) => void uploadFiles([...(event.target.files || [])])} />
    <p className="group-upload-help">PDF, DOC eller DOCX · högst 20 MB per fil och 20 dokument per inlägg. Du kan välja flera filer samtidigt.</p>
    {progress && <p className="group-upload-progress" role="status">{busy && <LoaderCircle className="admin-submit-spinner" size={15} aria-hidden="true" />}{progress}</p>}
    {error && <p className="group-upload-error" role="alert">{error}</p>}
  </div>;
}
