"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { NodeSelection, type SelectionBookmark } from "@tiptap/pm/state";
import {
  Bold, ImagePlus, Italic, Link2, Link2Off, List, ListOrdered,
  LoaderCircle, Minus, Quote, Redo2, Strikethrough, Trash2, Underline, Undo2,
} from "lucide-react";
import { parseGroupRichText } from "@/lib/group-rich-text";
import { uploadGroupFile } from "@/lib/group-upload-client";
import "./group-rich-editor.css";

const IMAGE_PATH = /^\/api\/gruppfiler\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const EMPTY_DOCUMENT = { type: "doc", content: [{ type: "paragraph" }] };
const IMAGE_LIMIT = 2 * 1024 * 1024;

function safeLink(href: string) {
  try {
    return Boolean(parseGroupRichText({
      type: "doc",
      content: [{ type: "paragraph", content: [{
        type: "text", text: "Länk", marks: [{ type: "link", attrs: { href } }],
      }] }],
    }));
  } catch {
    return false;
  }
}

// A pasted document may contain tracking images or media. Only uploaded group
// images reach ProseMirror; the template stays inert while the HTML is cleaned.
function cleanPastedHTML(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script,style,link,meta,base,iframe,object,embed,svg,math,video,audio,source,picture,figcaption").forEach((node) => node.remove());
  template.content.querySelectorAll("img").forEach((image) => {
    if (!IMAGE_PATH.test(image.getAttribute("src") || "")) {
      image.remove();
      return;
    }
    for (const attribute of [...image.attributes]) {
      if (!["src", "alt", "title"].includes(attribute.name)) image.removeAttribute(attribute.name);
    }
  });
  template.content.querySelectorAll("a").forEach((link) => {
    if (!safeLink(link.getAttribute("href") || "")) link.removeAttribute("href");
    for (const attribute of [...link.attributes]) {
      if (!["href", "title"].includes(attribute.name)) link.removeAttribute(attribute.name);
    }
  });
  template.content.querySelectorAll("ol").forEach((list) => {
    const start = Number(list.getAttribute("start"));
    if (!Number.isSafeInteger(start) || start < 1) list.removeAttribute("start");
    if (!["1", "a", "A", "i", "I"].includes(list.getAttribute("type") || "")) list.removeAttribute("type");
  });
  template.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("on") || ["style", "srcset", "background"].includes(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return template.innerHTML;
}

const GroupImage = Image.extend({
  addInputRules() {
    // Markdown image syntax must not insert an external URL as a live image.
    return [];
  },
  parseHTML() {
    return [{ tag: "img[src]", getAttrs: (element) => IMAGE_PATH.test(element.getAttribute("src") || "") ? null : false }];
  },
  renderHTML({ HTMLAttributes }) {
    const image = ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
    return HTMLAttributes.title
      ? ["figure", { class: "group-rich-editor-image" }, image, ["figcaption", {}, String(HTMLAttributes.title)]]
      : ["figure", { class: "group-rich-editor-image" }, image];
  },
}).configure({ allowBase64: false });

function ToolButton({ label, children, active, disabled, onClick }: {
  label: string;
  children: ReactNode;
  active?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return <button
    type="button"
    className="group-rich-tool"
    aria-label={label}
    title={label}
    aria-pressed={active}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
  >{children}</button>;
}

function documentValue(editor: Editor) {
  return editor.isEmpty ? "" : JSON.stringify(editor.getJSON());
}

export function GroupRichEditor({ value, onChange, disabled = false, onBusyChange, groupId }: {
  groupId: number;
  value: string;
  onChange: (json: string) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const id = useId();
  const [initial] = useState(() => {
    try {
      return { content: parseGroupRichText(value) || EMPTY_DOCUMENT, error: "" };
    } catch (failure) {
      return {
        content: EMPTY_DOCUMENT,
        error: failure instanceof Error ? failure.message : "Inlägget kunde inte läsas.",
      };
    }
  });
  const [panel, setPanel] = useState<"link" | "image" | null>(null);
  const [href, setHref] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [title, setTitle] = useState("");
  const [editingImage, setEditingImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const bookmark = useRef<SelectionBookmark | null>(null);
  const upload = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const disabledRef = useRef(disabled);
  const onChangeRef = useRef(onChange);
  const onBusyChangeRef = useRef(onBusyChange);
  const lastEmitted = useRef<string | null>(null);
  const lastValue = useRef(value);
  disabledRef.current = disabled;
  onChangeRef.current = onChange;
  onBusyChangeRef.current = onBusyChange;

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable: !disabled,
    extensions: [StarterKit.configure({
      code: false,
      codeBlock: false,
      heading: { levels: [2, 3] },
      link: {
        openOnClick: false,
        defaultProtocol: "https",
        isAllowedUri: (url) => safeLink(url),
        HTMLAttributes: { target: null, rel: "noopener noreferrer", class: null },
      },
    }), GroupImage],
    content: initial.content,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Inläggstext",
        "aria-multiline": "true",
        "aria-describedby": `${id}-help`,
        class: "group-rich-content",
      },
      transformPastedHTML: cleanPastedHTML,
      handlePaste: (_view, event) => {
        if (event.clipboardData?.files.length) {
          setError("Använd bildknappen för att ladda upp en bild.");
          return true;
        }
        return false;
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (!moved) {
          if (event.dataTransfer?.files.length || event.dataTransfer?.types.includes("text/uri-list")) {
            setError("Använd bildknappen för att lägga till bilder. Länkar kan klistras in som text.");
          }
          // External HTML never bypasses the paste sanitizer through drag/drop.
          return true;
        }
        return false;
      },
    },
    onTransaction: ({ transaction }) => {
      if (bookmark.current && transaction.docChanged) bookmark.current = bookmark.current.map(transaction.mapping);
    },
    onUpdate: ({ editor: changedEditor }) => {
      const next = documentValue(changedEditor);
      lastEmitted.current = next;
      onChangeRef.current(next);
    },
  });

  const selection = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      paragraph: current.isActive("paragraph") && !current.isActive("bulletList") && !current.isActive("orderedList") && !current.isActive("blockquote"),
      heading2: current.isActive("heading", { level: 2 }),
      heading3: current.isActive("heading", { level: 3 }),
      bold: current.isActive("bold"), italic: current.isActive("italic"),
      underline: current.isActive("underline"), strike: current.isActive("strike"),
      bulletList: current.isActive("bulletList"), orderedList: current.isActive("orderedList"),
      blockquote: current.isActive("blockquote"), link: current.isActive("link"),
      image: current.state.selection instanceof NodeSelection && current.state.selection.node.type.name === "image",
      canUndo: current.can().undo(), canRedo: current.can().redo(),
    } : null,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      upload.current?.abort();
      if (busyRef.current) onBusyChangeRef.current?.(false);
      busyRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled && !busy, false);
    editor.view.dom.setAttribute("aria-disabled", String(disabled || busy));
  }, [editor, disabled, busy]);

  useEffect(() => {
    if (!editor || value === lastValue.current) return;
    lastValue.current = value;
    if (value === lastEmitted.current || value === documentValue(editor)) return;
    let content;
    try {
      content = parseGroupRichText(value) || EMPTY_DOCUMENT;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Inlägget kunde inte läsas. Texten i redigeraren finns kvar.");
      return;
    }
    if (JSON.stringify(content) === JSON.stringify(editor.getJSON())) return;
    generation.current += 1;
    upload.current?.abort();
    upload.current = null;
    if (busyRef.current) onBusyChangeRef.current?.(false);
    busyRef.current = false;
    setBusy(false);
    bookmark.current = null;
    setPanel(null);
    setFile(null);
    setError("");
    setNotice("");
    lastEmitted.current = null;
    editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, value]);

  function restoreSelection() {
    if (!editor || editor.isDestroyed || !bookmark.current) return false;
    const saved = bookmark.current;
    bookmark.current = null;
    editor.view.dispatch(editor.state.tr.setSelection(saved.resolve(editor.state.doc)));
    return true;
  }

  function closePanel() {
    restoreSelection();
    setPanel(null);
    setError("");
    editor?.commands.focus();
  }

  function openLink() {
    if (!editor || disabled || busy) return;
    bookmark.current = editor.state.selection.getBookmark();
    setHref(String(editor.getAttributes("link").href || ""));
    setPanel("link");
    setError("");
    setNotice("");
  }

  function applyLink() {
    if (!editor || disabled || busy) return;
    const address = href.trim();
    if (address && !safeLink(address)) {
      setError("Ange en giltig https://- eller http://-adress, eller en lokal länk som börjar med /.");
      return;
    }
    restoreSelection();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (address) chain.setLink({ href: address }).run();
    else chain.unsetLink().run();
    setPanel(null);
    setError("");
  }

  function openImage() {
    if (!editor || disabled || busy) return;
    const selected = editor.state.selection;
    const isImage = selected instanceof NodeSelection && selected.node.type.name === "image";
    const attributes = isImage ? selected.node.attrs : null;
    bookmark.current = selected.getBookmark();
    setEditingImage(isImage);
    setAlt(String(attributes?.alt || ""));
    setTitle(String(attributes?.title || ""));
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setPanel("image");
    setError("");
    setNotice("");
  }

  function removeImage() {
    if (!editor || disabled || busy || !selection?.image) return;
    bookmark.current = null;
    setPanel(null);
    setError("");
    editor.chain().focus().deleteSelection().run();
  }

  async function applyImage() {
    if (!editor || disabled || busyRef.current) return;
    if (!alt.trim()) {
      setError("Skriv en bildbeskrivning som förklarar vad bilden visar.");
      return;
    }
    if (editingImage) {
      restoreSelection();
      if (!editor.isActive("image")) {
        setError("Markera bilden igen för att ändra dess texter.");
        return;
      }
      editor.chain().focus().updateAttributes("image", { alt: alt.trim(), title: title.trim() || null }).run();
      setPanel(null);
      setError("");
      return;
    }
    if (!file) {
      setError("Välj en bild att ladda upp.");
      return;
    }
    if (!/\.(jpe?g|png|webp)$/i.test(file.name) || (file.type && !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      setError("Välj en JPG-, PNG- eller WebP-bild.");
      return;
    }
    if (!file.size || file.size > IMAGE_LIMIT) {
      setError("Bilden får vara högst 2 MB.");
      return;
    }
    const controller = new AbortController();
    const attempt = ++generation.current;
    upload.current = controller;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    onBusyChangeRef.current?.(true);
    try {
      const result = await uploadGroupFile(groupId, "image", file, controller.signal);
      if (!mounted.current || attempt !== generation.current || editor.isDestroyed) return;
      if (!IMAGE_PATH.test(result.url)) throw new Error("Uppladdningen saknar en giltig bildreferens.");
      if (disabledRef.current) throw new Error("Bilden är uppladdad. Försök infoga den igen när formuläret är tillgängligt.");
      restoreSelection();
      const inserted = editor.chain().focus().setImage({ src: result.url, alt: alt.trim(), title: title.trim() || undefined }).run();
      if (!inserted) throw new Error("Bilden kunde inte infogas på den valda platsen. Försök igen.");
      setPanel(null);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setNotice("Bilden är infogad. Spara inlägget för att använda den.");
    } catch (failure) {
      if (!mounted.current || attempt !== generation.current || controller.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : "Bilden kunde inte laddas upp. Försök igen.");
    } finally {
      if (mounted.current && attempt === generation.current) {
        upload.current = null;
        busyRef.current = false;
        setBusy(false);
        onBusyChangeRef.current?.(false);
      }
    }
  }

  const unavailable = disabled || busy || !editor;
  return <div className="group-rich-editor" aria-busy={busy}>
    <div className="group-rich-toolbar" role="group" aria-label="Formatera inlägg">
      <div className="group-rich-tool-group">
        <ToolButton label="Vanligt stycke" active={selection?.paragraph} disabled={unavailable} onClick={() => editor?.chain().focus().setParagraph().run()}>Stycke</ToolButton>
        <ToolButton label="Rubrik 2" active={selection?.heading2} disabled={unavailable} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolButton>
        <ToolButton label="Rubrik 3" active={selection?.heading3} disabled={unavailable} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolButton>
      </div>
      <div className="group-rich-tool-group">
        <ToolButton label="Fetstil" active={selection?.bold} disabled={unavailable} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold aria-hidden="true" size={17} /></ToolButton>
        <ToolButton label="Kursiv" active={selection?.italic} disabled={unavailable} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic aria-hidden="true" size={17} /></ToolButton>
        <ToolButton label="Understruken" active={selection?.underline} disabled={unavailable} onClick={() => editor?.chain().focus().toggleUnderline().run()}><Underline aria-hidden="true" size={17} /></ToolButton>
        <ToolButton label="Genomstruken" active={selection?.strike} disabled={unavailable} onClick={() => editor?.chain().focus().toggleStrike().run()}><Strikethrough aria-hidden="true" size={17} /></ToolButton>
      </div>
      <div className="group-rich-tool-group">
        <ToolButton label="Punktlista" active={selection?.bulletList} disabled={unavailable} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List aria-hidden="true" size={18} /></ToolButton>
        <ToolButton label="Numrerad lista" active={selection?.orderedList} disabled={unavailable} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered aria-hidden="true" size={18} /></ToolButton>
        <ToolButton label="Citat" active={selection?.blockquote} disabled={unavailable} onClick={() => editor?.chain().focus().toggleBlockquote().run()}><Quote aria-hidden="true" size={17} /></ToolButton>
        <ToolButton label="Avdelare" disabled={unavailable} onClick={() => editor?.chain().focus().setHorizontalRule().run()}><Minus aria-hidden="true" size={18} /></ToolButton>
      </div>
      <div className="group-rich-tool-group">
        <ToolButton label="Lägg till eller ändra länk" active={selection?.link} disabled={unavailable} onClick={openLink}><Link2 aria-hidden="true" size={17} /></ToolButton>
        <ToolButton label="Ta bort länk" disabled={unavailable || !selection?.link} onClick={() => editor?.chain().focus().extendMarkRange("link").unsetLink().run()}><Link2Off aria-hidden="true" size={17} /></ToolButton>
        <ToolButton label={selection?.image ? "Ändra bildtexter" : "Lägg till bild"} active={selection?.image} disabled={unavailable} onClick={openImage}><ImagePlus aria-hidden="true" size={17} /><span>Bild</span></ToolButton>
        {selection?.image && <ToolButton label="Ta bort markerad bild" disabled={unavailable} onClick={removeImage}><Trash2 aria-hidden="true" size={17} /></ToolButton>}
      </div>
      <div className="group-rich-tool-group">
        <ToolButton label="Ångra" disabled={unavailable || !selection?.canUndo} onClick={() => editor?.chain().focus().undo().run()}><Undo2 aria-hidden="true" size={17} /></ToolButton>
        <ToolButton label="Gör om" disabled={unavailable || !selection?.canRedo} onClick={() => editor?.chain().focus().redo().run()}><Redo2 aria-hidden="true" size={17} /></ToolButton>
      </div>
    </div>
    {panel === "link" && <div className="group-rich-panel" role="group" aria-label="Redigera länk">
      <label htmlFor={`${id}-link`}>Länkadress</label>
      <input id={`${id}-link`} type="text" inputMode="url" value={href} disabled={unavailable} placeholder="https:// eller /butik" onChange={(event) => setHref(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); applyLink(); }
        if (event.key === "Escape") { event.preventDefault(); closePanel(); }
      }} />
      <div className="group-rich-panel-actions">
        <button type="button" className="button button-small" disabled={unavailable} onClick={applyLink}>{href.trim() ? "Använd länk" : "Ta bort länk"}</button>
        <button type="button" className="button button-secondary button-small" disabled={unavailable} onClick={closePanel}>Avbryt</button>
      </div>
    </div>}
    {panel === "image" && <div className="group-rich-panel" role="group" aria-label={editingImage ? "Ändra bildtexter" : "Ladda upp bild"}>
      {!editingImage && <>
        <label htmlFor={`${id}-file`}>Bildfil</label>
        <input ref={fileInput} id={`${id}-file`} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={unavailable} onChange={(event) => { setFile(event.target.files?.[0] || null); setError(""); }} />
        <p className="group-rich-hint">{file ? `${file.name} · ${(file.size / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 2 })} MB` : "JPG, PNG eller WebP · högst 2 MB"}</p>
      </>}
      <div className="group-rich-image-fields">
        <div>
          <label htmlFor={`${id}-alt`}>Bildbeskrivning (alternativ text)</label>
          <input id={`${id}-alt`} type="text" value={alt} maxLength={500} disabled={unavailable} placeholder="Beskriv vad bilden visar" onChange={(event) => setAlt(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); void applyImage(); }
            if (event.key === "Escape") { event.preventDefault(); closePanel(); }
          }} />
        </div>
        <div>
          <label htmlFor={`${id}-title`}>Bildtext (valfri)</label>
          <input id={`${id}-title`} type="text" value={title} maxLength={500} disabled={unavailable} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); void applyImage(); }
            if (event.key === "Escape") { event.preventDefault(); closePanel(); }
          }} />
        </div>
      </div>
      <div className="group-rich-panel-actions">
        <button type="button" className="button button-small" disabled={unavailable} onClick={() => void applyImage()}>{busy ? <><LoaderCircle size={16} className="admin-submit-spinner" aria-hidden="true" /> Laddar upp…</> : editingImage ? "Spara bildtexter" : "Ladda upp och infoga"}</button>
        <button type="button" className="button button-secondary button-small" disabled={unavailable} onClick={closePanel}>Avbryt</button>
      </div>
    </div>}
    <EditorContent editor={editor} />
    {!editor && <p className="group-rich-loading" role="status">Laddar redigeraren…</p>}
    <p id={`${id}-help`} className="group-rich-hint">Formatera texten och lägg till bilder där de ska visas. Markera en bild för att ändra dess texter eller ta bort den.</p>
    {busy && <p className="group-rich-status" role="status">Laddar upp bilden… Vänta tills den är infogad innan du sparar inlägget.</p>}
    {notice && <p className="group-rich-status" role="status">{notice}</p>}
    {error && <p className="notice notice-error group-rich-error" role="alert">{error}</p>}
  </div>;
}
