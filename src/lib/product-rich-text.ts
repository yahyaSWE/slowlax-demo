/** The supported, portable subset of Tiptap JSON used for product descriptions. */
type EmptyAttributes = Record<string, never>;

export type ProductRichTextMark =
  | {
      type: "bold" | "italic" | "underline" | "strike";
      attrs?: EmptyAttributes;
    }
  | {
      type: "link";
      attrs: {
        href: string;
        target?: "_blank" | "_self" | null;
        rel?: string | null;
        class?: "" | null;
        title?: string | null;
      };
    };

type InlineNode =
  | { type: "text"; text: string; marks?: ProductRichTextMark[] }
  | {
      type: "hardBreak";
      attrs?: EmptyAttributes;
      marks?: ProductRichTextMark[];
    };

type ParagraphNode = {
  type: "paragraph";
  attrs?: EmptyAttributes;
  content?: InlineNode[];
};

type ListItemNode = {
  type: "listItem";
  attrs?: EmptyAttributes;
  content: [ParagraphNode, ...BlockNode[]];
};

type BlockNode =
  | ParagraphNode
  | {
      type: "heading";
      attrs: { level: 2 | 3 };
      content?: InlineNode[];
    }
  | {
      type: "bulletList";
      attrs?: EmptyAttributes;
      content: ListItemNode[];
    }
  | {
      type: "orderedList";
      attrs?: {
        start?: number;
        type?: "1" | "a" | "A" | "i" | "I" | null;
      };
      content: ListItemNode[];
    }
  | { type: "blockquote"; attrs?: EmptyAttributes; content: BlockNode[] }
  | { type: "horizontalRule"; attrs?: EmptyAttributes }
  | {
      type: "image";
      attrs: {
        src: string;
        alt?: string | null;
        title?: string | null;
        width?: null;
        height?: null;
      };
    };

export type ProductRichTextNode = BlockNode | InlineNode | ListItemNode;

export type ProductRichTextDocument = {
  type: "doc";
  attrs?: EmptyAttributes;
  content: BlockNode[];
};

const MAX_JSON_BYTES = 120_000;
const MAX_TEXT_LENGTH = 50_000;
const MAX_NODES = 2_000;
const MAX_DEPTH = 12;
const MAX_IMAGES = 20;
export type RichTextImageNamespace = "shop" | "group";
const shopImagePath =
  /^\/api\/shop\/images\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const groupImagePath =
  /^\/api\/gruppfiler\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const blockTypes = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "horizontalRule",
  "image",
]);
const simpleMarks = new Set(["bold", "italic", "underline", "strike"]);
const safeRelTokens = new Set([
  "noopener",
  "noreferrer",
  "nofollow",
  "sponsored",
  "ugc",
]);

