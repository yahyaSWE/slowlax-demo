import { Fragment, type ReactNode } from "react";
import {
  parseProductRichText,
  type ProductRichTextDocument,
  type ProductRichTextMark,
  type ProductRichTextNode,
  type RichTextImageNamespace,
} from "@/lib/product-rich-text";
import "./product-rich-text.css";

function renderMarks(text: ReactNode, marks: ProductRichTextMark[] = []): ReactNode {
  return marks.reduce<ReactNode>((content, mark, index) => {
    switch (mark.type) {
      case "bold":
        return <strong key={index}>{content}</strong>;
      case "italic":
        return <em key={index}>{content}</em>;
      case "underline":
        return <u key={index}>{content}</u>;
      case "strike":
        return <s key={index}>{content}</s>;
      case "link": {
        const rel = [...new Set(["noopener", "noreferrer", ...(mark.attrs.rel?.split(" ").filter(Boolean) ?? [])])].join(" ");
        return <a key={index} href={mark.attrs.href} target={mark.attrs.target ?? undefined} title={mark.attrs.title ?? undefined} rel={rel}>{content}</a>;
      }
    }
  }, text);
}

function renderNode(node: ProductRichTextNode, key: number): ReactNode {
  const children = "content" in node ? node.content?.map(renderNode) : undefined;
  switch (node.type) {
    case "text":
      return <Fragment key={key}>{renderMarks(node.text, node.marks)}</Fragment>;
    case "hardBreak":
      return <Fragment key={key}>{renderMarks(<br />, node.marks)}</Fragment>;
    case "paragraph":
      return <p key={key}>{children}</p>;
    case "heading":
      return node.attrs.level === 2 ? <h2 key={key}>{children}</h2> : <h3 key={key}>{children}</h3>;
    case "bulletList":
      return <ul key={key}>{children}</ul>;
    case "orderedList":
      return <ol key={key} start={node.attrs?.start} type={node.attrs?.type ?? undefined}>{children}</ol>;
    case "listItem":
      return <li key={key}>{children}</li>;
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;
    case "horizontalRule":
      return <hr key={key} />;
    case "image":
      return (
        <figure key={key}>
          <img src={node.attrs.src} alt={node.attrs.alt ?? ""} title={node.attrs.title ?? undefined} loading="lazy" decoding="async" />
          {node.attrs.title?.trim() && <figcaption>{node.attrs.title}</figcaption>}
        </figure>
      );
  }
}

/** Render the validated structure as escaped React elements, including captions. */
export function ProductRichText({ document, imageNamespace = "shop" }: { document: ProductRichTextDocument | null; imageNamespace?: RichTextImageNamespace }) {
  const validated = parseProductRichText(document, imageNamespace);
  if (!validated) return null;
  return <div className="product-rich-text">{validated.content.map(renderNode)}</div>;
}
