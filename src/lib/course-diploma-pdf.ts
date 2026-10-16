import "server-only";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { z } from "zod";
import { assertCourseDiplomaTextSupported, cleanDiplomaText as clean, diplomaFontBytes as fontBytes } from "./diploma-fonts";

const snapshotSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/), studentName: z.string().min(1).max(100), courseTitle: z.string().min(1).max(180),
  issuerName: z.string().min(1).max(100), completedAt: z.iso.datetime({ offset: true }), issuedAt: z.iso.datetime({ offset: true }),
});
export type CourseDiplomaSnapshot = z.infer<typeof snapshotSchema>;
const gold = rgb(0.67, 0.43, 0.12), brightGold = rgb(0.87, 0.60, 0.20);
const ink = rgb(0.07, 0.07, 0.07), muted = rgb(0.39, 0.39, 0.39);
const width = 841.89, height = 595.28;
const dateText = (value: string) => new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Stockholm" }).format(new Date(value));

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [], words = text.split(" "); let line = "";
  for (const word of words) {
    const proposed = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(proposed, size) <= maxWidth) { line = proposed; continue; }
    if (line) { lines.push(line); line = ""; }
    // Long names and unbroken course titles must wrap without clipping.
    for (const { segment } of new Intl.Segmenter("sv", { granularity: "grapheme" }).segment(word)) {
      if (line && font.widthOfTextAtSize(line + segment, size) > maxWidth) { lines.push(line); line = ""; }
      line += segment;
    }
  }
  if (line) lines.push(line);
  return lines;
}
function fit(text: string, font: PDFFont, maxWidth: number, maxLines: number, startSize: number) {
  for (let size = startSize; size >= 9; size--) {
    const lines = wrap(text, font, size, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  throw new Error("Diplomets text ryms inte.");
}
function center(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color = ink) {
  page.drawText(text, { x: (width - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
}

/** Generates a private PDF from the immutable issued snapshot. No remote fonts,
 * signatures, credentials, current course content or other students are read.
 */
export async function createCourseDiplomaPdf(input: CourseDiplomaSnapshot, options: { preview?: boolean } = {}): Promise<Uint8Array> {
  const snapshot = snapshotSchema.parse(input);
  await assertCourseDiplomaTextSupported(snapshot);
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(await fontBytes("Poppins-Regular.ttf"), { subset: true });
  const semibold = await doc.embedFont(await fontBytes("Poppins-SemiBold.ttf"), { subset: true });
  const characterSets = new Map<PDFFont, Set<number>>();
  const supports = (font: PDFFont, text: string) => {
    let set = characterSets.get(font); if (!set) { set = new Set(font.getCharacterSet()); characterSets.set(font, set); }
    return [...text].every(character => /\p{Cf}/u.test(character) || set!.has(character.codePointAt(0)!));
  };
  const fallbacks = new Map<string, PDFFont>();
  async function fontFor(text: string, bold = false) {
    const primary = bold ? semibold : regular; if (supports(primary, text)) return primary;
    for (const name of ["NotoSans-Regular.ttf", "NotoSansArabic-Regular.ttf"]) {
      let font = fallbacks.get(name); if (!font) { font = await doc.embedFont(await fontBytes(name), { subset: true }); fallbacks.set(name, font); }
      if (supports(font, text)) return font;
    }
    throw new Error("Diplomets text innehåller tecken som den installerade mallen saknar.");
  }
  const studentName = clean(snapshot.studentName), courseTitle = clean(snapshot.courseTitle), issuerName = clean(snapshot.issuerName);
  const nameFont = await fontFor(studentName, true), courseFont = await fontFor(courseTitle, true), issuerFont = await fontFor(issuerName, true);
  const page = doc.addPage([width, height]);
  doc.setTitle(`Diplom - ${courseTitle}`); doc.setAuthor(issuerName); doc.setSubject("Intyg om genomförd kurs");
  doc.setCreator("Slowlax"); doc.setProducer("Slowlax"); doc.setLanguage("sv-SE");
  doc.setCreationDate(new Date(snapshot.issuedAt)); doc.setModificationDate(new Date(snapshot.issuedAt));
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 0.994, 0.98) });
  page.drawRectangle({ x: 27, y: 27, width: width - 54, height: height - 54, borderColor: brightGold, borderWidth: 0.8 });
  page.drawRectangle({ x: 35, y: 35, width: width - 70, height: height - 70, borderColor: rgb(0.90, 0.86, 0.78), borderWidth: 0.35 });
  page.drawRectangle({ x: 52, y: 515, width: 154, height: 43, color: ink });
  page.drawText("SLOWLAX", { x: 68, y: 528, font: semibold, size: 21, color: rgb(1, 1, 1) });
  const motto = options.preview ? "LAYOUTEXEMPEL - EJ UTFÄRDAT DIPLOM" : "KUNSKAP FÖR EN MEDVETEN FRAMTID";
  page.drawText(motto, { x: width - 66 - regular.widthOfTextAtSize(motto, 7.2), y: 535, font: regular, size: 7.2, color: muted });
  center(page, "DIPLOM", 441, semibold, 45);
  page.drawLine({ start: { x: width / 2 - 28, y: 421 }, end: { x: width / 2 + 28, y: 421 }, color: brightGold, thickness: 2 });
  center(page, "Härmed intygas att", 390, regular, 11, muted);
  const name = fit(studentName, nameFont, 686, 2, 35);
  let y = 348;
  for (const line of name.lines) { center(page, line, y, nameFont, name.size); y -= name.size * 1.2; }
  const nameBottom = y + name.size * 1.2;
  const introY = nameBottom - 34;
  center(page, "har genomfört kursen", introY, regular, 11, muted);
  const course = fit(courseTitle, courseFont, 680, 3, 24);
  y = introY - 34;
  for (const line of course.lines) { center(page, line, y, courseFont, course.size, gold); y -= course.size * 1.24; }
  const statementY = y + course.size * 1.24 - 28;
  center(page, "Kursens samtliga genomförandekrav är uppfyllda.", statementY, regular, 9.5, muted);
  page.drawLine({ start: { x: 67, y: 131 }, end: { x: width - 67, y: 131 }, color: rgb(0.85, 0.80, 0.69), thickness: 0.5 });
  page.drawText("GENOMFÖRD", { x: 68, y: 101, font: regular, size: 7.2, color: muted });
  page.drawText(dateText(snapshot.completedAt), { x: 68, y: 79, font: semibold, size: 12, color: ink });
  page.drawCircle({ x: width / 2, y: 89, size: 21, borderColor: brightGold, borderWidth: 1.4 });
  page.drawCircle({ x: width / 2, y: 89, size: 16, borderColor: rgb(0.90, 0.83, 0.68), borderWidth: 0.6 });
  page.drawLine({ start: { x: width / 2 - 7, y: 89 }, end: { x: width / 2 - 1, y: 83 }, color: gold, thickness: 1.7 });
  page.drawLine({ start: { x: width / 2 - 1, y: 83 }, end: { x: width / 2 + 9, y: 96 }, color: gold, thickness: 1.7 });
  const issuer = fit(issuerName, issuerFont, 220, 1, 13);
  const issuerX = width - 68 - issuerFont.widthOfTextAtSize(issuerName, issuer.size);
  page.drawText("UTFÄRDAT AV", { x: width - 68 - regular.widthOfTextAtSize("UTFÄRDAT AV", 7.2), y: 101, font: regular, size: 7.2, color: muted });
  page.drawText(issuerName, { x: issuerX, y: 79, font: issuerFont, size: issuer.size, color: ink });
  page.drawText(`Utfärdat ${dateText(snapshot.issuedAt)}`, { x: 68, y: 58, font: regular, size: 7, color: muted });
  const identifier = `Diplom-ID: ${snapshot.id}`;
  page.drawText(identifier, { x: width - 68 - regular.widthOfTextAtSize(identifier, 7), y: 58, font: regular, size: 7, color: muted });
  return doc.save();
}
