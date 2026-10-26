// Translation with the Spanish phrases loaded (the server, the tests). The
// page uses core.ts and loads the phrases only for Spanish (web/src/i18n.ts).

import { useSpanish } from "./core.ts";
import { ES_PATTERNS, ES_PHRASES } from "./es.ts";

useSpanish(ES_PHRASES, ES_PATTERNS);

export * from "./core.ts";