function invalid(message: string): never {
  throw new Error(`Produktbeskrivningen ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length
  )
    invalid(`har ogiltigt ${label}.`);
  return value as Record<string, unknown>;
}

function onlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    invalid(`innehåller otillåtna fält i ${label}.`);
}

function emptyAttrs(value: unknown): EmptyAttributes {
  const attrs = record(value, "attribut");
  onlyKeys(attrs, [], "attribut");
  return {};
}

function safeHref(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    /[\u0000-\u0020\u007f-\u009f\\]/.test(value)
  )
    invalid("innehåller en osäker länk. Använd https, http eller en lokal sökväg.");
  if (/^\/(?!\/)/.test(value) || /^#[^#]+$/.test(value)) return value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.hostname &&
        !url.username &&
        !url.password
      )
        return value;
    } catch {
      // Invalid URLs are reported with the same useful message as unsafe schemes.
    }
  }
  invalid("innehåller en osäker länk. Använd https, http eller en lokal sökväg.");
}

function parseMarks(input: unknown, addText: (value: unknown) => string): ProductRichTextMark[] {
  if (!Array.isArray(input) || input.length > 5)
    invalid("har ogiltig textformatering.");
  const seen = new Set<string>();
  return input.map((inputMark) => {
    const mark = record(inputMark, "textformatering");
    onlyKeys(mark, ["type", "attrs"], "textformatering");
    if (typeof mark.type !== "string" || seen.has(mark.type))
      invalid("har ogiltig eller upprepad textformatering.");
    seen.add(mark.type);
    if (simpleMarks.has(mark.type)) {
      return {
        type: mark.type as "bold" | "italic" | "underline" | "strike",
        ...(mark.attrs !== undefined ? { attrs: emptyAttrs(mark.attrs) } : {}),
      };
    }
    if (mark.type !== "link") invalid("innehåller otillåten textformatering.");
    const inputAttrs = record(mark.attrs, "länkattribut");
    onlyKeys(inputAttrs, ["href", "target", "rel", "class", "title"], "länkattribut");
    const attrs: Extract<ProductRichTextMark, { type: "link" }>["attrs"] = {
      href: safeHref(inputAttrs.href),
    };
    if ("target" in inputAttrs) {
      if (
        inputAttrs.target !== null &&
        inputAttrs.target !== "_blank" &&
        inputAttrs.target !== "_self"
      )
        invalid("har ett otillåtet länkmål.");
      attrs.target = inputAttrs.target;
    }
    if ("rel" in inputAttrs) {
      if (
        inputAttrs.rel !== null &&
        (typeof inputAttrs.rel !== "string" ||
          /[\u0000-\u001f\u007f-\u009f]/.test(inputAttrs.rel) ||
          inputAttrs.rel.split(" ").filter(Boolean).some((token) => !safeRelTokens.has(token)))
      )
        invalid("har otillåtna länkattribut.");
      attrs.rel = inputAttrs.rel as string | null;
    }
    if ("class" in inputAttrs) {
      if (inputAttrs.class !== null && inputAttrs.class !== "")
        invalid("innehåller otillåtna stilar för en länk.");
      attrs.class = inputAttrs.class;
    }
    if ("title" in inputAttrs)
      attrs.title = inputAttrs.title === null ? null : addText(inputAttrs.title);
    return { type: "link", attrs };
  });
}

/** Validate and clone JSON before persistence or display; never accept HTML. */
export function parseProductRichText(input: unknown, imageNamespace: RichTextImageNamespace = "shop"): ProductRichTextDocument | null {
  const imagePath = imageNamespace === "group" ? groupImagePath : shopImagePath;
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > MAX_JSON_BYTES)
      invalid("är för stor. Använd högst 120 000 byte.");
    if (!input.trim()) return null;
    try {
      input = JSON.parse(input);
    } catch {
      invalid("har ett ogiltigt JSON-format.");
    }
    if (input === null) return null;
  }
  let json: string | undefined;
  try {
    json = JSON.stringify(input);
  } catch {
    invalid("har ett ogiltigt JSON-format.");
  }
  if (!json) invalid("har ett ogiltigt JSON-format.");
  if (new TextEncoder().encode(json).length > MAX_JSON_BYTES)
    invalid("är för stor. Använd högst 120 000 byte.");

  let nodeCount = 1;
  let textLength = 0;
  const images = new Set<string>();
  const addText = (value: unknown): string => {
    if (typeof value !== "string") invalid("innehåller ogiltig text.");
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value))
      invalid("innehåller otillåtna kontrolltecken.");
    textLength += value.length;
    if (textLength > MAX_TEXT_LENGTH)
      invalid("har för mycket text. Använd högst 50 000 tecken.");
    return value;
  };

  const parseNode = (inputNode: unknown, depth: number): ProductRichTextNode => {
    if (depth > MAX_DEPTH) invalid("har för många nivåer. Använd högst 12 nivåer.");
    if (++nodeCount > MAX_NODES)
      invalid("har för många delar. Använd högst 2 000 delar.");
    const node = record(inputNode, "innehåll");
    const type = node.type;
    if (typeof type !== "string") invalid("saknar en giltig innehållstyp.");
    if (type === "text") {
      onlyKeys(node, ["type", "text", "marks"], "text");
      const text = addText(node.text);
      if (!text) invalid("innehåller en tom textdel.");
      return {
        type,
        text,
        ...(node.marks !== undefined ? { marks: parseMarks(node.marks, addText) } : {}),
      };
    }
    if (type === "hardBreak" || type === "horizontalRule") {
      onlyKeys(node, type === "hardBreak" ? ["type", "attrs", "marks"] : ["type", "attrs"], "radbrytning eller avdelare");
      return {
        type,
        ...(node.attrs !== undefined ? { attrs: emptyAttrs(node.attrs) } : {}),
        ...(type === "hardBreak" && node.marks !== undefined
          ? { marks: parseMarks(node.marks, addText) }
          : {}),
      };
    }
    if (type === "image") {
      onlyKeys(node, ["type", "attrs"], "bild");
      const inputAttrs = record(node.attrs, "bildattribut");
      onlyKeys(inputAttrs, ["src", "alt", "title", "width", "height"], "bildattribut");
      const match = typeof inputAttrs.src === "string" ? imagePath.exec(inputAttrs.src) : null;
      if (!match || match[0] !== inputAttrs.src)
        invalid("innehåller en otillåten bild. Välj en uppladdad produktbild.");
      const attrs: Extract<BlockNode, { type: "image" }>["attrs"] = {
        src: `${imageNamespace === "group" ? "/api/gruppfiler" : "/api/shop/images"}/${match[1].toLowerCase()}`,
      };
      for (const key of ["alt", "title"] as const) {
        if (key in inputAttrs)
          attrs[key] = inputAttrs[key] === null ? null : addText(inputAttrs[key]);
      }
      for (const key of ["width", "height"] as const) {
        if (key in inputAttrs) {
          if (inputAttrs[key] !== null) invalid("har otillåtna bilddimensioner.");
          attrs[key] = null;
        }
      }
      images.add(match[1].toLowerCase());
      if (images.size > MAX_IMAGES)
        invalid("har för många bilder. Använd högst 20 olika bilder.");
      return { type, attrs };
    }
    if (!blockTypes.has(type) && type !== "listItem")
      invalid("innehåller en otillåten innehållstyp.");
    onlyKeys(node, ["type", "attrs", "content"], "innehåll");
    if (node.content !== undefined && !Array.isArray(node.content))
      invalid("har ogiltigt innehåll. Innehållet måste vara en lista.");
    const children = ((node.content ?? []) as unknown[]).map((child) => parseNode(child, depth + 1));

    if (type === "paragraph" || type === "heading") {
      if (children.some((child) => child.type !== "text" && child.type !== "hardBreak"))
        invalid("har ogiltig struktur i ett stycke eller en rubrik.");
      const content = node.content !== undefined ? { content: children as InlineNode[] } : {};
      if (type === "heading") {
        const attrs = record(node.attrs, "rubrikattribut");
        onlyKeys(attrs, ["level"], "rubrikattribut");
        if (attrs.level !== 2 && attrs.level !== 3)
          invalid("har en otillåten rubriknivå. Använd rubrik 2 eller 3.");
        return { type, attrs: { level: attrs.level }, ...content };
      }
      return { type, ...(node.attrs !== undefined ? { attrs: emptyAttrs(node.attrs) } : {}), ...content };
    }
    if (type === "bulletList" || type === "orderedList") {
      if (!children.length || children.some((child) => child.type !== "listItem"))
        invalid("har ogiltig struktur i en lista.");
      const content = children as ListItemNode[];
      if (type === "bulletList")
        return { type, ...(node.attrs !== undefined ? { attrs: emptyAttrs(node.attrs) } : {}), content };
      const attrs: Extract<BlockNode, { type: "orderedList" }>["attrs"] = {};
      if (node.attrs !== undefined) {
        const inputAttrs = record(node.attrs, "listattribut");
        onlyKeys(inputAttrs, ["start", "type"], "listattribut");
        if ("start" in inputAttrs) {
          if (typeof inputAttrs.start !== "number" || !Number.isSafeInteger(inputAttrs.start) || inputAttrs.start < 1)
            invalid("har ett ogiltigt startnummer för en lista.");
          attrs.start = inputAttrs.start;
        }
        if ("type" in inputAttrs) {
          if (inputAttrs.type !== null && !["1", "a", "A", "i", "I"].includes(inputAttrs.type as string))
            invalid("har en otillåten listtyp.");
          attrs.type = inputAttrs.type as "1" | "a" | "A" | "i" | "I" | null;
        }
      }
      return { type, ...(node.attrs !== undefined ? { attrs } : {}), content };
    }
    if (!children.length || children.some((child) => !blockTypes.has(child.type)))
      invalid("har ogiltig struktur i ett citat eller en listpunkt.");
    if (type === "listItem") {
      if (children[0].type !== "paragraph")
        invalid("har en listpunkt som inte börjar med ett stycke.");
      return { type, ...(node.attrs !== undefined ? { attrs: emptyAttrs(node.attrs) } : {}), content: children as [ParagraphNode, ...BlockNode[]] };
    }
    return { type: "blockquote", ...(node.attrs !== undefined ? { attrs: emptyAttrs(node.attrs) } : {}), content: children as BlockNode[] };
  };

  const root = record(input, "dokument");
  onlyKeys(root, ["type", "attrs", "content"], "dokument");
  if (root.type !== "doc") invalid("måste vara ett dokument i JSON-format.");
  if (root.content !== undefined && !Array.isArray(root.content))
    invalid("har ogiltigt dokumentinnehåll.");
  const content = ((root.content ?? []) as unknown[]).map((node) => parseNode(node, 2));
  if (content.some((node) => !blockTypes.has(node.type)))
    invalid("har ogiltig struktur. Text måste ligga i ett stycke eller en rubrik.");
  const document: ProductRichTextDocument = {
    type: "doc",
    ...(root.attrs !== undefined ? { attrs: emptyAttrs(root.attrs) } : {}),
    content: content as BlockNode[],
  };
  // Tiptap's empty editor is a document containing an empty paragraph.
  return productRichTextText(document) || images.size || content.some((node) => node.type === "horizontalRule")
    ? document
    : null;
}

export function productRichTextImageIds(document: ProductRichTextDocument | null, imageNamespace: RichTextImageNamespace = "shop"): string[] {
  const imagePath = imageNamespace === "group" ? groupImagePath : shopImagePath;
  const ids = new Set<string>();
  const visit = (node: ProductRichTextNode) => {
    if (node.type === "image") {
      const match = imagePath.exec(node.attrs.src);
      if (match) ids.add(match[1].toLowerCase());
    }
    if ("content" in node) node.content?.forEach(visit);
  };
  document?.content.forEach(visit);
  return [...ids];
}

/** Plain visible and alternative text, without HTML or link destinations. */
export function productRichTextText(document: ProductRichTextDocument | null): string {
  const visit = (node: ProductRichTextNode): string => {
    if (node.type === "text") return node.text;
    if (node.type === "hardBreak") return "\n";
    if (node.type === "image") {
      return [...new Set([node.attrs.alt, node.attrs.title].filter((text): text is string => typeof text === "string" && !!text.trim()))].join("\n");
    }
    if (!("content" in node)) return "";
    return (node.content ?? []).map(visit).join(node.type === "paragraph" || node.type === "heading" ? "" : "\n");
  };
  return document?.content.map(visit).filter(Boolean).join("\n").trim() ?? "";
}
