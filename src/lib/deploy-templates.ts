import i18n from "i18next";

import type { Stack } from "@/types";

export interface DeployTemplate {
  label: string;
  script: string;
}

// Läuft im Projektordner mit bash; jeder Befehl wird angezeigt, beim ersten Fehler ist Schluss.
export const deployTemplates: Record<Stack, DeployTemplate[]> = {
  laravel: [
    {
      label: "Laravel",
      script: `git pull --ff-only
composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader
php artisan migrate --force
php artisan optimize
npm ci
npm run build
# If you use queues:
# php artisan queue:restart`,
    },
    {
      // Getter, damit das Label bei jedem Zugriff in der aktuellen Sprache kommt
      get label() {
        return i18n.t("deployTemplates.laravelMaintenance");
      },
      script: `php artisan down --retry=15
trap "php artisan up" EXIT
git pull --ff-only
composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader
php artisan migrate --force
php artisan optimize
npm ci
npm run build`,
    },
  ],
  wordpress: [
    {
      label: "WordPress (Git)",
      script: `git pull --ff-only
if [ -f composer.json ]; then composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader; fi
# With WP-CLI, update the database after core updates:
# wp core update-db
# wp cache flush`,
    },
  ],
  static: [
    {
      get label() {
        return i18n.t("deployTemplates.staticSite");
      },
      script: `git pull --ff-only
# If the site needs a build step:
# npm ci
# npm run build`,
    },
  ],
  other: [{ label: "Git Pull", script: "git pull --ff-only" }],
};
