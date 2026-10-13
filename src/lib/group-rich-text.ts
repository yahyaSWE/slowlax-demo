import {
  parseProductRichText,
  productRichTextImageIds,
  type ProductRichTextDocument,
} from "./product-rich-text";

/** Groups accept the same safe JSON subset, with their own private image URLs. */
export function parseGroupRichText(input: unknown): ProductRichTextDocument | null {
  try {
    return parseProductRichText(input, "group");
  } catch (error) {
    if (error instanceof Error)
      throw new Error(error.message.replace(/^Produktbeskrivningen/, "Inlägget").replace("produktbild", "gruppbild"));
    throw error;
  }
}

export function groupRichTextImageIds(document: ProductRichTextDocument | null): string[] {
  return productRichTextImageIds(document, "group");
}
