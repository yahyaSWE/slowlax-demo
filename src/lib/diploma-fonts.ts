import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";

export class DiplomaTextError extends Error {}
export const DIPLOMA_FONTS = ["Poppins-Regular.ttf", "Poppins-SemiBold.ttf", "NotoSans-Regular.ttf", "NotoSansArabic-Regular.ttf"] as const;
const bytesCache = new Map<string, Promise<Buffer>>();
let supportedSets: Promise<Set<number>[]> | undefined;
export function diplomaFontBytes(name: string) {
  if (!(DIPLOMA_FONTS as readonly string[]).includes(name)) throw new Error("Okänd diplomfont.");
  let promise = bytesCache.get(name);
  if (!promise) {
    promise = readFile(join(process.cwd(), "src", "assets", "certificates", name)).catch(error => { bytesCache.delete(name); throw error; });
    bytesCache.set(name, promise);
  }
  return promise;
}
export function cleanDiplomaText(value: string) { return value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(); }
export async function assertCourseDiplomaTextSupported(input: { studentName: string; courseTitle: string; issuerName: string }) {
  supportedSets ??= Promise.all(DIPLOMA_FONTS.map(async name => new Set(fontkit.create(await diplomaFontBytes(name)).characterSet)))
    .catch(error => { supportedSets = undefined; throw error; });
  const sets = await supportedSets;
  for (const [field, value] of Object.entries(input)) {
    const text = cleanDiplomaText(value);
    if (!text || !sets.some(set => [...text].every(character => /\p{Cf}/u.test(character) || set.has(character.codePointAt(0)!)))) {
      throw new DiplomaTextError(field === "studentName"
        ? "Ditt namn innehåller tecken som diplomet inte kan visa. Uppdatera namnet under Mitt konto och försök igen."
        : "Kursnamnet eller utfärdarnamnet innehåller tecken som diplomet inte kan visa. Kontakta oss för hjälp.");
    }
  }
}
