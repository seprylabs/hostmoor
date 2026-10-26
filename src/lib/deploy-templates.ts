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
# Falls Queues laufen:
# php artisan queue:restart`,
    },
    {
      label: "Laravel mit Wartungsmodus",
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
# Mit WP-CLI nach Core-Updates die Datenbank aktualisieren:
# wp core update-db
# wp cache flush`,
    },
  ],
  static: [
    {
      label: "Statische Seite",
      script: `git pull --ff-only
# Falls gebaut werden muss:
# npm ci
# npm run build`,
    },
  ],
  other: [{ label: "Git Pull", script: "git pull --ff-only" }],
};
