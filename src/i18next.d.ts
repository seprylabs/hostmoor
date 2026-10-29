import type { resources } from "@/i18n";

// Type-checked keys: t("unknown.key") fails in tsc
declare module "i18next" {
  interface CustomTypeOptions {
    resources: (typeof resources)["en"];
  }
}
