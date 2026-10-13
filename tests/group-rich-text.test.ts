import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { parseGroupRichText, groupRichTextImageIds } from "../src/lib/group-rich-text";
import { parseProductRichText } from "../src/lib/product-rich-text";

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
  return nextLoad(url, context);
} });
const id = "07cf9f34-0571-46dd-8498-5fc5adb93785";
const image = (src: string) => ({ type: "image", attrs: { src, alt: '<script>alert("image")</script>', title: "En privat bild" } });
const document = (src: string) => ({ type: "doc", content: [image(src)] });

test("group images normalize UUIDs and stay separate from shop image references", () => {
  const doc = parseGroupRichText(document(`/api/gruppfiler/${id.toUpperCase()}`));
  assert.deepEqual(groupRichTextImageIds(doc), [id]);
  assert.throws(() => parseProductRichText(doc), /otillåten bild/);
  assert.throws(() => parseGroupRichText(document(`/api/shop/images/${id}`)), /otillåten bild/);
  assert.ok(parseProductRichText(document(`/api/shop/images/${id}`)));
  for (const src of ["https://example.test/image.webp", "data:image/png;base64,AA==", "javascript:alert(1)", `/api/gruppfiler/${id}?raw=1`, `/api/gruppfiler/${id}/../file`]) assert.throws(() => parseGroupRichText(document(src)), /otillåten bild/);
});

test("group JSON rejects active content and the shared renderer escapes text and image captions", async () => {
  assert.throws(() => parseGroupRichText("<p>HTML</p>"), /JSON/);
  assert.throws(() => parseGroupRichText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "länk", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] }), /osäker länk/);
  const { ProductRichText } = await import("../src/components/shop/product-rich-text");
  const markup = renderToStaticMarkup(createElement(ProductRichText, { document: parseGroupRichText(document(`/api/gruppfiler/${id}`)), imageNamespace: "group" }));
  assert.ok(markup.includes(`/api/gruppfiler/${id}`));
  assert.ok(markup.includes("&lt;script&gt;"));
  assert.ok(!markup.includes("<script>"));
  assert.ok(markup.includes("<figcaption>En privat bild</figcaption>"));
});

test("actual Tiptap schema defaults for group images, links and lists round-trip through validation", () => {
  const schema = getSchema([StarterKit.configure({ code: false, codeBlock: false, heading: { levels: [2, 3] }, link: { HTMLAttributes: { target: null, rel: "noopener noreferrer", class: null } } }), Image]);
  const generated = schema.nodeFromJSON({ type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Månadens material" }] },
    { type: "paragraph", content: [{ type: "text", text: "Läs mer", marks: [{ type: "bold" }, { type: "link", attrs: { href: "/elevportal/grupper" } }] }] },
    { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Första veckan" }] }] }] },
    { type: "image", attrs: { src: `/api/gruppfiler/${id}`, alt: "Övning", title: "Veckans övning" } },
  ] }).toJSON();
  assert.deepEqual(parseGroupRichText(generated), JSON.parse(JSON.stringify(generated)));
  assert.deepEqual(groupRichTextImageIds(parseGroupRichText(generated)), [id]);
});
