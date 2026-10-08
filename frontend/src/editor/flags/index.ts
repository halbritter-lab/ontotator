import de from "./de.svg";
import es from "./es.svg";
import fr from "./fr.svg";
import gb from "./gb.svg";
import nl from "./nl.svg";

/**
 * Bundled flag images by language code. Emoji flags are not an option: Windows
 * renders them as two letters, and the portable bundle runs without network.
 */
const FLAGS: Record<string, string> = { en: gb, de, es, fr, nl };

/** The flag image for a language, or undefined when none is bundled. */
export const flagFor = (language: string): string | undefined => FLAGS[language.toLowerCase()];
