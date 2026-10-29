import { createMessageComponents } from "@riic/shell/LanguageProvider";
import { features } from "./feature-manifest";
export const { withMessages, lazyWithMessages } = createMessageComponents(features);
