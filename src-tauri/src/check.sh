# Hostmoor Server-Check: liest nur, verändert nichts.
# Gibt Zeilen "schlüssel=wert" aus; ausgewertet wird in check.rs.
# Achtung: keine einfachen Anführungszeichen verwenden (wird per sh -c übergeben).

PATH="$PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:$HOME/bin:$HOME/.local/bin:$HOME/.config/composer/vendor/bin:$HOME/.composer/vendor/bin"
export COMPOSER_ALLOW_SUPERUSER=1 COMPOSER_NO_INTERACTION=1 NO_COLOR=1
# Node über nvm (z. B. bei Forge/Ploi oder eigener Installation)
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

have() { command -v "$1" >/dev/null 2>&1; }
# Befehl mit Zeitlimit, ohne Eingabe; die ersten Ausgabezeilen als schlüssel=wert
# (mehrere Zeilen, weil manche Tools vorher Warnungen ausgeben, z. B. PHP-Deprecations bei Composer)
probe() {
  key=$1; shift
  have "$1" || return 0
  if have timeout; then out=$(timeout 15 "$@" </dev/null 2>&1 | head -n 30 | tr "\n" " ")
  else out=$("$@" </dev/null 2>&1 | head -n 30 | tr "\n" " "); fi
  [ -n "$out" ] && printf "%s=%s\n" "$key" "$out"
}

echo "hostmoor-check=1"

if [ -r /etc/os-release ]; then
  . /etc/os-release
  echo "os_name=${NAME:-}"
  echo "os_version=${VERSION_ID:-}"
  echo "os_pretty=${PRETTY_NAME:-}"
fi
echo "kernel=$(uname -r)"
[ -r /proc/uptime ] && echo "uptime=$(cut -d " " -f 1 /proc/uptime)"
[ -r /proc/loadavg ] && echo "load=$(cut -d " " -f 1-3 /proc/loadavg)"
have nproc && echo "cores=$(nproc)"
if [ -r /proc/meminfo ]; then
  echo "mem_total_kb=$(awk "/^MemTotal:/ {print \$2}" /proc/meminfo)"
  echo "mem_available_kb=$(awk "/^MemAvailable:/ {print \$2}" /proc/meminfo)"
fi
df -kP -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs 2>/dev/null \
  | awk "NR > 1 { print \"disk=\" \$6 \" \" \$2 \" \" \$3 }"

if have php; then
  echo "php_version=$(php -r "echo PHP_VERSION;" 2>/dev/null </dev/null)"
  echo "php_memory_limit=$(php -r "echo ini_get(\"memory_limit\");" 2>/dev/null </dev/null)"
  echo "php_upload_max_filesize=$(php -r "echo ini_get(\"upload_max_filesize\");" 2>/dev/null </dev/null)"
  echo "php_extensions=$(php -m 2>/dev/null </dev/null | grep -v "^\[" | grep -v "^$" | tr "\n" ",")"
fi
# Installierte PHP-Versionen: Ordner (Debian/Ubuntu, Plesk, Remi) …
for d in /etc/php/*/ /opt/plesk/php/*/ /opt/remi/php*/; do
  [ -d "$d" ] && echo "php_installed=$(basename "$d")"
done
# … und Programme mit Version im Namen (php8.3, php83, z. B. Hetzner Managed Server, cPanel)
for b in /usr/bin/php[0-9]* /usr/local/bin/php[0-9]* /opt/php*/bin/php /opt/cpanel/ea-php*/root/usr/bin/php; do
  [ -f "$b" ] && [ -x "$b" ] || continue
  # Hetzner legt zu jeder Version noch .bin.cli/.wrp.cli an, die zählen nicht extra
  case "$b" in *.bin.*|*.wrp.*) continue ;; esac
  echo "php_installed=$("$b" -r "echo PHP_MAJOR_VERSION.\".\".PHP_MINOR_VERSION;" </dev/null 2>/dev/null)"
done

# Composer: als Befehl, als composer.phar oder im Home-Verzeichnis
if have composer; then probe composer composer --version
elif have composer.phar; then probe composer composer.phar --version
elif [ -f "$HOME/composer.phar" ]; then probe composer php "$HOME/composer.phar" --version
fi
probe node node --version
probe npm npm --version
probe git git --version
probe wpcli wp --allow-root --version

probe nginx nginx -v
probe apache apache2 -v
probe apache httpd -v
probe caddy caddy version
probe litespeed lshttpd -v

probe mariadb mariadbd --version
probe mysql mysqld --version
probe mysql_client mysql --version
probe postgres psql --version

probe redis redis-server --version
probe redis_client redis-cli --version

echo "hostmoor-check-end=1"
